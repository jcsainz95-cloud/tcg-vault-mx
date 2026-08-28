import { Prisma } from '@prisma/client';
import { SealedProductService } from '../src/modules/inventory/sealed-product.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvSealedBulkProvider } from '../src/modules/pricing/providers/tcgcsv-sealed.provider';
import { inferSealedSubtype, SEALED_SUBTYPE_META } from '../src/modules/inventory/sealed-subtype';

/** Fabrica un error P2002 (violación UNIQUE) como el que lanza Prisma bajo una carrera de `create`. */
const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

/**
 * v1.39-sealed-product-module (M-39, P-38 · ARCHITECTURE §4.34 · API_CONTRACT §M1) — SealedProductService.
 * Cubre: sync que PUEBLA el groupId del set por name-match SIN item previo (rompe el círculo vicioso),
 * 1 set → N grupos (set_main + promo_collection), UPC inferido, money-safe (sin precio → null, nunca 0),
 * soft-delete, listado ordenado (§4.34c) con marketRef live→caché→null, candidates, enlace de grupos, y
 * el backfill que cura el ETB→Tropius (liga sealedProductId) dejando los SIN MAPEO en null.
 */

// ---------------------------------------------------------------------------
// Mock de Prisma en memoria (lo que usa el servicio).
// ---------------------------------------------------------------------------
function buildPrisma(seed: {
  sets?: any[];
  cards?: any[];
  sealedProducts?: any[];
  sealedSetGroups?: any[];
  inventoryItems?: any[];
} = {}) {
  const sets: any[] = seed.sets ?? [];
  const cards: any[] = seed.cards ?? [];
  const sealedProducts: any[] = (seed.sealedProducts ?? []).map((p) => ({ ...p }));
  const sealedSetGroups: any[] = (seed.sealedSetGroups ?? []).map((g) => ({ ...g }));
  const inventoryItems: any[] = (seed.inventoryItems ?? []).map((i) => ({ ...i }));
  let seq = 0;
  const uid = () => `id-${++seq}`;

  const matchSealed = (p: any, where: any): boolean => {
    if (where.setId != null && p.setId !== where.setId) return false;
    if (where.active != null && p.active !== where.active) return false;
    if (where.origin != null && p.origin !== where.origin) return false;
    if (where.isPrincipal != null && p.isPrincipal !== where.isPrincipal) return false;
    if (where.tcgplayerGroupId?.in != null && !where.tcgplayerGroupId.in.includes(p.tcgplayerGroupId)) return false;
    if (where.tcgplayerProductId?.notIn != null && where.tcgplayerProductId.notIn.includes(p.tcgplayerProductId)) return false;
    if (where.OR != null) {
      const ok = where.OR.some((cond: any) => {
        if (cond.name?.contains) return String(p.name).toLowerCase().includes(cond.name.contains.toLowerCase());
        if (cond.cleanName?.contains)
          return String(p.cleanName ?? '').toLowerCase().includes(cond.cleanName.contains.toLowerCase());
        return false;
      });
      if (!ok) return false;
    }
    return true;
  };

  const prisma: any = {
    cardSet: {
      findUnique: jest.fn(async ({ where }: any) => sets.find((s) => s.id === where.id) ?? null),
      findMany: jest.fn(async () => sets),
      update: jest.fn(async ({ where, data }: any) => {
        const s = sets.find((x) => x.id === where.id);
        Object.assign(s, data);
        return s;
      }),
    },
    card: {
      findFirst: jest.fn(async ({ where }: any) => {
        const inSet = cards.filter((c) => c.setId === where.setId);
        inSet.sort(
          (a, b) => (a.numberPrefix ?? '').localeCompare(b.numberPrefix ?? '') || (a.numberSort ?? 0) - (b.numberSort ?? 0),
        );
        return inSet[0] ?? null;
      }),
    },
    sealedSetGroup: {
      findMany: jest.fn(async ({ where }: any) =>
        sealedSetGroups.filter((g) => g.setId === where.setId),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.setId_tcgplayerGroupId;
        return sealedSetGroups.find((g) => g.setId === k.setId && g.tcgplayerGroupId === k.tcgplayerGroupId) ?? null;
      }),
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
      findMany: jest.fn(async ({ where }: any) => sealedProducts.filter((p) => matchSealed(p, where ?? {}))),
      count: jest.fn(async ({ where }: any) => sealedProducts.filter((p) => matchSealed(p, where ?? {})).length),
      findUnique: jest.fn(async ({ where }: any) =>
        sealedProducts.find((p) => p.tcgplayerProductId === where.tcgplayerProductId) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: uid(), cleanName: null, imageUrl: null, marketUsdCents: null, ...data };
        sealedProducts.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = sealedProducts.find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const affected = sealedProducts.filter((p) => matchSealed(p, where));
        affected.forEach((p) => Object.assign(p, data));
        return { count: affected.length };
      }),
    },
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        inventoryItems
          .filter((i) => {
            if (where.productType && i.productType !== where.productType) return false;
            if (where.sealedProductId === null && i.sealedProductId != null) return false;
            if (where.tcgplayerProductId?.not === null && i.tcgplayerProductId == null) return false;
            if (where.tcgplayerProductId != null && typeof where.tcgplayerProductId === 'number' && i.tcgplayerProductId !== where.tcgplayerProductId)
              return false;
            return true;
          })
          .map((i) => ({ ...i, card: { setId: cards.find((c) => c.id === i.cardId)?.setId ?? i.setId } })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const affected = inventoryItems.filter(
          (i) =>
            i.productType === where.productType &&
            i.tcgplayerProductId === where.tcgplayerProductId &&
            (where.sealedProductId !== null || i.sealedProductId == null),
        );
        affected.forEach((i) => Object.assign(i, data));
        return { count: affected.length };
      }),
    },
    _stores: { sets, cards, sealedProducts, sealedSetGroups, inventoryItems },
  };
  return prisma;
}

