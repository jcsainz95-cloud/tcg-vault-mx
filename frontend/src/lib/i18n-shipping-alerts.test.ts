import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { get, p66_3Offenders } from './i18n-p66-3.testkit';

/**
 * UX-SDX-44 (`DESIGN_SYSTEM §43.22.7` FS-63 y §43.22.8): las 10 claves de «Alertas de envíos» y del filtro de alertas
 * existen en ES y EN, y ninguna nombra un código de módulo, de aviso de gasto ni de correo (P66-3).
 */

export const SHIPPING_ALERT_KEYS = [
  'admin.dashboard.shippingAlerts.title',
  'admin.dashboard.shippingAlerts.alerts',
  'admin.dashboard.shippingAlerts.alertsCarrierOnly',
  'admin.dashboard.shippingAlerts.none',
  'admin.dashboard.shippingAlerts.overlap',
  'admin.dashboard.shippingAlerts.processing',
  'admin.dashboard.shippingAlerts.lowBalance',
  'admin.dashboard.shippingAlerts.seeBalance',
  'admin.m4.alertFilter',
  'admin.m4.alertFilterRemove',
] as const;

describe('UX-SDX-44 · i18n de «Alertas de envíos»', () => {
  it('las 10 claves existen en ES y EN (texto no vacío)', () => {
    for (const k of SHIPPING_ALERT_KEYS) {
      expect(typeof get(es, k) === 'string' && (get(es, k) as string).trim() !== '', `ES ${k}`).toBe(true);
      expect(typeof get(en, k) === 'string' && (get(en, k) as string).trim() !== '', `EN ${k}`).toBe(true);
    }
  });
  it('el objeto `shippingAlerts` tiene las mismas claves en ES y EN, y ninguna de más', () => {
    const esKeys = Object.keys(get(es, 'admin.dashboard.shippingAlerts') as object).sort();
    const enKeys = Object.keys(get(en, 'admin.dashboard.shippingAlerts') as object).sort();
    expect(esKeys).toEqual(enKeys);
    expect(esKeys).toEqual(SHIPPING_ALERT_KEYS.filter((k) => k.startsWith('admin.dashboard.')).map((k) => k.split('.').pop()).sort());
  });
  it('ningún texto nombra un código «M-n», «AG-n» ni «AV-n» (P66-3)', () => {
    const pick = (cat: unknown) => Object.fromEntries(SHIPPING_ALERT_KEYS.map((k) => [k, String(get(cat, k))]));
    const offenders = [...p66_3Offenders('es', pick(es)), ...p66_3Offenders('en', pick(en))];
    expect(offenders).toEqual([]);
  });
});
