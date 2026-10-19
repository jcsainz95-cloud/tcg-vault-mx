/**
 * API_CONTRACT §MKT.H.1 / ARCHITECTURE §14.8 — orígenes de medición que la CSP abre en `connect-src`
 * SOLO con `NEXT_PUBLIC_MEASUREMENT_MODE=on`. Lista ÚNICA (la del contrato, literal).
 *
 * Por qué un `.mjs` aparte y no una constante en `csp.ts`: con el modo `off` el artefacto no puede
 * contener estos hosts (candado C-F1, grep sobre `.next/server` incluidos los `.map`, que copian el
 * fuente entero de cada módulo del middleware). Así la lista solo la lee `next.config.mjs`, que la
 * hornea en `TH_MEASUREMENT_CSP_CONNECT` (cadena vacía con `off`), y `csp.ts` no la importa nunca.
 * Lo prueba `csp.test.ts` (C-F7).
 */

/** @type {readonly string[]} */
export const MEASUREMENT_CSP_ORIGINS = Object.freeze([
  'https://www.googletagmanager.com',
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://connect.facebook.net',
  'https://www.facebook.com',
]);

/** Solo el texto exacto `on` enciende; todo lo demás es `off` (mismo criterio que `lib/measurement/mode.ts`). */
export function measurementModeOf(raw) {
  return raw === 'on' ? 'on' : 'off';
}

/** Cadena para `TH_MEASUREMENT_CSP_CONNECT`: los orígenes separados por espacio con `on`; `''` con `off`. */
export function measurementCspConnectFor(mode) {
  return mode === 'on' ? MEASUREMENT_CSP_ORIGINS.join(' ') : '';
}