function buildProvider(opts: {
  groups?: { groupId: number; name: string; publishedOn?: string }[];
  productsByGroup?: Record<number, { productId: number; name: string; cleanName?: string; imageUrl?: string }[]>;
  pricesByGroup?: Record<number, { tcgplayerProductId: number; marketCents: number }[]>;
  listThrows?: boolean;
} = {}) {
  return {
    listGroups: jest.fn(async () => {
      if (opts.listThrows) throw new Error('tcgcsv down');
      return opts.groups ?? [];
    }),
    listSealedProducts: jest.fn(async (groupId: number) => opts.productsByGroup?.[groupId] ?? []),
    fetchSealedPricesForGroup: jest.fn(async (groupId: number) => ({
      rows: (opts.pricesByGroup?.[groupId] ?? []).map((r) => ({ ...r, usedFallbackMid: false, currency: 'USD' })),
      fetchedRaw: 0,
      skipped: 0,
    })),
  } as unknown as TcgcsvSealedBulkProvider;
}

const fxMock = (rate = 20, bufferPct = 0) =>
  ({ getCurrent: jest.fn(async () => ({ rate, bufferPct, source: 'manual' as const, effectiveDate: '2026-08-23' })) } as unknown as FxService);

/**
 * v1.41 (IMP-1) — mock del PricingService que el listado usa para `effectiveMarketCents` (resolver H-1
 * gateado). Por defecto el dial está OFF (`sourceOn=false`) ⇒ `effectiveMarketCents` null (money-safe,
 * PRICE_PENDING) aunque `marketRef` traiga un valor de caché. `refsByKey` permite sembrar referencias H-1
 * (`cardId|sealed|sealed:tcg:<productId>|normal` → cents) para el caso dial ON.
 */
const pricingMock = (opts: { sourceOn?: boolean; refsByKey?: Record<string, number> } = {}) =>
  ({
    loadSealedSpreads: jest.fn(async () => ({
      spreadPctBySubtype: {},
      fallbackPct: 0,
      sourceOn: opts.sourceOn ?? false,
    })),
    getReferencesBatch: jest.fn(async (items: any[]) => {
      const map = new Map<string, any>();
      for (const i of items) {
        const key = `${i.cardId}|${i.productType}|${i.gradeKey}|${i.finish}`;
        const cents = opts.refsByKey?.[key];
        if (cents != null) map.set(key, { status: 'priced', referenceMxnCents: cents });
      }
      return map;
    }),
    // Réplica exacta del gate H-1 real (gateSealedMarketCents, v1.43/IMP-C): el override manual de
    // mercado (source='manual'/isManualOverride) sobrevive al dial; la fuente automática se gatea.
    gateSealedMarketCents: (ref: any, sourceOn: boolean) => {
      if (ref?.status !== 'priced' || ref.referenceMxnCents == null) return null;
      if (ref.isManualOverride === true || ref.source === 'manual') return ref.referenceMxnCents;
      return sourceOn ? ref.referenceMxnCents : null;
    },
  }) as any;

const svcOf = (prisma: any, provider: any, fx = fxMock(), pricing = pricingMock()) =>
  new SealedProductService(prisma as PrismaService, provider, fx, pricing);

