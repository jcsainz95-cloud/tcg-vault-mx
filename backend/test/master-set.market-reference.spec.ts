import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';

/**
 * v1.26 (P-2 ④, §M1 / §4.24d) — PRECIO DE MERCADO en la teja del Master Set (M1):
 *  - una celda con referencia PRICED expone `marketReferenceMxnCents` (referencia CRUDA del acabado
 *    base, ya FX-recomputada a MXN por `getReferencesBatch` — NO el precio de venta derivado);
 *  - una celda con referencia PENDING/ausente expone `null` (nunca un 0 inventado);
 *  - SIN N+1: las referencias se traen en UN solo lote (`getReferencesBatch` llamado 1 vez).
 */

function buildPrisma(over: any = {}) {
  return {
    cardSet: { findMany: jest.fn(), findUnique: jest.fn() },
    card: { groupBy: jest.fn(), findMany: jest.fn() },
    inventoryItem: { groupBy: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as PrismaService;
}

function buildPricing(refs: Map<string, PriceInfo>) {
  const getReferencesBatch = jest.fn().mockResolvedValue(refs);
  return {
    pricing: {
      loadSalesRules: jest.fn().mockResolvedValue({ rules: {}, fallbackPct: 15 }),
      getReferencesBatch,
      getPricedRawFinishesBatch: jest.fn().mockResolvedValue(new Map()),
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    } as unknown as PricingService,
    getReferencesBatch,
  };
}

describe('MasterSetService.binder — marketReferenceMxnCents (P-2 ④)', () => {
  const setup = (refs: Map<string, PriceInfo>) => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 191,
    });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      // carta con precio (acabado base = normal)
      { id: 'cPriced', number: '1', numberSort: 1, numberPrefix: '', name: 'A', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
      // carta sin precio (referencia pending/ausente)
      { id: 'cPending', number: '2', numberSort: 2, numberPrefix: '', name: 'B', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal'] },
      // carta premium de una sola impresión: acabado base = holofoil
      { id: 'cHolo', number: '3', numberSort: 3, numberPrefix: '', name: 'C', rarity: 'DR', imageSmallUrl: null, availableFinishes: ['holofoil'] },
    ]);
    (prisma.inventoryItem.groupBy as jest.Mock).mockResolvedValue([]);
    const { pricing, getReferencesBatch } = buildPricing(refs);
    return { svc: new MasterSetService(prisma, pricing), prisma, getReferencesBatch };
  };

  it('celda priced → marketReferenceMxnCents = referencia MXN vigente; pending/ausente → null', async () => {
    // getReferencesBatch YA aplica liveMxnCents (FX-recompute); el mock devuelve el MXN vigente.
    const refs = new Map<string, PriceInfo>([
      ['cPriced|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 34500 }],
      // 'cPending|raw|raw:NM|normal' ausente → pending
      ['cHolo|raw|raw:NM|holofoil', { status: 'priced', referenceMxnCents: 990000 }],
    ]);
    const { svc } = setup(refs);
    const res = await svc.binder('s1');

    const priced = res.cells.find((c) => c.cardId === 'cPriced')!;
    expect(priced.marketReferenceMxnCents).toBe(34500);

    const pending = res.cells.find((c) => c.cardId === 'cPending')!;
    expect(pending.marketReferenceMxnCents).toBeNull();

    // El acabado BASE de una premium de 1 impresión es el premium (holofoil), no normal.
    const holo = res.cells.find((c) => c.cardId === 'cHolo')!;
    expect(holo.marketReferenceMxnCents).toBe(990000);
  });

  it('semántica = MERCADO CRUDO, NO precio de venta: se sirve referenceMxnCents tal cual (sin markup)', async () => {
    const refs = new Map<string, PriceInfo>([
      ['cPriced|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 10000 }],
    ]);
    const { svc } = setup(refs);
    const res = await svc.binder('s1');
    const priced = res.cells.find((c) => c.cardId === 'cPriced')!;
    // Exactamente la referencia (10000), NUNCA referencia × (1 + markup).
    expect(priced.marketReferenceMxnCents).toBe(10000);
  });

  it('SIN N+1: getReferencesBatch se invoca UNA sola vez para TODA la teja (lote)', async () => {
    const { svc, getReferencesBatch } = setup(new Map());
    await svc.binder('s1');
    expect(getReferencesBatch).toHaveBeenCalledTimes(1);
    // Y con exactamente una entrada por carta (acabado base), no una por variante.
    const arg = getReferencesBatch.mock.calls[0][0] as any[];
    expect(arg).toHaveLength(3);
    expect(arg).toEqual(
      expect.arrayContaining([
        { cardId: 'cPriced', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
        { cardId: 'cPending', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
        { cardId: 'cHolo', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' },
      ]),
    );
  });
});
