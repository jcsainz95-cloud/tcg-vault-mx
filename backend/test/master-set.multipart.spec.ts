import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import {
  MASTER_SET_GROUPS,
  MasterSetGroup,
  partExternalIds,
  parentExternalIdOf,
  groupForPrimaryExternalId,
} from '../src/config/master-set-groups';

/**
 * P-27 (v1.33-master-set-multipart, PROJECT §L / ARCHITECTURE §4.31 / API_CONTRACT v1.33) — MASTER
 * SET COMBINADO en el read model único `MasterSetService` (M1, bóveda y admin-bóveda lo heredan).
 * Con fixtures (no depende del catálogo real): Celebrations `cel25` + Classic Collection `cel25c` = 50.
 * Cubre: binder = 50 en un solo master; partSetId/partLabel por celda; normalización subset→principal;
 * Σ de conteos; CA-68 (money-safe: piezas de un subset intactas, llaveadas a cardId); CA-70 (N subsets);
 * CA-71 (subset sin principal → no revienta). Los grupos-fixture temporales se limpian en afterEach.
 */

const CEL25 = { id: 'cel25-local', externalId: 'cel25', name: 'Celebrations', series: 'Celebrations', releaseDate: '2021/10/08', printedTotal: 25 };
const CEL25C = { id: 'cel25c-local', externalId: 'cel25c', name: 'Classic Collection', series: 'Celebrations', releaseDate: '2021/10/08', printedTotal: 25 };

