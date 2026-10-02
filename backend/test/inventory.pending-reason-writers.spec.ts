import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

/**
 * Cola de precio pendiente (VENTA) — **todo escritor vigente pone el MOTIVO.**
 *
 * Defecto medido (2026-10-02, sobre 0d6b5362/22b0b08d): el dueño veía en M2 «… · 19 SIN MOTIVO». Los
 * escritores del alta (single `createItem`, lote `batchCreate`, ajuste «encontrada») y la publicación del
 * SELLADO llamaban a `escalatePending` sin `reason` ⇒ default `null`, que `counts` y la pantalla leen
 * como «fila anterior a M-41» (`unknown`). El contrato solo conoce `PendingPriceReason = no_market |
 * premium_at_floor` (§Enums); el guardarraíl es de raw/graded, así que el motivo de estos caminos —que
 * solo escalan sin mercado y sin override— es `no_market`.
 *
 * Además, el alta de un sellado sin `listPriceCents` escalaba SIEMPRE, aunque el sellado tuviera mercado
 * (regla v1.1 retirada en v1.23; contrato del alta: «sin mercado ni override queda PRICE_PENDING»). Esa
 * entrada no tenía motivo verdadero y no la cerraba nadie (la publicación del sellado no cierra la cola).
 *
 * El harness usa `escalatePending` REAL contra un almacén en memoria (la clave de dedupe completa).
 */

const SEALED_PRODUCT = {
  id: 'sp-etb',
  setId: 'set-1',
  tcgplayerProductId: 777,
  tcgplayerGroupId: 900,
  name: 'Prismatic Evolutions Elite Trainer Box',
  subtype: 'etb',
  imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/777.jpg',
  active: true,
};
const MARKET_KEY = 'card-anchor|sealed|sealed:tcg:777|normal';

