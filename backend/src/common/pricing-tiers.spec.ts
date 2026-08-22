import {
  PRICING_TIERS,
  TIER_IDS,
  TierId,
  isTierId,
  getTier,
} from './pricing-tiers';
import {
  buildEffectiveRuleSet,
  isTieredRuleSet,
  toPriceRuleSet,
  TieredRuleSet,
  BuylistRule,
  quoteAcquisitionForFinish,
} from './money';
import { normalizeRarity, isPremiumCanonicalRarity } from './rarity-catalog';

/**
 * v1.37 (§4.33, P-34) — pricing por TIERS. Cubre: taxonomía LOCKED; `buildEffectiveRuleSet` reproduce el
 * comportamiento previo SALVO T2 (§4.33f); compat on-read de AMBOS shapes; las nuevas canónicas premium
 * (Mega Rare/Black White Rare/Mega Hyper Rare) cotizan por su propia regla, no al bin de bulk (fix de dinero).
 */

// Seed de reglas de COMPRA por tier (§4.33e): T0/T1 fijos, T2 pct 25 (CAMBIO LOCKED), T3/T4 pct 40.
const BUY_TIERED: TieredRuleSet<BuylistRule> = {
  tierRules: {
    T0: { mode: 'fixed', value: 50 },
    T1: { mode: 'fixed', value: 150 },
    T2: { mode: 'pct', value: 25 },
    T3: { mode: 'pct', value: 40 },
    T4: { mode: 'pct', value: 40 },
  },
  finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
  fallbackPct: 40,
};

const SEED_TIER_MAP: Record<string, TierId> = {
  Common: 'T0',
  Uncommon: 'T1',
  'Reverse Holo': 'T1',
  Rare: 'T2',
  'Rare Holo': 'T2',
  'Illustration Rare': 'T3',
  'Ultra Rare': 'T3',
  'Mega Rare': 'T3',
  'Black White Rare': 'T3',
  'Hyper Rare': 'T4',
  'Secret Rare': 'T4',
};

describe('PRICING_TIERS — taxonomía LOCKED (§4.33a)', () => {
  it('son 5 tiers T0–T4 con la banda premium correcta (T0/T1/T2 no; T3/T4 sí)', () => {
    expect(TIER_IDS).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
    expect(PRICING_TIERS.map((t) => t.premium)).toEqual([false, false, false, true, true]);
    expect(getTier('T3')?.name).toBe('Premium / Chase');
  });

  it('isTierId distingue ids válidos de basura', () => {
    expect(isTierId('T0')).toBe(true);
    expect(isTierId('T5')).toBe(false);
    expect(isTierId('t0')).toBe(false);
    expect(isTierId(null)).toBe(false);
  });
});

