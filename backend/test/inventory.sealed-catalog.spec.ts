import {
  SealedCatalogAdminService,
  inferSealedSubtype,
} from '../src/modules/inventory/sealed-catalog-admin.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvSealedBulkProvider } from '../src/modules/pricing/providers/tcgcsv-sealed.provider';

/**
 * v1.36-sealed-alta (M-37, P-35 · ARCHITECTURE §4.32 · API_CONTRACT §M1) —
 * GET /admin/inventory/sealed-catalog: lista los PRODUCTOS SELLADOS de un set (NO singles) desde
 * TCGCSV para el alta dedicada. Cubre: resolución set→grupo (precedencia §4.32b), money-safe
 * (`marketRef` null/pendiente sin precio, NUNCA 0), ancla representativa, upstream 502, set 404,
 * y las validaciones 400 del controller (setId requerido, groupId entero positivo).
 */

const SET = (over: any = {}) => ({
  id: 'set-1',
  name: 'Prismatic Evolutions',
  series: 'Scarlet & Violet',
  releaseDate: '2025-01-17',
  tcgcsvGroupId: null as number | null,
  ...over,
});

function buildHarness(opts: {
  set?: any;
  anchorCardId?: string | null;
  siblingGroupIds?: number[]; // tcgplayerGroupId de items sellados ya mapeados del set
  products?: any[]; // lo que devuelve provider.listSealedProducts (ya sin singles)
  priceRows?: any[]; // lo que devuelve provider.fetchSealedPricesForGroup().rows
  listThrows?: boolean;
  rate?: number;
  bufferPct?: number;
} = {}) {
  const set = opts.set === null ? null : opts.set ?? SET();
  const prisma: any = {
    cardSet: {
      findUnique: jest.fn(async ({ where }: any) => (set && where.id === set.id ? set : null)),
    },
    card: {
      findFirst: jest.fn(async () =>
        opts.anchorCardId === null ? null : { id: opts.anchorCardId ?? 'card-anchor' },
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async () =>
        (opts.siblingGroupIds ?? []).map((g) => ({ tcgplayerGroupId: g })),
      ),
    },
  };
  const provider = {
    listSealedProducts: jest.fn(async () => {
      if (opts.listThrows) throw new Error('tcgcsv down');
      return opts.products ?? [];
    }),
    fetchSealedPricesForGroup: jest.fn(async () => ({
      rows: opts.priceRows ?? [],
      fetchedRaw: (opts.priceRows ?? []).length,
      skipped: 0,
    })),
  } as unknown as TcgcsvSealedBulkProvider;
  const fx = {
    getCurrent: jest.fn(async () => ({
      rate: opts.rate ?? 20,
      bufferPct: opts.bufferPct ?? 0,
      source: 'manual' as const,
      effectiveDate: '2026-08-22',
    })),
  } as unknown as FxService;
  const svc = new SealedCatalogAdminService(prisma as PrismaService, provider, fx);
  return { svc, prisma, provider, fx };
}

