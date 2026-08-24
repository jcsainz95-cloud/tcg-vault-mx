import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';
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
 * v1.26 (P-7 ⑤, §M1 / §4.24e) — PUBLICAR + REPRECIAR FRESCO desde el Master Set.
 *  - `repriceFresh` refresca la referencia ANTES de resolver el precio → publica al precio FRESCO.
 *  - funciona sobre inventario UNPUBLISHED (`in_stock`).
 *  - HEREDA el gate ④: si tras el refresh sigue sin precio → ESCALA a pendiente, NO publica.
 *  - money-safety: un fallo/agotamiento del reprecio CAE a la referencia ALMACENADA o a pendiente,
 *    NUNCA a 0/inventado; sin `repriceFresh` el reprecio NO se llama (comportamiento previo intacto).
 */

type PendingRow = {
  id: string; cardId: string; productType: string; gradeKey: string; finish: string;
  context: string; refId: string | null; status: string;
  resolvedPriceRefId: string | null; resolvedAt: Date | null; createdAt: Date;
};

function buildHarness() {
  const pendingStore: PendingRow[] = [];
  const items: any[] = [];
  let pendSeq = 0;
  const matchKey = (e: PendingRow, w: any) =>
    e.cardId === w.cardId && e.productType === w.productType && e.gradeKey === w.gradeKey &&
    e.finish === w.finish && e.status === w.status;

  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) => items.filter((i) => where.id.in.includes(i.id))),
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
    pendingPriceEntry: {
      findFirst: jest.fn(async ({ where }: any) => pendingStore.find((e) => matchKey(e, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row: PendingRow = { id: `pend-${++pendSeq}`, refId: null, resolvedPriceRefId: null, resolvedAt: null, createdAt: new Date(), ...data };
        pendingStore.push(row);
        return row;
      }),
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
  jest.spyOn(pricing, 'loadPricingCurve').mockResolvedValue(DEFAULT_PRICING_CURVE);
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false } as any);

  // Referencia observada por getReferencesBatch — mutable para simular el efecto del reprecio fresco.
  const refState: { current: Map<string, PriceInfo> } = { current: new Map() };
  const getRefs = jest.spyOn(pricing, 'getReferencesBatch').mockImplementation(async () => refState.current);
  const refresh = jest.spyOn(pricing, 'refreshCardPrices');

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, pricing, prisma, pendingStore, items, refState, getRefs, refresh };
}

const rawItem = (over: any = {}) => ({
  id: 'i1', cardId: 'c1', productType: 'raw', finish: 'normal', certNumber: null,
  ownerType: 'platform', status: 'in_stock', listPriceCents: null, tcgplayerProductId: null,
  card: { rarity: 'Illustration Rare' }, ...over,
});

const priced = (cents: number): PriceInfo => ({ status: 'priced', referenceMxnCents: cents });
const publish = (id: string, extra: Partial<BulkPublishRequest> = {}, listPriceCents?: number): BulkPublishRequest => ({
  items: [{ inventoryItemId: id, ...(listPriceCents != null ? { listPriceCents } : {}) }],
  ...extra,
});

describe('bulkPublish repriceFresh (P-7 ⑤)', () => {
  it('refresca la ref ANTES de resolver el precio y publica al precio FRESCO (unpublished in_stock)', async () => {
    const h = buildHarness();
    h.items.push(rawItem()); // in_stock, sin precio almacenado (refState vacío)
    // El reprecio "trae" una referencia fresca: se refleja en lo que ve getReferencesBatch después.
    h.refresh.mockImplementation(async () => {
      h.refState.current = new Map([['c1|raw|raw:NM|normal', priced(20000)]]);
      return { refreshed: ['c1'], pending: [], dailyLimited: false };
    });

    const res = await h.svc.bulkPublish(publish('i1', { repriceFresh: true }), 'admin');

    // Se llamó al reprecio con la carta+acabado de la línea, ANTES de leer las referencias.
    expect(h.refresh).toHaveBeenCalledWith(['c1'], ['normal']);
    expect(h.refresh.mock.invocationCallOrder[0]).toBeLessThan(h.getRefs.mock.invocationCallOrder[0]);
    // Publicada al precio FRESCO (derivado de la ref recién traída), status → listed.
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed', priceSource: 'derived' });
    expect((res.results[0] as any).salePriceCents).toBeGreaterThan(0);
    expect(h.items[0].status).toBe('listed');
  });

  it('gate ④: si tras el refresh sigue sin precio → ESCALA a pendiente y NO publica (nunca 0)', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    // El reprecio no consigue precio (proveedor sin datos / cuota): refState sigue vacío.
    h.refresh.mockResolvedValue({ refreshed: [], pending: ['c1'], dailyLimited: false });

    const res = await h.svc.bulkPublish(publish('i1', { repriceFresh: true }), 'admin');

    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect((res.results[0] as any).salePriceCents).toBeUndefined();
    expect(res.summary.published).toBe(0);
    expect(h.items[0].status).toBe('in_stock'); // origen intacto
    // Escaló (context=inventory) y devolvió el deep-link.
    expect(h.pendingStore).toHaveLength(1);
    expect(h.pendingStore[0]).toMatchObject({ cardId: 'c1', gradeKey: 'raw:NM', finish: 'normal', context: 'inventory', status: 'open' });
    expect((res.results[0] as any).pendingPriceEntryId).toBe(h.pendingStore[0].id);
  });

  it('money-safe: reprecio sin ref fresca CAE a la referencia ALMACENADA (publica al precio previo)', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    h.refState.current = new Map([['c1|raw|raw:NM|normal', priced(15000)]]); // ref almacenada previa
    // El reprecio fresco NO trae nada nuevo (falla/cuota) y NO borra la almacenada.
    h.refresh.mockResolvedValue({ refreshed: [], pending: ['c1'], dailyLimited: true });

    const res = await h.svc.bulkPublish(publish('i1', { repriceFresh: true }), 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed', priceSource: 'derived' });
    expect((res.results[0] as any).salePriceCents).toBeGreaterThan(0);
    expect(h.items[0].status).toBe('listed');
  });

  it('money-safe: un THROW del reprecio NO tumba la publicación (cae a la ref almacenada)', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    h.refState.current = new Map([['c1|raw|raw:NM|normal', priced(15000)]]);
    h.refresh.mockRejectedValue(new Error('provider exploded'));

    const res = await h.svc.bulkPublish(publish('i1', { repriceFresh: true }), 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed' });
    expect(h.items[0].status).toBe('listed');
  });

  it('sin repriceFresh el reprecio NO se llama (comportamiento previo intacto)', async () => {
    const h = buildHarness();
    h.items.push(rawItem());
    h.refState.current = new Map([['c1|raw|raw:NM|normal', priced(15000)]]);
    await h.svc.bulkPublish(publish('i1'), 'admin');
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('repriceFresh NO gasta cuota en líneas con precio MANUAL (solo derivadas)', async () => {
    const h = buildHarness();
    h.items.push(rawItem()); // derivada
    h.items.push(rawItem({ id: 'i2', cardId: 'c2', listPriceCents: 9999 })); // override de item
    h.refresh.mockResolvedValue({ refreshed: [], pending: ['c1'], dailyLimited: false });

    await h.svc.bulkPublish(
      { items: [{ inventoryItemId: 'i1' }, { inventoryItemId: 'i2' }], repriceFresh: true },
      'admin',
    );
    // Solo la carta de la línea DERIVADA (c1) entra al reprecio; la de override (c2) no.
    expect(h.refresh).toHaveBeenCalledWith(['c1'], ['normal']);
  });
});
