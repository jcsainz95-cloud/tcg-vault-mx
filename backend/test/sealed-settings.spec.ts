import {
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  validateSealedSpreads,
  validateSealedSpreadFallback,
} from '../src/modules/settings/settings.constants';

/**
 * v1.23-sealed-sales (§4.23c/§M10) — diales del sellado: seeds confirmados por el PO, validadores de
 * los spreads (subtype ∈ {box,etb,bundle,tin,blister}, value/fallback en [0,1000]) y exposición en el
 * DTO de M10 (los FLAGS sí; los SPREADS no — se editan por endpoints M2 dedicados).
 */
describe('sealed spreads — validadores (§4.23c)', () => {
  it('acepta un mapa válido', () => {
    expect(validateSealedSpreads({ box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 })).toBeNull();
  });
  it('acepta un mapa PARCIAL (solo algunas claves)', () => {
    expect(validateSealedSpreads({ box: 0 })).toBeNull();
  });
  it('rechaza una clave que no es un SealedSubtype', () => {
    expect(validateSealedSpreads({ jumbo: 10 })).toMatch(/invalid subtype/);
  });
  it('rechaza value fuera de [0, 1000]', () => {
    expect(validateSealedSpreads({ box: 1001 })).toMatch(/\[0, 1000\]/);
    expect(validateSealedSpreads({ box: -1 })).toMatch(/\[0, 1000\]/);
  });
  it('rechaza no-objeto / array', () => {
    expect(validateSealedSpreads([])).toMatch(/object map/);
    expect(validateSealedSpreads(null)).toMatch(/object map/);
  });
  it('fallback: número en [0,1000]', () => {
    expect(validateSealedSpreadFallback(25)).toBeNull();
    expect(validateSealedSpreadFallback(1001)).toMatch(/\[0, 1000\]/);
    expect(validateSealedSpreadFallback('x')).toMatch(/\[0, 1000\]/);
  });
});

describe('sealed dials — seeds (SUP-6) y exposición en el DTO de M10', () => {
  it('seed de spreads = confirmado por el PO', () => {
    expect(SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]).toEqual({
      box: 18,
      etb: 22,
      bundle: 25,
      tin: 30,
      blister: 35,
    });
    expect(SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_FALLBACK_PCT]).toBe(25);
  });

  it('los feature flags nacen APAGADOS (seed off)', () => {
    expect(SETTING_DEFAULTS[SettingKey.SEALED_VALUE_TREND]).toBe('off');
    expect(SETTING_DEFAULTS[SettingKey.SEALED_RESTOCK_ALERTS]).toBe('off');
  });

  it('el DTO de M10 expone los FLAGS pero NO los spreads (esos van por M2)', () => {
    expect(SETTING_DTO_MAP.sealedValueTrend).toBe(SettingKey.SEALED_VALUE_TREND);
    expect(SETTING_DTO_MAP.sealedRestockAlerts).toBe(SettingKey.SEALED_RESTOCK_ALERTS);
    const exposed = Object.values(SETTING_DTO_MAP);
    expect(exposed).not.toContain(SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE);
    expect(exposed).not.toContain(SettingKey.SEALED_SPREAD_FALLBACK_PCT);
  });

  it('los flags validan on|off vía PUT /admin/settings', () => {
    const v = SETTING_VALIDATORS[SettingKey.SEALED_VALUE_TREND];
    expect(v('on')).toBeNull();
    expect(v('off')).toBeNull();
    expect(v('maybe')).toMatch(/on\|off/);
  });
});
