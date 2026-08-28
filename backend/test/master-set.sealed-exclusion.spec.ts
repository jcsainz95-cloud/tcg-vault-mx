import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.42 (BLOQ-3/3b, §4.20b/§4.20d) — el binder de master set cuenta SOLO SINGLES:
 *  - `countsByFinish`/`totalCount`/completitud y las agregaciones X/Y EXCLUYEN productType='sealed'
 *    (un ETB anclado a una carta ya NO la infla como finish=normal). `graded` SIGUE contando.
 *  - `buyable` (BLOQ-3b) resuelve SOLO singles (raw|graded): un ETB sellado ya no llena la casilla de
 *    un single (mata «Tropius» en el faltante).
 *  - `catalogCardCount` (denominador = catálogo) NO cambia. Money-safe: es CONTEO, no dinero.
 */

function buildPrisma() {
  return {
    cardSet: { findMany: jest.fn(), findUnique: jest.fn() },
    card: { groupBy: jest.fn(), findMany: jest.fn() },
    inventoryItem: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
}

function buildPricing(over: any = {}) {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    ...over,
  } as unknown as PricingService;
}

const SET = { id: 's1', name: 'Obsidian Flames', series: 'SV', releaseDate: '2023/08/11', printedTotal: 197 };

describe('BLOQ-3 — el binder groupBy EXCLUYE productType=sealed (solo singles)', () => {
  it('el groupBy de piezas filtra productType != sealed (graded sigue, sealed fuera)', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', number: '1', name: 'Charizard', rarity: 'Rare', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);
    const svc = new MasterSetService(prisma, buildPricing());
    await svc.binder('s1');

    const where = (prisma.inventoryItem.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.productType).toEqual({ not: 'sealed' });
  });

  it('un ETB sellado anclado a la carta NO la cuenta ni la marca covered (viene excluido del groupBy)', async () => {
    // El mock del groupBy ya representa el resultado FILTRADO (Prisma no devuelve las piezas sealed):
    // con solo el ETB anclado a c1, el groupBy de singles vuelve vacío → totalCount 0, covered false.
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', number: '1', name: 'Charizard', rarity: 'Rare', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([]); // sealed excluido ⇒ 0 singles
    const svc = new MasterSetService(prisma, buildPricing());
    const res = await svc.binder('s1');
    const c1 = res.cells.find((c) => c.cardId === 'c1')!;
    expect(c1.totalCount).toBe(0);
    expect(c1.countsByFinish).toEqual([]);
    expect(c1.coveredVariantCount).toBe(0);
    expect(c1.variants.every((v) => v.covered === false)).toBe(true);
  });

  it('la agregación raw del índice (aggregateInventoryBySet) interpola la exclusión de sealed', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findMany as jest.Mock).mockResolvedValue([SET]);
    (prisma.card.groupBy as jest.Mock).mockResolvedValue([{ setId: 's1', _count: { _all: 200 } }]);
    const svc = new MasterSetService(prisma, buildPricing());
    await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });

    const invCall = (prisma.$queryRaw as jest.Mock).mock.calls.find((c) =>
      String(c[0]?.sql ?? '').includes('FROM "InventoryItem"'),
    );
    expect(String(invCall[0].sql)).toContain(`ii."productType"::text <> 'sealed'`);
  });
});

describe('BLOQ-3b — buyable resuelve SOLO singles (sealed excluido)', () => {
  function setupCustomerBinder(listedItems: any[], pricingOver: any = {}) {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue(SET);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Ana', email: 'a@x.mx' });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'c1', number: '1', name: 'Charizard', rarity: 'Rare', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([]); // c1 faltante (0 singles del user)
    (prisma.inventoryItem.findMany as jest.Mock).mockResolvedValue(listedItems);
    const pricing = buildPricing(pricingOver);
    return { prisma, svc: new MasterSetService(prisma, pricing) };
  }

  it('la búsqueda de comprables filtra productType != sealed (un ETB ya no llena la casilla del single)', async () => {
    const { prisma, svc } = setupCustomerBinder([]);
    await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const where = (prisma.inventoryItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.ownerType).toBe('platform');
    expect(where.status).toBe('listed');
    expect(where.productType).toEqual({ not: 'sealed' });
  });

  it('con solo un ETB sellado publicado de esa carta → buyable null (viene excluido del findMany)', async () => {
    // El findMany (ya filtrado) no devuelve el ETB → no hay single publicado → buyable null.
    const { svc } = setupCustomerBinder([]);
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const missing = res.cells[0].variants.find((v) => v.finish === 'normal')!;
    expect(missing.buyable).toBeNull();
  });

  it('un single graded publicado SÍ es buyable (solo sealed se excluye)', async () => {
    const { svc } = setupCustomerBinder([
      { id: 'i-graded', cardId: 'c1', finish: 'normal', productType: 'graded', listPriceCents: 8000, card: { rarity: 'Rare' } },
    ]);
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const missing = res.cells[0].variants.find((v) => v.finish === 'normal')!;
    expect(missing.buyable).toEqual({ inventoryItemId: 'i-graded', salePriceCents: 8000 });
  });
});
