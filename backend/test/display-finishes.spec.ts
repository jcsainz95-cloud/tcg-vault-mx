import { Finish } from '@prisma/client';
import { computeDisplayFinishes } from '../src/common/card-order';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.22-2 / N-15 (ARCHITECTURE §4.22a-6) — `displayFinishes`: supresión del acabado ESPURIO en
 * cartas premium de una sola impresión (DISPLAY-only). Verifica la función pura compartida y su
 * proyección a `MasterSetVariantDTO.displayed`. Invariantes duras: `displayFinishes ⊆
 * availableFinishes`, NUNCA vacío (≥1), orden `FINISH_ORDER`; SOLO RESTA, jamás AÑADE. La whitelist
 * SEC-A1 `availableFinishes` y la completitud X/Y (sobre availableFinishes) NO cambian.
 */

describe('computeDisplayFinishes (§4.22a-6) — función pura money-safe', () => {
  it('ex/full-art: normal (market null) + holofoil (market>0) → oculta la normal ESPURIA', () => {
    // availableFinishes conserva AMBOS (whitelist SEC-A1 intacta); solo holofoil tiene precio>0.
    const available: Finish[] = ['normal', 'holofoil'];
    const priced: Finish[] = ['holofoil'];
    const display = computeDisplayFinishes('Illustration Rare', available, priced);
    expect(display).toEqual(['holofoil']);
    // Invariante: subconjunto de availableFinishes (que NO se toca).
    expect(display.every((f) => available.includes(f))).toBe(true);
  });

  it('common: normal(>0) + reverse_holo(>0) → SIN supresión (no es premium) == availableFinishes', () => {
    const available: Finish[] = ['normal', 'reverse_holo'];
    const priced: Finish[] = ['normal', 'reverse_holo'];
    expect(computeDisplayFinishes('Common', available, priced)).toEqual(['normal', 'reverse_holo']);
  });

  it('premium con TODOS los acabados SIN precio (pricedFinishes=∅) → salvaguarda anti-cero-casillas', () => {
    const available: Finish[] = ['normal', 'holofoil'];
    // Ningún acabado priceado → NO se suprime (una premium totalmente pendiente no queda sin casillas).
    expect(computeDisplayFinishes('Ultra Rare', available, [])).toEqual(['normal', 'holofoil']);
  });

  it('rareza null → isPremiumRarity(null)=false → SIN supresión = availableFinishes', () => {
    const available: Finish[] = ['normal', 'holofoil'];
    expect(computeDisplayFinishes(null, available, ['holofoil'])).toEqual(['normal', 'holofoil']);
  });

  it('orden FINISH_ORDER: reordena a canónico aunque priced venga desordenado', () => {
    const available: Finish[] = ['normal', 'reverse_holo', 'holofoil'];
    // Illustration Rare (premium) con 2 impresiones reales priceadas, en desorden.
    const display = computeDisplayFinishes('Illustration Rare', available, ['holofoil', 'normal']);
    expect(display).toEqual(['normal', 'holofoil']); // canónico, sin reverse_holo (sin precio)
  });

  it('SOLO RESTA, jamás AÑADE: un finish priceado FUERA de availableFinishes NO aparece', () => {
    const available: Finish[] = ['holofoil'];
    // priced trae 'normal' (drift), pero no está en la whitelist → no puede añadirse.
    const display = computeDisplayFinishes('Secret Rare', available, ['normal', 'holofoil']);
    expect(display).toEqual(['holofoil']);
    expect(display).not.toContain('normal');
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
    loadSalesRules: jest.fn().mockResolvedValue({ rules: {}, fallbackPct: 15 }),
    getReferencesBatch: jest.fn().mockResolvedValue(new Map()),
    getPricedRawFinishesBatch: jest.fn().mockResolvedValue(pricedByCard),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
  } as unknown as PricingService;
}

describe('MasterSetService.binder — displayFinishes + MasterSetVariantDTO.displayed (§4.22a-6/N-16)', () => {
  it('premium 1-impresión: normal espuria displayed=false, holofoil displayed=true; X/Y intacto', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Set', series: 'SV', releaseDate: '2024/11/08', printedTotal: 100,
    });
    // Carta premium (Illustration Rare) con availableFinishes = [normal, holofoil] (whitelist intacta).
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'cx', number: '5', numberSort: 5, numberPrefix: '', name: 'Chase', rarity: 'Illustration Rare', imageSmallUrl: null, availableFinishes: ['normal', 'holofoil'] },
    ]);
    // Solo holofoil está priceada (market>0); la normal es espuria (pendiente).
    const priced = new Map<string, Set<Finish>>([['cx', new Set<Finish>(['holofoil'])]]);

    const svc = new MasterSetService(prisma, buildPricing(priced));
    const res = await svc.binder('s1');
    const cell = res.cells.find((c) => c.cardId === 'cx')!;

    // availableFinishes NO cambia (whitelist SEC-A1); displayFinishes oculta la normal espuria.
    expect(cell.availableFinishes).toEqual(['normal', 'holofoil']);
    expect(cell.displayFinishes).toEqual(['holofoil']);

    // La completitud X/Y sigue contando sobre availableFinishes (universo = 2 variantes), sin cambio.
    expect(cell.expectedVariantCount).toBe(2);
    const vNormal = cell.variants.find((v) => v.finish === 'normal')!;
    const vHolo = cell.variants.find((v) => v.finish === 'holofoil')!;
    // `variants` conserva UNA entrada por acabado de availableFinishes (universo intacto)…
    expect(cell.variants.map((v) => v.finish)).toEqual(['normal', 'holofoil']);
    // …pero `displayed` marca cuál PINTA el front: la normal espuria NO se pinta.
    expect(vNormal.displayed).toBe(false);
    expect(vHolo.displayed).toBe(true);
  });

  it('common: sin supresión → displayFinishes = availableFinishes, todo displayed=true', async () => {
    const prisma = buildPrisma();
    (prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({
      id: 's1', name: 'Set', printedTotal: 100,
    });
    (prisma.card.findMany as jest.Mock).mockResolvedValue([
      { id: 'cc', number: '1', numberSort: 1, numberPrefix: '', name: 'Bulk', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
    ]);
    // Aunque holofoil no esté priceado, Common no es premium → nunca se suprime.
    const priced = new Map<string, Set<Finish>>([['cc', new Set<Finish>(['normal'])]]);

    const svc = new MasterSetService(prisma, buildPricing(priced));
    const res = await svc.binder('s1');
    const cell = res.cells.find((c) => c.cardId === 'cc')!;

    expect(cell.displayFinishes).toEqual(['normal', 'reverse_holo']);
    expect(cell.variants.every((v) => v.displayed)).toBe(true);
  });
});
