import { describe, expect, it } from 'vitest';
import {
  MEASUREMENT_QUERY_ALLOWLIST,
  isPixelSafeDocument,
  isPixelSafeUrl,
  parseFirstUtm,
  sanitizeMeasurementUrl,
  sanitizePath,
  utmFromSearch,
} from './utm';

/** C-F4 (API_CONTRACT §MKT.H.11) — el saneador de URL deja solo origen + ruta + `utm_*` válidos. */
describe('C-F4 · sanitizeMeasurementUrl', () => {
  it('ejemplo literal del contrato ⇒ ?utm_source=ig', () => {
    expect(
      sanitizeMeasurementUrl(
        'https://tcghunt.mx/es/checkout?token=x&session_id=cs_live_1&payment_intent_client_secret=y&utm_source=ig#a',
        'ga4',
      ),
    ).toBe('https://tcghunt.mx/es/checkout?utm_source=ig');
  });

  it('borra email, code, fbclid y el fragmento; conserva los cuatro utm válidos normalizados', () => {
    const out = sanitizeMeasurementUrl(
      'https://tcghunt.mx/es/catalog?email=a%40b.com&code=123&fbclid=zz&utm_source=IG&utm_medium=story&utm_campaign=cs-cdmx&utm_content=v1#x',
      'ga4',
    );
    expect(out).toBe(
      'https://tcghunt.mx/es/catalog?utm_source=ig&utm_medium=story&utm_campaign=cs-cdmx&utm_content=v1',
    );
  });

  it('un utm inválido (correo, espacios, >64) se descarta; los demás quedan', () => {
    const long = 'a'.repeat(65);
    const out = sanitizeMeasurementUrl(
      `https://tcghunt.mx/es?utm_source=juan%40correo.com&utm_medium=${long}&utm_campaign=ok&utm_content=con%20espacio`,
      'ga4',
    );
    expect(out).toBe('https://tcghunt.mx/es?utm_campaign=ok');
  });

  it('sin utm ⇒ origen + ruta, sin «?»', () => {
    expect(sanitizeMeasurementUrl('https://tcghunt.mx/es/guias/que-es-nm?token=abc', 'ga4')).toBe('https://tcghunt.mx/es/guias/que-es-nm');
  });

  it('no http(s) o basura ⇒ cadena vacía', () => {
    expect(sanitizeMeasurementUrl('javascript:alert(1)', 'ga4')).toBe('');
    expect(sanitizeMeasurementUrl('no es url', 'ga4')).toBe('');
    expect(sanitizeMeasurementUrl('', 'ga4')).toBe('');
  });

  it('utm repetido (array) se descarta, como en el backend', () => {
    expect(utmFromSearch('?utm_source=a&utm_source=b')).toEqual({});
  });

  it('sanitizePath deja solo la ruta', () => {
    expect(sanitizePath('/es/catalog/xy1-1?token=1#a')).toBe('/es/catalog/xy1-1');
    expect(sanitizePath('https://evil.example/x')).toBe('');
  });

  // v1.112.2 (D-MKT2-11, SEC-MED-1): lista blanca única por destino; `q` nunca sale.
  it('v1.112.2 · ejemplo literal: ga4 ⇒ ?utm_source=ig; pixel ⇒ ?utm_source=ig&fbclid=AbC', () => {
    const raw = 'https://tcghunt.mx/es/catalog?q=pikachu&utm_term=x&gclid=y&fbclid=AbC&utm_source=ig';
    expect(sanitizeMeasurementUrl(raw, 'ga4')).toBe('https://tcghunt.mx/es/catalog?utm_source=ig');
    expect(sanitizeMeasurementUrl(raw, 'pixel')).toBe('https://tcghunt.mx/es/catalog?utm_source=ig&fbclid=AbC');
  });

  it('v1.112.2 · q, utm_term, utm_id, gclid, _gl y el # nunca salen, en ningún destino', () => {
    const raw = 'https://tcghunt.mx/es/catalog?q=pikachu&utm_term=pikachu&utm_id=pikachu&gclid=pikachu&_gl=pikachu&otra=pikachu#pikachu';
    for (const dest of ['ga4', 'pixel'] as const) {
      expect(sanitizeMeasurementUrl(raw, dest)).toBe('https://tcghunt.mx/es/catalog');
    }
  });

  it('v1.112.2 · fbclid inválido (espacio, >255, repetido) no sale; un utm repetido tampoco', () => {
    const long = 'a'.repeat(256);
    expect(sanitizeMeasurementUrl('https://tcghunt.mx/es?fbclid=a%20b', 'pixel')).toBe('https://tcghunt.mx/es');
    expect(sanitizeMeasurementUrl(`https://tcghunt.mx/es?fbclid=${long}`, 'pixel')).toBe('https://tcghunt.mx/es');
    expect(sanitizeMeasurementUrl('https://tcghunt.mx/es?fbclid=a&fbclid=b', 'pixel')).toBe('https://tcghunt.mx/es');
    expect(sanitizeMeasurementUrl('https://tcghunt.mx/es?utm_source=a&utm_source=b', 'ga4')).toBe('https://tcghunt.mx/es');
  });

  it('v1.112.2 · MEASUREMENT_QUERY_ALLOWLIST es exactamente la del contrato (fuente única)', () => {
    const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
    expect(Object.keys(MEASUREMENT_QUERY_ALLOWLIST.ga4)).toEqual(utm);
    expect(Object.keys(MEASUREMENT_QUERY_ALLOWLIST.pixel)).toEqual([...utm, 'fbclid']);
    for (const dest of ['ga4', 'pixel'] as const) {
      for (const k of ['q', 'utm_term', 'utm_id', 'gclid', '_gl']) expect(Object.keys(MEASUREMENT_QUERY_ALLOWLIST[dest])).not.toContain(k);
    }
  });

  it('parseFirstUtm es espejo de backend/src/common/first-utm.ts (mismas claves, misma regex)', () => {
    expect(parseFirstUtm({ utm_source: 'IG', utm_medium: '<script>', other: 'x', utm_campaign: 3 })).toEqual({ source: 'ig' });
  });
});

