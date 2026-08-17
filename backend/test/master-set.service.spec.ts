import {
  MasterSetService,
  compareByNumber,
  deriveNumberParts,
} from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * WS-E (v1.16-master-set, §4.17a) — LECTURA AGREGADA del inventario:
 *  - ORDEN NATURAL de Card.number String ("10" > "2"; no-numéricos/promos al final).
 *  - índice: completitud/piezas agregadas vs conteos reales, sin N+1 (nº de queries).
 *  - binder: countsByFinish por (cardId, finish) coincide con las piezas on-hand; secret rares.
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
    },
    $queryRaw: jest.fn(),
    ...over,
  } as unknown as PrismaService;
}

describe('MasterSetService.index — agregados vs conteos reales, sin N+1', () => {
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
    // agregación raw: s1 con 5 piezas de 3 cartas distintas; s2 sin inventario.
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([
      { setId: 's1', pieces: 5n, distinctCards: 3n },
    ]);

    const svc = new MasterSetService(prisma);
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });

    const s1 = res.data.find((r) => r.setId === 's1')!;
    expect(s1.catalogCardCount).toBe(200);
    expect(s1.distinctCardsOwned).toBe(3);
    expect(s1.totalPieces).toBe(5);
    expect(s1.completionPct).toBe(1.5); // 3/200 = 1.5% (denominador = catálogo real, nunca >100%)
    expect(s1.year).toBe(2024);
    const s2 = res.data.find((r) => r.setId === 's2')!;
    expect(s2.totalPieces).toBe(0);
    expect(s2.completionPct).toBe(0);

    // Sin N+1: 3 queries FIJAS sin importar el nº de sets (página + groupBy + 1 agregación raw).
    expect((prisma.cardSet.findMany as jest.Mock).mock.calls).toHaveLength(1);
    expect((prisma.card.groupBy as jest.Mock).mock.calls).toHaveLength(1);
    expect((prisma.$queryRaw as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('sort=release_desc ordena por releaseDate descendente', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([
      { id: 's2', name: 'Base', releaseDate: '1999/01/09', printedTotal: 102 },
      { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08', printedTotal: 191 },
    ]);
    (prisma.card.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    const svc = new MasterSetService(prisma);
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect(res.data.map((r) => r.setId)).toEqual(['s1', 's2']);
  });
});

describe('MasterSetService.binder — countsByFinish, orden natural, secret rares', () => {
  it('agrega piezas on-hand por (cardId, finish) y ordena las celdas por número', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 191,
    });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c10', number: '10', name: 'B', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
      { id: 'c2', number: '2', name: 'A', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      { id: 'c200', number: '200', name: 'Secret', rarity: 'Secret Rare', imageSmallUrl: null, availableFinishes: ['holofoil'] },
      { id: 'ctg', number: 'TG12', name: 'Trainer', rarity: 'Trainer Gallery', imageSmallUrl: null, availableFinishes: ['holofoil'] },
    ]);
    // 2 normales + 1 reverse de c10; 3 normales de c2; c200/ctg sin inventario.
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([
      { cardId: 'c10', finish: 'normal', _count: { _all: 2 } },
      { cardId: 'c10', finish: 'reverse_holo', _count: { _all: 1 } },
      { cardId: 'c2', finish: 'normal', _count: { _all: 3 } },
    ]);

    const svc = new MasterSetService(prisma);
    const res = await svc.binder('s1');

    // Orden natural: 2, 10, 200, luego TG12 al final.
    expect(res.cells.map((c) => c.number)).toEqual(['2', '10', '200', 'TG12']);

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
    const svc = new MasterSetService(prisma);
    await expect(svc.binder('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
