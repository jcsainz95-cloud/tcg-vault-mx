import { Prisma, SealedGroupKind } from '@prisma/client';
import { SealedProductService } from '../src/modules/inventory/sealed-product.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvSealedBulkProvider } from '../src/modules/pricing/providers/tcgcsv-sealed.provider';

/**
 * SEC-M11-3 (BAJA) + SEC-M11-5 (BAJA/PERF) — deuda del sellado sobre `SealedProductService`.
 *
 * - SEC-M11-3: la bitácora de `setMainGroup` capturaba SÓLO `tcgcsvGroupId` en `before/after`; la
 *   reestructura de `kind` de los grupos (set_main viejo degradado, grupo nuevo promovido) quedaba fuera.
 *   El rastro debe reflejar el ESTADO PREVIO y NUEVO COMPLETOS de los grupos del set.
 * - SEC-M11-5: `sealedPriceStatus` resolvía el ancla y las referencias de mercado UNA CONSULTA POR SET
 *   (N+1). Debe resolverse EN LOTE sin cambiar la salida (mismos números, menos queries).
 */

// ---------------------------------------------------------------------------
// Mock de Prisma en memoria (sólo lo que tocan setMainGroup y sealedPriceStatus).
// ---------------------------------------------------------------------------
function buildPrisma(seed: {
  sets?: any[];
  cards?: any[];
  sealedProducts?: any[];
  sealedSetGroups?: any[];
} = {}) {
  const sets: any[] = (seed.sets ?? []).map((s) => ({ ...s }));
  const cards: any[] = (seed.cards ?? []).map((c) => ({ ...c }));
  const sealedProducts: any[] = (seed.sealedProducts ?? []).map((p) => ({ ...p }));
  const sealedSetGroups: any[] = (seed.sealedSetGroups ?? []).map((g) => ({ ...g }));
  let seq = 0;
  const uid = () => `g-${++seq}`;
  const sortCards = (arr: any[]) =>
    [...arr].sort(
      (a, b) =>
        String(a.numberPrefix ?? '').localeCompare(String(b.numberPrefix ?? '')) ||
        (a.numberSort ?? 0) - (b.numberSort ?? 0),
    );

  const prisma: any = {
    cardSet: {
      findUnique: jest.fn(async ({ where }: any) => sets.find((s) => s.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) =>
        sets.filter((s) => {
          if (where?.id?.in != null && !where.id.in.includes(s.id)) return false;
          if (where?.tcgcsvGroupId?.not === null && s.tcgcsvGroupId == null) return false;
          if (where?.name?.contains != null)
            return String(s.name).toLowerCase().includes(String(where.name.contains).toLowerCase());
          return true;
        }),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const s = sets.find((x) => x.id === where.id);
        Object.assign(s, data);
        return s;
      }),
    },
    card: {
      // Ruta N+1 (producción): una llamada POR SET.
      findFirst: jest.fn(async ({ where }: any) => sortCards(cards.filter((c) => c.setId === where.setId))[0] ?? null),
      // Ruta en lote (arreglo SEC-M11-5): UNA llamada para todos los sets.
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where?.setId?.in ?? [];
        return sortCards(cards.filter((c) => ids.includes(c.setId)));
      }),
    },
    sealedSetGroup: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        sealedSetGroups.filter((g) => (where?.setId != null ? g.setId === where.setId : true)),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: uid(), label: null, ...data };
        sealedSetGroups.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const g = sealedSetGroups.find((x) => x.id === where.id);
        Object.assign(g, data);
        return g;
      }),
    },
    sealedProduct: {
      findMany: jest.fn(async ({ where }: any) =>
        sealedProducts.filter((p) => (where?.active != null ? p.active === where.active : true)),
      ),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    _stores: { sets, cards, sealedProducts, sealedSetGroups },
  };
  return prisma;
}

const fxMock = () =>
  ({ getCurrent: jest.fn(async () => ({ rate: 20, bufferPct: 0, source: 'manual' as const, effectiveDate: '2026-08-23' })) } as unknown as FxService);

const providerMock = (groups: { groupId: number; name: string }[] = []) =>
  ({ listGroups: jest.fn(async () => groups) } as unknown as TcgcsvSealedBulkProvider);

/** PricingService mock: dial ON, referencias sembradas por clave; gate H-1 réplica del real. */
const pricingMock = (opts: { sourceOn?: boolean; refsByKey?: Record<string, number> } = {}) =>
  ({
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 0, sourceOn: opts.sourceOn ?? true })),
    getReferencesBatch: jest.fn(async (items: any[]) => {
      const map = new Map<string, any>();
      for (const i of items) {
        const key = `${i.cardId}|${i.productType}|${i.gradeKey}|${i.finish}`;
        const cents = opts.refsByKey?.[key];
        if (cents != null) map.set(key, { status: 'priced', referenceMxnCents: cents });
      }
      return map;
    }),
    gateSealedMarketCents: (ref: any, sourceOn: boolean) => {
      if (ref?.status !== 'priced' || ref.referenceMxnCents == null) return null;
      if (ref.isManualOverride === true || ref.source === 'manual') return ref.referenceMxnCents;
      return sourceOn ? ref.referenceMxnCents : null;
    },
  }) as any;

const auditMock = () => ({ log: jest.fn(async () => undefined) });

const svcOf = (prisma: any, provider: any, pricing: any, audit?: any) =>
  new SealedProductService(prisma as PrismaService, provider, fxMock(), pricing, audit);