/** C-F4 (v1.112.2) — ¿puede el píxel ver esta URL tal cual? */
describe('C-F4 · isPixelSafeUrl / isPixelSafeDocument', () => {
  it('falso con q, con #a, con clave repetida o con utm_source=a b', () => {
    expect(isPixelSafeUrl('https://tcghunt.mx/es/catalog?q=pikachu')).toBe(false);
    expect(isPixelSafeUrl('https://tcghunt.mx/es/catalog#a')).toBe(false);
    expect(isPixelSafeUrl('https://tcghunt.mx/es/catalog?utm_source=ig#a')).toBe(false);
    expect(isPixelSafeUrl('https://tcghunt.mx/es?utm_source=ig&utm_source=fb')).toBe(false);
    expect(isPixelSafeUrl('https://tcghunt.mx/es?utm_source=a%20b')).toBe(false);
    expect(isPixelSafeUrl('https://tcghunt.mx/es?utm_source=a b')).toBe(false);
    for (const k of ['utm_term', 'utm_id', 'gclid', '_gl', 'token']) expect(isPixelSafeUrl(`https://tcghunt.mx/es?${k}=x`), k).toBe(false);
  });

  it('verdadero con solo utm_* válidos y fbclid, o sin query', () => {
    expect(isPixelSafeUrl('https://tcghunt.mx/es/catalog')).toBe(true);
    expect(isPixelSafeUrl('https://tcghunt.mx/es?utm_source=ig&utm_medium=story&utm_campaign=cs-cdmx&utm_content=v1&fbclid=AbC_1-2')).toBe(true);
  });

  it('no http(s) o vacío ⇒ falso', () => {
    expect(isPixelSafeUrl('')).toBe(false);
    expect(isPixelSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('referente de NUESTRO origen con q ⇒ el documento no es apto; de otro origen no cuenta', () => {
    const here = 'https://tcghunt.mx/es/catalog/xy1-1';
    expect(isPixelSafeDocument(here, '')).toBe(true);
    expect(isPixelSafeDocument(here, 'https://tcghunt.mx/es/catalog?q=pikachu')).toBe(false);
    expect(isPixelSafeDocument(here, 'https://www.google.com/search?q=pikachu')).toBe(true);
    expect(isPixelSafeDocument(here, 'https://tcghunt.mx/es?utm_source=ig')).toBe(true);
    expect(isPixelSafeDocument('https://tcghunt.mx/es/catalog?q=pikachu', '')).toBe(false);
  });
});
