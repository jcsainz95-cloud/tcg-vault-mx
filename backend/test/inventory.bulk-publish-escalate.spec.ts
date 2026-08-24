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
import { BulkPublishRequest } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.26 (④, §M1) — PUBLICAR SIEMPRE CON PRECIO: la variante priceless ESCALA a la cola de
 * pendientes (`context='inventory'`) en vez de caerse en silencio. Cubre las DOS ramas de
 * `bulkPublish` (raw/graded y sealed):
 *  - money-safety: una variante SIN precio NUNCA se publica ni se lista a 0 → se encola.
 *  - idempotencia: re-publicar NO duplica la fila de la cola (dedupe por cardId/productType/
 *    gradeKey/finish/status='open').
 *  - deep-link: la línea PRICE_PENDING gana `pendingPriceEntryId` (aditivo).
 *  - cierre: tras `manualOverride`/referencia, el re-publish procede y el pendiente se resuelve.
 *
 * Wiring INTEGRACIÓN: se usa un `PricingService` REAL (para ejercer `escalatePending` + su dedupe
 * y `resolveSealedSalePrice`/`gradeKeyFor` reales) con un prisma en memoria; solo se stubean los
 * accesos a datos que `bulkPublish` iza una vez (`loadSalesRules`/`loadSealedSpreads`/
 * `getReferencesBatch`).
 */

type PendingRow = {
  id: string;
  cardId: string;
  productType: string;
  gradeKey: string;
  finish: string;
  context: string;
  refId: string | null;
  status: string;
  resolvedPriceRefId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

function buildHarness() {
  const pendingStore: PendingRow[] = [];
  const items: any[] = [];
  let pendSeq = 0;
  let refSeq = 0;

  const matchKey = (e: PendingRow, w: any) =>
    e.cardId === w.cardId &&
    e.productType === w.productType &&
    e.gradeKey === w.gradeKey &&
    e.finish === w.finish &&
    e.status === w.status;

  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        items.filter((i) => where.id.in.includes(i.id)),
      ),
      // Guardia atómica de publicación: "gana" por defecto (count=1) y marca el item published.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const it = items.find((i) => i.id === where.id);
        if (it && where.status.in.includes(it.status)) {
          Object.assign(it, data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    inventoryBatch: { findUnique: jest.fn(async () => null), create: jest.fn() },
    // v1.28 (P-18): sin filas M-30 por default (comportamiento previo).
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    priceReference: {
      // v1.29 (M-31): manualOverride usa findFirst + create/update (cardProductId=null).
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: `ref-${++refSeq}` })),
      update: jest.fn(async () => ({ id: `ref-${refSeq}` })),
      upsert: jest.fn(async () => ({ id: `ref-${++refSeq}` })),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async ({ where }: any) => pendingStore.find((e) => matchKey(e, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row: PendingRow = {
          id: `pend-${++pendSeq}`,
          refId: null,
          resolvedPriceRefId: null,
          resolvedAt: null,
          createdAt: new Date(),
          ...data,
        };
        pendingStore.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const e of pendingStore) {
          if (matchKey(e, where)) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        pendingStore
          .filter((e) => e.status === where.status && (where.context ? e.context === where.context : true))
          .map((e) => ({ ...e, card: { id: e.cardId, name: 'X', number: '1', set: { name: 'S' } } })),
      ),
    },
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
  // Stubs de acceso a datos izados una vez por bulkPublish (el resto de métodos corre REAL).
  jest.spyOn(pricing, 'loadPricingCurve').mockResolvedValue(DEFAULT_PRICING_CURVE);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: false,
  } as any);
  const refsBatch = jest.spyOn(pricing, 'getReferencesBatch').mockResolvedValue(new Map());

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, pricing, prisma, pendingStore, items, refsBatch };
}

const rawItem = (over: any = {}) => ({
  id: 'i1',
  cardId: 'c1',
  productType: 'raw',
  finish: 'normal',
  certNumber: null,
  ownerType: 'platform',
  status: 'in_stock',
  listPriceCents: null,
  tcgplayerProductId: null,
  card: { rarity: 'Illustration Rare' }, // rareza sin regla → pct fallback (pending sin market)
  ...over,
});

const sealedItem = (over: any = {}) => ({
  id: 's1',
  cardId: 'cs',
  productType: 'sealed',
  finish: 'normal',
  certNumber: null,
  ownerType: 'platform',
  status: 'in_stock',
  listPriceCents: null,
  sealedSubtype: 'box',
  tcgplayerProductId: 555, // mapeado → gradeKey de mercado sealed:tcg:555
  card: { rarity: null },
  ...over,
});

