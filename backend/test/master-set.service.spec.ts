import {
  MasterSetService,
  compareByNumber,
  deriveNumberParts,
} from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * WS-E (v1.16-master-set, §4.17a) — LECTURA AGREGADA del inventario:
 *  - ORDEN NATURAL de Card.number String ("10" > "2"; no-numéricos/promos al final).
 *  - índice: completitud/piezas agregadas vs conteos reales, sin N+1 (nº de queries).
 *  - binder: countsByFinish por (cardId, finish) coincide con las piezas on-hand; secret rares.
 * v1.20-master-set-everywhere: el scope/variantes se prueba en test/master-set.scopes.spec.ts;
 * aquí se verifica que el comportamiento v1.16 (scope platform, default) NO cambió (aditivo).
 */

describe('orden natural (deriveNumberParts / compareByNumber)', () => {
  it('numérico: "10" va DESPUÉS de "2" (no lexicográfico)', () => {
    const sorted = ['10', '2', '1', '100', '21'].map((n) => ({ number: n })).sort(compareByNumber);
    expect(sorted.map((c) => c.number)).toEqual(['1', '2', '10', '21', '100']);
  });

  it('no-numéricos (TG/GG/SV) van al FINAL, agrupados por prefijo', () => {
    const input = ['TG12', '4', 'SV107', 'TG2', '10', 'GG50'].map((n) => ({ number: n }));
    const sorted = input.sort(compareByNumber);
    expect(sorted.map((c) => c.number)).toEqual(['4', '10', 'GG50', 'SV107', 'TG2', 'TG12']);
  });

  it('numberSort: puro = entero; promo = base grande (va al final)', () => {
    expect(deriveNumberParts('10').numberSort).toBe(10);
    expect(deriveNumberParts('2').numberSort).toBe(2);
    expect(deriveNumberParts('TG12').numberSort).toBeGreaterThan(999_999);
  });
});