// ===========================================================================
describe('inferSealedSubtype — orden normativo §4.34c (upc antes de etb/collection)', () => {
  it.each([
    ['Scarlet & Violet Ultra Premium Collection', 'upc'],
    ['SV: Prismatic Evolutions UPC', 'upc'],
    ['Prismatic Evolutions Elite Trainer Box', 'etb'],
    ['SV08 ETB White', 'etb'],
    ['Prismatic Evolutions Booster Bundle', 'bundle'],
    ['Prismatic Evolutions Booster Box', 'box'],
    ['Charizard ex Premium Collection', 'collection'],
    ['Special Collection Pikachu', 'collection'],
    ['Poké Ball Tin', 'tin'],
    ['3-Pack Blister', 'blister'],
    ['Mystery Gift Box', 'collection'], // «box» genérico → collection (no booster box)
  ])('«%s» → %s', (name, expected) => {
    expect(inferSealedSubtype(name)).toBe(expected);
  });

  it('nombre no reconocible → null (el operador cura)', () => {
    expect(inferSealedSubtype('Random Promo Thing')).toBeNull();
  });

  it('sortOrder canónico: upc=0, etb=1, box=2, bundle=3, tin=4, blister=5, collection=6; principales', () => {
    expect(SEALED_SUBTYPE_META.upc).toMatchObject({ sortOrder: 0, isPrincipal: true });
    expect(SEALED_SUBTYPE_META.etb).toMatchObject({ sortOrder: 1, isPrincipal: true });
    expect(SEALED_SUBTYPE_META.box).toMatchObject({ sortOrder: 2, isPrincipal: true });
    expect(SEALED_SUBTYPE_META.bundle).toMatchObject({ sortOrder: 3, isPrincipal: true });
    expect(SEALED_SUBTYPE_META.tin).toMatchObject({ sortOrder: 4, isPrincipal: false });
    expect(SEALED_SUBTYPE_META.blister).toMatchObject({ sortOrder: 5, isPrincipal: false });
    expect(SEALED_SUBTYPE_META.collection).toMatchObject({ sortOrder: 6, isPrincipal: false });
  });
});

// ===========================================================================
describe('SealedProductService.sync — puebla groupId + catálogo (rompe el círculo vicioso)', () => {
  const SET = { id: 'set-1', name: 'Prismatic Evolutions', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null };

  it('set SIN groupId curado: name-match del set_main → PUEBLA CardSet.tcgcsvGroupId + SealedSetGroup, SIN item previo', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }] });
    const provider = buildProvider({
      groups: [
        { groupId: 100, name: 'Prismatic Evolutions', publishedOn: '2025-01-17' },
        { groupId: 999, name: 'Some Other Set', publishedOn: '2020-01-01' },
      ],
      productsByGroup: {
        100: [
          { productId: 11, name: 'Prismatic Evolutions Elite Trainer Box', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/11.jpg' },
          { productId: 12, name: 'Prismatic Evolutions Ultra Premium Collection' },
        ],
      },
      pricesByGroup: { 100: [{ tcgplayerProductId: 11, marketCents: 25000 }] },
    });
    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });

    // Pobló el groupId del set (denormalización del set_main) — el hueco 1 resuelto sin item.
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(100);
    // Fila SealedSetGroup(set_main) creada.
    const sg = prisma._stores.sealedSetGroups;
    expect(sg).toHaveLength(1);
    expect(sg[0]).toMatchObject({ setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main' });
    // Dos SealedProduct upserted; UPC inferido; ETB con precio, UPC sin precio → null money-safe.
    const sp = prisma._stores.sealedProducts;
    expect(sp).toHaveLength(2);
    const upc = sp.find((p: any) => p.tcgplayerProductId === 12);
    expect(upc.subtype).toBe('upc');
    expect(upc.marketUsdCents).toBeNull(); // money-safe: sin precio → null, NUNCA 0
    const etb = sp.find((p: any) => p.tcgplayerProductId === 11);
    expect(etb.subtype).toBe('etb');
    expect(etb.marketUsdCents).toBe(25000);
    expect(res).toMatchObject({ setsSynced: 1, groupsPopulated: 1, productsUpserted: 2, pricedCount: 1, pendingPriceCount: 1 });
  });

  it('1 set → N grupos: groupIds extra se enlazan como promo_collection y aportan su origin', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET, tcgcsvGroupId: 100 }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
    });
    const provider = buildProvider({
      productsByGroup: {
        100: [{ productId: 11, name: 'Booster Box' }],
        200: [{ productId: 21, name: 'Mega Evolution Blister' }],
      },
      pricesByGroup: {},
    });
    const res = await svcOf(prisma, provider).sync({ setId: 'set-1', groupIds: [200] });

    const sg = prisma._stores.sealedSetGroups;
    expect(sg.find((g: any) => g.tcgplayerGroupId === 200)).toMatchObject({ kind: 'promo_collection' });
    const blister = prisma._stores.sealedProducts.find((p: any) => p.tcgplayerProductId === 21);
    expect(blister.origin).toBe('promo_collection');
    expect(blister.subtype).toBe('blister');
    const box = prisma._stores.sealedProducts.find((p: any) => p.tcgplayerProductId === 11);
    expect(box.origin).toBe('set_main');
    expect(res.setsSynced).toBe(1);
    expect(res.productsUpserted).toBe(2);
  });

  it('soft-delete: un SealedProduct que ya no aparece en su grupo → active=false (nunca borrado duro)', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET, tcgcsvGroupId: 100 }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
      sealedProducts: [
        { id: 'sp-old', setId: 'set-1', tcgplayerProductId: 99, tcgplayerGroupId: 100, name: 'Retired', subtype: 'box', subtypeInferred: true, isPrincipal: true, origin: 'set_main', active: true },
      ],
    });
    const provider = buildProvider({
      productsByGroup: { 100: [{ productId: 11, name: 'Booster Box' }] },
    });
    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });
    const old = prisma._stores.sealedProducts.find((p: any) => p.tcgplayerProductId === 99);
    expect(old.active).toBe(false);
    expect(res.productsDeactivated).toBe(1);
  });

  it('NO pisa un subtype CURADO por humano (subtypeInferred=false)', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET, tcgcsvGroupId: 100 }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
      sealedProducts: [
        { id: 'sp-1', setId: 'set-1', tcgplayerProductId: 11, tcgplayerGroupId: 100, name: 'Weird Box', subtype: 'tin', subtypeInferred: false, isPrincipal: false, origin: 'set_main', active: true },
      ],
    });
    const provider = buildProvider({ productsByGroup: { 100: [{ productId: 11, name: 'Booster Box' }] } });
    await svcOf(prisma, provider).sync({ setId: 'set-1' });
    // El nombre inferiría 'box', pero fue curado a 'tin' → se conserva.
    expect(prisma._stores.sealedProducts[0].subtype).toBe('tin');
  });

  it('setId inexistente → 404; ni setId ni all → 400', async () => {
    const prisma = buildPrisma({ sets: [] });
    const provider = buildProvider();
    await expect(svcOf(prisma, provider).sync({ setId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(svcOf(prisma, provider).sync({})).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('TCGCSV caído al listar productos → 502 UPSTREAM_ERROR', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET, tcgcsvGroupId: 100 }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
    });
    const provider = buildProvider();
    (provider.listSealedProducts as jest.Mock).mockRejectedValue(new Error('down'));
    await expect(svcOf(prisma, provider).sync({ setId: 'set-1' })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
  });
});

