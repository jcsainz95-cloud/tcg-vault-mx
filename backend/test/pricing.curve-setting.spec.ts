import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  validatePricingCurveSetting,
} from '../src/modules/settings/settings.constants';
import { DEFAULT_PRICING_CURVE, PricingCurve, validatePricingCurve } from '../src/common/pricing-curve';

/**
 * E1 (ARCHITECTURE §4.36.11) — el setting `pricing_curve`: KEY nueva, seed = diales de PROJECT §N.2
 * VERBATIM, validador de puerta cableado y los CINCO settings viejos todavía ahí, INTACTOS (§4.36.9b:
 * quedan huérfanos e inertes; no se borran en la migración a propósito, para no matar el diagnóstico
 * ni el rollback barato).
 */
function seed(): PricingCurve {
  return JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
}

describe('E1 — SettingKey.PRICING_CURVE (§4.36.2)', () => {
  it('la key de BD es `pricing_curve`', () => {
    expect(SettingKey.PRICING_CURVE).toBe('pricing_curve');
  });

  it('el SEED son los diales de PROJECT §N.2 VERBATIM (piso $25 · 1.60x→1.15x · bin $1 · 30/40/50 % · $5/$10/$25)', () => {
    expect(SETTING_DEFAULTS[SettingKey.PRICING_CURVE]).toEqual({
      version: 1,
      sale: {
        floorCents: 2500,
        points: [
          { marketCents: 2500, multiplierBp: 16000 },
          { marketCents: 8000, multiplierBp: 11500 },
        ],
        rounding: [
          { uptoCents: 20000, stepCents: 500 },
          { uptoCents: 50000, stepCents: 1000 },
          { uptoCents: null, stepCents: 2500 },
        ],
      },
      buy: {
        binCents: 100,
        points: [
          { marketCents: 2500, pctBp: 3000 },
          { marketCents: 10000, pctBp: 4000 },
          { marketCents: 50000, pctBp: 5000 },
        ],
      },
    });
  });

  it('el seed PASA sus propios invariantes V1–V8 (no se siembra una curva que el editor rechazaría)', () => {
    expect(validatePricingCurve(SETTING_DEFAULTS[SettingKey.PRICING_CURVE])).toBeNull();
  });

  it('tiene validador cableado en SETTING_VALIDATORS', () => {
    expect(SETTING_VALIDATORS[SettingKey.PRICING_CURVE]).toBe(validatePricingCurveSetting);
    expect(SETTING_VALIDATORS[SettingKey.PRICING_CURVE](SETTING_DEFAULTS[SettingKey.PRICING_CURVE])).toBeNull();
  });

  it('NO se expone en el DTO de M10: se edita SOLO por PUT /admin/pricing/curve (como los spreads del sellado)', () => {
    expect(Object.values(SETTING_DTO_MAP)).not.toContain(SettingKey.PRICING_CURVE);
  });
});

describe('E1 — el validador de puerta aplana el error estructurado sin ablandarlo', () => {
  it('un objeto válido pasa', () => {
    expect(validatePricingCurveSetting(seed())).toBeNull();
  });

  it('propaga el CÓDIGO del invariante y señala el punto infractor', () => {
    const c = seed();
    c.sale.points[1].multiplierBp = 9_000; // V4
    expect(validatePricingCurveSetting(c)).toMatch(/^SALE_BELOW_MARKET: .*\[sale\.points\[1\]\]$/);
  });

  it('rechaza curva vacía, bin sobre piso, compra sobre venta y escalera mal formada', () => {
    const empty = seed();
    empty.buy.points = [];
    expect(validatePricingCurveSetting(empty)).toMatch(/^CURVE_EMPTY:/);

    const bin = seed();
    bin.buy.binCents = 9_999;
    expect(validatePricingCurveSetting(bin)).toMatch(/^BIN_ABOVE_FLOOR:/);

    const cross = seed();
    cross.sale.points = [{ marketCents: 2500, multiplierBp: 10_000 }];
    cross.buy.points = [{ marketCents: 2500, pctBp: 10_000 }];
    expect(validatePricingCurveSetting(cross)).toMatch(/^BUY_ABOVE_SALE:/);

    const ladder = seed();
    ladder.sale.rounding[0].uptoCents = 20_300; // no es múltiplo de su paso de $5
    expect(validatePricingCurveSetting(ladder)).toMatch(/^ROUNDING_LADDER_INVALID:/);
  });

  it('rechaza basura sin explotar', () => {
    expect(validatePricingCurveSetting(null)).toMatch(/^VALIDATION_ERROR:/);
    expect(validatePricingCurveSetting('nope')).toMatch(/^VALIDATION_ERROR:/);
    expect(validatePricingCurveSetting({ version: 1 })).toMatch(/^VALIDATION_ERROR:/);
  });
});

describe('E8 — los CINCO settings retirados YA NO se leen, escriben ni siembran (§4.36.9b)', () => {
  // La MIGRACIÓN no los borra a propósito: sus filas quedan huérfanas e inertes en `ConfigSetting`
  // (precedente `rarity_map`, v1.32), porque borrar config en el mismo paso que cambia la matemática
  // elimina la vía de diagnóstico y el rollback barato. Lo que se retira es el CÓDIGO que los usaba.
  const RETIRADAS = [
    'sales_price_rules',
    'sales_price_fallback_pct',
    'buylist_price_rules',
    'buylist_price_fallback_pct',
    'pricing_tier_map',
  ] as const;

  it.each(RETIRADAS)('%s no tiene SettingKey, ni default, ni validador', (key) => {
    expect(Object.values(SettingKey)).not.toContain(key);
    expect(Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(SETTING_VALIDATORS, key)).toBe(false);
  });

  it('el seed ya NO siembra ninguna de las cinco (una BD nueva arranca solo con `pricing_curve`)', () => {
    for (const key of RETIRADAS) expect(Object.keys(SETTING_DEFAULTS)).not.toContain(key);
    expect(Object.keys(SETTING_DEFAULTS)).toContain('pricing_curve');
  });
});
