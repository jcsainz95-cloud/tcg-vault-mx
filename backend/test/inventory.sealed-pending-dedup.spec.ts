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

/**
 * fix/variant-composition-regression — REGRESIÓN DE DINERO en la cola M2 del SELLADO.
 *
 * Bug (pre-existente): el ALTA de un sellado SIN listPriceCents escalaba un pendiente con el gradeKey
 * legacy `'sealed'` y SIN `sealedProductId`, mientras el bulk-publish escala con la clave de MERCADO
 * `sealed:tcg:<productId>` + `sealedProductId`. Resultado: DOS `PendingPriceEntry` open para la MISMA
 * pieza (dos filas «FIJAR PRECIO» en M2), y como el resolver del sellado consume `sealed:tcg:<id>` (no
 * el legacy), fijar precio sobre la fila legacy escribía una `PriceReference` que el resolver IGNORA →
 * la pieza seguía impublicable aunque el admin creyera que ya la había fijado (dinero parado).
 *
 * Fix: para piezas con `sealedProductId`, la escalación del ALTA usa la MISMA clave de mercado que el
 * publish, de modo que alta y publish DEDUPEAN en UNA sola entrada resoluble. Estos tests ejercen el
 * `escalatePending` REAL (con su clave de dedupe completa `(cardId, productType, gradeKey, finish,
 * cardProductId, sealedProductId, status)`) contra un prisma en memoria.
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

function buildHarness() {
  const items: any[] = [];
  const pendingStore: any[] = [];
  const priceRefs: any[] = [];
  let pendSeq = 0;
  let refSeq = 0;

  // Clave de dedupe COMPLETA (la real de `escalatePending`): incluye cardProductId y sealedProductId.
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
        where.id === SEALED_PRODUCT.id && SEALED_PRODUCT.active ? SEALED_PRODUCT : null,
      ),
    },
    card: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'card-tropius'
          ? { id: 'card-tropius', rarity: null, availableFinishes: ['normal'] }
          : null,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        where.setId === 'set-1' ? { id: 'card-tropius' } : null,
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        items
          .filter((i) => where.id.in.includes(i.id))
          // bulkPublish hace include:{card:true}; adjuntamos la relación.
          .map((i) => ({ ...i, card: { rarity: null } })),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `inv-${items.length + 1}`, ...data };
        items.push(row);
        return row;
      }),
      // Guardia atómica de publicación: "gana" si el status de origen está en el allowlist.
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
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    priceReference: {
      findFirst: jest.fn(async ({ where }: any) =>
        priceRefs.find(
          (r) =>
            r.cardId === where.cardId &&
            r.productType === where.productType &&
            r.gradeKey === where.gradeKey &&
            r.finish === where.finish,
        ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        priceRefs.filter(
          (r) =>
            r.cardId === where.cardId &&
            r.productType === where.productType &&
            r.gradeKey === where.gradeKey &&
            r.finish === where.finish,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ref-${++refSeq}`, ...data };
        priceRefs.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = priceRefs.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async ({ where }: any) => pendingStore.find((e) => dedupeMatch(e, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pend-${++pendSeq}`, resolvedPriceRefId: null, resolvedAt: null, ...data };
        pendingStore.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const e of pendingStore) {
          if (
            e.cardId === where.cardId &&
            e.productType === where.productType &&
            e.gradeKey === where.gradeKey &&
            e.finish === where.finish &&
            e.status === where.status
          ) {
            Object.assign(e, data);
            count++;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        pendingStore.filter((e) => e.status === where.status),
      ),
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

  const settings = { getNumber: jest.fn(async () => 100) } as unknown as SettingsService;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  // Dial de mercado APAGADO (escenario real del bug): sin fuente automática; solo el override manual
  // del admin (isManualOverride) resuelve. Stubs izados una vez por bulkPublish; el resto corre REAL.
  jest.spyOn(pricing, 'loadSalesRules').mockResolvedValue({
    rules: { rarityRules: {}, finishRules: {}, fallbackPct: 15 },
    fallbackPct: 15,
  } as any);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: false,
  } as any);
  jest.spyOn(pricing, 'getVariantOverridesBatch').mockResolvedValue(new Map());
  const refsBatch = jest.spyOn(pricing, 'getReferencesBatch').mockResolvedValue(new Map());

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, pricing, prisma, items, pendingStore, priceRefs, refsBatch };
}

const openCount = (pendingStore: any[]) => pendingStore.filter((e) => e.status === 'open').length;

// Alta de sellado por COMPRA sin listPriceCents (repro del bug): con sealedProductId validado.
const altaLine = (over: any = {}) => ({
  productType: 'sealed' as const,
  sealedProductId: 'sp-etb',
  acquisitionType: 'compra' as const,
  ...over,
});

const publish = (id: string, listPriceCents?: number): BulkPublishRequest => ({
  items: [{ inventoryItemId: id, ...(listPriceCents != null ? { listPriceCents } : {}) }],
});

describe('sellado sin precio: UNA sola entrada resoluble en M2 (no la legacy)', () => {
  it('alta (compra) sin listPrice → EXACTAMENTE 1 pendiente open con la clave de mercado `sealed:tcg:<id>` (no legacy `sealed`)', async () => {
    const h = buildHarness();
    await h.svc.createItem(altaLine() as any, 'op-1');

    expect(openCount(h.pendingStore)).toBe(1);
    const entry = h.pendingStore[0];
    // La clave de la cola es la que el RESOLVER consume: `sealed:tcg:777`, NO el legacy `'sealed'`.
    expect(entry).toMatchObject({
      cardId: 'card-tropius',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:777',
      finish: 'normal',
      sealedProductId: 'sp-etb',
      context: 'inventory',
      status: 'open',
    });
    expect(entry.gradeKey).not.toBe('sealed');
    // La pieza sí nació (compra no se cae a PRICE_PENDING; solo escala la cola).
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({ sealedProductId: 'sp-etb', listPriceCents: null, status: 'in_stock' });
  });

  it('tras bulk-publish la misma pieza sigue con 1 pendiente (dedupe alta↔publish), NO 2', async () => {
    const h = buildHarness();
    await h.svc.createItem(altaLine() as any, 'op-1');
    const created = h.items[0];

    const res = await h.svc.bulkPublish(publish(created.id), 'admin');
    // Money-safe: no publica sin precio.
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(res.summary.published).toBe(0);
    expect(created.status).toBe('in_stock');

    // No se creó una SEGUNDA fila: alta y publish colapsan en la MISMA entrada resoluble.
    expect(openCount(h.pendingStore)).toBe(1);
    expect(h.prisma.pendingPriceEntry.create).toHaveBeenCalledTimes(1);
    // Y el deep-link de la línea apunta a esa única entrada.
    expect((res.results[0] as any).pendingPriceEntryId).toBe(h.pendingStore[0].id);
  });

  it('fijar el override manual SOBRE esa entrada (misma clave `sealed:tcg:777`) publica la pieza y deja la cola en 0', async () => {
    const h = buildHarness();
    await h.svc.createItem(altaLine() as any, 'op-1');
    const created = h.items[0];
    await h.svc.bulkPublish(publish(created.id), 'admin'); // escala, no publica
    expect(openCount(h.pendingStore)).toBe(1);

    // El admin «FIJA PRECIO» sobre la fila de M2: override manual con el gradeKey de esa fila.
    const entry = h.pendingStore[0];
    const ref = await h.pricing.manualOverride('card-tropius', 'sealed' as any, entry.gradeKey, 200000, 'normal');
    // La entrada quedó RESUELTA (no re-abre otra).
    expect(entry.status).toBe('resolved');
    expect(entry.resolvedPriceRefId).toBe(ref.id);
    expect(openCount(h.pendingStore)).toBe(0);

    // El resolver del sellado ahora SÍ ve el override (isManualOverride sobrevive al dial off) → publica.
    h.refsBatch.mockResolvedValue(
      new Map([
        [
          'card-tropius|sealed|sealed:tcg:777|normal',
          { status: 'priced', referenceMxnCents: 200000, isManualOverride: true, source: 'manual' } as any,
        ],
      ]),
    );
    const res = await h.svc.bulkPublish(publish(created.id), 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed', priceSource: 'derived' });
    expect((res.results[0] as any).salePriceCents).toBeGreaterThan(0); // nunca 0
    expect(created.status).toBe('listed');
    // No se abrió ninguna entrada nueva.
    expect(openCount(h.pendingStore)).toBe(0);
  });
});

describe('sellado legacy SIN sealedProductId (no curado): comportamiento seguro, sin duplicar', () => {
  // Path P-35: mapeo por tcgplayerProductId del cliente, sin sealedProductId. El alta escala con la
  // clave de mercado del mapping (sealed:tcg:<id>) y sealedProductId=null; sigue money-safe y dedupea.
  const legacyLine = (over: any = {}) => ({
    cardId: 'card-tropius',
    productType: 'sealed' as const,
    sealedSubtype: 'etb',
    acquisitionType: 'compra' as const,
    tcgplayerProductId: 777,
    tcgplayerGroupId: 900,
    ...over,
  });

  it('alta legacy (mapeada, sin sealedProductId) escala con `sealed:tcg:<id>` y sealedProductId=null, 1 sola fila', async () => {
    const h = buildHarness();
    await h.svc.createItem(legacyLine() as any, 'op-1');
    expect(openCount(h.pendingStore)).toBe(1);
    expect(h.pendingStore[0]).toMatchObject({
      gradeKey: 'sealed:tcg:777',
      sealedProductId: null,
      context: 'inventory',
      status: 'open',
    });
  });
});