// ===========================================================================
describe('SEC-M11-3 · setMainGroup audita el ESTADO COMPLETO de grupos (before/after)', () => {
  // set con set_main=100 y promo=200; se REEMPLAZA el set_main a 200 (promueve 200, degrada 100).
  const seed = () => ({
    sets: [{ id: 'set-a', name: 'Set A', series: 'SV', releaseDate: '2026-01-01', tcgcsvGroupId: 100 }],
    sealedSetGroups: [
      { id: 'row-100', setId: 'set-a', tcgplayerGroupId: 100, kind: 'set_main' as SealedGroupKind, label: 'A' },
      { id: 'row-200', setId: 'set-a', tcgplayerGroupId: 200, kind: 'promo_collection' as SealedGroupKind, label: 'B' },
    ],
  });

  it('⛔ el rastro debe reflejar el kind PREVIO y NUEVO de cada grupo afectado (antes: sólo tcgcsvGroupId)', async () => {
    const prisma = buildPrisma(seed());
    const audit = auditMock();
    const svc = svcOf(prisma, providerMock(), pricingMock(), audit);

    await svc.setMainGroup('set-a', { tcgplayerGroupId: 200, reason: 'mapeo corregido' }, { userId: 'u1', role: 'super_admin' as any });

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry: any = (audit.log.mock.calls[0] as any[])[0];

    // El espejo sigue capturado (no se pierde nada de lo anterior).
    expect((entry.before as any).tcgcsvGroupId).toBe(100);
    expect((entry.after as any).tcgcsvGroupId).toBe(200);
    expect((entry.after as any).reason).toBe('mapeo corregido');

    // ESTADO PREVIO COMPLETO de los grupos: 100=set_main, 200=promo_collection.
    const beforeGroups: { tcgplayerGroupId: number; kind: string }[] = (entry.before as any).groups;
    expect(beforeGroups).toEqual(
      expect.arrayContaining([
        { tcgplayerGroupId: 100, kind: 'set_main' },
        { tcgplayerGroupId: 200, kind: 'promo_collection' },
      ]),
    );

    // ESTADO NUEVO COMPLETO: 100 degradado a promo_collection, 200 promovido a set_main.
    const afterGroups: { tcgplayerGroupId: number; kind: string }[] = (entry.after as any).groups;
    expect(afterGroups).toEqual(
      expect.arrayContaining([
        { tcgplayerGroupId: 100, kind: 'promo_collection' },
        { tcgplayerGroupId: 200, kind: 'set_main' },
      ]),
    );
  });

  it('✅ la bitácora participa de la MISMA $transaction que el remap (SEC-M11-2, no regresa)', async () => {
    const prisma = buildPrisma(seed());
    const audit = auditMock();
    const svc = svcOf(prisma, providerMock(), pricingMock(), audit);
    await svc.setMainGroup('set-a', { tcgplayerGroupId: 200 }, { userId: 'u1', role: 'super_admin' as any });
    // audit.log recibió el `tx` (segundo argumento) del $transaction.
    expect((audit.log.mock.calls[0] as any[])[1]).toBeDefined();
  });
});

describe('SEC-M11-5 · sealedPriceStatus resuelve anclas + referencias EN LOTE (no N+1)', () => {
  // 5 sets, cada uno con 1 carta ancla y 1 producto sellado mapeado y preciado.
  const N = 5;
  const seed = () => {
    const sets: any[] = [];
    const cards: any[] = [];
    const sealedProducts: any[] = [];
    const sealedSetGroups: any[] = [];
    const refsByKey: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const setId = `set-${i}`;
      const groupId = 1000 + i;
      const productId = 5000 + i;
      const anchor = `card-${i}`;
      sets.push({ id: setId, name: `Set ${i}`, series: 'SV', releaseDate: `2026-0${i + 1}-01`, tcgcsvGroupId: groupId });
      cards.push({ id: anchor, setId, numberPrefix: '', numberSort: 1 });
      sealedProducts.push({ setId, tcgplayerProductId: productId, tcgplayerGroupId: groupId, active: true });
      sealedSetGroups.push({ id: `row-${i}`, setId, tcgplayerGroupId: groupId, kind: 'set_main' });
      refsByKey[`${anchor}|sealed|sealed:tcg:${productId}|normal`] = 12345 + i;
    }
    return { seed: { sets, cards, sealedProducts, sealedSetGroups }, refsByKey };
  };

  it('⛔ censo de queries: ≤1 llamada a getReferencesBatch para N sets (antes: N)', async () => {
    const { seed: s, refsByKey } = seed();
    const prisma = buildPrisma(s);
    const pricing = pricingMock({ sourceOn: true, refsByKey });
    const svc = svcOf(prisma, providerMock(), pricing);

    const res = await svc.sealedPriceStatus({ page: 1, pageSize: 50 });

    // Salida INTACTA: los N sets salen `priced`.
    expect(res.total).toBe(N);
    expect(res.data.every((r) => r.state === 'priced' && r.priced === 1)).toBe(true);

    // N+1 eliminado: una sola consulta de referencias, y anclas en lote (findMany, no findFirst por set).
    expect((pricing.getReferencesBatch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
    expect((prisma.card.findFirst as jest.Mock).mock.calls.length).toBe(0);
    expect((prisma.card.findMany as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('✅ mismos números que antes: dial OFF ⇒ mapped_unpriced (gate money-safe intacto)', async () => {
    const { seed: s, refsByKey } = seed();
    const prisma = buildPrisma(s);
    const svc = svcOf(prisma, providerMock(), pricingMock({ sourceOn: false, refsByKey }));
    const res = await svc.sealedPriceStatus({ page: 1, pageSize: 50 });
    expect(res.total).toBe(N);
    expect(res.data.every((r) => r.state === 'mapped_unpriced' && r.mappedUnpriced === 1)).toBe(true);
  });
});
