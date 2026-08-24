import { SealedGradedInventoryService } from '../src/modules/inventory/sealed-graded.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { NOT_ON_HAND } from '../src/modules/inventory/master-set.service';
import { buildGradeKey } from '../src/modules/pricing/pricing.types';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.28 (P-25 + P-20, §4.26g/h / API_CONTRACT §M1) — pestañas «Sellado» (por SET) y «Gradeadas»:
 *  - GET /admin/inventory/sealed-sets: agregación por set (pieceCount/listedCount/unmappedCount/
 *    marketValueMxnCents = Σ sealedMarketRef de piezas CON mercado; null si ninguna — nunca 0
 *    inventado) + unmappedTotal global (espejo del badge de la cola M2).
 *  - GET /admin/inventory/sealed-sets/:setId: grupos por identidad §4.23 con conteos por status,
 *    mapped, sealedMarketRef (solo priced) y costo agregado. 404 si el set no existe.
 *  - GET /admin/inventory/graded: agregado por (carta, compañía, grado) con la referencia de
 *    grado (override manual §M2 P-20), null honesto sin referencia, y grado DESC dentro de carta.
 */

function buildPricing(refsByKey: Record<string, { cents: number; capturedDate?: string }>) {
  const getReferencesBatch = jest.fn(async (keys: any[]) => {
    const map = new Map<string, any>();
    for (const k of keys) {
      const id = `${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`;
      const hit = refsByKey[id];
      if (hit) {
        map.set(id, {
          status: 'priced',
          referenceMxnCents: hit.cents,
          source: 'tcgcsv',
          ...(hit.capturedDate ? { capturedDate: hit.capturedDate } : {}),
        });
      }
    }
    return map;
  });
  return {
    pricing: {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      gradeKeyFor: (i: any) => buildGradeKey(i),
      getReferencesBatch,
    } as unknown as PricingService,
    getReferencesBatch,
  };
}

describe('sealedSetsIndex (P-25)', () => {
  function buildHarness() {
    // Piezas selladas de plataforma on-hand, agrupadas por (cardId, productId, status):
    //  set-1: 2 in_stock mapeadas c/mercado (777→200000) + 1 listed mapeada SIN ingest (888)
    //         + 1 in_stock sin mapeo → unmappedCount = 2, value = 400000, listed = 1
    //  set-2: 1 listed sin mapeo → todo unmapped, value = null
    const grouped = [
      { cardId: 'c1', tcgplayerProductId: 777, status: 'in_stock', _count: { _all: 2 } },
      { cardId: 'c1', tcgplayerProductId: 888, status: 'listed', _count: { _all: 1 } },
      { cardId: 'c1', tcgplayerProductId: null, status: 'in_stock', _count: { _all: 1 } },
      { cardId: 'c2', tcgplayerProductId: null, status: 'listed', _count: { _all: 1 } },
    ];
    const prisma: any = {
      inventoryItem: {
        groupBy: jest.fn(async () => grouped),
        count: jest.fn(async () => 7), // badge global de la cola (sealed sin mapeo, TODO el inventario)
      },
      card: {
        findMany: jest.fn(async () => [
          { id: 'c1', setId: 'set-1' },
          { id: 'c2', setId: 'set-2' },
        ]),
      },
      cardSet: {
        findMany: jest.fn(async ({ where }: any) =>
          [
            { id: 'set-1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08' },
            { id: 'set-2', name: 'Prismatic Evolutions', series: 'SV', releaseDate: '2025/01/17' },
          ].filter((s) =>
            where.name ? s.name.toLowerCase().includes(where.name.contains.toLowerCase()) : true,
          ),
        ),
      },
    };
    const { pricing } = buildPricing({ 'c1|sealed|sealed:tcg:777|normal': { cents: 200000 } });
    const svc = new SealedGradedInventoryService(prisma as PrismaService, pricing);
    return { svc, prisma };
  }

  it('agrega por set: conteos, listed, unmapped (sin mapeo O sin ingest) y valor Σ ref×piezas', async () => {
    const h = buildHarness();
    const res = await h.svc.sealedSetsIndex({ page: 1, pageSize: 20 });

    expect(res.unmappedTotal).toBe(7);
    expect(res.total).toBe(2);
    // Orden por releaseDate desc → set-2 (2025) primero.
    expect(res.data[0]).toEqual({
      set: { id: 'set-2', name: 'Prismatic Evolutions', series: 'SV', releaseDate: '2025/01/17' },
      pieceCount: 1,
      listedCount: 1,
      unmappedCount: 1,
      marketValueMxnCents: null, // ninguna valuable — null honesto, jamás 0
    });
    expect(res.data[1]).toEqual({
      set: { id: 'set-1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08' },
      pieceCount: 4,
      listedCount: 1,
      unmappedCount: 2, // 1 sin mapeo + 1 mapeada sin ingest (sin mercado, se excluye del valor)
      marketValueMxnCents: 400000, // 2 piezas × 200000
    });
    // Alcance normativo del groupBy: plataforma + on-hand (fuente única NOT_ON_HAND).
    expect(h.prisma.inventoryItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productType: 'sealed',
          ownerType: 'platform',
          status: { notIn: NOT_ON_HAND },
        }),
      }),
    );
  });

  it('?q= filtra por nombre de set (patrón del índice Master Set)', async () => {
    const h = buildHarness();
    const res = await h.svc.sealedSetsIndex({ q: 'prismatic', page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.data[0].set.id).toBe('set-2');
  });
});