function buildPrisma(over: any = {}) {
  return {
    cardSet: { findMany: jest.fn(), findUnique: jest.fn() },
    card: { groupBy: jest.fn(), findMany: jest.fn() },
    inventoryItem: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as PrismaService;
}

function buildPricing(over: any = {}) {
  return {
    loadSalesRules: jest.fn().mockResolvedValue({ rules: {}, fallbackPct: 15 }),
    loadBuylistRules: jest.fn().mockResolvedValue({ rules: {}, fallbackPct: 40 }),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    ...over,
  } as unknown as PricingService;
}

/** Genera `n` celdas de catálogo para un set, numeración 1..n (orden natural puro). */
function genCards(setId: string, n: number, namePrefix: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${setId}-c${i + 1}`,
    setId,
    number: String(i + 1),
    numberSort: i + 1,
    numberPrefix: '',
    name: `${namePrefix}${i + 1}`,
    rarity: 'Common',
    imageSmallUrl: null,
    availableFinishes: ['normal'],
  }));
}

describe('config/master-set-groups — mapa curado y helpers', () => {
  it('Celebrations cel25→cel25c está ACTIVO (caso testigo confirmado)', () => {
    const g = groupForPrimaryExternalId('cel25');
    expect(g).toBeDefined();
    expect(g!.subsets.map((s) => s.externalId)).toEqual(['cel25c']);
    expect(g!.subsets[0].label).toBe('Classic Collection');
    expect(parentExternalIdOf('cel25c')).toBe('cel25');
    expect(partExternalIds('cel25')).toEqual(['cel25', 'cel25c']);
  });

  it('los candidatos Shiny Vault NO están activos (comentados hasta validar)', () => {
    expect(groupForPrimaryExternalId('swsh45')).toBeUndefined();
    expect(groupForPrimaryExternalId('sm115')).toBeUndefined();
    expect(parentExternalIdOf('swsh45sv')).toBeUndefined();
    expect(parentExternalIdOf('sma')).toBeUndefined();
  });

  it('un set normal no es parte de ningún grupo', () => {
    expect(groupForPrimaryExternalId('sv08')).toBeUndefined();
    expect(parentExternalIdOf('sv08')).toBeUndefined();
    expect(partExternalIds('sv08')).toEqual([]);
  });
});

describe('MasterSetService.binder — master set combinado (fan-in)', () => {
  it('Celebrations = 50 cartas en UN solo master; set = principal; Σ conteos; parts[]', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(CEL25);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([CEL25, CEL25C]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      ...genCards('cel25-local', 25, 'A'),
      ...genCards('cel25c-local', 25, 'B'),
    ]);

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('cel25-local');

    // 50 cartas en un solo binder; nombre del master = principal; printedTotal = Σ (25 + 25).
    expect(res.catalogCardCount).toBe(50);
    expect(res.cells).toHaveLength(50);
    expect(res.set.id).toBe('cel25-local');
    expect(res.set.name).toBe('Celebrations');
    expect(res.printedTotal).toBe(50);
    // parts[]: dos partes, principal primero.
    expect(res.parts).toBeDefined();
    expect(res.parts!.map((p) => ({ setId: p.setId, isPrimary: p.isPrimary, order: p.order, cc: p.catalogCardCount }))).toEqual([
      { setId: 'cel25-local', isPrimary: true, order: 0, cc: 25 },
      { setId: 'cel25c-local', isPrimary: false, order: 1, cc: 25 },
    ]);
    // No hay canonicalSetId al pedir por el principal.
    expect(res.canonicalSetId).toBeUndefined();
    // fan-in: card.findMany se llamó con setId IN [ambas partes].
    expect((prisma.card.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      setId: { in: ['cel25-local', 'cel25c-local'] },
    });
  });

  it('cada celda trae partSetId/partLabel y el bloque del principal va PRIMERO', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(CEL25);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([CEL25, CEL25C]);
    // Devueltas INTERCALADAS por el mock: el servicio debe re-ordenar por bloque (estable).
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'sub1', setId: 'cel25c-local', number: '1', numberSort: 1, numberPrefix: '', name: 'Sub1', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      { id: 'main1', setId: 'cel25-local', number: '1', numberSort: 1, numberPrefix: '', name: 'Main1', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      { id: 'sub2', setId: 'cel25c-local', number: '2', numberSort: 2, numberPrefix: '', name: 'Sub2', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      { id: 'main2', setId: 'cel25-local', number: '2', numberSort: 2, numberPrefix: '', name: 'Main2', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('cel25-local');

    // Bloque del principal primero (order 0), luego el subset (order 1) — orden estable intra-bloque.
    expect(res.cells.map((c) => c.cardId)).toEqual(['main1', 'main2', 'sub1', 'sub2']);
    const main = res.cells.find((c) => c.cardId === 'main1')!;
    expect(main.partSetId).toBe('cel25-local');
    expect(main.partLabel).toBe('Celebrations'); // en el principal la etiqueta = su nombre
    const sub = res.cells.find((c) => c.cardId === 'sub1')!;
    expect(sub.partSetId).toBe('cel25c-local');
    expect(sub.partLabel).toBe('Classic Collection');
  });

  it('pedir el binder por el SUBSET (cel25c) normaliza al principal + canonicalSetId', async () => {
    const prisma = buildPrisma();
    // findUnique del set pedido = el SUBSET.
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(CEL25C);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([CEL25, CEL25C]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      ...genCards('cel25-local', 25, 'A'),
      ...genCards('cel25c-local', 25, 'B'),
    ]);

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('cel25c-local');

    // Se normaliza: set = principal, canonicalSetId = id del principal (el front actualiza la URL).
    expect(res.set.id).toBe('cel25-local');
    expect(res.set.name).toBe('Celebrations');
    expect(res.canonicalSetId).toBe('cel25-local');
    expect(res.catalogCardCount).toBe(50); // no más binder roto de 25
  });

  it('CA-68 money-safe: las piezas de una carta de cel25c salen llaveadas a su cardId (intactas)', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(CEL25);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([CEL25, CEL25C]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'main1', setId: 'cel25-local', number: '1', numberSort: 1, numberPrefix: '', name: 'Main1', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      { id: 'subX', setId: 'cel25c-local', number: '5', numberSort: 5, numberPrefix: '', name: 'SubX', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);
    // 3 piezas de la carta de subset (llaveadas por cardId, NO por setId del mapa).
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([
      { cardId: 'subX', finish: 'normal', _count: { _all: 3 } },
    ]);

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('cel25-local');

    const subX = res.cells.find((c) => c.cardId === 'subX')!;
    expect(subX.totalCount).toBe(3);
    expect(subX.countsByFinish).toEqual([{ finish: 'normal', count: 3 }]);
    // El groupBy de piezas filtra por cardId (unión de partes) + scopeWhere REAL (ownerType/status);
    // el mapa NO reemplaza el filtro por cardId → precio/folio/titularidad por pieza intactos (CA-68/CA-72).
    const gbWhere = (prisma.inventoryItem.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(gbWhere.cardId).toEqual({ in: ['main1', 'subX'] });
    expect(gbWhere.ownerType).toBe('platform');
    expect(gbWhere.status).toEqual({ notIn: expect.arrayContaining(['withdrawn', 'shipped']) });
  });
});

describe('MasterSetService.binder — casos borde (CA-70 / CA-71) con grupos-fixture', () => {
  let injected: MasterSetGroup | null = null;
  afterEach(() => {
    if (injected) {
      const i = MASTER_SET_GROUPS.indexOf(injected);
      if (i >= 0) MASTER_SET_GROUPS.splice(i, 1);
      injected = null;
    }
  });

  it('CA-70: N subsets — el fan-in suma TODAS las partes, en orden de bloque', async () => {
    injected = { primary: 'multi', subsets: [
      { externalId: 'multi-b', label: 'Bloque B', order: 1 },
      { externalId: 'multi-c', label: 'Bloque C', order: 2 },
    ] };
    MASTER_SET_GROUPS.push(injected);

    const A = { id: 'A', externalId: 'multi', name: 'Multi', series: null, releaseDate: '2020/01/01', printedTotal: 10 };
    const B = { id: 'B', externalId: 'multi-b', name: 'B-set', series: null, releaseDate: '2020/01/01', printedTotal: 5 };
    const C = { id: 'C', externalId: 'multi-c', name: 'C-set', series: null, releaseDate: '2020/01/01', printedTotal: 3 };
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(A);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([A, B, C]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      ...genCards('A', 10, 'a'),
      ...genCards('B', 5, 'b'),
      ...genCards('C', 3, 'c'),
    ]);

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('A');

    expect(res.catalogCardCount).toBe(18); // 10 + 5 + 3
    expect(res.printedTotal).toBe(18);
    expect(res.parts!.map((p) => p.setId)).toEqual(['A', 'B', 'C']); // orden de bloque
    // Todas las celdas del bloque A primero, luego B, luego C.
    expect(res.cells.slice(0, 10).every((c) => c.partSetId === 'A')).toBe(true);
    expect(res.cells.slice(10, 15).every((c) => c.partSetId === 'B')).toBe(true);
    expect(res.cells.slice(15).every((c) => c.partSetId === 'C')).toBe(true);
  });

  it('CA-71: subset cuyo PRINCIPAL no está importado → NO se combina, se muestra como su set (sin 500)', async () => {
    injected = { primary: 'ghost', subsets: [{ externalId: 'orphan', label: 'Huérfano', order: 1 }] };
    MASTER_SET_GROUPS.push(injected);

    const ORPHAN = { id: 'orphan-local', externalId: 'orphan', name: 'Orphan Set', series: null, releaseDate: '2019/01/01', printedTotal: 4 };
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(ORPHAN);
    // resolveMasterSet busca las partes; el principal 'ghost' NO existe → solo aparece el subset.
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([ORPHAN]);
    (prisma.card.findMany as jest.Mock).mockResolvedValue(genCards('orphan-local', 4, 'o'));

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('orphan-local');

    // Sin combinación: comportamiento normal (su propio set), sin parts/canonicalSetId, sin romper.
    expect(res.catalogCardCount).toBe(4);
    expect(res.set.id).toBe('orphan-local');
    expect(res.set.name).toBe('Orphan Set');
    expect(res.parts).toBeUndefined();
    expect(res.canonicalSetId).toBeUndefined();
    expect(res.cells.every((c) => c.partSetId === undefined)).toBe(true);
  });

  it('principal importado pero subset AUSENTE → una sola parte → set normal (no revienta)', async () => {
    injected = { primary: 'solo', subsets: [{ externalId: 'solo-missing', label: 'Ausente', order: 1 }] };
    MASTER_SET_GROUPS.push(injected);

    const SOLO = { id: 'solo-local', externalId: 'solo', name: 'Solo Set', series: null, releaseDate: '2018/01/01', printedTotal: 6 };
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SOLO);
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([SOLO]); // subset no importado
    (prisma.card.findMany as jest.Mock).mockResolvedValue(genCards('solo-local', 6, 's'));

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('solo-local');

    expect(res.catalogCardCount).toBe(6);
    expect(res.parts).toBeUndefined(); // <2 partes → set normal
    expect(res.cells.every((c) => c.partSetId === undefined)).toBe(true);
  });
});

describe('MasterSetService.index — plegado del master set combinado', () => {
  /**
   * El índice v1.20 hace DOS agregaciones raw (Σ|availableFinishes| en "Card" + piezas en
   * "InventoryItem"): el mock despacha por el TEXTO del SQL.
   */
  function mockRawQueries(prisma: PrismaService, data: { variantRows?: any[]; inventoryRows?: any[] }) {
    (prisma.$queryRaw as unknown as jest.Mock).mockImplementation((query: any) => {
      const s = query && typeof query.sql === 'string' ? query.sql : String(query);
      if (s.includes('FROM "InventoryItem"')) return Promise.resolve(data.inventoryRows ?? []);
      if (s.includes('FROM "Card"')) return Promise.resolve(data.variantRows ?? []);
      return Promise.resolve([]);
    });
  }

  it('pliega cel25c en cel25: una sola fila, agregados SUMADos, partSetIds, subset ausente', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([
      { id: 'cel25-local', externalId: 'cel25', name: 'Celebrations', series: 'Celebrations', releaseDate: '2021/10/08', printedTotal: 25 },
      { id: 'cel25c-local', externalId: 'cel25c', name: 'Classic Collection', series: 'Celebrations', releaseDate: '2021/10/08', printedTotal: 25 },
      { id: 'other', externalId: 'sv08', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 191 },
    ]);
    (prisma.card.groupBy as jest.Mock).mockResolvedValue([
      { setId: 'cel25-local', _count: { _all: 25 } },
      { setId: 'cel25c-local', _count: { _all: 25 } },
      { setId: 'other', _count: { _all: 200 } },
    ]);
    mockRawQueries(prisma, {
      variantRows: [
        { setId: 'cel25-local', variantCount: 30n },
        { setId: 'cel25c-local', variantCount: 28n },
        { setId: 'other', variantCount: 250n },
      ],
      inventoryRows: [
        { setId: 'cel25-local', pieces: 4n, distinctCards: 3n, distinctVariants: 3n },
        { setId: 'cel25c-local', pieces: 6n, distinctCards: 5n, distinctVariants: 5n },
      ],
    });

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });

    // El subset NO aparece como fila propia.
    expect(res.data.find((r) => r.setId === 'cel25c-local')).toBeUndefined();
    const cel = res.data.find((r) => r.setId === 'cel25-local')!;
    // Agregados SUMADos sobre las partes.
    expect(cel.catalogCardCount).toBe(50); // 25 + 25
    expect(cel.catalogVariantCount).toBe(58); // 30 + 28
    expect(cel.distinctCardsOwned).toBe(8); // 3 + 5
    expect(cel.distinctVariantsOwned).toBe(8); // 3 + 5
    expect(cel.totalPieces).toBe(10); // 4 + 6
    expect(cel.printedTotal).toBe(50); // 25 + 25
    expect(cel.completionPct).toBe(16); // 8/50 = 16%
    expect(cel.partSetIds).toEqual(['cel25-local', 'cel25c-local']);
    // El set normal no se toca y no gana partSetIds.
    const other = res.data.find((r) => r.setId === 'other')!;
    expect(other.catalogCardCount).toBe(200);
    expect(other.partSetIds).toBeUndefined();
  });
});