function buildPrisma(over: any = {}) {
  return {
    cardSet: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    card: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    inventoryItem: {
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as PrismaService;
}

function buildPricing(over: any = {}) {
  return {
    loadSalesRules: jest.fn().mockResolvedValue({ rules: {}, fallbackPct: 15 }),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    // v1.22-2 / N-15: displayFinishes se deriva de este lote (default vacío = sin supresión).
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    ...over,
  } as unknown as PricingService;
}

/**
 * El índice v1.20 hace DOS agregaciones raw (Σ|availableFinishes| sobre "Card" + piezas sobre
 * "InventoryItem"): el mock despacha por el TEXTO del SQL (Prisma.Sql.sql).
 */
function mockRawQueries(
  prisma: PrismaService,
  data: { variantRows?: any[]; inventoryRows?: any[] },
) {
  (prisma.$queryRaw as unknown as jest.Mock).mockImplementation((query: any) => {
    const s = query && typeof query.sql === 'string' ? query.sql : String(query);
    if (s.includes('FROM "InventoryItem"')) return Promise.resolve(data.inventoryRows ?? []);
    if (s.includes('FROM "Card"')) return Promise.resolve(data.variantRows ?? []);
    return Promise.resolve([]);
  });
}

describe('MasterSetService.index — agregados vs conteos reales, sin N+1 (scope platform default)', () => {
  it('completionPct = distinctCardsOwned / catalogCardCount (nunca >100%) y piezas totales', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([
      { id: 's1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 191 },
      { id: 's2', name: 'Base', series: 'Base', releaseDate: '1999/01/09', printedTotal: 102 },
    ]);
    // catalogCardCount: s1 catálogo=200 (incluye secret > printedTotal), s2=102.
    (prisma.card.groupBy as jest.Mock).mockResolvedValue([
      { setId: 's1', _count: { _all: 200 } },
      { setId: 's2', _count: { _all: 102 } },
    ]);
    mockRawQueries(prisma, {
      // Σ|availableFinishes| por set (v1.20): s1=250 variantes de catálogo, s2=102.
      variantRows: [
        { setId: 's1', variantCount: 250n },
        { setId: 's2', variantCount: 102n },
      ],
      // agregación de piezas: s1 con 5 piezas / 3 cartas distintas / 4 variantes; s2 sin inventario.
      inventoryRows: [{ setId: 's1', pieces: 5n, distinctCards: 3n, distinctVariants: 4n }],
    });

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });

    // v1.20: el scope default sigue siendo platform (respuesta aditiva, endpoints v1.16 intactos).
    expect(res.scope).toBe('platform');
    expect(res.owner).toBeUndefined();

    const s1 = res.data.find((r) => r.setId === 's1')!;
    expect(s1.catalogCardCount).toBe(200);
    expect(s1.distinctCardsOwned).toBe(3);
    expect(s1.totalPieces).toBe(5);
    expect(s1.completionPct).toBe(1.5); // 3/200 = 1.5% (denominador = catálogo real, nunca >100%)
    expect(s1.year).toBe(2024);
    // v1.20: contadores por VARIANTE (los «X/Y» del front usan estos).
    expect(s1.catalogVariantCount).toBe(250);
    expect(s1.distinctVariantsOwned).toBe(4);
    expect(s1.variantCompletionPct).toBe(1.6); // 4/250
    const s2 = res.data.find((r) => r.setId === 's2')!;
    expect(s2.totalPieces).toBe(0);
    expect(s2.completionPct).toBe(0);
    expect(s2.variantCompletionPct).toBe(0);

    // Sin N+1: 4 queries FIJAS sin importar el nº de sets (página + groupBy + 2 agregaciones raw).
    expect((prisma.cardSet.findMany as jest.Mock).mock.calls).toHaveLength(1);
    expect((prisma.card.groupBy as jest.Mock).mock.calls).toHaveLength(1);
    expect(((prisma as any).$queryRaw as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('sort=release_desc ordena por releaseDate descendente', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([
      { id: 's2', name: 'Base', releaseDate: '1999/01/09', printedTotal: 102 },
      { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08', printedTotal: 191 },
    ]);
    (prisma.card.groupBy as jest.Mock).mockResolvedValue([]);
    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect(res.data.map((r) => r.setId)).toEqual(['s1', 's2']);
  });
});

describe('MasterSetService.binder — countsByFinish, orden natural, secret rares (platform)', () => {
  it('agrega piezas on-hand por (cardId, finish) y ordena las celdas por número', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 191,
    });
    // v1.22 (§4.22b): el orden natural lo aplica la BD (`orderBy: CARD_ORDER_BY_IN_SET`); el
    // mock simula la respuesta YA ordenada, con `numberSort`/`numberPrefix` COMO COLUMNAS (M-26) —
    // el servicio ya NO deriva/ordena en memoria.
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c2', number: '2', numberSort: 2, numberPrefix: '', name: 'A', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      { id: 'c10', number: '10', numberSort: 10, numberPrefix: '', name: 'B', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
      { id: 'c200', number: '200', numberSort: 200, numberPrefix: '', name: 'Secret', rarity: 'Secret Rare', imageSmallUrl: null, availableFinishes: ['holofoil'] },
      { id: 'ctg', number: 'TG12', numberSort: 1_000_012, numberPrefix: 'TG', name: 'Trainer', rarity: 'Trainer Gallery', imageSmallUrl: null, availableFinishes: ['holofoil'] },
    ]);
    // 2 normales + 1 reverse de c10; 3 normales de c2; c200/ctg sin inventario.
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([
      { cardId: 'c10', finish: 'normal', _count: { _all: 2 } },
      { cardId: 'c10', finish: 'reverse_holo', _count: { _all: 1 } },
      { cardId: 'c2', finish: 'normal', _count: { _all: 3 } },
    ]);

    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('s1');

    // v1.20: scope default platform, sin owner y SIN buyable en ninguna variante.
    expect(res.scope).toBe('platform');
    expect(res.owner).toBeUndefined();
    for (const cell of res.cells) {
      for (const v of cell.variants) expect('buyable' in v).toBe(false);
    }

    // Orden natural: 2, 10, 200, luego TG12 al final — servido por el `orderBy` de la BD.
    expect(res.cells.map((c) => c.number)).toEqual(['2', '10', '200', 'TG12']);
    // v1.22 (§4.22b): `card.findMany` se invoca con el `orderBy` NORMATIVO dentro del set.
    expect((prisma.card.findMany as jest.Mock).mock.calls[0][0]).toMatchObject({
      orderBy: [{ numberPrefix: 'asc' }, { numberSort: 'asc' }, { number: 'asc' }, { id: 'asc' }],
    });

    const c10 = res.cells.find((c) => c.cardId === 'c10')!;
    expect(c10.totalCount).toBe(3);
    expect(c10.countsByFinish).toEqual([
      { finish: 'normal', count: 2 },
      { finish: 'reverse_holo', count: 1 },
    ]);

    const c2 = res.cells.find((c) => c.cardId === 'c2')!;
    expect(c2.totalCount).toBe(3);

    // Hueco de inventario (totalCount 0).
    const c200 = res.cells.find((c) => c.cardId === 'c200')!;
    expect(c200.totalCount).toBe(0);
    expect(c200.countsByFinish).toEqual([]);
    // Secret rare (BE-36 / §M1 v1.16.1): numeración PRINCIPAL (número puro) con entero > printedTotal.
    expect(c200.isSecretRare).toBe(true);
    // Carta dentro del total nominal NO es secret.
    expect(c10.isSecretRare).toBe(false);
    // Promo/subset con PREFIJO alfabético (TG12) NO es secret rare aunque su numberSort
    // (PROMO_SORT_BASE + 12) supere printedTotal — es heurística de display, no numeración principal.
    const ctg = res.cells.find((c) => c.cardId === 'ctg')!;
    expect(ctg.isSecretRare).toBe(false);

    // Sin N+1: 1 findMany de cartas + 1 groupBy de agregación (no una query por carta).
    expect((prisma.card.findMany as jest.Mock).mock.calls).toHaveLength(1);
    expect((prisma.inventoryItem.groupBy as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('404 si el set no existe', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new MasterSetService(prisma, buildPricing());
    await expect(svc.binder('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
