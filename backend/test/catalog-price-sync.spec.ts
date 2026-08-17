import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { CatalogPriceSyncJobService } from '../src/jobs/catalog-price-sync.service';
import { usdToMxnCents } from '../src/common/money';

/**
 * v1.12-catalog-pricing (§4.13a/c) — Fase 1 del epic de precios (backend):
 *  (a) el `catalog-sync` pobla `PriceReference` por ACABADO desde `tcgplayer.prices` ya descargado;
 *  (b) `persistMarketReference` respeta overrides manuales (`isManualOverride=true` → skip);
 *  (c) una carta/acabado SIN market → ni referencia ni pendiente (escalate=false, §4.13a);
 *  (d) el job `catalog-price-sync` invoca el re-sync completo con `force:true`.
 */

function settings(fromDate = '2024/01/01'): SettingsService {
  return { getString: jest.fn(async () => fromDate) } as unknown as SettingsService;
}
function fxMock() {
  return {
    getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 0, source: 'manual', effectiveDate: '2026-08-17' })),
  } as unknown as FxService;
}

/** Carta remota con precios por acabado (llaves reales de tcgplayer.prices). */
function cardWithPrices(id: string, prices: Record<string, { market?: number }>) {
  return {
    id,
    name: `Card ${id}`,
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    images: { small: 's', large: 'l' },
    tcgplayer: { url: 'u', prices },
    set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
  };
}

function prismaWithCardId() {
  return {
    cardSet: {
      upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
      findMany: jest.fn(async () => []),
    },
    // upsert devuelve un id real para poder poblar PriceReference.
    card: { upsert: jest.fn(async ({ where }: any) => ({ id: `db-${where.externalId}` })) },
  } as any;
}

function clientWithCards(cards: any[]) {
  return {
    getCardsBySet: jest.fn(async () => ({
      data: cards,
      page: 1,
      pageSize: 250,
      count: cards.length,
      totalCount: cards.length,
    })),
    getSets: jest.fn(),
  } as unknown as PokemonTcgIoClient;
}

describe('CatalogSyncService — (a) pobla PriceReference por acabado desde tcgplayer.prices', () => {
  it('un finish por cada llave con market>0; FX cargado UNA sola vez por corrida', async () => {
    const prisma = prismaWithCardId();
    const client = clientWithCards([
      cardWithPrices('sv8-1', {
        normal: { market: 1.5 }, // → finish normal, 150 USD¢
        holofoil: { market: 10 }, // → finish holofoil, 1000 USD¢
        reverseHolofoil: { market: 0 }, // market<=0 → NO referencia
      }),
    ]);
    const persistMarketReference = jest.fn(async () => {});
    const pricing = { persistMarketReference } as unknown as PricingService;
    const fx = fxMock();
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings(), pricing, fx);

    await svc.sync('sv8');

    // FX una sola vez por corrida (no por carta).
    expect((fx.getCurrent as jest.Mock)).toHaveBeenCalledTimes(1);
    // Se persistió normal y holofoil; reverse (market 0) se saltó.
    expect(persistMarketReference).toHaveBeenCalledTimes(2);
    expect(persistMarketReference).toHaveBeenCalledWith('db-sv8-1', 'normal', 150, expect.objectContaining({ rate: 18 }));
    expect(persistMarketReference).toHaveBeenCalledWith('db-sv8-1', 'holofoil', 1000, expect.objectContaining({ rate: 18 }));
    const finishes = persistMarketReference.mock.calls.map((c: any) => c[1]);
    expect(finishes).not.toContain('reverse_holo');
  });
});

