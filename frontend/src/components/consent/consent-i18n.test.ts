import { describe, expect, it } from 'vitest';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';
import { flatten } from '@/lib/i18n-p66-3.testkit';

/** C-F15 (DESIGN_SYSTEM MKT2-UX.15) — claves `consent.*`: paridad ES/EN y nada que ensucie C-F1. */
describe('C-F15 · consent.* i18n', () => {
  const esKeys = flatten((es as Record<string, unknown>).consent);
  const enKeys = flatten((en as Record<string, unknown>).consent);

  it('mismas claves en ES y EN, ninguna vacía', () => {
    expect(Object.keys(esKeys).sort()).toEqual(Object.keys(enKeys).sort());
    for (const v of [...Object.values(esKeys), ...Object.values(enKeys)]) expect(v.trim()).not.toBe('');
  });

  it('textos literales de MKT2-UX.11 (ES)', () => {
    expect(esKeys.accept).toBe('Aceptar');
    expect(esKeys.necessary).toBe('Solo lo necesario');
    expect(esKeys.customize).toBe('Configurar');
    expect(esKeys.saved).toBe('Tu elección se guardó.');
    expect(esKeys.footerLink).toBe('Preferencias de cookies');
    expect(esKeys['layer.save']).toBe('Guardar mi elección');
  });

  it('ninguna cadena nombra hosts de etiquetas ni códigos internos (P66-3, CK-4)', () => {
    const banned = /googletagmanager|google-analytics|connect\.facebook|fbevents|gtag\/js|LFPDPPP|Consent Mode|th_consent|\bGA4\b|\bCAPI\b|píxel|pixel|\bARCO\b/i;
    for (const [k, v] of [...Object.entries(esKeys), ...Object.entries(enKeys)]) {
      expect(v, k).not.toMatch(banned);
    }
  });

  it('«Aviso de privacidad» no tiene clave propia aquí (usa privacy.link, §80.0.5)', () => {
    expect(Object.keys(esKeys).some((k) => /privacy|link$/i.test(k) && k !== 'footerLink')).toBe(false);
  });
});