describe('sealedSetDetail (P-25)', () => {
  function buildHarness(grouped: any[]) {
    const prisma: any = {
      cardSet: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'set-1'
            ? { id: 'set-1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08' }
            : null,
        ),
      },
      inventoryItem: { groupBy: jest.fn(async () => grouped) },
      card: { findMany: jest.fn(async () => [{ id: 'c1', name: 'Pikachu' }]) },
    };
    const { pricing } = buildPricing({
      'c1|sealed|sealed:tcg:777|normal': { cents: 200000, capturedDate: '2026-08-21' },
    });
    const svc = new SealedGradedInventoryService(prisma as PrismaService, pricing);
    return { svc, prisma };
  }

  const g = (over: any = {}) => ({
    cardId: 'c1',
    sealedSubtype: 'etb',
    tcgplayerProductId: 777,
    sealedCondition: 'mint',
    status: 'in_stock',
    _count: { _all: 2, acquisitionCostCents: 2 },
    _sum: { acquisitionCostCents: 300000 },
    ...over,
  });

  it('combina los status en UN grupo por identidad §4.23 con counts {inStock, listed, other}', async () => {
    const h = buildHarness([
      g(),
      g({ status: 'listed', _count: { _all: 1, acquisitionCostCents: 0 }, _sum: { acquisitionCostCents: null } }),
      g({ status: 'reserved', _count: { _all: 1, acquisitionCostCents: 1 }, _sum: { acquisitionCostCents: 50000 } }),
    ]);
    const res = await h.svc.sealedSetDetail('set-1');
    expect(res.set.id).toBe('set-1');
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({
      cardId: 'c1',
      productName: 'Pikachu',
      sealedSubtype: 'etb',
      sealedCondition: 'mint',
      tcgplayerProductId: 777,
      mapped: true,
      counts: { inStock: 2, listed: 1, other: 1 },
      totalCostCents: 350000,
      sealedMarketRef: expect.objectContaining({ status: 'priced', referenceMxnCents: 200000 }),
    });
  });

  // BLOQ-2 (fix H-P38-1, cascada §4.34a / contrato §M1 v1.36 L187-188): el detalle del set debe
  // pintar el nombre/imagen del PRODUCTO SELLADO (snapshot por-pieza) y NO la carta ancla.
  it('cascada de display: sealedProductName/sealedImageUrl ganan a la Card ancla (no «Pikachu»)', async () => {
    const h = buildHarness([
      g({
        sealedProductName: 'Pokémon 151 Elite Trainer Box',
        sealedImageUrl: 'https://tcgcsv.com/etb.png',
      }),
      // Segunda fila del MISMO grupo (otro status) sin snapshot → no debe romper el representativo.
      g({
        status: 'listed',
        sealedProductName: 'Pokémon 151 Elite Trainer Box',
        sealedImageUrl: 'https://tcgcsv.com/etb.png',
        _count: { _all: 1, acquisitionCostCents: 0 },
        _sum: { acquisitionCostCents: null },
      }),
    ]);
    const res = await h.svc.sealedSetDetail('set-1');
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({
      cardId: 'c1',
      productName: 'Pokémon 151 Elite Trainer Box', // NO 'Pikachu' (carta ancla)
      imageSmallUrl: 'https://tcgcsv.com/etb.png',
      counts: { inStock: 2, listed: 1, other: 0 },
    });
    expect(res.groups[0].productName).not.toBe('Pikachu');
  });

  // Sin snapshot (pieza legacy sin sealedProductName) → fallback money-safe a la Card ancla + imagen null.
  it('cascada: sin snapshot cae a Card.name ancla e imagen null honesta', async () => {
    const h = buildHarness([g()]); // g() no trae sealedProductName/sealedImageUrl
    const res = await h.svc.sealedSetDetail('set-1');
    expect(res.groups[0]).toMatchObject({ productName: 'Pikachu', imageSmallUrl: null });
  });

  it('grupo NO mapeado: mapped=false, sealedMarketRef null y es un grupo SEPARADO (identidad §4.23)', async () => {
    const h = buildHarness([
      g(),
      g({ tcgplayerProductId: null, _count: { _all: 1, acquisitionCostCents: 0 }, _sum: { acquisitionCostCents: null } }),
    ]);
    const res = await h.svc.sealedSetDetail('set-1');
    expect(res.groups).toHaveLength(2);
    const unmapped = res.groups.find((x) => x.tcgplayerProductId == null)!;
    expect(unmapped).toMatchObject({ mapped: false, sealedMarketRef: null, totalCostCents: null });
  });

  it('set inexistente → 404 NOT_FOUND', async () => {
    const h = buildHarness([]);
    await expect(h.svc.sealedSetDetail('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('gradedIndex (P-20)', () => {
  function buildHarness(grouped: any[], refs: Record<string, { cents: number; capturedDate?: string }>) {
    const prisma: any = {
      inventoryItem: { groupBy: jest.fn(async () => grouped) },
      card: {
        findMany: jest.fn(async () => [
          {
            id: 'c1',
            name: 'Charizard',
            number: '4',
            imageSmallUrl: 'https://img/zard.png',
            set: { name: 'Base Set' },
          },
        ]),
      },
    };
    const { pricing } = buildPricing(refs);
    const svc = new SealedGradedInventoryService(prisma as PrismaService, pricing);
    return { svc, prisma };
  }

  const g = (over: any = {}) => ({
    cardId: 'c1',
    gradingCompany: 'PSA',
    gradeValue: '10',
    _count: { _all: 2, acquisitionCostCents: 2 },
    _sum: { acquisitionCostCents: 800000 },
    ...over,
  });

  it('agrega por (carta, compañía, grado) con la referencia POR GRADO (override manual M2) y grado desc', async () => {
    const h = buildHarness(
      [
        g({ gradeValue: '9', _count: { _all: 1, acquisitionCostCents: 0 }, _sum: { acquisitionCostCents: null } }),
        g(), // PSA 10 ×2
      ],
      { 'c1|graded|graded:PSA:10|normal': { cents: 1500000, capturedDate: '2026-08-20' } },
    );
    const res = await h.svc.gradedIndex({ page: 1, pageSize: 20 });
    expect(res.total).toBe(2);
    // Grado DESC dentro de la carta: PSA 10 antes que PSA 9.
    expect(res.data[0]).toMatchObject({
      cardId: 'c1',
      card: { name: 'Charizard', number: '4', setName: 'Base Set', imageSmallUrl: 'https://img/zard.png' },
      gradingCompany: 'PSA',
      gradeValue: '10',
      count: 2,
      marketReferenceMxnCents: 1500000,
      capturedDate: '2026-08-20',
      totalCostCents: 800000,
    });
    // Sin referencia por grado → null HONESTO (y sin capturedDate) + costo null sin capturas.
    expect(res.data[1]).toMatchObject({
      gradeValue: '9',
      marketReferenceMxnCents: null,
      totalCostCents: null,
    });
    expect(res.data[1]).not.toHaveProperty('capturedDate');
    // Alcance: SOLO graded de plataforma on-hand (separado de sueltas).
    expect(h.prisma.inventoryItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productType: 'graded',
          ownerType: 'platform',
          status: { notIn: NOT_ON_HAND },
        }),
      }),
    );
  });

  it('?q= filtra por nombre de carta y la paginación corta el agregado', async () => {
    const h = buildHarness(
      [g(), g({ gradeValue: '9' }), g({ gradeValue: '8' })],
      {},
    );
    const res = await h.svc.gradedIndex({ q: 'chari', page: 2, pageSize: 2 });
    expect(h.prisma.inventoryItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          card: { name: { contains: 'chari', mode: 'insensitive' } },
        }),
      }),
    );
    expect(res.total).toBe(3);
    expect(res.data).toHaveLength(1); // página 2 de pageSize 2
    expect(res.data[0].gradeValue).toBe('8');
  });

  it('inventario graded vacío → data [] y total 0', async () => {
    const h = buildHarness([], {});
    const res = await h.svc.gradedIndex({ page: 1, pageSize: 20 });
    expect(res).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });
});
