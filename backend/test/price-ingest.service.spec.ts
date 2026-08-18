import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { usdToMxnCents } from '../src/common/money';
import { cardNumberVariants } from '../src/modules/pricing/pricing.types';

/**
 * WS-A (v1.14-price-ingest, §4.15c/§4.15d) — PriceIngestService:
 *  - el dial `PRICE_PROVIDER` elige el provider;
 *  - upsert por ACABADO (una persistMarketReference por finish) con el FX del snapshot;
 *  - resolución de carta (externalId primario, (set,number) fallback), omite las no resueltas.
 * + PricingService.persistMarketReference generalizado (source + moneda USD/MXN).
 *
 * v1.22-variantes-orden (§4.22a) — CERO ESCRITURAS sobre `Card` desde este servicio.
 * `availableFinishes` DEJA de derivarse/escribirse aquí (§4.15e DEROGADA, VAR-1 §9): la autoridad
 * única es `CatalogSyncService.upsertCards`. En su lugar, este servicio LEE (nunca escribe) el
 * catálogo de acabados de las cartas tocadas para loguear `finishNotInCatalog` cuando el proveedor
 * reporta un acabado que `Card.availableFinishes` no declara (drift observable, dato inocuo: el
 * quote valida el finish contra el catálogo ANTES de leer precio).
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
        // §4.22a — lectura de SOLO LECTURA del catálogo de acabados (drift/`finishNotInCatalog`).
        // Por default el catálogo NO conoce ningún finish extra → sin drift en estos tests.
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
      },
      ...overrides,
    } as any;
  }

  const fx = { rate: 18, bufferPct: 3 };

  it('persiste una referencia por acabado (source+moneda del provider) y NO toca Card (§4.22a)', async () => {
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
    // v1.22 (§4.22a) — CERO escrituras sobre `Card`: ni siquiera cuando el proveedor reporta 2
    // acabados. La autoridad de `availableFinishes` es SOLO el sync de catálogo.
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(res).toMatchObject({ cardCount: 1, priced: 2, unresolved: 0 });
  });

  it('finishNotInCatalog: el proveedor reporta un acabado FUERA de Card.availableFinishes → se LOGUEA, NO se escribe', async () => {
    const provider = providerMock('pokemonpricetracker', [
      { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 300, currency: 'USD' },
    ]);
    // El catálogo SOLO conoce ['normal'] para db-1 → 'holofoil' es DRIFT.
    const prisma = prismaMock({
      card: {
        findUnique: jest.fn(async ({ where }: any) => (where.externalId === 'sv8-1' ? { id: 'db-1' } : null)),
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => [{ id: 'db-1', externalId: 'sv8-1', availableFinishes: ['normal'] }]),
        update: jest.fn(async () => ({})),
      },
    });
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await svc.ingestSet('local-sv8', fx);

    // El PRECIO sí se persiste (dato inocuo: el quote valida el finish antes de leer precio).
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-1', 'holofoil', expect.objectContaining({ marketCents: 300 }), fx,
    );
    // El CATÁLOGO no se toca nunca.
    expect(prisma.card.update).not.toHaveBeenCalled();
    // La divergencia queda LOGUEADA como finishNotInCatalog.
    expect(warnSpy.mock.calls.some(([msg]) => String(msg).includes('finishNotInCatalog'))).toBe(true);
    warnSpy.mockRestore();
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
    expect(prisma.card.update).not.toHaveBeenCalled();
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

  it('proveedor sin filas válidas → sigue sin tocar Card (cero escrituras, §4.22a)', async () => {
    const provider = providerMock('pokemonpricetracker', []);
    const prisma = prismaMock();
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);

    await svc.ingestSet('local-sv8', fx);
    expect(prisma.card.update).not.toHaveBeenCalled();
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

/**
 * Auditoría de precios (2026-08-17) — `hasRecentIngest` alimenta el catch-up al boot:
 * "reciente" = ≥1 PriceReference NO-manual con capturedDate ≥ ayer 00:00 UTC. Los overrides
 * manuales del admin NO cuentan como ingesta.
 */
