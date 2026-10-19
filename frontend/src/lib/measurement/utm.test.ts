import { describe, expect, it } from 'vitest';
import { parseFirstUtm, sanitizeMeasurementUrl, sanitizePath, utmFromSearch } from './utm';

/** C-F4 (API_CONTRACT §MKT.H.11) — el saneador de URL deja solo origen + ruta + `utm_*` válidos. */
describe('C-F4 · sanitizeMeasurementUrl', () => {
  it('ejemplo literal del contrato ⇒ ?utm_source=ig', () => {
    expect(
      sanitizeMeasurementUrl(
        'https://tcghunt.mx/es/checkout?token=x&session_id=cs_live_1&payment_intent_client_secret=y&utm_source=ig#a',
      ),
    ).toBe('https://tcghunt.mx/es/checkout?utm_source=ig');
  });

  it('borra email, code, fbclid y el fragmento; conserva los cuatro utm válidos normalizados', () => {
    const out = sanitizeMeasurementUrl(
      'https://tcghunt.mx/es/catalog?email=a%40b.com&code=123&fbclid=zz&utm_source=IG&utm_medium=story&utm_campaign=cs-cdmx&utm_content=v1#x',
    );
    expect(out).toBe(
      'https://tcghunt.mx/es/catalog?utm_source=ig&utm_medium=story&utm_campaign=cs-cdmx&utm_content=v1',
    );
  });

  it('un utm inválido (correo, espacios, >64) se descarta; los demás quedan', () => {
    const long = 'a'.repeat(65);
    const out = sanitizeMeasurementUrl(
      `https://tcghunt.mx/es?utm_source=juan%40correo.com&utm_medium=${long}&utm_campaign=ok&utm_content=con%20espacio`,
    );
    expect(out).toBe('https://tcghunt.mx/es?utm_campaign=ok');
  });

  it('sin utm ⇒ origen + ruta, sin «?»', () => {
    expect(sanitizeMeasurementUrl('https://tcghunt.mx/es/guias/que-es-nm?token=abc')).toBe('https://tcghunt.mx/es/guias/que-es-nm');
  });

  it('no http(s) o basura ⇒ cadena vacía', () => {
    expect(sanitizeMeasurementUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeMeasurementUrl('no es url')).toBe('');
    expect(sanitizeMeasurementUrl('')).toBe('');
  });

  it('utm repetido (array) se descarta, como en el backend', () => {
    expect(utmFromSearch('?utm_source=a&utm_source=b')).toEqual({});
  });

  it('sanitizePath deja solo la ruta', () => {
    expect(sanitizePath('/es/catalog/xy1-1?token=1#a')).toBe('/es/catalog/xy1-1');
    expect(sanitizePath('https://evil.example/x')).toBe('');
  });

  it('parseFirstUtm es espejo de backend/src/common/first-utm.ts (mismas claves, misma regex)', () => {
    expect(parseFirstUtm({ utm_source: 'IG', utm_medium: '<script>', other: 'x', utm_campaign: 3 })).toEqual({ source: 'ig' });
  });
});
