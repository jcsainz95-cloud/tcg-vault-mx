import {
  SEALED_SPREAD_PCT_MAX,
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  validateSealedSpreads,
  validateSealedSpreadFallback,
} from '../src/modules/settings/settings.constants';
import { SEALED_SUBTYPE_VALUES } from '../src/common/enum-values';

/**
 * v1.23-sealed-sales (§4.23c/§M10) — diales del sellado: seeds confirmados por el PO, validadores de
 * los spreads (subtype ∈ `SealedSubtype`, value/fallback en `[0, SEALED_SPREAD_PCT_MAX]`) y exposición
 * en el DTO de M10 (los FLAGS sí; los SPREADS no — se editan por endpoints M2 dedicados).
 *
 * ⚠️ v2.1.9 — este docstring decía `{box,etb,bundle,tin,blister}`: **cinco** de los siete. Mismo
 * residuo textual que el de `pricing.controller.ts`, y de la misma familia que el ejemplo del contrato
 * que el arquitecto corrigió en D3: **un dominio de llaves no se enumera a mano en prosa**, porque se
 * copia con la misma confianza que una declaración.
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
  it('seed de spreads = confirmado por el PO, con `upc`/`collection` elegidos por el dueño (v2.1.9)', () => {
    expect(SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE]).toEqual({
      box: 18,
      etb: 22,
      bundle: 25,
      tin: 30,
      blister: 35,
      // El dueño VENDE UPC y eligió los dos valores. Criterio de la tabla: ítem más chico ⇒ % mayor.
      // Un UPC es la pieza más grande y cara ⇒ va con box; una collection es comparable a un ETB.
      upc: 18,
      collection: 22,
    });
    expect(SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_FALLBACK_PCT]).toBe(25);
  });

  /**
   * v2.1.9 — **el seed cubre los SIETE subtipos, y eso está fijado.**
   *
   * `upc` y `collection` no tenían semilla, así que caían al `fallbackPct: 25` — un número que **nadie
   * eligió** para la pieza más grande y cara del catálogo. Ése fue el síntoma que destapó todo el hilo
   * del enum en v2.1.8: el enum corto hacía que el `PUT` las rechazara con 422, así que el dueño **no
   * podía** calibrarlas ni a mano; con el enum ya arreglado, seguían sin semilla.
   *
   * Este test es un **ancla**, del mismo tipo que las de `enum-values-parity.spec.ts`: cuando el schema
   * gane un octavo subtipo, rompe aquí y obliga a **elegir su spread a propósito** en vez de dejarlo
   * caer al fallback global en silencio. El fallback existe para el hueco, no para ser el único camino
   * de una presentación real que sí vendemos.
   */
  it('ANCLA — el seed tiene una entrada por CADA `SealedSubtype` (un subtipo nuevo rompe aquí)', () => {
    const seed = SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE] as Record<string, number>;
    expect(Object.keys(seed).sort()).toEqual([...SEALED_SUBTYPE_VALUES].sort());
    // Y cada valor es sembrable por el mismo validador que gobierna el PUT (no un número suelto).
    expect(validateSealedSpreads(seed)).toBeNull();
    for (const v of Object.values(seed)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(SEALED_SPREAD_PCT_MAX);
    }
  });

  it('el seed respeta el criterio «ítem más chico ⇒ % mayor» que la tabla ya usaba', () => {
    // No es decoración: es lo que hace defendible el `18` del UPC. Si alguien mueve un valor sin mover
    // el criterio, esto lo señala en el punto exacto.
    const seed = SETTING_DEFAULTS[SettingKey.SEALED_SPREAD_PCT_BY_SUBTYPE] as Record<string, number>;
    expect(seed.box).toBeLessThan(seed.etb);
    expect(seed.etb).toBeLessThan(seed.bundle);
    expect(seed.bundle).toBeLessThan(seed.tin);
    expect(seed.tin).toBeLessThan(seed.blister);
    // Las dos nuevas se anclan a su comparable, no a un número inventado.
    expect(seed.upc).toBe(seed.box);
    expect(seed.collection).toBe(seed.etb);
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