// ===========================================================================
describe('SealedProductService.listSealedProducts — orden §4.34c + marketRef money-safe', () => {
  const SET = { id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 100 };

  const seedProducts = () => [
    { id: 'a', setId: 'set-1', tcgplayerProductId: 1, tcgplayerGroupId: 100, name: 'Zzz Booster Box', subtype: 'box', subtypeInferred: true, isPrincipal: true, origin: 'set_main', imageUrl: null, marketUsdCents: 40000, active: true },
    { id: 'b', setId: 'set-1', tcgplayerProductId: 2, tcgplayerGroupId: 100, name: 'Aaa ETB', subtype: 'etb', subtypeInferred: true, isPrincipal: true, origin: 'set_main', imageUrl: null, marketUsdCents: null, active: true },
    { id: 'c', setId: 'set-1', tcgplayerProductId: 3, tcgplayerGroupId: 200, name: 'Promo Tin', subtype: 'tin', subtypeInferred: true, isPrincipal: false, origin: 'promo_collection', imageUrl: null, marketUsdCents: null, active: true },
  ];

  it('ordena (isPrincipal desc, sortOrder asc, name asc); marketRef live→caché→null (nunca 0)', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }], sealedProducts: seedProducts() });
    // Live: product 2 (ETB) obtiene precio EN VIVO 30000; product 1 usa la caché 40000; product 3 sin nada → null.
    const provider = buildProvider({ pricesByGroup: { 100: [{ tcgplayerProductId: 2, marketCents: 30000 }], 200: [] } });
    const res = await svcOf(prisma, provider, fxMock(20, 0)).listSealedProducts({ setId: 'set-1' });

    expect(res.needsSync).toBe(false);
    // Principales primero por sortOrder: etb(1) antes que box(2); luego la secundaria tin.
    expect(res.data.map((d) => d.tcgplayerProductId)).toEqual([2, 1, 3]);
    // ETB: live 30000 USDc × 20 = 600000 MXNc.
    expect(res.data[0].marketRef).toEqual({ status: 'priced', referenceMxnCents: 600000 });
    // Box: caché 40000 × 20 = 800000.
    expect(res.data[1].marketRef).toEqual({ status: 'priced', referenceMxnCents: 800000 });
    // Tin: sin precio en ninguna capa → null money-safe.
    expect(res.data[2].marketRef).toBeNull();
  });

  it('filtro origin=set_main separa las secciones; principalOnly filtra cabeceras', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }], sealedProducts: seedProducts() });
    const provider = buildProvider({ pricesByGroup: {} });
    const svc = svcOf(prisma, provider);
    const del = await svc.listSealedProducts({ setId: 'set-1', origin: 'set_main' });
    expect(del.data.map((d) => d.origin)).toEqual(['set_main', 'set_main']);
    const promo = await svc.listSealedProducts({ setId: 'set-1', origin: 'promo_collection' });
    expect(promo.data.map((d) => d.tcgplayerProductId)).toEqual([3]);
    const princ = await svc.listSealedProducts({ setId: 'set-1', principalOnly: true });
    expect(princ.data.every((d) => d.isPrincipal)).toBe(true);
  });

  it('catálogo vacío → data:[] + needsSync:true (aunque haya filtros)', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }], sealedProducts: [] });
    const res = await svcOf(prisma, buildProvider()).listSealedProducts({ setId: 'set-1', q: 'x' });
    expect(res.data).toEqual([]);
    expect(res.needsSync).toBe(true);
  });

  it('set inexistente → 404', async () => {
    const prisma = buildPrisma({ sets: [] });
    await expect(svcOf(prisma, buildProvider()).listSealedProducts({ setId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('v1.41 (IMP-1) — effectiveMarketCents gateado + sealedPriceSource (money-safe)', () => {
  const SET = { id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 100 };
  // Ancla del set (menor numberPrefix/numberSort) — la MISMA que usa el alta para llavear el mercado.
  const cards = [{ id: 'anchor-1', setId: 'set-1', numberPrefix: '', numberSort: 1 }];
  const seedProducts = () => [
    { id: 'a', setId: 'set-1', tcgplayerProductId: 1, tcgplayerGroupId: 100, name: 'Booster Box', subtype: 'box', subtypeInferred: true, isPrincipal: true, origin: 'set_main', imageUrl: null, marketUsdCents: 40000, active: true },
  ];

  it('dial OFF → effectiveMarketCents null AUNQUE marketRef tenga valor de caché; sealedPriceSource=off', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }], cards, sealedProducts: seedProducts() });
    // marketRef live/caché sí trae valor (informativo), pero la ref H-1 gateada está apagada.
    const provider = buildProvider({ pricesByGroup: { 100: [{ tcgplayerProductId: 1, marketCents: 40000 }] } });
    const pricing = pricingMock({
      sourceOn: false,
      refsByKey: { 'anchor-1|sealed|sealed:tcg:1|normal': 700000 }, // habría precio, pero el dial gatea
    });
    const res = await svcOf(prisma, provider, fxMock(20, 0), pricing).listSealedProducts({ setId: 'set-1' });
    expect(res.sealedPriceSource).toBe('off');
    // marketRef informativo presente…
    expect(res.data[0].marketRef).toEqual({ status: 'priced', referenceMxnCents: 800000 });
    // …pero el efectivo (autoritativo) es null (⟺ el alta aceptaría manualMarketMxnCents). JAMÁS 0.
    expect(res.data[0].effectiveMarketCents).toBeNull();
  });

  it('dial ON + mercado gateado → effectiveMarketCents = ese valor; sealedPriceSource=tcgcsv', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }], cards, sealedProducts: seedProducts() });
    const provider = buildProvider({ pricesByGroup: { 100: [] } });
    const pricing = pricingMock({
      sourceOn: true,
      refsByKey: { 'anchor-1|sealed|sealed:tcg:1|normal': 700000 },
    });
    const res = await svcOf(prisma, provider, fxMock(20, 0), pricing).listSealedProducts({ setId: 'set-1' });
    expect(res.sealedPriceSource).toBe('tcgcsv');
    expect(res.data[0].effectiveMarketCents).toBe(700000);
  });

  it('dial ON pero sin fila H-1 (sin ingest) → effectiveMarketCents null (pendiente, nunca 0)', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }], cards, sealedProducts: seedProducts() });
    const provider = buildProvider({ pricesByGroup: { 100: [{ tcgplayerProductId: 1, marketCents: 40000 }] } });
    const pricing = pricingMock({ sourceOn: true, refsByKey: {} }); // sin referencia gateada
    const res = await svcOf(prisma, provider, fxMock(20, 0), pricing).listSealedProducts({ setId: 'set-1' });
    expect(res.data[0].effectiveMarketCents).toBeNull();
  });
});