const publish = (id: string, listPriceCents?: number): BulkPublishRequest => ({
  items: [{ inventoryItemId: id, ...(listPriceCents != null ? { listPriceCents } : {}) }],
});

describe('bulkPublish ④ — raw/graded priceless ESCALA (no dropea, no publica)', () => {
  it('encola context=inventory, NO publica, devuelve PRICE_PENDING + pendingPriceEntryId', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    const res = await h.svc.bulkPublish(publish('i1'), 'admin');

    // Money-safety: NO publicada, sin precio, sin listar a 0.
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect((res.results[0] as any).salePriceCents).toBeUndefined();
    expect(res.summary.published).toBe(0);
    expect(h.items[0].status).toBe('in_stock'); // status de origen intacto

    // Escaló a la cola: 1 fila open, context inventory, gradeKey/finish del item.
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      context: 'inventory',
      status: 'open',
    });
    // Deep-link aditivo poblado con el id de la entrada creada.
    expect((res.results[0] as any).pendingPriceEntryId).toBe(h.pendingStore[0].id);
  });

  it('re-publicar NO duplica la fila de la cola (dedupe idempotente)', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    await h.svc.bulkPublish(publish('i1'), 'admin');
    const res2 = await h.svc.bulkPublish(publish('i1'), 'admin');
    expect(res2.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    // Sigue habiendo UNA sola fila; el id devuelto es el de la preexistente.
    expect(h.pendingStore).toHaveLength(1);
    expect((res2.results[0] as any).pendingPriceEntryId).toBe(h.pendingStore[0].id);
    expect(h.prisma.pendingPriceEntry.create).toHaveBeenCalledTimes(1);
  });

  it('tras manualOverride + referencia, el re-publish PROCEDE y el pendiente se resuelve', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    await h.svc.bulkPublish(publish('i1'), 'admin'); // escala
    expect(h.pendingStore[0].status).toBe('open');

    // El admin fija el precio (override manual, mismo cardId/gradeKey/finish) → resuelve el pendiente.
    await h.pricing.manualOverride('c1', 'raw' as any, 'raw:NM', 20000, 'normal');
    expect(h.pendingStore[0].status).toBe('resolved');
    expect(h.pendingStore[0].resolvedPriceRefId).toBeTruthy();

    // La referencia ya está priced → el re-publish deriva y publica.
    h.refsBatch.mockResolvedValue(
      new Map([['c1|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 20000 } as any]]),
    );
    const res = await h.svc.bulkPublish(publish('i1'), 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed', priceSource: 'derived' });
    expect((res.results[0] as any).salePriceCents).toBeGreaterThan(0);
    expect(h.items[0].status).toBe('listed');
    expect(h.pendingStore).toHaveLength(1); // no se creó otra fila
  });
});

describe('bulkPublish ④ — sealed priceless ESCALA (no dropea, no publica)', () => {
  it('encola context=inventory con gradeKey de mercado, NO publica, PRICE_PENDING + pendingPriceEntryId', async () => {
    const h = buildHarness();
    h.items.push(sealedItem());
    const res = await h.svc.bulkPublish(publish('s1'), 'admin');

    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect((res.results[0] as any).salePriceCents).toBeUndefined();
    expect(res.summary.published).toBe(0);
    expect(h.items[0].status).toBe('in_stock');

    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({
      cardId: 'cs',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:555', // reusa el gradeKey de mercado (~:478)
      finish: 'normal',
      context: 'inventory',
      status: 'open',
    });
    expect((res.results[0] as any).pendingPriceEntryId).toBe(h.pendingStore[0].id);
  });

  it('re-publicar NO duplica la fila de la cola (dedupe idempotente)', async () => {
    const h = buildHarness();
    h.items.push(sealedItem());
    await h.svc.bulkPublish(publish('s1'), 'admin');
    await h.svc.bulkPublish(publish('s1'), 'admin');
    expect(h.pendingStore).toHaveLength(1);
    expect(h.prisma.pendingPriceEntry.create).toHaveBeenCalledTimes(1);
  });

  it('sealed no mapeado (sin tcgplayerProductId) escala con gradeKey estructural "sealed"', async () => {
    const h = buildHarness();
    h.items.push(sealedItem({ id: 's2', cardId: 'cs2', tcgplayerProductId: null }));
    const res = await h.svc.bulkPublish(publish('s2'), 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed', context: 'inventory' });
  });

  it('re-publish con listPriceCents (override del sellado) PROCEDE y publica', async () => {
    const h = buildHarness();
    h.items.push(sealedItem());
    await h.svc.bulkPublish(publish('s1'), 'admin'); // escala
    const res = await h.svc.bulkPublish(publish('s1', 15000), 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed', salePriceCents: 15000 });
    expect(h.items[0].status).toBe('listed');
  });
});
