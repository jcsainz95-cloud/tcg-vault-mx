import {
  SettingKey,
  SETTING_DEFAULTS,
  SETTING_VALIDATORS,
  SETTING_DTO_MAP,
  validateSalesRules,
  validateSalesFallbackPct,
  isValidSalesRule,
  SALES_PCT_MAX,
} from '../src/modules/settings/settings.constants';

/**
 * v1.13-sales-pricing (§4.14a) — seed y validadores de las reglas de VENTA por rareza.
 */
describe('sales pricing settings — seed (§4.14a)', () => {
  it('v1.29 (§4.28d): SALES_PRICE_RULES siembra en DOS EJES (Common/Uncommon por rareza; Holo/Reverse por acabado)', () => {
    expect(SETTING_DEFAULTS[SettingKey.SALES_PRICE_RULES]).toEqual({
      rarityRules: {
        Common: { mode: 'fixed', value: 500 },
        Uncommon: { mode: 'fixed', value: 1000 },
      },
      finishRules: {
        holofoil: { mode: 'fixed', value: 1000 },
        reverse_holo: { mode: 'fixed', value: 1000 },
      },
    });
  });

  it('SALES_PRICE_FALLBACK_PCT = 15 (iguala el SALES_MARKUP_PCT legacy → preserva la venta actual)', () => {
    expect(SETTING_DEFAULTS[SettingKey.SALES_PRICE_FALLBACK_PCT]).toBe(15);
  });

  it('SALES_MARKUP_PCT (legacy) se conserva como palanca de rollback', () => {
    expect(SETTING_DEFAULTS[SettingKey.SALES_MARKUP_PCT]).toBe(15);
  });

  it('los validadores están registrados para ambas keys', () => {
    expect(SETTING_VALIDATORS[SettingKey.SALES_PRICE_RULES]).toBe(validateSalesRules);
    expect(SETTING_VALIDATORS[SettingKey.SALES_PRICE_FALLBACK_PCT]).toBe(validateSalesFallbackPct);
  });

  it('NO se exponen en SETTING_DTO_MAP (se editan por endpoints M2 dedicados, no por PUT /admin/settings)', () => {
    const mapped = Object.values(SETTING_DTO_MAP);
    expect(mapped).not.toContain(SettingKey.SALES_PRICE_RULES);
    expect(mapped).not.toContain(SettingKey.SALES_PRICE_FALLBACK_PCT);
  });
});

describe('sales pricing settings — validadores (§4.14a)', () => {
  it('isValidSalesRule: fixed → entero ≥ 0', () => {
    expect(isValidSalesRule({ mode: 'fixed', value: 0 })).toBe(true);
    expect(isValidSalesRule({ mode: 'fixed', value: 500 })).toBe(true);
    expect(isValidSalesRule({ mode: 'fixed', value: -1 })).toBe(false);
    expect(isValidSalesRule({ mode: 'fixed', value: 1.5 })).toBe(false);
  });

  it('isValidSalesRule: pct en [0, 1000] (markup arriba de mercado, admite >100%)', () => {
    expect(isValidSalesRule({ mode: 'pct', value: 0 })).toBe(true);
    expect(isValidSalesRule({ mode: 'pct', value: 300 })).toBe(true); // >100% OK en venta
    expect(isValidSalesRule({ mode: 'pct', value: SALES_PCT_MAX })).toBe(true);
    expect(isValidSalesRule({ mode: 'pct', value: SALES_PCT_MAX + 1 })).toBe(false);
    expect(isValidSalesRule({ mode: 'pct', value: -1 })).toBe(false);
  });

  it('isValidSalesRule: modo desconocido / no-objeto → false', () => {
    expect(isValidSalesRule({ mode: 'percent', value: 10 })).toBe(false);
    expect(isValidSalesRule(null)).toBe(false);
    expect(isValidSalesRule([])).toBe(false);
  });

  it('SALES_PCT_MAX = 1000 (más permisivo que buylist [0,100])', () => {
    expect(SALES_PCT_MAX).toBe(1000);
  });

  it('validateSalesRules acepta el mapa seed y rechaza mapas inválidos', () => {
    expect(validateSalesRules(SETTING_DEFAULTS[SettingKey.SALES_PRICE_RULES])).toBeNull();
    expect(validateSalesRules({ X: { mode: 'pct', value: 1001 } })).not.toBeNull();
    expect(validateSalesRules([])).not.toBeNull();
  });

  it('validateSalesFallbackPct: número en [0, 1000]', () => {
    expect(validateSalesFallbackPct(15)).toBeNull();
    expect(validateSalesFallbackPct(1000)).toBeNull();
    expect(validateSalesFallbackPct(1001)).not.toBeNull();
    expect(validateSalesFallbackPct(-1)).not.toBeNull();
    expect(validateSalesFallbackPct('x')).not.toBeNull();
  });
});