// ===========================================================================
describe('SealedProductService.syncCandidates / linkGroup', () => {
  const SET = { id: 'set-1', name: 'Prismatic Evolutions', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null };

  it('candidates: name-match con matchScore + alreadyLinked', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET }],
      sealedSetGroups: [{ id: 'g', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
    });
    const provider = buildProvider({
      groups: [
        { groupId: 100, name: 'Prismatic Evolutions', publishedOn: '2025-01-17' },
        { groupId: 200, name: 'Prismatic Evolutions Promos', publishedOn: '2025-01-17' },
        { groupId: 300, name: 'Totally Unrelated', publishedOn: '2019-01-01' },
      ],
    });
    const res = await svcOf(prisma, provider).syncCandidates('set-1');
    const byId = Object.fromEntries(res.candidates.map((c) => [c.tcgplayerGroupId, c]));
    expect(byId[100]).toMatchObject({ alreadyLinked: true, matchScore: 1 });
    expect(byId[200]?.matchScore).toBeGreaterThan(0); // contención parcial
    expect(byId[300]).toBeUndefined(); // sin match y no enlazado → fuera
  });

  it('linkGroup crea el enlace y pobla CardSet.tcgcsvGroupId si kind=set_main y era null', async () => {
    const prisma = buildPrisma({ sets: [{ ...SET }] });
    const provider = buildProvider({ groups: [{ groupId: 100, name: 'Prismatic Evolutions' }] });
    const res = await svcOf(prisma, provider).linkGroup('set-1', { tcgplayerGroupId: 100, kind: 'set_main' });
    expect(res).toMatchObject({ setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: 'Prismatic Evolutions' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(100);
  });

  it('linkGroup de un grupo ya enlazado → 409 CONFLICT', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET }],
      sealedSetGroups: [{ id: 'g', setId: 'set-1', tcgplayerGroupId: 200, kind: 'promo_collection', label: null }],
    });
    await expect(
      svcOf(prisma, buildProvider()).linkGroup('set-1', { tcgplayerGroupId: 200, kind: 'promo_collection' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
});

// ===========================================================================
// fix/variant-composition-regression: matchScore tolerante al PREFIJO de código de TCGCSV.
// TCGCSV nombra los grupos con prefijo de colección ("SV08: Pitch Black"); el catálogo local NO
// ("Pitch Black"). Sin tolerancia, el match caía a 0.5 (< umbral 0.9) → "sin grupo resoluble".
// Money-safe: sube los matches legítimos al rango auto-resoluble, PERO conserva la salvaguarda de
// bestSetMainMatch (≥0.9 y ÚNICO en el tope): empate tras quitar prefijo → null (no adivina).
// ===========================================================================
describe('SealedProductService.matchScore — tolerante al prefijo de código de TCGCSV', () => {
  it('"Pitch Black" local vs grupo "SV08: Pitch Black" (mismo año) → score ≥0.9 → auto-resuelve set_main', async () => {
    const setRow = { id: 'set-1', name: 'Pitch Black', series: 'SV', releaseDate: '2025-06-13', tcgcsvGroupId: null };
    const groups = [
      { groupId: 800, name: 'SV08: Pitch Black', publishedOn: '2025-06-13' },
      { groupId: 999, name: 'Totally Unrelated', publishedOn: '2019-01-01' },
    ];

    // syncCandidates expone el matchScore crudo: el grupo prefijado debe puntuar en rango exacto.
    const candPrisma = buildPrisma({ sets: [{ ...setRow }] });
    const cand = await svcOf(candPrisma, buildProvider({ groups })).syncCandidates('set-1');
    const byId = Object.fromEntries(cand.candidates.map((c) => [c.tcgplayerGroupId, c]));
    expect(byId[800]?.matchScore).toBeGreaterThanOrEqual(0.9);
    expect(byId[999]).toBeUndefined(); // sin match → fuera

    // sync auto-resuelve el set_main (puebla groupId) gracias al score ≥0.9 ÚNICO en el tope.
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const provider = buildProvider({ groups, productsByGroup: { 800: [{ productId: 81, name: 'Pitch Black Booster Box' }] }, pricesByGroup: {} });
    await svcOf(prisma, provider).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(800);
    expect(prisma._stores.sealedSetGroups.find((g: any) => g.tcgplayerGroupId === 800)).toMatchObject({ kind: 'set_main' });
  });

  it('SIN prefijo: comportamiento intacto — exacto+año=1.0, año distinto=0.7, contención=0.5', async () => {
    const prisma = buildPrisma({ sets: [{ id: 'set-1', name: 'Prismatic Evolutions', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null }] });
    const provider = buildProvider({
      groups: [
        { groupId: 100, name: 'Prismatic Evolutions', publishedOn: '2025-01-17' }, // exacto + mismo año → 1.0
        { groupId: 200, name: 'Prismatic Evolutions', publishedOn: '2020-01-01' }, // exacto + año distinto → 0.7
        { groupId: 300, name: 'Prismatic Evolutions Promos', publishedOn: '2025-01-17' }, // contención → 0.5
      ],
    });
    const cand = await svcOf(prisma, provider).syncCandidates('set-1');
    const byId = Object.fromEntries(cand.candidates.map((c) => [c.tcgplayerGroupId, c]));
    expect(byId[100].matchScore).toBeCloseTo(1.0);
    expect(byId[200].matchScore).toBeCloseTo(0.7);
    expect(byId[300].matchScore).toBeCloseTo(0.5);
  });

  it('empate tras quitar prefijo (dos grupos "… Pitch Black", mismo año) → NO auto-resuelve (money-safe)', async () => {
    const prisma = buildPrisma({ sets: [{ id: 'set-1', name: 'Pitch Black', series: 'SV', releaseDate: '2025-06-13', tcgcsvGroupId: null }] });
    const provider = buildProvider({
      groups: [
        { groupId: 800, name: 'SV08: Pitch Black', publishedOn: '2025-06-13' }, // base → 1.0
        { groupId: 900, name: 'SV09: Pitch Black', publishedOn: '2025-06-13' }, // reprint → 1.0
      ],
      productsByGroup: {},
      pricesByGroup: {},
    });
    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });
    // Empate en el tope (ambos 1.0) → bestSetMainMatch devuelve null → no puebla groupId ni crea set_main.
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(prisma._stores.sealedSetGroups.find((g: any) => g.kind === 'set_main')).toBeUndefined();
    expect(res.groupsPopulated).toBe(0);
  });

  it('set que NO existe en TCGCSV → sin match (0), sin falsos positivos ni auto-resolución', async () => {
    const setRow = { id: 'set-1', name: 'Nonexistent Set XYZ', series: 'SV', releaseDate: '2025-06-13', tcgcsvGroupId: null };
    const groups = [{ groupId: 999, name: 'Totally Unrelated', publishedOn: '2019-01-01' }];

    const candPrisma = buildPrisma({ sets: [{ ...setRow }] });
    const cand = await svcOf(candPrisma, buildProvider({ groups })).syncCandidates('set-1');
    expect(cand.candidates).toHaveLength(0); // ningún grupo puntúa > 0

    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const res = await svcOf(prisma, buildProvider({ groups })).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(res.groupsPopulated).toBe(0);
  });
});

