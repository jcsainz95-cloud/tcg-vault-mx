import { describe, expect, it } from 'vitest';
import { buildCsp, parseCsp } from './csp';
import { MEASUREMENT_CSP_ORIGINS, measurementCspConnectFor } from './measurement-origins.mjs';

const ENV = { apiBaseUrl: 'https://api.tcghunt.mx/api/v1', vercelEnv: 'production', nodeEnv: 'production' };

/** Lista de §MKT.H.1, copiada LITERAL del contrato: si alguien cambia la del código, esto se pone rojo. */
const CONTRACT_ORIGINS = [
  'https://www.googletagmanager.com',
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://connect.facebook.net',
  'https://www.facebook.com',
];

const MEASUREMENT_HOST_RE = /googletagmanager|google-analytics|analytics\.google|facebook|doubleclick/;

/** C-F7 (API_CONTRACT §MKT.H.11) — `buildCsp` con el modo. */
describe('C-F7 · CSP con medición', () => {
  it('la lista del código es exactamente la del contrato', () => {
    expect([...MEASUREMENT_CSP_ORIGINS]).toEqual(CONTRACT_ORIGINS);
  });

  it('off (o ausente): ningún origen de medición en ninguna directiva, aunque se pasen', () => {
    for (const env of [ENV, { ...ENV, measurementMode: 'off' as const, measurementConnect: CONTRACT_ORIGINS }]) {
      const policy = buildCsp('n0nce', env);
      expect(policy).not.toMatch(MEASUREMENT_HOST_RE);
    }
  });

  it('off: la política es idéntica a la de antes de la Fase 2', () => {
    expect(buildCsp('n0nce', { ...ENV, measurementMode: 'off', measurementConnect: CONTRACT_ORIGINS })).toBe(buildCsp('n0nce', ENV));
  });

  it('on: connect-src lleva EXACTAMENTE los de §MKT.H.1 además de lo de siempre', () => {
    const before = parseCsp(buildCsp('n0nce', ENV))['connect-src'];
    const after = parseCsp(buildCsp('n0nce', { ...ENV, measurementMode: 'on', measurementConnect: CONTRACT_ORIGINS }))['connect-src'];
    expect(after.filter((o) => !before.includes(o))).toEqual(CONTRACT_ORIGINS);
    // Solo connect-src cambia.
    const p = parseCsp(buildCsp('n0nce', { ...ENV, measurementMode: 'on', measurementConnect: CONTRACT_ORIGINS }));
    for (const [k, v] of Object.entries(p)) if (k !== 'connect-src') expect(v.join(' ')).not.toMatch(MEASUREMENT_HOST_RE);
  });

  it('on: un valor horneado con otra forma (con «;» o ruta) se descarta', () => {
    const policy = buildCsp('n0nce', {
      ...ENV,
      measurementMode: 'on',
      measurementConnect: ['https://evil.example; script-src *', 'https://x.example/path', 'https://ok.example'],
    });
    expect(policy).not.toContain('evil.example');
    expect(policy).not.toContain('x.example/path');
    expect(parseCsp(policy)['connect-src']).toContain('https://ok.example');
  });

  it('next.config hornea la cadena solo con on', () => {
    expect(measurementCspConnectFor('off')).toBe('');
    expect(measurementCspConnectFor('on').split(' ')).toEqual(CONTRACT_ORIGINS);
  });
});
