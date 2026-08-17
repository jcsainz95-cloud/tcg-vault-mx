import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { usdToMxnCents } from '../src/common/money';

/**
 * WS-A (v1.14-price-ingest, §4.15c/§4.15d/§4.15e) — PriceIngestService:
 *  - el dial `PRICE_PROVIDER` elige el provider;
 *  - upsert por ACABADO (una persistMarketReference por finish) con el FX del snapshot;
 *  - resolución de carta (externalId primario, (set,number) fallback), omite las no resueltas;
 *  - availableFinishes se DERIVA del proveedor (autoridad) y NO se clobbea si no reporta nada.
 * + PricingService.persistMarketReference generalizado (source + moneda USD/MXN).
 */

function providerMock(source: string, rows: unknown[], skipped = 0) {
  return {
    source,
    fetchPricesForSet: jest.fn(async () => ({ rows, fetchedRaw: rows.length + skipped, skipped })),
  };
}

const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks' };

function settingsMock(provider: string) {
  return { getString: jest.fn(async () => provider) };
}

describe('PriceIngestService.providerFor — el dial PRICE_PROVIDER elige el provider', () => {
  const ppt = providerMock('pokemonpricetracker', []);
  const tcg = providerMock('pokemontcg_io', []);

  function build(dial: string) {
    return new PriceIngestService(
      {} as PrismaService,
      settingsMock(dial) as any,
      {} as PricingService,
      ppt as any,
      tcg as any,
    );
  }

  it('dial=pokemonpricetracker → provider de PAGA', async () => {
    expect((await build('pokemonpricetracker').providerFor()).source).toBe('pokemonpricetracker');
  });
  it('dial=pokemontcg_io → provider LEGACY', async () => {
    expect((await build('pokemontcg_io').providerFor()).source).toBe('pokemontcg_io');
  });
  it('dial desconocido → fallback money-safe a pokemontcg_io (legacy)', async () => {
    expect((await build('garbage').providerFor()).source).toBe('pokemontcg_io');
  });
});

describe('PriceIngestService.ingestSet — upsert por acabado + availableFinishes + resolución', () => {
  function prismaMock(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      cardSet: { findUnique: jest.fn(async () => SET) },
      card: {
        findUnique: jest.fn(async ({ where }: any) => (where.externalId === 'sv8-1' ? { id: 'db-1' } : null)),
        findFirst: jest.fn(async ({ where }: any) =>
          where.setId === 'local-sv8' && where.number === '5' ? { id: 'db-5' } : null,
        ),
        update: jest.fn(async () => ({})),
      },
      ...overrides,
    } as any;
  }

  const fx = { rate: 18, bufferPct: 3 };

  it('persiste una referencia por acabado (source+moneda del provider) y deriva availableFinishes', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 150, currency: 'USD' },
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'reverse_holo', marketCents: 200, currency: 'USD' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    const res = await svc.ingestSet('local-sv8', fx);

    expect(pricing.persistMarketReference).toHaveBeenCalledTimes(2);
    // El FX del snapshot fluye tal cual; source y moneda vienen de la fila del provider.
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'normal', { marketCents: 150, currency: 'USD', source: 'pokemonpricetracker' }, fx,
    );
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'reverse_holo', { marketCents: 200, currency: 'USD', source: 'pokemonpricetracker' }, fx,
    );
    // Variantes #8: availableFinishes = acabados reportados por el proveedor (autoridad).
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'db-1' },
      data: { availableFinishes: ['normal', 'reverse_holo'] },
    });
    expect(res).toMatchObject({ cardCount: 1, priced: 2, unresolved: 0 });
  });

  it('resuelve por (set, number) cuando falta externalId (fallback §4.15d)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: null, setExternalId: 'sv8', number: '5', finish: 'normal', marketCents: 100, currency: 'USD' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-5', 'normal', expect.objectContaining({ marketCents: 100 }), fx,
    );
  });

  it('fila que NO resuelve a carta local → se OMITE (no crea referencia huérfana)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'ghost', setExternalId: 'sv8', number: null, finish: 'normal', marketCents: 100, currency: 'USD' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    const res = await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(res.unresolved).toBe(1);
  });

  it('proveedor sin filas válidas → NO clobbea availableFinishes (respeta lo existente, §4.15e)', async () => {
    const provider = providerMock('pokemonpricetracker', []);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    await svc.ingestSet('local-sv8', fx);
    expect(prisma.card.update).not.toHaveBeenCalled(); // nunca se pisa a [normal] ni a []
  });

  it('propaga la moneda MXN de la fila (el ingest no convierte MXN)', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 5000, currency: 'MXN' },
    ]);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'holofoil', { marketCents: 5000, currency: 'MXN', source: 'pokemonpricetracker' }, fx,
    );
  });

  it('set inexistente → no revienta y no persiste nada', async () => {
    const provider = providerMock('pokemonpricetracker', []);
    const prisma = { cardSet: { findUnique: jest.fn(async () => null) }, card: {} } as any;
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    const res = await svc.ingestSet('missing', fx);
    expect(res.priced).toBe(0);
    expect(provider.fetchPricesForSet).not.toHaveBeenCalled();
  });
});

describe('PricingService.persistMarketReference — generalizado (source + moneda USD/MXN)', () => {
  function pricingSvc(existing: unknown) {
    const prisma: any = {
      priceReference: { findUnique: jest.fn(async () => existing), upsert: jest.fn(async () => ({})) },
    };
    const svc = new PricingService(prisma as PrismaService, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('USD → convierte con FX+colchón, guarda priceUsdCents + fxRate/fxBufferPct + source del provider', async () => {
    const { svc, prisma } = pricingSvc(null);
    await svc.persistMarketReference(
      'c1', 'holofoil', { marketCents: 1000, currency: 'USD', source: 'pokemonpricetracker' }, { rate: 18, bufferPct: 10 },
    );
    const arg = prisma.priceReference.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil',
      source: 'pokemonpricetracker',
      priceUsdCents: 1000,
      priceMxnCents: usdToMxnCents(1000, 18, 10), // 19800
      fxRate: 18, fxBufferPct: 10,
      isManualOverride: false,
    });
  });

  it('MXN → SIN conversión ni colchón; priceUsdCents/fx* = null', async () => {
    const { svc, prisma } = pricingSvc(null);
    await svc.persistMarketReference(
      'c1', 'normal', { marketCents: 5000, currency: 'MXN', source: 'pokemonpricetracker' }, { rate: 18, bufferPct: 10 },
    );
    const arg = prisma.priceReference.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      source: 'pokemonpricetracker',
      priceMxnCents: 5000, // sin ×FX
      priceUsdCents: null,
      fxRate: null,
      fxBufferPct: null,
    });
  });

  it('respeta el override manual del admin (fila de hoy isManualOverride=true → NO upsert)', async () => {
    const { svc, prisma } = pricingSvc({ isManualOverride: true, priceMxnCents: 999 });
    await svc.persistMarketReference(
      'c1', 'normal', { marketCents: 500, currency: 'USD', source: 'pokemonpricetracker' }, { rate: 18, bufferPct: 0 },
    );
    expect(prisma.priceReference.upsert).not.toHaveBeenCalled();
  });
});