// ===========================================================================
// H-P38-4 (TECH_DEBT): check-then-create → escritura ATÓMICA guardada contra P2002 bajo concurrencia.
// Se simula la carrera: entre el findUnique (null) y el create de ESTA llamada, OTRO sync ya insertó la
// misma fila (unique) → Prisma lanza P2002 → el perdedor CONVERGE en vez de romper.
// ===========================================================================
describe('SealedProductService — concurrencia atómica (H-P38-4)', () => {
  const SET = { id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 100 };

  it('upsertSealedProduct: create pierde la carrera (P2002) → converge por update SIN pisar el subtype curado', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
      sealedProducts: [],
    });
    const provider = buildProvider({
      productsByGroup: { 100: [{ productId: 11, name: 'Booster Box' }] }, // el nombre inferiría 'box'
      pricesByGroup: { 100: [{ tcgplayerProductId: 11, marketCents: 5000 }] },
    });
    const store = prisma._stores.sealedProducts;
    // La carrera: el GANADOR insertó el row 11 (curado a 'tin' por un humano) justo antes de nuestro create.
    (prisma.sealedProduct.create as jest.Mock).mockImplementationOnce(async () => {
      store.push({
        id: 'raced', setId: 'set-1', tcgplayerProductId: 11, tcgplayerGroupId: 100, name: 'Booster Box',
        subtype: 'tin', subtypeInferred: false, isPrincipal: false, origin: 'set_main', imageUrl: null,
        marketUsdCents: null, active: true,
      });
      throw p2002();
    });

    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });

    // Converge: NO duplica (1 sola fila), el subtype CURADO 'tin' se preserva, y el market se actualiza.
    expect(store).toHaveLength(1);
    expect(store[0].subtype).toBe('tin');
    expect(store[0].marketUsdCents).toBe(5000);
    expect(res.productsUpserted).toBe(1);
  });

  it('upsertSealedProduct: un error NO-P2002 en create SÍ se propaga (no se traga)', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null }],
      sealedProducts: [],
    });
    const provider = buildProvider({ productsByGroup: { 100: [{ productId: 11, name: 'Booster Box' }] } });
    (prisma.sealedProduct.create as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await expect(svcOf(prisma, provider).sync({ setId: 'set-1' })).rejects.toThrow('db down');
  });

  it('ensureSetGroup: create pierde la carrera (P2002) → NO rompe y NO doble-cuenta groupsPopulated', async () => {
    const prisma = buildPrisma({
      sets: [{ ...SET, tcgcsvGroupId: 100 }],
      sealedSetGroups: [], // sin grupos previos → ensureSetGroup intentará crear
    });
    const provider = buildProvider({ productsByGroup: { 100: [{ productId: 11, name: 'Booster Box' }] } });
    const groupStore = prisma._stores.sealedSetGroups;
    // La carrera: otro sync creó el SealedSetGroup(set_main, 100) justo antes de nuestro create.
    (prisma.sealedSetGroup.create as jest.Mock).mockImplementationOnce(async () => {
      groupStore.push({ id: 'g-raced', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null });
      throw p2002();
    });

    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });

    // No rompe; el grupo existe una sola vez; ESTA llamada no lo contó como creado (lo creó el otro).
    expect(groupStore.filter((g: any) => g.tcgplayerGroupId === 100)).toHaveLength(1);
    expect(res.groupsPopulated).toBe(0);
  });

  it('linkGroup: create pierde la carrera (P2002) → se traduce al MISMO 409 CONFLICT', async () => {
    // dup pre-check pasa (no hay fila), pero el create choca con una inserción concurrente → 409.
    const prisma = buildPrisma({ sets: [{ ...SET, tcgcsvGroupId: null }], sealedSetGroups: [] });
    const provider = buildProvider({ groups: [{ groupId: 300, name: 'PRE Promos' }] });
    (prisma.sealedSetGroup.create as jest.Mock).mockImplementationOnce(async () => {
      throw p2002();
    });
    await expect(
      svcOf(prisma, provider).linkGroup('set-1', { tcgplayerGroupId: 300, kind: 'promo_collection' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
});

// ===========================================================================
describe('SealedProductService.backfillFromInventory — cura ETB→Tropius (M-39 pasos 7-8)', () => {
  it('deriva SealedProduct del inventario MAPEADO y liga sealedProductId (el ETB deja de anclar a Tropius)', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 100 }],
      cards: [{ id: 'card-tropius', setId: 'set-1', numberPrefix: '', numberSort: 1 }],
      inventoryItems: [
        // Un ETB MAPEADO anclado a la carta Tropius (el bug actual).
        { id: 'inv-1', folio: 'INV-000001', cardId: 'card-tropius', productType: 'sealed', tcgplayerProductId: 610903, tcgplayerGroupId: 100, sealedProductName: 'PRE Elite Trainer Box', sealedImageUrl: 'https://tcgplayer-cdn.tcgplayer.com/etb.jpg', sealedSubtype: 'etb', sealedProductId: null },
      ],
    });
    const report = await svcOf(prisma, buildProvider()).backfillFromInventory();

    expect(report.productsCreated).toBe(1);
    expect(report.itemsLinked).toBe(1);
    const sp = prisma._stores.sealedProducts[0];
    expect(sp).toMatchObject({ tcgplayerProductId: 610903, setId: 'set-1', name: 'PRE Elite Trainer Box', subtype: 'etb', marketUsdCents: null });
    // La pieza queda ligada a su presentación REAL (ETB), no a Tropius.
    expect(prisma._stores.inventoryItems[0].sealedProductId).toBe(sp.id);
    expect(report.unmappedItems).toHaveLength(0);
  });

  it('los SIN MAPEO (tcgplayerProductId null) quedan sealedProductId=null + reporte de reconciliación', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null }],
      cards: [{ id: 'card-x', setId: 'set-1', numberPrefix: '', numberSort: 1 }],
      inventoryItems: [
        { id: 'inv-9', folio: 'INV-000009', cardId: 'card-x', productType: 'sealed', tcgplayerProductId: null, tcgplayerGroupId: null, sealedProductId: null },
      ],
    });
    const report = await svcOf(prisma, buildProvider()).backfillFromInventory();
    expect(report.productsCreated).toBe(0);
    expect(report.itemsLinked).toBe(0);
    expect(report.unmappedItems).toEqual([{ folio: 'INV-000009', cardId: 'card-x' }]);
    expect(prisma._stores.inventoryItems[0].sealedProductId).toBeNull();
  });

  it('idempotente: una segunda corrida no re-liga ni duplica', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 100 }],
      cards: [{ id: 'card-tropius', setId: 'set-1', numberPrefix: '', numberSort: 1 }],
      inventoryItems: [
        { id: 'inv-1', folio: 'INV-000001', cardId: 'card-tropius', productType: 'sealed', tcgplayerProductId: 610903, tcgplayerGroupId: 100, sealedProductName: 'PRE ETB', sealedSubtype: 'etb', sealedProductId: null },
      ],
    });
    const svc = svcOf(prisma, buildProvider());
    await svc.backfillFromInventory();
    const second = await svc.backfillFromInventory();
    expect(second.productsCreated).toBe(0);
    expect(second.itemsLinked).toBe(0); // ya ligada → no re-liga
    expect(prisma._stores.sealedProducts).toHaveLength(1);
  });
});
