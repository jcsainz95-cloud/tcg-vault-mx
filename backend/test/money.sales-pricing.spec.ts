import { computeSalePriceForRarity } from '../src/common/money';

/**
 * v1.13-sales-pricing (§4.14b) — `computeSalePriceForRarity` (precio de VENTA por RAREZA).
 * Reusa `ruleKeyCandidates` (gate premium de Fase 0). Semántica del `pct` = markup ARRIBA de mercado
 * (DISTINTA a buylist, donde pct = % de la referencia).
 */
describe('computeSalePriceForRarity — venta por rareza (§4.14b)', () => {
  // Seed del ejemplo del humano (defaults confirmados).
  const RULES = {
    Common: { mode: 'fixed', value: 500 } as const,
    Uncommon: { mode: 'fixed', value: 1000 } as const,
    Holo: { mode: 'fixed', value: 1000 } as const,
    'Reverse Holo': { mode: 'fixed', value: 1000 } as const,
  };
  const FALLBACK = 15;

  describe('fixed = PISO (no depende del mercado → siempre precia)', () => {
    it('Common normal SIN market → piso $5, priced', () => {
      expect(computeSalePriceForRarity('Common', 'normal', null, RULES, FALLBACK)).toEqual({
        salePriceCents: 500,
        status: 'priced',
        appliedRule: { mode: 'fixed', value: 500 },
        ruleSource: 'rule',
      });
    });

    it('Common normal CON market ignora la referencia (piso fijo, no % arriba)', () => {
      // Aunque haya market de $200, el piso fixed manda: $5.
      expect(computeSalePriceForRarity('Common', 'normal', 20000, RULES, FALLBACK).salePriceCents).toBe(500);
    });

    it('reverse_holo → clave sintética "Reverse Holo" piso $10', () => {
      const r = computeSalePriceForRarity('Common', 'reverse_holo', null, RULES, FALLBACK);
      expect(r.salePriceCents).toBe(1000);
      expect(r.ruleSource).toBe('rule');
    });
  });

  describe('pct = MARKUP ARRIBA DE MERCADO (round(ref × (1 + value/100)))', () => {
    it('rareza sin regla → fallback 15% arriba de market', () => {
      // Illustration Rare no tiene fila → fallback pct 15 → round(100000 × 1.15) = 115000.
      expect(computeSalePriceForRarity('Illustration Rare', 'normal', 100000, RULES, FALLBACK)).toEqual({
        salePriceCents: 115000,
        status: 'priced',
        appliedRule: { mode: 'pct', value: 15 },
        ruleSource: 'fallback',
      });
    });

    it('DIVERGE de buylist: value=40 da 140% del market (no 40%)', () => {
      // round(10000 × (1 + 40/100)) = 14000 (venta). En buylist sería round(10000 × 40/100) = 4000.
      expect(
        computeSalePriceForRarity('Rare', 'normal', 10000, { Rare: { mode: 'pct', value: 40 } }, FALLBACK)
          .salePriceCents,
      ).toBe(14000);
    });

    it('pct SIN market → pending (sin precio), como el legacy', () => {
      expect(computeSalePriceForRarity('Rare', 'normal', null, {}, FALLBACK)).toEqual({
        salePriceCents: null,
        status: 'pending',
        appliedRule: { mode: 'pct', value: 15 },
        ruleSource: 'fallback',
      });
    });

    it('redondeo correcto del markup', () => {
      // round(12345 × 1.15) = round(14196.75) = 14197
      expect(
        computeSalePriceForRarity('Rare', 'normal', 12345, {}, 15).salePriceCents,
      ).toBe(14197);
    });
  });

  describe('gate premium de Fase 0 (heredado de ruleKeyCandidates)', () => {
    it('una chase (Illustration Rare) en holofoil NO cae al piso fijo "Holo" de bulk', () => {
      // Premium en holofoil → candidatos [rarity] únicamente; NUNCA "Holo". Sin regla propia →
      // fallback pct = markup sobre market, no el piso $10 de "Holo".
      const r = computeSalePriceForRarity('Illustration Rare', 'holofoil', 500000, RULES, FALLBACK);
      expect(r.ruleSource).toBe('fallback');
      expect(r.appliedRule).toEqual({ mode: 'pct', value: 15 });
      expect(r.salePriceCents).toBe(575000); // round(500000 × 1.15), NO 1000 (piso "Holo")
    });

    it('un holo de bulk ("Rare Holo") en holofoil SÍ puede usar la clave "Holo" (piso $10)', () => {
      // No premium y no tiene regla propia "Rare Holo" → candidatos [rarity, "Holo"] → hit "Holo" piso.
      const r = computeSalePriceForRarity('Rare Holo', 'holofoil', 500000, RULES, FALLBACK);
      expect(r.salePriceCents).toBe(1000);
      expect(r.ruleSource).toBe('rule');
    });

    it('la regla EXPLÍCITA de la rareza premium gana sobre el fallback', () => {
      const r = computeSalePriceForRarity(
        'Illustration Rare',
        'holofoil',
        500000,
        { ...RULES, 'Illustration Rare': { mode: 'pct', value: 200 } },
        FALLBACK,
      );
      expect(r.salePriceCents).toBe(1500000); // round(500000 × (1 + 200/100)) = 3×
      expect(r.ruleSource).toBe('rule');
    });
  });
});