describe('SealedCatalogAdminService — listado de productos sellados del set (P-35)', () => {
  it('lista productos con imageUrl + marketRef (USD→MXN) y subtype inferido; money-safe sin precio → null', async () => {
    const h = buildHarness({
      set: SET({ tcgcsvGroupId: 100 }),
      products: [
        { productId: 111, name: 'Prismatic Evolutions Elite Trainer Box', cleanName: 'PRE ETB', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/111_200w.jpg' },
        { productId: 222, name: 'Prismatic Evolutions Booster Box', imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/222_200w.jpg' },
        { productId: 333, name: 'Prismatic Evolutions Booster Bundle', imageUrl: null },
      ],
      // 111 = USD $250.00 (25000 c); 222 = USD $400.00; 333 SIN precio → marketRef null.
      priceRows: [
        { tcgplayerProductId: 111, marketCents: 25000, usedFallbackMid: false, currency: 'USD' },
        { tcgplayerProductId: 222, marketCents: 40000, usedFallbackMid: false, currency: 'USD' },
      ],
      rate: 20,
      bufferPct: 0,
    });
    const res = await h.svc.sealedCatalog({ setId: 'set-1' });
    expect(res.groupResolved).toBe(true);
    expect(res.tcgcsvGroupId).toBe(100);
    expect(res.anchorCardId).toBe('card-anchor');
    expect(res.set).toMatchObject({ id: 'set-1', name: 'Prismatic Evolutions' });
    expect(res.data).toHaveLength(3);

    const etb = res.data.find((d) => d.tcgplayerProductId === 111)!;
    expect(etb.sealedSubtype).toBe('etb');
    expect(etb.imageUrl).toBe('https://tcgplayer-cdn.tcgplayer.com/product/111_200w.jpg');
    // 25000 USD cents × 20 (rate) × (1 + 0%) = 500000 MXN cents.
    expect(etb.marketRef).toEqual({ status: 'priced', referenceMxnCents: 500000 });
    expect(etb.cleanName).toBe('PRE ETB');

    const box = res.data.find((d) => d.tcgplayerProductId === 222)!;
    expect(box.sealedSubtype).toBe('box');
    expect(box.marketRef).toEqual({ status: 'priced', referenceMxnCents: 800000 });

    // MONEY-SAFE: producto sin precio en la fuente → marketRef null (pendiente/«—»), NUNCA 0.
    const bundle = res.data.find((d) => d.tcgplayerProductId === 333)!;
    expect(bundle.sealedSubtype).toBe('bundle');
    expect(bundle.imageUrl).toBeNull();
    expect(bundle.marketRef).toBeNull();
  });

  it('aplica el colchón (bufferPct) al convertir USD→MXN', async () => {
    const h = buildHarness({
      set: SET({ tcgcsvGroupId: 100 }),
      products: [{ productId: 111, name: 'ETB', imageUrl: null }],
      priceRows: [{ tcgplayerProductId: 111, marketCents: 1000, usedFallbackMid: false, currency: 'USD' }],
      rate: 20,
      bufferPct: 5,
    });
    const res = await h.svc.sealedCatalog({ setId: 'set-1' });
    // 1000 × 20 × 1.05 = 21000.
    expect(res.data[0].marketRef).toEqual({ status: 'priced', referenceMxnCents: 21000 });
  });

  it('filtra por `q` (nombre / cleanName)', async () => {
    const h = buildHarness({
      set: SET({ tcgcsvGroupId: 100 }),
      products: [
        { productId: 1, name: 'Elite Trainer Box', imageUrl: null },
        { productId: 2, name: 'Booster Box', imageUrl: null },
      ],
    });
    const res = await h.svc.sealedCatalog({ setId: 'set-1', q: 'trainer' });
    expect(res.data.map((d) => d.tcgplayerProductId)).toEqual([1]);
  });

  describe('resolución set → grupo TCGCSV (precedencia §4.32b)', () => {
    it('override `groupId` de la query GANA sobre CardSet.tcgcsvGroupId', async () => {
      const h = buildHarness({ set: SET({ tcgcsvGroupId: 100 }), products: [] });
      const res = await h.svc.sealedCatalog({ setId: 'set-1', groupId: 777 });
      expect(res.tcgcsvGroupId).toBe(777);
      expect(res.groupResolved).toBe(true);
      expect(h.provider.listSealedProducts).toHaveBeenCalledWith(777);
    });

    it('CardSet.tcgcsvGroupId se usa cuando no hay override', async () => {
      const h = buildHarness({ set: SET({ tcgcsvGroupId: 100 }), products: [] });
      const res = await h.svc.sealedCatalog({ setId: 'set-1' });
      expect(res.tcgcsvGroupId).toBe(100);
      expect(h.provider.listSealedProducts).toHaveBeenCalledWith(100);
    });

    it('fallback: DISTINCT tcgplayerGroupId de hermanos ya mapeados (exactamente uno)', async () => {
      const h = buildHarness({ set: SET({ tcgcsvGroupId: null }), siblingGroupIds: [55, 55], products: [] });
      const res = await h.svc.sealedCatalog({ setId: 'set-1' });
      expect(res.tcgcsvGroupId).toBe(55);
      expect(res.groupResolved).toBe(true);
    });

    it('grupo NO resoluble (cero hermanos, sin CardSet.tcgcsvGroupId) → groupResolved:false, data:[]', async () => {
      const h = buildHarness({ set: SET({ tcgcsvGroupId: null }), siblingGroupIds: [] });
      const res = await h.svc.sealedCatalog({ setId: 'set-1' });
      expect(res.groupResolved).toBe(false);
      expect(res.tcgcsvGroupId).toBeNull();
      expect(res.data).toEqual([]);
      // No se llama al proxy si no hay grupo (aún así devuelve el anchor para el front).
      expect(h.provider.listSealedProducts).not.toHaveBeenCalled();
      expect(res.anchorCardId).toBe('card-anchor');
    });

    it('hermanos AMBIGUOS (≥2 groupIds distintos) sin CardSet.tcgcsvGroupId → groupResolved:false (no se adivina)', async () => {
      const h = buildHarness({ set: SET({ tcgcsvGroupId: null }), siblingGroupIds: [55, 66] });
      const res = await h.svc.sealedCatalog({ setId: 'set-1' });
      expect(res.groupResolved).toBe(false);
      expect(res.tcgcsvGroupId).toBeNull();
    });
  });

  it('set inexistente → 404 NOT_FOUND', async () => {
    const h = buildHarness({ set: null });
    await expect(h.svc.sealedCatalog({ setId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('TCGCSV caído (listSealedProducts lanza) → 502 UPSTREAM_ERROR', async () => {
    const h = buildHarness({ set: SET({ tcgcsvGroupId: 100 }), listThrows: true });
    await expect(h.svc.sealedCatalog({ setId: 'set-1' })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      status: 502,
    });
  });

  it('sin N+1: UNA llamada de productos + UNA de precios por request', async () => {
    const h = buildHarness({
      set: SET({ tcgcsvGroupId: 100 }),
      products: [
        { productId: 1, name: 'ETB', imageUrl: null },
        { productId: 2, name: 'Booster Box', imageUrl: null },
      ],
      priceRows: [{ tcgplayerProductId: 1, marketCents: 1000, usedFallbackMid: false, currency: 'USD' }],
    });
    await h.svc.sealedCatalog({ setId: 'set-1' });
    expect(h.provider.listSealedProducts).toHaveBeenCalledTimes(1);
    expect(h.provider.fetchSealedPricesForGroup).toHaveBeenCalledTimes(1);
    expect(h.fx.getCurrent).toHaveBeenCalledTimes(1);
  });
});

describe('inferSealedSubtype — heurística de nombre (§4.32a)', () => {
  it.each([
    ['Scarlet & Violet Elite Trainer Box', 'etb'],
    ['SV ETB White', 'etb'],
    ['Prismatic Evolutions Booster Box', 'box'],
    ['Booster Case', 'box'],
    ['Prismatic Evolutions Booster Bundle', 'bundle'],
    ['Collector Tin', 'tin'],
    ['3-Pack Blister', 'blister'],
    ['Sleeved Booster Pack', 'blister'],
    ['Checklane Blister', 'blister'],
  ])('«%s» → %s', (name, expected) => {
    expect(inferSealedSubtype(name)).toBe(expected);
  });

  it('nombre no reconocible → null (el operador elige)', () => {
    expect(inferSealedSubtype('Mystery Something')).toBeNull();
    expect(inferSealedSubtype('Single Booster Pack Wrapper Art')).toBeNull();
  });
});

describe('InventoryController.sealedCatalogList — validaciones 400 (P-35)', () => {
  const ctrl = (svc: any) =>
    new InventoryController({} as any, {} as any, {} as any, {} as any, svc);

  it('setId ausente → 400 VALIDATION_ERROR (no llama al servicio)', async () => {
    const svc = { sealedCatalog: jest.fn() };
    await expect(ctrl(svc).sealedCatalogList(undefined, undefined, undefined)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(svc.sealedCatalog).not.toHaveBeenCalled();
  });

  it('groupId no entero positivo → 400 VALIDATION_ERROR', async () => {
    const svc = { sealedCatalog: jest.fn() };
    await expect(ctrl(svc).sealedCatalogList('set-1', '-3', undefined)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    await expect(ctrl(svc).sealedCatalogList('set-1', 'abc', undefined)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(svc.sealedCatalog).not.toHaveBeenCalled();
  });

  it('setId válido + groupId válido → delega con los parámetros parseados', async () => {
    const svc = { sealedCatalog: jest.fn(async () => ({ ok: true })) };
    await ctrl(svc).sealedCatalogList('set-1', '100', 'etb');
    expect(svc.sealedCatalog).toHaveBeenCalledWith({ setId: 'set-1', groupId: 100, q: 'etb' });
  });

  it('groupId omitido → undefined (no override)', async () => {
    const svc = { sealedCatalog: jest.fn(async () => ({ ok: true })) };
    await ctrl(svc).sealedCatalogList('set-1', undefined, undefined);
    expect(svc.sealedCatalog).toHaveBeenCalledWith({ setId: 'set-1', groupId: undefined, q: undefined });
  });
});