describe('CatalogSyncService — (c) carta SIN market → ni referencia ni pendiente', () => {
  it('carta sin tcgplayer.prices no llama persistMarketReference', async () => {
    const prisma = prismaWithCardId();
    // Carta sin bloque tcgplayer → availableFinishes default [normal], sin precios.
    const bareCard = {
      id: 'sv8-2', name: 'Bare', number: '2', rarity: 'Common', supertype: 'Pokémon', subtypes: [],
      images: { small: 's', large: 'l' },
      set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    };
    const client = clientWithCards([bareCard]);
    const persistMarketReference = jest.fn(async () => {});
    const pricing = { persistMarketReference } as unknown as PricingService;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings(), pricing, fxMock());

    await svc.sync('sv8');
    // La carta se importó igual (upsert), pero SIN referencia de precio.
    expect(prisma.card.upsert).toHaveBeenCalledTimes(1);
    expect(persistMarketReference).not.toHaveBeenCalled();
  });

  it('carta con prices pero todos market<=0 no llama persistMarketReference', async () => {
    const prisma = prismaWithCardId();
    const client = clientWithCards([
      cardWithPrices('sv8-3', { normal: { market: 0 }, holofoil: {} }),
    ]);
    const persistMarketReference = jest.fn(async () => {});
    const pricing = { persistMarketReference } as unknown as PricingService;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings(), pricing, fxMock());

    await svc.sync('sv8');
    expect(persistMarketReference).not.toHaveBeenCalled();
  });
});

describe('PricingService.persistMarketReference — (a) escribe y (b) respeta isManualOverride', () => {
  function pricingSvc(existing: any) {
    const prisma: any = {
      priceReference: {
        findUnique: jest.fn(async () => existing),
        upsert: jest.fn(async () => ({})),
      },
    };
    // persistMarketReference solo usa this.prisma; el resto de deps no interviene.
    const svc = new PricingService(
      prisma as PrismaService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { svc, prisma };
  }

  it('(a) sin fila previa → upsert con clave raw/raw:NM/finish y priceMxnCents = usdToMxnCents', async () => {
    const { svc, prisma } = pricingSvc(null);
    await svc.persistMarketReference('c1', 'holofoil', 1000, { rate: 18, bufferPct: 10 });

    expect(prisma.priceReference.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.priceReference.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
      source: 'pokemontcg_io',
      priceUsdCents: 1000,
      priceMxnCents: usdToMxnCents(1000, 18, 10), // 19800
      isManualOverride: false,
    });
    // La clave del upsert usa el índice único compuesto (incluye finish + capturedDate).
    expect(arg.where.cardId_productType_gradeKey_finish_capturedDate).toMatchObject({
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'holofoil',
    });
  });

  it('(b) fila de hoy con isManualOverride=true → NO se upsertea (el override del admin manda)', async () => {
    const { svc, prisma } = pricingSvc({ isManualOverride: true, priceMxnCents: 999 });
    await svc.persistMarketReference('c1', 'normal', 500, { rate: 18, bufferPct: 0 });
    expect(prisma.priceReference.upsert).not.toHaveBeenCalled();
  });

  it('fila de hoy NO override → sí actualiza (update)', async () => {
    const { svc, prisma } = pricingSvc({ isManualOverride: false, priceMxnCents: 100 });
    await svc.persistMarketReference('c1', 'normal', 500, { rate: 18, bufferPct: 0 });
    expect(prisma.priceReference.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.priceReference.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ source: 'pokemontcg_io', priceUsdCents: 500 });
  });
});

describe('CatalogPriceSyncJobService — (d) invoca el re-sync completo con force:true', () => {
  it('run() delega en CatalogSyncService.syncAll({ force: true }) y devuelve su shape', async () => {
    const syncAll = jest.fn(async () => ({ jobId: 'catalog-sync-all-1', setsQueued: 42, remaining: 0 }));
    const catalogSync = { syncAll } as unknown as CatalogSyncService;
    const job = new CatalogPriceSyncJobService(catalogSync);

    const res = await job.run();
    expect(syncAll).toHaveBeenCalledTimes(1);
    expect(syncAll).toHaveBeenCalledWith({ force: true });
    expect(res).toEqual({ jobId: 'catalog-sync-all-1', setsQueued: 42, remaining: 0 });
  });
});
