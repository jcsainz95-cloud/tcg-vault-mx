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
      findFirst: jest.fn(async ({ where }: any) => {
        const inSet = cards.filter((c) => c.setId === where.setId);
        inSet.sort(
          (a, b) => (a.numberPrefix ?? '').localeCompare(b.numberPrefix ?? '') || (a.numberSort ?? 0) - (b.numberSort ?? 0),
        );
        return inSet[0] ?? null;
      }),
      // SEC-M11-5: resolución de anclas EN LOTE (una consulta para varios sets), ordenada como el
      // `findFirst` por-set (numberPrefix asc, numberSort asc) para que el primero por set sea el ancla.
      findMany: jest.fn(async ({ where }: any = {}) => {
        const ids: string[] | null = where?.setId?.in ?? null;
        const rows = cards.filter((c) => (ids ? ids.includes(c.setId) : true));
        rows.sort(
          (a, b) => (a.numberPrefix ?? '').localeCompare(b.numberPrefix ?? '') || (a.numberSort ?? 0) - (b.numberSort ?? 0),
        );
        return rows.map((c) => ({ id: c.id, setId: c.setId }));
      }),
    },
    sealedSetGroup: {
      findMany: jest.fn(async ({ where }: any = {}) =>
        sealedSetGroups.filter((g) => (where?.setId != null ? g.setId === where.setId : true)),
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
      delete: jest.fn(async ({ where }: any) => {
        const idx = sealedSetGroups.findIndex((x) => x.id === where.id);
        const [removed] = idx >= 0 ? sealedSetGroups.splice(idx, 1) : [null];
        return removed;
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
    // SEC-M11-1/-2: `setMainGroup` ahora envuelve sus escrituras en `$transaction`. El doble en memoria
    // muta los mismos `_stores`, así que ejecutar el callback con el propio `prisma` como `tx` reproduce
    // la semántica (commit al terminar sin lanzar). Es el mismo patrón de doble que usan las demás specs.
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    auditLog: { create: jest.fn(async () => ({})) },
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

  // -------------------------------------------------------------------------
  // ⭐⭐ IMPORTANTE-3 (QA, P-46-bis) — DOS grupos MISMO-NOMBRE / AÑO-DISTINTO: el resolver único
  // devuelve `null` DONDE EL VIEJO `matchScore` HABRÍA ELEGIDO EL DEL AÑO. Esta prueba FIJA esa
  // conducta intencionada (antes no había canario que la sostuviera).
  //
  // El caso: el set local «Base Set» (2016) coincide EN AÑO con uno solo de dos grupos homónimos
  // (uno 1999, otro 2016). El histórico `matchScore` puntuaba 1.0 al del año que empata y 0.7 al
  // otro, así que `bestSetMainMatch` (viejo) desempataba POR AÑO y adoptaba el de 2016. El resolver
  // único (`matchTcgcsvGroupByName`) NO desempata por año: los dos nombres normalizan igual ⇒ el
  // peldaño `exact` tiene DOS candidatos ⇒ `ambiguous` ⇒ `null`, y `bestSetMainMatch` NO baja al
  // desempate de año (money-safe: match ÚNICO o nada). Es dirección SEGURA — sólo se pierde una
  // AUTO-adopción que antes ocurría; JAMÁS puede pasar `groupId → OTRO grupo`. La cura sigue viva:
  // el humano cura a mano (`linkGroup`/`set-main-group`) y ENTONCES sí baja.
  //
  // ⚠️ El arquitecto debe ratificar/documentar esta pérdida de desempate-por-año en el diseño §8
  // (anotado en `docs/TECH_DEBT.md`). Este canario fija la conducta de HOY para que el cambio, si
  // se decide otro, sea VISIBLE (esta prueba se pondría roja) y no silencioso.
  // -------------------------------------------------------------------------
  it('IMPORTANTE-3: dos grupos mismo-nombre/año-distinto → resolver único devuelve null (NO desempata por año como el viejo matchScore)', async () => {
    const setRow = { id: 'set-1', name: 'Base Set', series: 'BASE', releaseDate: '2016-02-27', tcgcsvGroupId: null };
    const groups = [
      { groupId: 100, name: 'Base Set', publishedOn: '1999-01-09' }, // homónimo de otra era
      { groupId: 200, name: 'Base Set', publishedOn: '2016-02-27' }, // el que EMPATA en año con el local
    ];

    // 1) La UI de candidatos sí SURFACEA ambos con su score histórico (1.0 el del año, 0.7 el otro):
    //    el desempate por año sigue INFORMANDO al humano, sólo que ya no AUTO-adopta.
    const candPrisma = buildPrisma({ sets: [{ ...setRow }] });
    const cand = await svcOf(candPrisma, buildProvider({ groups })).syncCandidates('set-1');
    const byId = Object.fromEntries(cand.candidates.map((c) => [c.tcgplayerGroupId, c]));
    expect(byId[200].matchScore).toBeCloseTo(1.0); // el del año que empata (lo que el viejo elegía)
    expect(byId[100].matchScore).toBeCloseTo(0.7); // el homónimo de otra era

    // 2) …pero el sync NO adopta NINGUNO: `exact` es ambiguo ⇒ null. `null → groupId` jamás ocurre.
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const res = await svcOf(
      prisma,
      buildProvider({ groups, productsByGroup: { 200: [{ productId: 20, name: 'Base Set Booster Box' }] }, pricesByGroup: {} }),
    ).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(prisma._stores.sealedSetGroups.find((g: any) => g.kind === 'set_main')).toBeUndefined();
    expect(res.groupsPopulated).toBe(0);

    // 3) La salida manual sigue viva: curado por el humano, ENTONCES sí baja (curado > name-match).
    const svc = svcOf(
      prisma,
      buildProvider({ groups, productsByGroup: { 200: [{ productId: 20, name: 'Base Set Booster Box' }] }, pricesByGroup: {} }),
    );
    await svc.linkGroup('set-1', { tcgplayerGroupId: 200, kind: 'set_main' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(200);
  });

  // -------------------------------------------------------------------------
  // P-46 (verificación 2026-09-08): el arreglo es GENÉRICO, no caso-por-caso. Cualquier forma de
  // prefijo de código que TCGCSV use ("ME05:", "SV08:", "SWSH07:", "SV:") tiene que auto-resolver
  // cuando el nombre restante es EL MISMO set y el año coincide. Medido: sin la tolerancia estos
  // casos puntúan 0.5 (< 0.9) → «sin grupo resoluble» → 0 presentaciones.
  // -------------------------------------------------------------------------
  it.each([
    ['Pitch Black', 'ME05: Pitch Black'],
    ['Pitch Black', 'SV08: Pitch Black'],
    ['Chaos Rising', 'ME04: Chaos Rising'],
    ['Chaos Rising', 'SV: Chaos Rising'],
    ['Evolving Skies', 'SWSH07: Evolving Skies'],
  ])('prefijo de TCGCSV: local «%s» vs grupo «%s» (mismo año) → auto-resuelve y BAJA presentaciones', async (localName, groupName) => {
    const setRow = { id: 'set-1', name: localName, series: 'SV', releaseDate: '2026-07-17', tcgcsvGroupId: null };
    const groups = [
      { groupId: 800, name: groupName, publishedOn: '2026-07-17' },
      { groupId: 999, name: 'Totally Unrelated', publishedOn: '2019-01-01' },
    ];
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const provider = buildProvider({
      groups,
      productsByGroup: { 800: [{ productId: 81, name: `${localName} Booster Box` }] },
      pricesByGroup: {},
    });
    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(800);
    expect(res.productsUpserted).toBe(1); // el síntoma del humano era exactamente «0 presentaciones»
  });

  // -------------------------------------------------------------------------
  // NEGATIVO — el UMBRAL 0.9 sigue en pie (money-safe). Un grupo que solo CONTIENE el nombre es
  // otro producto (kit de prerelease, promos): puntúa 0.5 y NO se auto-resuelve, aunque sea el
  // ÚNICO candidato. Este es el candado que impide bajar presentaciones y precios del set ajeno.
  // Muerde: bajar el umbral de `bestSetMainMatch` de 0.9 a 0.5 pone este test en rojo (verificado
  // con mutación 2026-09-08; sin él, la suite entera de 3689 tests seguía verde con el umbral roto).
  // -------------------------------------------------------------------------
  it('NEGATIVO: único candidato con contención («ME05: Pitch Black Prerelease Kit») → 0.5, NO auto-resuelve; la curación a mano sigue siendo la salida', async () => {
    const setRow = { id: 'set-1', name: 'Pitch Black', series: 'SV', releaseDate: '2026-07-17', tcgcsvGroupId: null };
    const groups = [{ groupId: 850, name: 'ME05: Pitch Black Prerelease Kit', publishedOn: '2026-07-17' }];
    const productsByGroup = { 850: [{ productId: 85, name: 'Pitch Black Prerelease Kit' }] };

    // 1) El candidato SÍ se ve en la UI de curación, con confianza baja (0.5): no se esconde.
    const candPrisma = buildPrisma({ sets: [{ ...setRow }] });
    const cand = await svcOf(candPrisma, buildProvider({ groups })).syncCandidates('set-1');
    expect(cand.candidates.map((c) => c.tcgplayerGroupId)).toEqual([850]);
    expect(cand.candidates[0].matchScore).toBeCloseTo(0.5);

    // 2) …pero el sync NO lo adopta: sin grupo resoluble no baja NADA (0 presentaciones a propósito).
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const res = await svcOf(prisma, buildProvider({ groups, productsByGroup, pricesByGroup: {} })).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(prisma._stores.sealedSetGroups).toHaveLength(0);
    expect(res).toMatchObject({ groupsPopulated: 0, productsUpserted: 0 });

    // 3) La salida manual sigue viva: el humano lo cura y ENTONCES sí baja (curado > name-match).
    const svc = svcOf(prisma, buildProvider({ groups, productsByGroup, pricesByGroup: {} }));
    await svc.linkGroup('set-1', { tcgplayerGroupId: 850, kind: 'set_main' });
    const res2 = await svc.sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(850);
    expect(res2.productsUpserted).toBe(1);
  });

  // -------------------------------------------------------------------------
  // NEGATIVO — dos sets DISTINTOS que se parecen: mismo nombre tras quitar prefijo pero de AÑO
  // distinto (reimpresión/otro producto homónimo). 0.7 < 0.9 → no se auto-resuelve. Muerde:
  // devolver 0.9/1.0 sin comparar años (o ignorar `publishedOn`) pone este test en rojo.
  // -------------------------------------------------------------------------
  it('NEGATIVO: «Chaos Rising» (2026) vs grupo «ME04: Chaos Rising» publicado en 2019 → 0.7 → NO auto-resuelve', async () => {
    const setRow = { id: 'set-1', name: 'Chaos Rising', series: 'ME', releaseDate: '2026-05-01', tcgcsvGroupId: null };
    const groups = [{ groupId: 640, name: 'ME04: Chaos Rising', publishedOn: '2019-03-01' }];

    const candPrisma = buildPrisma({ sets: [{ ...setRow }] });
    const cand = await svcOf(candPrisma, buildProvider({ groups })).syncCandidates('set-1');
    expect(cand.candidates[0].matchScore).toBeCloseTo(0.7);

    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const res = await svcOf(
      prisma,
      buildProvider({ groups, productsByGroup: { 640: [{ productId: 64, name: 'Chaos Rising Booster Box' }] }, pricesByGroup: {} }),
    ).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(res).toMatchObject({ groupsPopulated: 0, productsUpserted: 0 });
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
// P-46-bis (2026-09-17) — la resolución del set_main del SELLADO REUSA `matchTcgcsvGroupByName`
// (la fuente ÚNICA de match S-D3 de sueltas), en vez del `matchScore`/`bestSetMainMatch` duplicado
// que NO tenía el peldaño `exact_debased`. Antes, las bases de era («SV01: Scarlet & Violet Base
// Set») caían al `contains` AMBIGUO (subcadena de la base + los promos) ⇒ el sellado del set quedaba
// «sin grupo resoluble» y nunca bajaba presentaciones/precios. Tras el fix el sellado gana ese
// peldaño y cruza a SU base, PERO conserva su política money-safe MÁS ESTRICTA que la de sueltas:
//   - RECHAZA el peldaño `contains` (contención pura = kit de prerelease/promo → curación a mano);
//   - guarda de AÑO (ambos años conocidos y distintos ⇒ no adopta).
// Egress a tcgcsv.com BLOQUEADO (O-17): todo con fixtures de nombres de grupo (convención confirmada
// en `tcgcsv-group-match.spec.ts`), NUNCA red viva.
// ===========================================================================
describe('SealedProductService — set_main REUSA matchTcgcsvGroupByName (P-46-bis, exact_debased)', () => {
  // Universo realista de la era SV: la base (prefijo + sufijo `Base Set`) + su grupo de promos + un
  // hermano de la era. Es el caso que HOY (matchScore/bestSetMainMatch) deja en null por contención
  // ambigua y que el peldaño `exact_debased` de la fuente única resuelve.
  const svEra = [
    { groupId: 22873, name: 'SV01: Scarlet & Violet Base Set', publishedOn: '2025-01-17' },
    { groupId: 23001, name: 'Scarlet & Violet Black Star Promos', publishedOn: '2025-01-17' },
    { groupId: 23874, name: 'SV: Prismatic Evolutions', publishedOn: '2025-01-17' },
  ];

  it('CANARIO P-46-bis: «Scarlet & Violet» (base de era) auto-resuelve a SU base y BAJA presentaciones', async () => {
    const setRow = { id: 'set-1', name: 'Scarlet & Violet', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null };
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const provider = buildProvider({
      groups: svEra,
      productsByGroup: { 22873: [{ productId: 100, name: 'Scarlet & Violet Booster Box' }] },
      pricesByGroup: {},
    });
    const res = await svcOf(prisma, provider).sync({ setId: 'set-1' });
    // Cruza a la BASE (22873), NUNCA a los promos (23001) — money-safe.
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(22873);
    expect(prisma._stores.sealedSetGroups.find((g: any) => g.kind === 'set_main')).toMatchObject({ tcgplayerGroupId: 22873 });
    expect(res.productsUpserted).toBe(1);
  });

  it('⛔ MONEY-SAFE: la base NUNCA cruza al grupo de PROMOS (falso positivo = precios de otra carta)', async () => {
    const setRow = { id: 'set-1', name: 'Scarlet & Violet', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null };
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    await svcOf(prisma, buildProvider({ groups: svEra, productsByGroup: { 22873: [] }, pricesByGroup: {} })).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).not.toBe(23001);
  });

  it('MONEY-SAFE conservado: contención pura («… Prerelease Kit») NO auto-resuelve (tier contains rechazado)', async () => {
    // Con matchTcgcsvGroupByName crudo esto sería un `contains` ÚNICO ⇒ groupId; el sellado lo RECHAZA
    // (conserva el umbral 0.9 histórico de bestSetMainMatch). La salida sigue siendo curación a mano.
    const setRow = { id: 'set-1', name: 'Pitch Black', series: 'SV', releaseDate: '2026-07-17', tcgcsvGroupId: null };
    const groups = [{ groupId: 850, name: 'ME05: Pitch Black Prerelease Kit', publishedOn: '2026-07-17' }];
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const res = await svcOf(prisma, buildProvider({ groups, productsByGroup: { 850: [{ productId: 85, name: 'x' }] }, pricesByGroup: {} })).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(res.groupsPopulated).toBe(0);
  });

  it('MONEY-SAFE conservado: guarda de AÑO — «Chaos Rising» 2026 vs grupo 2019 → NO auto-resuelve', async () => {
    const setRow = { id: 'set-1', name: 'Chaos Rising', series: 'ME', releaseDate: '2026-05-01', tcgcsvGroupId: null };
    const groups = [{ groupId: 640, name: 'ME04: Chaos Rising', publishedOn: '2019-03-01' }];
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    const res = await svcOf(prisma, buildProvider({ groups, productsByGroup: { 640: [{ productId: 64, name: 'x' }] }, pricesByGroup: {} })).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(res.groupsPopulated).toBe(0);
  });
});

// ===========================================================================
// M11 §10 — GET sealed-price-status: TRES estados por set desde estado persistido, con el gate H-1.
// Read-only, SIN red externa (O-17): el endpoint no puede depender de tcgcsv.com.
// ===========================================================================
describe('M11 §10 — SealedProductService.sealedPriceStatus (tres estados, gate H-1, sin egress)', () => {
  // Tres sets fixture, uno por estado. anchor-* = ancla del set (menor numberPrefix/numberSort).
  const seed = () => ({
    sets: [
      { id: 'set-a', name: 'Alpha', series: 'SV', releaseDate: '2025-03-01', tcgcsvGroupId: 100 },
      { id: 'set-b', name: 'Bravo', series: 'SV', releaseDate: '2025-02-01', tcgcsvGroupId: 200 },
      { id: 'set-c', name: 'Charlie', series: 'SV', releaseDate: '2025-01-01', tcgcsvGroupId: null },
    ],
    cards: [
      { id: 'anchor-a', setId: 'set-a', numberPrefix: '', numberSort: 1 },
      { id: 'anchor-b', setId: 'set-b', numberPrefix: '', numberSort: 1 },
    ],
    sealedSetGroups: [
      { id: 'ga', setId: 'set-a', tcgplayerGroupId: 100, kind: 'set_main', label: null },
      { id: 'gb', setId: 'set-b', tcgplayerGroupId: 200, kind: 'set_main', label: null },
    ],
    sealedProducts: [
      { id: 'pa', setId: 'set-a', tcgplayerProductId: 1, tcgplayerGroupId: 100, name: 'A Box', subtype: 'box', subtypeInferred: true, isPrincipal: true, origin: 'set_main', imageUrl: null, marketUsdCents: null, active: true },
      { id: 'pb', setId: 'set-b', tcgplayerProductId: 2, tcgplayerGroupId: 200, name: 'B Box', subtype: 'box', subtypeInferred: true, isPrincipal: true, origin: 'set_main', imageUrl: null, marketUsdCents: null, active: true },
      // set-c: producto HUÉRFANO (su grupo 999 no está enlazado, y el set no tiene set_main) → unmapped.
      { id: 'pc', setId: 'set-c', tcgplayerProductId: 3, tcgplayerGroupId: 999, name: 'C Box', subtype: 'box', subtypeInferred: true, isPrincipal: true, origin: 'set_main', imageUrl: null, marketUsdCents: null, active: true },
    ],
  });

  it('CANARIO tres estados: priced / mapped_unpriced / unmapped, con su reason (dial ON)', async () => {
    const prisma = buildPrisma(seed());
    // Dial ON; SOLO set-a tiene PriceReference gateada → priced. set-b mapeado sin ref → no_source_price.
    const pricing = pricingMock({ sourceOn: true, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
    const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ page: 1, pageSize: 20 });
    expect(res.sealedPriceSource).toBe('tcgcsv');
    const byId = Object.fromEntries(res.data.map((r) => [r.set.id, r]));
    expect(byId['set-a']).toMatchObject({ state: 'priced', priced: 1, mappedUnpriced: 0, unmapped: 0 });
    expect(byId['set-a'].reason).toBeUndefined();
    expect(byId['set-b']).toMatchObject({ state: 'mapped_unpriced', priced: 0, mappedUnpriced: 1, reason: 'no_source_price' });
    expect(byId['set-c']).toMatchObject({ state: 'unmapped', unmapped: 1, setMainGroupId: null, reason: 'no_group' });
    expect(res.total).toBe(3);
  });

  it('M11-status-gate-parity (DINERO): dial OFF ⇒ un set con PriceReference cuenta como mapped_unpriced (no priced), reason dial_off', async () => {
    const prisma = buildPrisma(seed());
    // MISMA ref que arriba, pero dial OFF: el gate H-1 la anula (fail-closed) ⇒ el alta lo valuaría
    // PRICE_PENDING ⇒ la vista debe reflejar `mapped_unpriced`, no `priced` (I-2, sin divergir del gate).
    const pricing = pricingMock({ sourceOn: false, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
    const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ page: 1, pageSize: 20 });
    expect(res.sealedPriceSource).toBe('off');
    const a = res.data.find((r) => r.set.id === 'set-a')!;
    expect(a).toMatchObject({ state: 'mapped_unpriced', priced: 0, mappedUnpriced: 1, reason: 'dial_off' });
  });

  it('M11-status-no-egress (O-17): responde aunque el provider TCGCSV LANCE al ser llamado (prueba que NO lo llama)', async () => {
    const prisma = buildPrisma(seed());
    const throwingProvider = {
      listGroups: jest.fn(async () => { throw new Error('tcgcsv egress BLOCKED'); }),
      listSealedProducts: jest.fn(async () => { throw new Error('tcgcsv egress BLOCKED'); }),
      fetchSealedPricesForGroup: jest.fn(async () => { throw new Error('tcgcsv egress BLOCKED'); }),
    } as any;
    const pricing = pricingMock({ sourceOn: true, refsByKey: {} });
    const res = await svcOf(prisma, throwingProvider, fxMock(), pricing).sealedPriceStatus({ page: 1, pageSize: 20 });
    expect(res.data).toHaveLength(3);
    expect(throwingProvider.listGroups).not.toHaveBeenCalled();
    expect(throwingProvider.fetchSealedPricesForGroup).not.toHaveBeenCalled();
  });

  it('?state= filtra a un solo estado (derivado del enum, §0-Q)', async () => {
    const prisma = buildPrisma(seed());
    const pricing = pricingMock({ sourceOn: true, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
    const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ state: 'unmapped', page: 1, pageSize: 20 });
    expect(res.data.map((r) => r.set.id)).toEqual(['set-c']);
    expect(res.total).toBe(1);
  });

  // SEC-M11-5 (PERF): resolvía el ancla + `getReferencesBatch` POR SET en bucle (N+1) y clasificaba TODO
  // el universo antes de paginar. El fix batchea anclas/refs entre sets y acota antes de gatear cuando no
  // hay filtro de estado. Conducta observable IDÉNTICA (mismos estados / orden / total): sólo menos trabajo.
  describe('SEC-M11-5 — sin N+1 y acota antes de gatear (conducta idéntica)', () => {
    it('resultado idéntico al canario de tres estados, con UNA consulta de anclas + UN lote de refs (no N+1)', async () => {
      const prisma = buildPrisma(seed());
      const pricing = pricingMock({ sourceOn: true, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
      const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ page: 1, pageSize: 20 });
      // Mismos estados/conteos que el canario de tres estados (dial ON).
      const byId = Object.fromEntries(res.data.map((r) => [r.set.id, r]));
      expect(byId['set-a']).toMatchObject({ state: 'priced', priced: 1, mappedUnpriced: 0, unmapped: 0 });
      expect(byId['set-b']).toMatchObject({ state: 'mapped_unpriced', priced: 0, mappedUnpriced: 1, reason: 'no_source_price' });
      expect(byId['set-c']).toMatchObject({ state: 'unmapped', unmapped: 1, setMainGroupId: null, reason: 'no_group' });
      // Orden por lanzamiento desc (convención de pestaña), preservado.
      expect(res.data.map((r) => r.set.id)).toEqual(['set-a', 'set-b', 'set-c']);
      expect(res.total).toBe(3);
      // SIN N+1: refs en UN solo lote (antes: una llamada por set con productos+ancla).
      expect((pricing.getReferencesBatch as jest.Mock).mock.calls.length).toBe(1);
      // Anclas EN LOTE (findMany), NO un findFirst por set.
      expect((prisma.card.findMany as jest.Mock).mock.calls.length).toBe(1);
      expect((prisma.card.findFirst as jest.Mock).mock.calls.length).toBe(0);
    });

    it('ACOTA antes de gatear: pageSize=1 sin filtro ⇒ gatea SOLO la página (1 set), total sigue completo', async () => {
      const prisma = buildPrisma(seed());
      const pricing = pricingMock({ sourceOn: true, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
      const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ page: 1, pageSize: 1 });
      // La página trae SOLO el lanzamiento más reciente; el total refleja el universo entero.
      expect(res.data.map((r) => r.set.id)).toEqual(['set-a']);
      expect(res.data[0]).toMatchObject({ state: 'priced', priced: 1 });
      expect(res.total).toBe(3);
      // Sólo se resolvió el ancla del set de la página (set-a), no de los tres.
      const findManyArgs = (prisma.card.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyArgs.where.setId.in).toEqual(['set-a']);
    });

    it('segunda página sin filtro: gatea SOLO esa página y conserva orden/total', async () => {
      const prisma = buildPrisma(seed());
      const pricing = pricingMock({ sourceOn: true, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
      const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ page: 2, pageSize: 1 });
      expect(res.data.map((r) => r.set.id)).toEqual(['set-b']); // segundo por lanzamiento desc
      expect(res.total).toBe(3);
      const findManyArgs = (prisma.card.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyArgs.where.setId.in).toEqual(['set-b']);
    });

    it('con filtro de estado batchea refs en UN lote (gatea el universo, pero sin N+1)', async () => {
      const prisma = buildPrisma(seed());
      const pricing = pricingMock({ sourceOn: true, refsByKey: { 'anchor-a|sealed|sealed:tcg:1|normal': 500000 } });
      const res = await svcOf(prisma, buildProvider(), fxMock(), pricing).sealedPriceStatus({ state: 'priced', page: 1, pageSize: 20 });
      expect(res.data.map((r) => r.set.id)).toEqual(['set-a']);
      expect(res.total).toBe(1);
      expect((pricing.getReferencesBatch as jest.Mock).mock.calls.length).toBe(1);
      expect((prisma.card.findFirst as jest.Mock).mock.calls.length).toBe(0);
    });
  });
});

// ===========================================================================
// M11 §11 — set-main-group (REEMPLAZA aunque exista) + unlink. super_admin, money-safe.
// ===========================================================================
describe('M11 §11 — SealedProductService.setMainGroup / unlinkGroup (escape de P-46)', () => {
  it('CA-12: setMainGroup REEMPLAZA CardSet.tcgcsvGroupId aunque ya esté poblado (lo que linkGroup NO puede)', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 700 }],
      sealedSetGroups: [{ id: 'g-old', setId: 'set-1', tcgplayerGroupId: 700, kind: 'set_main', label: 'wrong' }],
    });
    const res = await svcOf(prisma, buildProvider({ groups: [{ groupId: 800, name: 'Right Group' }] }))
      .setMainGroup('set-1', { tcgplayerGroupId: 800, reason: 'matcher escribió el grupo equivocado' });
    // CardSet.tcgcsvGroupId REESCRITO a 800 (linkGroup lo habría dejado en 700 por no ser null).
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(800);
    expect(res).toMatchObject({ group: { tcgplayerGroupId: 800, kind: 'set_main' }, before: 700, after: 800 });
    // El set_main anterior se DEGRADA a promo_collection (DO-5: no se borra).
    expect(prisma._stores.sealedSetGroups.find((g: any) => g.tcgplayerGroupId === 700)).toMatchObject({ kind: 'promo_collection' });
    // El nuevo grupo queda como set_main.
    expect(prisma._stores.sealedSetGroups.find((g: any) => g.tcgplayerGroupId === 800)).toMatchObject({ kind: 'set_main' });
  });

  it('setMainGroup PROMUEVE un grupo ya enlazado como promo_collection a set_main (sin duplicar fila)', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 300, kind: 'promo_collection', label: 'Promos' }],
    });
    await svcOf(prisma, buildProvider()).setMainGroup('set-1', { tcgplayerGroupId: 300 });
    expect(prisma._stores.sealedSetGroups).toHaveLength(1);
    expect(prisma._stores.sealedSetGroups[0]).toMatchObject({ tcgplayerGroupId: 300, kind: 'set_main' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(300);
  });

  it('setMainGroup con set inexistente → 404', async () => {
    const prisma = buildPrisma({ sets: [] });
    await expect(svcOf(prisma, buildProvider()).setMainGroup('nope', { tcgplayerGroupId: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  // SEC-M11-3 (BAJA): el `before/after` del audit debe registrar el cambio de `kind` de los grupos que se
  // DEGRADAN (set_main→promo_collection) y la promoción/creación del nuevo set_main, no sólo el
  // `tcgcsvGroupId`. El grupo anterior se infería del `before.tcgcsvGroupId`, pero la reestructuración de
  // `SealedSetGroup` no quedaba explícita en el rastro.
  it('SEC-M11-3: audita el cambio de kind de los grupos degradados y la promoción del nuevo set_main', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 700 }],
      sealedSetGroups: [
        { id: 'g-old', setId: 'set-1', tcgplayerGroupId: 700, kind: 'set_main', label: 'wrong' },
        { id: 'g-promo', setId: 'set-1', tcgplayerGroupId: 800, kind: 'promo_collection', label: 'promo' },
      ],
    });
    const log = jest.fn(async () => {});
    const audit = { log } as any;
    const svc = new SealedProductService(prisma as any, buildProvider(), fxMock(), pricingMock(), audit);
    await svc.setMainGroup('set-1', { tcgplayerGroupId: 800, reason: 'fix' }, { userId: 'u1', role: 'super_admin' as any });

    expect(log).toHaveBeenCalledTimes(1);
    const entry = (log.mock.calls[0] as any[])[0];
    expect(entry.after).toMatchObject({ tcgcsvGroupId: 800, reason: 'fix' });
    // El grupo 700 (set_main viejo) se DEGRADA; el 800 (promo) se PROMUEVE a set_main.
    expect(entry.after.groupKindChanges).toEqual(
      expect.arrayContaining([
        { tcgplayerGroupId: 700, from: 'set_main', to: 'promo_collection' },
        { tcgplayerGroupId: 800, from: 'promo_collection', to: 'set_main' },
      ]),
    );
    // Sólo esos dos grupos cambiaron de kind (no ruido).
    expect(entry.after.groupKindChanges).toHaveLength(2);
  });

  it('SEC-M11-3: cuando el nuevo set_main es un grupo NUEVO (no existía fila), el audit lo registra con from=null', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 700 }],
      sealedSetGroups: [{ id: 'g-old', setId: 'set-1', tcgplayerGroupId: 700, kind: 'set_main', label: 'wrong' }],
    });
    const log = jest.fn(async () => {});
    const svc = new SealedProductService(prisma as any, buildProvider(), fxMock(), pricingMock(), { log } as any);
    await svc.setMainGroup('set-1', { tcgplayerGroupId: 900 }, { userId: 'u1', role: 'super_admin' as any });

    const entry = (log.mock.calls[0] as any[])[0];
    expect(entry.after.groupKindChanges).toEqual(
      expect.arrayContaining([
        { tcgplayerGroupId: 700, from: 'set_main', to: 'promo_collection' },
        { tcgplayerGroupId: 900, from: null, to: 'set_main' },
      ]),
    );
    expect(entry.after.groupKindChanges).toHaveLength(2);
  });

  it('CA-13: unlinkGroup de un set_main → borra la fila y CardSet.tcgcsvGroupId vuelve a null (SIN emparejar)', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 500 }],
      sealedSetGroups: [{ id: 'g1', setId: 'set-1', tcgplayerGroupId: 500, kind: 'set_main', label: null }],
    });
    const before = await svcOf(prisma, buildProvider()).unlinkGroup('set-1', 500);
    expect(before).toMatchObject({ setId: 'set-1', tcgplayerGroupId: 500, kind: 'set_main' });
    expect(prisma._stores.sealedSetGroups).toHaveLength(0);
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
  });

  it('unlinkGroup de un promo_collection NO toca CardSet.tcgcsvGroupId (solo borra ese enlace)', async () => {
    const prisma = buildPrisma({
      sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: 100 }],
      sealedSetGroups: [
        { id: 'g1', setId: 'set-1', tcgplayerGroupId: 100, kind: 'set_main', label: null },
        { id: 'g2', setId: 'set-1', tcgplayerGroupId: 200, kind: 'promo_collection', label: null },
      ],
    });
    await svcOf(prisma, buildProvider()).unlinkGroup('set-1', 200);
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(100); // intacto
    expect(prisma._stores.sealedSetGroups.map((g: any) => g.tcgplayerGroupId)).toEqual([100]);
  });

  it('unlinkGroup de un enlace inexistente → 404', async () => {
    const prisma = buildPrisma({ sets: [{ id: 'set-1', name: 'PRE', series: 'SV', releaseDate: '2025-01-17', tcgcsvGroupId: null }], sealedSetGroups: [] });
    await expect(svcOf(prisma, buildProvider()).unlinkGroup('set-1', 999)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('CA-15 (funcional pese a P-46): mapear a mano + sync BAJA presentaciones aunque el matcher deje null', async () => {
    // Set con nombre ambiguo que el matcher automático deja null (dos grupos empatan módulo prefijo).
    const setRow = { id: 'set-1', name: 'Pitch Black', series: 'SV', releaseDate: '2025-06-13', tcgcsvGroupId: null };
    const groups = [
      { groupId: 800, name: 'SV08: Pitch Black', publishedOn: '2025-06-13' },
      { groupId: 900, name: 'ME05: Pitch Black', publishedOn: '2025-06-13' },
    ];
    const productsByGroup = { 800: [{ productId: 81, name: 'Pitch Black Booster Box' }] };
    const prisma = buildPrisma({ sets: [{ ...setRow }] });
    // 1) sync automático NO resuelve (ambiguo) → sin grupo, 0 presentaciones.
    const auto = await svcOf(prisma, buildProvider({ groups, productsByGroup, pricesByGroup: {} })).sync({ setId: 'set-1' });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBeNull();
    expect(auto.productsUpserted).toBe(0);
    // 2) el super-admin fija el grupo a mano (§11) …
    await svcOf(prisma, buildProvider({ groups })).setMainGroup('set-1', { tcgplayerGroupId: 800 });
    expect(prisma._stores.sets[0].tcgcsvGroupId).toBe(800);
    // 3) … y ENTONCES el sync baja las presentaciones (M11 trae precio pese a P-46).
    const after = await svcOf(prisma, buildProvider({ groups, productsByGroup, pricesByGroup: {} })).sync({ setId: 'set-1' });
    expect(after.productsUpserted).toBe(1);
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
