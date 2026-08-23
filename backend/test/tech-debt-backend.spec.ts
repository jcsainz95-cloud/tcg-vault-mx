import { premiumFixedOffenders, TierId } from '../src/common/pricing-tiers';
import { isPremiumCanonicalRarity } from '../src/common/rarity-catalog';
import { variantKey } from '../src/common/variant-key';
import { SETTING_DEFAULTS, SettingKey } from '../src/modules/settings/settings.constants';

/**
 * Deuda técnica backend (TECH_DEBT) — 3 guards unitarios:
 *  - P-34 H4: el seed `DEFAULT_SETTINGS` CUMPLE el invariante money-safe premium→pct
 *    (`premiumFixedOffenders(seedMap, seedBuyTiers) === []`).
 *  - P-34 H5: `premiumByPattern` (vía `isPremiumCanonicalRarity`) reconoce `mega`/`blackwhite`, cerrando
 *    la clase R-5 money-losing (una variante string premium NUEVA no-alias caería a bin holo barato).
 *  - P-30 H2: el helper único `variantKey` produce la clave K exacta (sin drift entre call-sites).
 */

// ===========================================================================
describe('P-34 H4 · el seed DEFAULT_SETTINGS cumple el invariante premium→pct (§4.33d)', () => {
  const seedMap = SETTING_DEFAULTS[SettingKey.PRICING_TIER_MAP] as Record<string, TierId>;
  const seedBuyTiers = (
    SETTING_DEFAULTS[SettingKey.BUYLIST_PRICE_RULES] as {
      tierRules: Partial<Record<TierId, { mode: string; value: number }>>;
    }
  ).tierRules;

  it('premiumFixedOffenders(seedMap, seedBuyTiers) === [] (ninguna rareza premium cae a un tier fijo)', () => {
    expect(premiumFixedOffenders(seedMap, seedBuyTiers)).toEqual([]);
  });

  it('sanity: el helper SÍ detecta un infractor si una rareza premium se mapea a un tier de COMPRA fixed', () => {
    // T0 es fixed en el seed; forzar 'Ultra Rare' (premium) → T0 debe reportarse como infractor.
    const badMap = { ...seedMap, 'Ultra Rare': 'T0' as TierId };
    expect(premiumFixedOffenders(badMap, seedBuyTiers)).toContainEqual({ rarity: 'Ultra Rare', tierId: 'T0' });
  });

  it('un tier SIN regla de compra (undefined) NO es infractor (cae al fallback pct = money-safe)', () => {
    // Sin reglas de compra: aunque haya premium mapeadas, ninguna es `fixed` ⇒ [].
    expect(premiumFixedOffenders(seedMap, {})).toEqual([]);
  });
});

// ===========================================================================
describe('P-34 H5 · premiumByPattern reconoce mega/blackwhite (clase R-5 money-losing cerrada)', () => {
  it('una variante string «Mega …» NO-alias cae a premium por PATRÓN (no al bin holo barato)', () => {
    // 'Mega Brilliant Rare' no es un alias del catálogo → resuelve por patrón → premium.
    expect(isPremiumCanonicalRarity('Mega Brilliant Rare')).toBe(true);
  });

  it('una variante string «Black White …» NO-alias cae a premium por PATRÓN', () => {
    expect(isPremiumCanonicalRarity('Black White Star Rare')).toBe(true);
  });

  it('las canónicas ya mapeadas siguen premium (consistencia): Mega Rare, Black White Rare, Mega Hyper Rare', () => {
    expect(isPremiumCanonicalRarity('Mega Rare')).toBe(true);
    expect(isPremiumCanonicalRarity('Black White Rare')).toBe(true);
    expect(isPremiumCanonicalRarity('Mega Hyper Rare')).toBe(true);
    // MEGA_ATTACK_RARE cruda (snake_case) también premium.
    expect(isPremiumCanonicalRarity('MEGA_ATTACK_RARE')).toBe(true);
  });

  it('las no-premium NO se ven afectadas por los patrones nuevos', () => {
    expect(isPremiumCanonicalRarity('Common')).toBe(false);
    expect(isPremiumCanonicalRarity('Uncommon')).toBe(false);
    expect(isPremiumCanonicalRarity('Rare')).toBe(false);
    expect(isPremiumCanonicalRarity('Rare Holo')).toBe(false);
  });
});

// ===========================================================================
describe('P-30 H2 · variantKey produce la clave K exacta (mismo string que las 3 copias previas)', () => {
  it('cardId|productType|gradeKey|finish, en ese orden y con separador «|»', () => {
    expect(
      variantKey({ cardId: 'card-1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }),
    ).toBe('card-1|raw|raw:NM|normal');
    expect(
      variantKey({ cardId: 'c2', productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'holofoil' }),
    ).toBe('c2|graded|graded:PSA:10|holofoil');
  });
});