describe('buildEffectiveRuleSet — deriva rarityRules[canonical] = tierRules[map[canonical]] (§4.33c)', () => {
  it('cada rareza mapeada hereda la regla de su tier; finishRules/fallback pasan verbatim', () => {
    const eff = buildEffectiveRuleSet(BUY_TIERED, SEED_TIER_MAP);
    expect(eff.rarityRules['Common']).toEqual({ mode: 'fixed', value: 50 });
    expect(eff.rarityRules['Rare']).toEqual({ mode: 'pct', value: 25 }); // T2
    expect(eff.rarityRules['Illustration Rare']).toEqual({ mode: 'pct', value: 40 }); // T3
    expect(eff.rarityRules['Hyper Rare']).toEqual({ mode: 'pct', value: 40 }); // T4
    expect(eff.finishRules).toEqual({ reverse_holo: { mode: 'fixed', value: 150 } });
    expect(eff.fallbackPct).toBe(40);
  });

  it('rareza AUSENTE del mapa → sin entrada en rarityRules ⇒ cae al fallback pct (money-safe, nunca $0)', () => {
    const eff = buildEffectiveRuleSet(BUY_TIERED, { Common: 'T0' });
    expect(eff.rarityRules['Some New Rarity']).toBeUndefined();
    const q = quoteAcquisitionForFinish('Some New Rarity', 'normal', 10000, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBe(4000); // 40% de 10000, NO $0
    expect(q.ruleSource).toBe('fallback');
  });
});

describe('reproduce el comportamiento previo SALVO T2 (§4.33f)', () => {
  const eff = buildEffectiveRuleSet(BUY_TIERED, SEED_TIER_MAP);
  const MARKET = 20000; // MX$200

  it('Common (T0) → fixed $0.50 idéntico a hoy', () => {
    const q = quoteAcquisitionForFinish('Common', 'normal', MARKET, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBe(50);
  });

  it('premium T3 (Illustration/Ultra) → pct 40 = idéntico al fallback 40 de hoy', () => {
    const q = quoteAcquisitionForFinish('Ultra Rare', 'normal', MARKET, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBe(8000); // 40% de 20000
  });

  it('T2 (Rare/Rare Holo) → pct 25 (CAMBIO LOCKED, antes fallback 40)', () => {
    const q = quoteAcquisitionForFinish('Rare', 'normal', MARKET, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBe(5000); // 25% de 20000 (antes hubiera sido 8000 = 40%)
  });

  it('T2 sin market ⇒ precio pendiente, NUNCA $0', () => {
    const q = quoteAcquisitionForFinish('Rare Holo', 'normal', null, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBeNull();
    expect(q.status).toBe('precio_pendiente');
  });
});

describe('compat on-read de AMBOS shapes (§4.33c)', () => {
  it('isTieredRuleSet distingue el shape por tiers del PriceRuleSet legacy', () => {
    expect(isTieredRuleSet(BUY_TIERED)).toBe(true);
    expect(isTieredRuleSet({ rarityRules: {}, finishRules: {} })).toBe(false);
    expect(isTieredRuleSet({ Common: { mode: 'fixed', value: 50 } })).toBe(false);
  });

  it('toPriceRuleSet(tiered, fb, tierMap) DERIVA el efectivo', () => {
    const eff = toPriceRuleSet<BuylistRule>(BUY_TIERED, 40, SEED_TIER_MAP);
    expect(eff.rarityRules['Rare']).toEqual({ mode: 'pct', value: 25 });
  });

  it('toPriceRuleSet(tiered) SIN tierMap → rarityRules vacío ⇒ todo al fallback (money-safe, nunca $0)', () => {
    const eff = toPriceRuleSet<BuylistRule>(BUY_TIERED, 40);
    expect(eff.rarityRules).toEqual({});
    expect(eff.finishRules).toEqual({ reverse_holo: { mode: 'fixed', value: 150 } });
    const q = quoteAcquisitionForFinish('Rare', 'normal', 20000, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBe(8000); // 40% fallback, no $0
  });

  it('toPriceRuleSet(legacy { rarityRules, finishRules }) IGNORA el tierMap (comportamiento §4.28d)', () => {
    const legacy = {
      rarityRules: { Common: { mode: 'fixed', value: 50 } },
      finishRules: { reverse_holo: { mode: 'fixed', value: 150 } },
    };
    const eff = toPriceRuleSet<BuylistRule>(legacy, 40, SEED_TIER_MAP);
    expect(eff.rarityRules).toEqual({ Common: { mode: 'fixed', value: 50 } });
  });

  it('toPriceRuleSet(mapa PLANO legacy) parte Holo/Reverse a finishRules como antes', () => {
    const flat = { Common: { mode: 'fixed', value: 50 }, 'Reverse Holo': { mode: 'fixed', value: 150 } };
    const eff = toPriceRuleSet<BuylistRule>(flat, 40, SEED_TIER_MAP);
    expect(eff.rarityRules).toEqual({ Common: { mode: 'fixed', value: 50 } });
    expect(eff.finishRules).toEqual({ reverse_holo: { mode: 'fixed', value: 150 } });
  });
});

describe('las nuevas canónicas premium cotizan por su regla, no al bin de bulk (fix de dinero §4.33e/f)', () => {
  it('normalizeRarity colapsa las 3 rarezas crudas a su canónica premium', () => {
    expect(normalizeRarity('MEGA_ATTACK_RARE')).toBe('Mega Rare');
    expect(normalizeRarity('Black White Rare')).toBe('Black White Rare');
    expect(normalizeRarity('Mega Hyper Rare')).toBe('Hyper Rare');
    expect(isPremiumCanonicalRarity('MEGA_ATTACK_RARE')).toBe(true);
    expect(isPremiumCanonicalRarity('Black White Rare')).toBe(true);
    expect(isPremiumCanonicalRarity('Mega Hyper Rare')).toBe(true);
  });

  it('MEGA_ATTACK_RARE en finish holofoil resuelve por su tier (pct 40), NO al bin holofoil de bulk', () => {
    // Efectivo con un bin holofoil BARATO de bulk (fixed 100) que una premium JAMÁS debe tocar.
    const eff = buildEffectiveRuleSet(
      {
        tierRules: BUY_TIERED.tierRules,
        finishRules: { holofoil: { mode: 'fixed', value: 100 } },
        fallbackPct: 40,
      },
      SEED_TIER_MAP,
    );
    const q = quoteAcquisitionForFinish('MEGA_ATTACK_RARE', 'holofoil', 50000, eff, eff.fallbackPct);
    // Gate premium (§4.2.1): usa la regla de RAREZA (Mega Rare → T3 pct 40), no el bin fijo $1.00.
    expect(q.quotedPriceCents).toBe(20000); // 40% de 50000, NO 100
  });

  it('Mega Hyper Rare (alias → Hyper Rare → T4) cotiza como premium por % de mercado', () => {
    const eff = buildEffectiveRuleSet(BUY_TIERED, SEED_TIER_MAP);
    const q = quoteAcquisitionForFinish('Mega Hyper Rare', 'normal', 50000, eff, eff.fallbackPct);
    expect(q.quotedPriceCents).toBe(20000); // T4 pct 40
  });
});
