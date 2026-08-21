import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';

/**
 * v1.26 (P-2 ④, §M1 / §4.24d) + v1.27 (P-15, §4.25b) — PRECIO DE MERCADO en el Master Set:
 *  - v1.27: cada VARIANTE expone SU `marketReferenceMxnCents` (la `PriceReference` de ESE acabado,
 *    ya FX-recomputada a MXN por `getReferencesBatch`) + `capturedDate` (solo con precio) — Normal
 *    y Reverse dejan de mostrar el mismo número;
 *  - una variante con referencia PENDING/ausente expone `null` (nunca un 0 inventado);
 *  - el campo de CELDA queda DEPRECADO como ESPEJO de la variante del acabado base (`variants[0]`);
 *  - SIN N+1: el lote se expande a (carta × acabado del universo) pero sigue UNA llamada
 *    (`getReferencesBatch` invocado 1 vez).
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

describe('MasterSetService.binder — mercado por VARIANTE (P-15) + espejo de celda deprecado (P-2)', () => {
  const setup = (refs: Map<string, PriceInfo>) => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 191,
    });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      // carta con dos variantes (acabado base = normal)
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

  it('P-15: cada variante lleva SU precio de mercado (Normal ≠ Reverse) + capturedDate solo con precio', async () => {
    const refs = new Map<string, PriceInfo>([
      ['cPriced|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 34500, capturedDate: '2026-08-21' }],
      ['cPriced|raw|raw:NM|reverse_holo', { status: 'priced', referenceMxnCents: 78000, capturedDate: '2026-08-20' }],
      ['cHolo|raw|raw:NM|holofoil', { status: 'priced', referenceMxnCents: 990000 }],
    ]);
    const { svc } = setup(refs);
    const res = await svc.binder('s1');

    const priced = res.cells.find((c) => c.cardId === 'cPriced')!;
    const vNormal = priced.variants.find((v) => v.finish === 'normal')!;
    const vReverse = priced.variants.find((v) => v.finish === 'reverse_holo')!;
    // Cada acabado su propia referencia: Normal y Reverse YA NO muestran el mismo número (bug P-15).
    expect(vNormal.marketReferenceMxnCents).toBe(34500);
    expect(vNormal.capturedDate).toBe('2026-08-21');
    expect(vReverse.marketReferenceMxnCents).toBe(78000);
    expect(vReverse.capturedDate).toBe('2026-08-20');

    // Variante pending/ausente → null honesto y SIN capturedDate (decoración solo con precio).
    const pending = res.cells.find((c) => c.cardId === 'cPending')!;
    const vPending = pending.variants.find((v) => v.finish === 'normal')!;
    expect(vPending.marketReferenceMxnCents).toBeNull();
    expect('capturedDate' in vPending).toBe(false);

    // Premium de 1 impresión: la variante holofoil trae su referencia (sin capturedDate del batch ⇒ ausente).
    const holo = res.cells.find((c) => c.cardId === 'cHolo')!;
    expect(holo.variants[0].marketReferenceMxnCents).toBe(990000);
    expect('capturedDate' in holo.variants[0]).toBe(false);
  });

  it('P-15: el campo de CELDA (deprecado) es el ESPEJO exacto de variants[0] (acabado base)', async () => {
    const refs = new Map<string, PriceInfo>([
      ['cPriced|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 34500 }],
      ['cPriced|raw|raw:NM|reverse_holo', { status: 'priced', referenceMxnCents: 78000 }],
      ['cHolo|raw|raw:NM|holofoil', { status: 'priced', referenceMxnCents: 990000 }],
    ]);
    const { svc } = setup(refs);
    const res = await svc.binder('s1');

    const priced = res.cells.find((c) => c.cardId === 'cPriced')!;
    expect(priced.marketReferenceMxnCents).toBe(34500); // base = normal, NO el reverse
    expect(priced.marketReferenceMxnCents).toBe(priced.variants[0].marketReferenceMxnCents);

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
    expect(priced.variants[0].marketReferenceMxnCents).toBe(10000);
    expect(priced.marketReferenceMxnCents).toBe(10000);
  });

  it('SIN N+1: getReferencesBatch se invoca UNA sola vez con el lote (carta × acabado del universo)', async () => {
    const { svc, getReferencesBatch } = setup(new Map());
    await svc.binder('s1');
    expect(getReferencesBatch).toHaveBeenCalledTimes(1);
    // v1.27: una entrada por VARIANTE del universo (2 + 1 + 1 = 4), no una por carta.
    const arg = getReferencesBatch.mock.calls[0][0] as any[];
    expect(arg).toHaveLength(4);
    expect(arg).toEqual(
      expect.arrayContaining([
        { cardId: 'cPriced', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
        { cardId: 'cPriced', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo' },
        { cardId: 'cPending', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
        { cardId: 'cHolo', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' },
      ]),
    );
  });
});
