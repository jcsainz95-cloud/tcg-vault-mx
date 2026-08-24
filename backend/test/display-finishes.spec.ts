import { Finish } from '@prisma/client';
import { computeDisplayFinishes } from '../src/common/card-order';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.29 (ARCHITECTURE §4.27c) — `displayFinishes` queda DEPRECADO: como tras §4.27 ya no hay casilla
 * ESPURIA que ocultar (los productos separados no fusionan acabados en la carta de set), la regla es
 * `displayFinishes := availableFinishes` SIEMPRE (sin supresión N-15). Se conserva `computeDisplayFinishes`
 * como shim PURO (= availableFinishes) por compat de contrato hasta el retiro del campo.
 */


describe('computeDisplayFinishes (§4.27c) — shim DEPRECADO: = availableFinishes (sin supresión)', () => {
  it('premium con normal+holofoil ⇒ NO oculta nada (= availableFinishes)', () => {
    const available: Finish[] = ['normal', 'holofoil'];
    expect(computeDisplayFinishes('Illustration Rare', available, ['holofoil'])).toEqual([
      'normal',
      'holofoil',
    ]);
  });

  it('common ⇒ = availableFinishes', () => {
    const available: Finish[] = ['normal', 'reverse_holo'];
    expect(computeDisplayFinishes('Common', available, ['normal', 'reverse_holo'])).toEqual([
      'normal',
      'reverse_holo',
    ]);
  });

  it('reordena a FINISH_ORDER y deduplica', () => {
    const available: Finish[] = ['reverse_holo', 'normal', 'holofoil'];
    expect(computeDisplayFinishes('Illustration Rare', available, [])).toEqual([
      'normal',
      'reverse_holo',
      'holofoil',
    ]);
  });

  it('availableFinishes vacío/null → default seguro ["normal"], nunca vacío', () => {
    expect(computeDisplayFinishes('Common', [], [])).toEqual(['normal']);
    expect(computeDisplayFinishes(null, null, [])).toEqual(['normal']);
  });
});

function buildPrisma(over: any = {}) {
  return {
    cardSet: { findUnique: jest.fn() },
    card: { findMany: jest.fn() },
    inventoryItem: { groupBy: jest.fn().mockResolvedValue([]) },
    ...over,
  } as unknown as PrismaService;
}

function buildPricing(pricedByCard: Map<string, Set<Finish>>): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(pricedByCard),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

describe('MasterSetService.binder — displayFinishes := availableFinishes, todo displayed=true (§4.27c)', () => {
  it('premium 1-impresión: displayFinishes = availableFinishes; NO se suprime la normal (ya no hay fantasma)', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Set', series: 'SV', releaseDate: '2024/11/08', printedTotal: 100,
    });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'cx', number: '5', numberSort: 5, numberPrefix: '', name: 'Chase', rarity: 'Illustration Rare', imageSmallUrl: null, availableFinishes: ['normal', 'holofoil'] },
    ]);
    const priced = new Map<string, Set<Finish>>([['cx', new Set<Finish>(['holofoil'])]]);

    const svc = new MasterSetService(prisma, buildPricing(priced));
    const res = await svc.binder('s1');
    const cell = res.cells.find((c) => c.cardId === 'cx')!;

    expect(cell.availableFinishes).toEqual(['normal', 'holofoil']);
    expect(cell.displayFinishes).toEqual(['normal', 'holofoil']);
    expect(cell.expectedVariantCount).toBe(2);
    expect(cell.variants.every((v) => v.displayed)).toBe(true);
  });

  it('common: displayFinishes = availableFinishes, todo displayed=true', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Set', printedTotal: 100,
    });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'cc', number: '1', numberSort: 1, numberPrefix: '', name: 'Bulk', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
    ]);
    const priced = new Map<string, Set<Finish>>([['cc', new Set<Finish>(['normal'])]]);

    const svc = new MasterSetService(prisma, buildPricing(priced));
    const res = await svc.binder('s1');
    const cell = res.cells.find((c) => c.cardId === 'cc')!;

    expect(cell.displayFinishes).toEqual(['normal', 'reverse_holo']);
    expect(cell.variants.every((v) => v.displayed)).toBe(true);
  });
});
