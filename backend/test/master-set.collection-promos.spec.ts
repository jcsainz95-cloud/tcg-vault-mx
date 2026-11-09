import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PROMO_GATE_KEY } from '../src/modules/catalog/promo-collection-link.service';
import { DEFAULT_PRICING_CURVE, DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';

/**
 * PROMOS-MASTERSET §4/§5 (PMS-B11/B12/B13/B16/B17) + AUTO_CATALOGO §B: el apartado «Promos de la colección».
 *  - `items` = `MasterSetCardCellDTO[]` (mismo DTO del binder), nunca la forma mínima.
 *  - Los SELLOS salen SIEMPRE; las Black Star ligadas solo con la compuerta automatica ABIERTA.
 *  - `owned/total` cuentan lo MOSTRADO y NO entran en `catalogCardCount`/celdas del Master Set.
 */
const card = (id: string, setId: string, number: string, over: Record<string, unknown> = {}) => ({
  id, setId, number, numberSort: Number(number) || 0, numberPrefix: '', name: `Carta ${number}`, rarity: 'Common',
  rarityCanonical: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'holofoil'], ...over,
});

function world(opts: { gate: boolean; stamps?: boolean; linked?: boolean; owned?: { cardId: string; finish: string }[]; ownedStamp?: number }) {
  const store = new Map<string, unknown>();
  if (opts.gate) store.set(PROMO_GATE_KEY, { open: true, n: 30, k: 30, expansions: 2 });
  const main = [card('x1', 's1', '1'), card('x2', 's1', '2')];
  const promoCard = card('bs1', 'svp', '10', { name: 'Black Star 10' });
  const stampedProducts = opts.stamps === false ? [] : [
    { tcgplayerProductId: 777, cardId: 'x1', finishes: ['holofoil'], card: main[0] },
    { tcgplayerProductId: 778, cardId: 'x2', finishes: [], card: main[1] },
  ];
  const prisma: any = {
    cardSet: { findUnique: jest.fn(async () => ({ id: 's1', name: 'Set 1', series: 'SV', releaseDate: '2025/01/01', printedTotal: 2 })), findMany: jest.fn(async () => []) },
    card: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.setId) return main;
        if (where?.id?.in) return where.id.in.includes('bs1') ? [promoCard] : [];
        return [];
      }),
    },
    cardProduct: { findMany: jest.fn(async () => stampedProducts) },
    promoCollectionLink: { findMany: jest.fn(async () => (opts.linked === false ? [] : [{ promoCardId: 'bs1' }])) },
    configSetting: { findUnique: jest.fn(async ({ where: { key } }: any) => (store.has(key) ? { key, valueJson: store.get(key) } : null)) },
    inventoryItem: {
      groupBy: jest.fn(async ({ by }: any) => {
        if (by[0] === 'cardProductId') return opts.ownedStamp ? [{ cardProductId: opts.ownedStamp, finish: 'holofoil', _count: { _all: 2 } }] : [];
        return (opts.owned ?? []).map((o) => ({ cardId: o.cardId, finish: o.finish, _count: { _all: 1 } }));
      }),
      findMany: jest.fn(async () => []),
    },
    user: { findUnique: jest.fn(async () => ({ id: 'u1', name: 'Cliente', nameSource: 'user', email: 'c@x.mx' })) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const pricing: any = {
    loadSalePremiumFloorPolicy: jest.fn(async () => DEFAULT_SALE_PREMIUM_FLOOR_POLICY),
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(),
    getReferencesBatch: jest.fn(async () => new Map()),
    getSeparateProductsByCard: jest.fn(async (_ids: string[], kinds?: string[]) =>
      kinds?.includes('stamped')
        ? new Map([['x1', [{ productId: 777, kind: 'stamped', name: 'Carta 1 (Prerelease)', finishes: ['holofoil'], prices: [{ finish: 'holofoil', marketReferenceMxnCents: 12_300, capturedDate: '2026-11-08' }] }]]])
        : new Map(),
    ),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    defaultVersionWhere: jest.fn(async () => ({ language: 'en' })),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  };
  return { svc: new MasterSetService(prisma, pricing), prisma, pricing };
}