function buildHarness(opts: { sourceOn?: boolean } = {}) {
  const items: any[] = [];
  const pendingStore: any[] = [];
  const priceRefs: any[] = [];
  let pendSeq = 0;
  let refSeq = 0;

  const dedupeMatch = (e: any, w: any) =>
    e.cardId === w.cardId &&
    e.productType === w.productType &&
    e.gradeKey === w.gradeKey &&
    e.finish === w.finish &&
    (e.cardProductId ?? null) === (w.cardProductId ?? null) &&
    (e.sealedProductId ?? null) === (w.sealedProductId ?? null) &&
    e.status === w.status;

  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    sealedProduct: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === SEALED_PRODUCT.id ? SEALED_PRODUCT : null,
      ),
    },
    card: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'card-anchor' || where.id === 'card-raw'
          ? {
              id: where.id,
              rarity: 'Common',
              rarityCanonical: 'common',
              availableFinishes: ['normal', 'holofoil'],
            }
          : null,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        where.setId === 'set-1' ? { id: 'card-anchor' } : null,
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        items
          .filter((i) => where.id.in.includes(i.id))
          .map((i) => ({ ...i, card: { rarity: null } })),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `inv-${items.length + 1}`, ...data };
        items.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const it = items.find((i) => i.id === where.id);
        if (it && where.status.in.includes(it.status)) {
          Object.assign(it, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    inventoryMovement: { create: jest.fn(async () => ({})) },
    inventoryAdjustment: { create: jest.fn(async () => ({ id: `adj-${Math.random()}` })) },
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    priceReference: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ref-${++refSeq}`, ...data };
        priceRefs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          priceRefs.find((x) => x.id === where.id),
          data,
        ),
      ),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(
        async ({ where }: any) => pendingStore.find((e) => dedupeMatch(e, where)) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `pend-${++pendSeq}`,
          resolvedPriceRefId: null,
          resolvedAt: null,
          ...data,
        };
        pendingStore.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          pendingStore.find((e) => e.id === where.id),
          data,
        ),
      ),
      // Cierre REAL (`closePendingForVariant`): clave de seis + `status` + el `OR` por motivo/eje.
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const e of pendingStore) {
          if (!dedupeMatch(e, where)) continue;
          if (
            where.OR &&
            !where.OR.some(
              (o: any) =>
                (e.reason ?? null) === (o.reason ?? null) &&
                (o.context == null || o.context === e.context),
            )
          ) {
            continue;
          }
          Object.assign(e, data);
          count++;
        }
        return { count };
      }),
    },
    inventoryBatch: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    nextFolio: jest.fn(async () => `INV-00000${items.length + 1}`),
    nextFolios: jest.fn(async (n: number) =>
      Array.from({ length: n }, (_, i) => `INV-B${items.length + i + 1}`),
    ),
  };

  const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  jest.spyOn(pricing, 'loadPricingCurve').mockResolvedValue(DEFAULT_PRICING_CURVE);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: opts.sourceOn ?? true,
  } as any);
  jest.spyOn(pricing, 'getVariantOverridesBatch').mockResolvedValue(new Map());
  // `getReference` delega en `getReferencesBatch`: un solo punto para «hay / no hay mercado».
  const refsBatch = jest.spyOn(pricing, 'getReferencesBatch').mockResolvedValue(new Map());
  const escalate = jest.spyOn(pricing, 'escalatePending');

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, pricing, prisma, items, pendingStore, refsBatch, escalate };
}

const open = (store: any[]) => store.filter((e) => e.status === 'open');
const sealedLine = (over: any = {}) => ({
  productType: 'sealed' as const,
  sealedProductId: 'sp-etb',
  acquisitionType: 'compra' as const,
  ...over,
});
const withMarket = (h: ReturnType<typeof buildHarness>) =>
  h.refsBatch.mockResolvedValue(
    new Map([
      [MARKET_KEY, { status: 'priced', referenceMxnCents: 150000, source: 'tcgcsv' } as any],
    ]),
  );

describe('alta de SELLADO sin listPriceCents — los TRES caminos escalan con motivo `no_market`', () => {
  it('createItem (single), sin mercado ⇒ 1 entrada open con reason=no_market', async () => {
    const h = buildHarness();
    await h.svc.createItem(sealedLine() as any, 'op');
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      gradeKey: 'sealed:tcg:777',
      sealedProductId: 'sp-etb',
      context: 'inventory',
      reason: 'no_market',
    });
  });

  it('batchCreate (lote — el que dispara la app real), sin mercado ⇒ reason=no_market', async () => {
    const h = buildHarness();
    const res = await h.svc.batchCreate(
      { batchKey: 'bk-1', items: [sealedLine({ qty: 1 })] } as any,
      'op',
    );
    expect(res.summary.createdItems).toBe(1);
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed:tcg:777', reason: 'no_market' });
  });

  it('adjust «encontrada», sin mercado ⇒ reason=no_market', async () => {
    const h = buildHarness();
    await h.svc.adjust({ reason: 'encontrada', item: sealedLine() } as any, 'op');
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed:tcg:777', reason: 'no_market' });
  });

  it('sellado legacy SIN mapeo (sin productId) ⇒ escala `no_market` bajo la clave estructural', async () => {
    const h = buildHarness();
    await h.svc.createItem(
      {
        cardId: 'card-anchor',
        productType: 'sealed',
        sealedSubtype: 'etb',
        acquisitionType: 'compra',
      } as any,
      'op',
    );
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      gradeKey: 'sealed',
      sealedProductId: null,
      reason: 'no_market',
    });
  });
});

describe('alta de SELLADO cuyo precio SÍ resuelve ⇒ NO abre entrada (no hay motivo verdadero)', () => {
  it.each([
    ['createItem', (h: any) => h.svc.createItem(sealedLine() as any, 'op')],
    [
      'batchCreate',
      (h: any) => h.svc.batchCreate({ batchKey: 'bk-2', items: [sealedLine()] } as any, 'op'),
    ],
    [
      'adjust encontrada',
      (h: any) => h.svc.adjust({ reason: 'encontrada', item: sealedLine() } as any, 'op'),
    ],
  ])(
    '%s con mercado TCGCSV vivo (dial on) ⇒ 0 entradas, y la pieza nace igual',
    async (_n, run) => {
      const h = buildHarness({ sourceOn: true });
      withMarket(h);
      await run(h);
      expect(h.items).toHaveLength(1);
      expect(h.pendingStore).toHaveLength(0);
    },
  );

  it('dial `sealedPriceSource` APAGADO: el mercado automático no cuenta ⇒ escala `no_market` (misma puerta que publicar)', async () => {
    const h = buildHarness({ sourceOn: false });
    withMarket(h);
    await h.svc.createItem(sealedLine() as any, 'op');
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0].reason).toBe('no_market');
  });

  it('alta con override manual de mercado (`manualMarketMxnCents`) ⇒ resuelve ⇒ 0 entradas', async () => {
    const h = buildHarness();
    await h.svc.createItem(sealedLine({ manualMarketMxnCents: 90000 }) as any, 'op');
    expect(h.items).toHaveLength(1);
    expect(h.pendingStore).toHaveLength(0);
  });
});

describe('aportación sin referencia (raw) ⇒ PRICE_PENDING y escala con `no_market`', () => {
  it('reason=no_market en la entrada creada', async () => {
    const h = buildHarness();
    await expect(
      h.svc.createItem(
        {
          cardId: 'card-raw',
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'holofoil',
          acquisitionType: 'aportacion_en_especie',
        } as any,
        'op',
      ),
    ).rejects.toMatchObject({ code: 'PRICE_PENDING' });
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      productType: 'raw',
      finish: 'holofoil',
      reason: 'no_market',
    });
  });
});

describe('publicación de SELLADO sin precio ⇒ escala con `no_market` y reclasifica una fila histórica', () => {
  const seedSealedItem = (h: ReturnType<typeof buildHarness>) => {
    h.items.push({
      id: 'inv-s1',
      cardId: 'card-anchor',
      productType: 'sealed',
      ownerType: 'platform',
      status: 'in_stock',
      finish: 'normal',
      listPriceCents: null,
      sealedSubtype: 'etb',
      tcgplayerProductId: 777,
      sealedProductId: 'sp-etb',
      cardProductId: null,
    });
  };

  it('bulkPublish sin mercado ⇒ PRICE_PENDING y la entrada nace con reason=no_market', async () => {
    const h = buildHarness();
    seedSealedItem(h);
    const res = await h.svc.bulkPublish({ items: [{ inventoryItemId: 'inv-s1' }] } as any, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(open(h.pendingStore)).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed:tcg:777', reason: 'no_market' });
  });

  it('una fila HISTÓRICA `reason=null` de la misma clave se RECLASIFICA a `no_market` al re-publicar (no se duplica)', async () => {
    const h = buildHarness();
    seedSealedItem(h);
    h.pendingStore.push({
      id: 'pend-legacy',
      cardId: 'card-anchor',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:777',
      finish: 'normal',
      cardProductId: null,
      sealedProductId: 'sp-etb',
      context: 'inventory',
      status: 'open',
      reason: null,
    });
    await h.svc.bulkPublish({ items: [{ inventoryItemId: 'inv-s1' }] } as any, 'admin');
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      id: 'pend-legacy',
      status: 'open',
      reason: 'no_market',
    });
  });
});

describe('VQ-6 (v1.80.8.4) — el SELLADO que resuelve en publicación CIERRA su fila', () => {
  const seed = (h: ReturnType<typeof buildHarness>, listPriceCents: number | null) => {
    h.items.push({
      id: 'inv-s1',
      cardId: 'card-anchor',
      productType: 'sealed',
      ownerType: 'platform',
      status: 'in_stock',
      finish: 'normal',
      listPriceCents,
      sealedSubtype: 'etb',
      tcgplayerProductId: 777,
      sealedProductId: 'sp-etb',
      cardProductId: null,
    });
    h.pendingStore.push({
      id: 'pend-nm',
      cardId: 'card-anchor',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:777',
      finish: 'normal',
      cardProductId: null,
      sealedProductId: 'sp-etb',
      context: 'inventory',
      status: 'open',
      reason: 'no_market',
    });
  };

  it('fila `open no_market` en `(card, sealed, sealed:tcg:777, normal, null, sp)`; llega mercado; publicar ⇒ publica y la fila pasa a `resolved`', async () => {
    const h = buildHarness();
    seed(h, null);
    withMarket(h);
    const res = await h.svc.bulkPublish({ items: [{ inventoryItemId: 'inv-s1' }] } as any, 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed' });
    expect(h.pendingStore[0]).toMatchObject({ id: 'pend-nm', status: 'resolved' });
  });

  it('con precio MANUAL por pieza (`listPriceCents`) publica pero NO cierra (no dice nada del mercado)', async () => {
    const h = buildHarness();
    seed(h, 250000);
    withMarket(h);
    const res = await h.svc.bulkPublish({ items: [{ inventoryItemId: 'inv-s1' }] } as any, 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed' });
    expect(h.pendingStore[0]).toMatchObject({ id: 'pend-nm', status: 'open', reason: 'no_market' });
  });

  it('sin mercado sigue sin publicar y la fila sigue abierta (no se cierra por error)', async () => {
    const h = buildHarness();
    seed(h, null);
    const res = await h.svc.bulkPublish({ items: [{ inventoryItemId: 'inv-s1' }] } as any, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ status: 'open', reason: 'no_market' });
  });
});