describe('PriceIngestService.hasRecentIngest — señal del catch-up al boot', () => {
  function buildWithRef(row: unknown) {
    const prisma = { priceReference: { findFirst: jest.fn(async () => row) } } as any;
    const svc = new PriceIngestService(
      prisma,
      settingsMock('pokemontcg_io') as any,
      {} as PricingService,
      {} as any,
      {} as any,
    );
    return { svc, prisma };
  }

  it('hay referencia no-manual reciente → true', async () => {
    const { svc } = buildWithRef({ id: 'ref-1' });
    await expect(svc.hasRecentIngest()).resolves.toBe(true);
  });

  it('sin referencias recientes → false, y el filtro excluye manuales y acota a ayer 00:00 UTC', async () => {
    const { svc, prisma } = buildWithRef(null);
    await expect(svc.hasRecentIngest()).resolves.toBe(false);

    const where = prisma.priceReference.findFirst.mock.calls[0][0].where;
    expect(where.isManualOverride).toBe(false);
    const since: Date = where.capturedDate.gte;
    const expected = new Date();
    expected.setUTCHours(0, 0, 0, 0);
    expected.setUTCDate(expected.getUTCDate() - 1);
    expect(since.toISOString()).toBe(expected.toISOString());
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

/**
 * P-6 (2026-08-18) — el proveedor de paga publica `cardNumber`, que puede venir con el total del
 * set (`"104/159"`) o con ceros a la izquierda (`"004"`), mientras `Card.number` viene de
 * pokemontcg.io (`"104"`). El fallback `(set, number)` tolera esas formas SIN adivinar la carta.
 */
describe('cardNumberVariants — formas equivalentes del número de carta', () => {
  it('corta el total del set: "104/159" → incluye "104"', () => {
    expect(cardNumberVariants('104/159')).toContain('104');
  });

  it('tolera el relleno de ceros en ambos sentidos', () => {
    expect(cardNumberVariants('004')).toEqual(expect.arrayContaining(['4', '04']));
    expect(cardNumberVariants('4')).toEqual(expect.arrayContaining(['04', '004']));
  });

  it('NO toca los números alfanuméricos (TG01, SV107) ni devuelve el valor exacto', () => {
    expect(cardNumberVariants('TG01')).toEqual([]);
    expect(cardNumberVariants('104')).not.toContain('104');
    expect(cardNumberVariants('  ')).toEqual([]);
  });
});

describe('PriceIngestService.resolveCardId — fallback por número con formato distinto (P-6)', () => {
  const fx = { rate: 18, bufferPct: 3 };

  function build(cards: { findFirst: jest.Mock; findMany?: jest.Mock }) {
    // §4.22a añadió una SEGUNDA consulta `card.findMany` (lectura del catálogo de acabados para
    // `finishNotInCatalog`), con forma `where.id.in`. Se enruta por forma del `where` para no
    // interferir con la de este describe, que es la del fallback por NÚMERO (`where.number.in`).
    const variantFindMany = cards.findMany ?? jest.fn(async () => []);
    const routedFindMany = jest.fn(async (args: any) => {
      if (args?.where?.id) return []; // catálogo de acabados: sin drift en estos tests
      return variantFindMany(args);
    });
    const prisma = {
      cardSet: { findUnique: jest.fn(async () => SET) },
      card: {
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        findFirst: cards.findFirst,
        findMany: routedFindMany,
      },
    } as any;
    const pricing = { persistMarketReference: jest.fn(async () => {}) };
    const provider = providerMock('pokemonpricetracker', [
      { externalId: null, setExternalId: 'sv8', number: '104/159', finish: 'normal', marketCents: 100, currency: 'USD' },
    ]);
    const svc = new PriceIngestService(prisma, settingsMock('pokemonpricetracker') as any, pricing as any, provider as any, {} as any);
    return { svc, prisma, pricing, variantFindMany };
  }

  it('"104/159" del proveedor resuelve a la carta "104" del set (coincidencia ÚNICA)', async () => {
    const findMany = jest.fn(async () => [{ id: 'db-104' }]);
    const { svc, prisma, pricing, variantFindMany } = build({ findFirst: jest.fn(async () => null), findMany });

    const res = await svc.ingestSet('local-sv8', fx);

    // Primero se intentó el número EXACTO; solo al fallar se probaron las variantes.
    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setId: 'local-sv8', number: '104/159' } }),
    );
    const variantsWhere = (variantFindMany.mock.calls[0] as unknown[])[0] as { where: { number: { in: string[] } } };
    expect(variantsWhere.where.number.in).toContain('104');
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-104', 'normal', expect.objectContaining({ marketCents: 100 }), fx,
    );
    expect(res.unresolved).toBe(0);
  });

  it('el número EXACTO manda: si casa, NO se consultan variantes', async () => {
    const findMany = jest.fn(async () => []);
    const { svc, pricing, variantFindMany } = build({ findFirst: jest.fn(async () => ({ id: 'db-exact' })), findMany });

    await svc.ingestSet('local-sv8', fx);
    expect(variantFindMany).not.toHaveBeenCalled();
    expect(pricing.persistMarketReference).toHaveBeenCalledWith(
      'db-exact', 'normal', expect.objectContaining({ marketCents: 100 }), fx,
    );
  });

  it('variantes AMBIGUAS (2 cartas casan) → se OMITE la fila (no se adivina la carta)', async () => {
    const findMany = jest.fn(async () => [{ id: 'db-a' }, { id: 'db-b' }]);
    const { svc, pricing } = build({ findFirst: jest.fn(async () => null), findMany });

    const res = await svc.ingestSet('local-sv8', fx);
    expect(pricing.persistMarketReference).not.toHaveBeenCalled();
    expect(res.unresolved).toBe(1);
  });
});