describe('collectionPromos - apartado «Promos de la colección»', () => {
  it('B13 sellos SIEMPRE visibles (compuerta CERRADA): items son MasterSetCardCellDTO, Black Star no sale', async () => {
    const { svc } = world({ gate: false });
    const res = await svc.binder('s1');
    expect(res.collectionPromos).toBeDefined();
    expect(res.collectionPromos!.items.map((c) => c.cardId)).toEqual(['x1', 'x2']); // solo sellos; 'bs1' (Black Star) no
    for (const c of res.collectionPromos!.items) {
      // DTO de celda COMPLETO (el front no truena): acabados, variantes, conteos y total.
      expect(Array.isArray(c.availableFinishes)).toBe(true);
      expect(Array.isArray(c.variants)).toBe(true);
      expect(Array.isArray(c.countsByFinish)).toBe(true);
      expect(typeof c.totalCount).toBe('number');
      expect(c.variants.length).toBeGreaterThan(0);
    }
    const first = res.collectionPromos!.items[0];
    expect(first.variants).toEqual([expect.objectContaining({ finish: 'holofoil', count: 0, covered: false, marketReferenceMxnCents: 12_300 })]);
    expect(first.separateProducts?.[0]).toMatchObject({ productId: 777, kind: 'stamped' });
    // sello sin acabados en el producto => una variante `normal` (nunca vacio)
    expect(res.collectionPromos!.items[1].variants.map((v) => v.finish)).toEqual(['normal']);
  });

  it('compuerta ABIERTA: las Black Star ligadas `high` tambien salen, por el MISMO constructor de celdas (variantes por acabado)', async () => {
    const { svc, prisma } = world({ gate: true });
    const res = await svc.binder('s1');
    const ids = res.collectionPromos!.items.map((c) => c.cardId);
    expect(ids).toEqual(['bs1', 'x1', 'x2']);
    const bs = res.collectionPromos!.items[0];
    expect(bs.variants.map((v) => v.finish)).toEqual(['normal', 'holofoil']);
    expect(bs.isSecretRare).toBe(false);
    expect(prisma.promoCollectionLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { expansionSetId: { in: ['s1'] }, confidence: 'high' } }));
  });

  it('compuerta cerrada y SIN sellos => sin apartado (undefined), aunque haya Black Star ligadas', async () => {
    const { svc } = world({ gate: false, stamps: false });
    expect((await svc.binder('s1')).collectionPromos).toBeUndefined();
  });

  it('compuerta abierta sin nada ligado y sin sellos => sin apartado', async () => {
    const { svc } = world({ gate: true, stamps: false, linked: false });
    expect((await svc.binder('s1')).collectionPromos).toBeUndefined();
  });

  it('B16 owned/total cuentan lo MOSTRADO: 3 celdas (1 Black Star + 2 sellos), tiene 2 (la Black Star y un sello)', async () => {
    const { svc } = world({ gate: true, owned: [{ cardId: 'bs1', finish: 'normal' }], ownedStamp: 777 });
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' });
    expect(res.collectionPromos).toMatchObject({ total: 3, owned: 2 });
    const stamp = res.collectionPromos!.items.find((c) => c.separateProducts?.[0]?.productId === 777)!;
    expect(stamp.countsByFinish).toEqual([{ finish: 'holofoil', count: 2 }]);
    expect(stamp.variants[0]).toMatchObject({ covered: true, count: 2 });
  });

  it('B11/B17 el apartado NO cambia el Master Set: mismas celdas, catalogCardCount y conteos con y sin apartado', async () => {
    const withPromos = await world({ gate: true, owned: [{ cardId: 'x1', finish: 'normal' }, { cardId: 'bs1', finish: 'normal' }] }).svc.binder('s1');
    const without = await world({ gate: false, stamps: false, owned: [{ cardId: 'x1', finish: 'normal' }, { cardId: 'bs1', finish: 'normal' }] }).svc.binder('s1');
    expect(without.collectionPromos).toBeUndefined();
    expect(withPromos.cells).toEqual(without.cells);
    expect(withPromos.catalogCardCount).toBe(2);
    expect(withPromos.cells.map((c) => c.cardId)).toEqual(['x1', 'x2']);
    expect(withPromos.cells.reduce((s, c) => s + c.coveredVariantCount, 0)).toBe(without.cells.reduce((s, c) => s + c.coveredVariantCount, 0));
  });

  it('un fallo armando el apartado jamas rompe el binder (se omite el campo)', async () => {
    const { svc, prisma } = world({ gate: true });
    prisma.cardProduct.findMany.mockRejectedValue(new Error('boom'));
    const res = await svc.binder('s1');
    expect(res.collectionPromos).toBeUndefined();
    expect(res.cells).toHaveLength(2);
  });

  it('B12 el indice (completitud/valor por set) no consulta el apartado', async () => {
    const { svc, prisma } = world({ gate: true });
    prisma.cardSet.findMany.mockResolvedValue([]);
    (prisma.card as any).groupBy = jest.fn().mockResolvedValue([]);
    await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect(prisma.promoCollectionLink.findMany).not.toHaveBeenCalled();
    expect(prisma.cardProduct.findMany).not.toHaveBeenCalled();
  });
});
