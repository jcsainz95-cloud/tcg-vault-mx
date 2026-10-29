/**
 * TL-DYN3-2 (§DYN.3) · CENTINELA del candado de bundle. Cada módulo de `lib/mock` lo importa (`import './sentinel'`);
 * el efecto lateral de abajo impide que webpack lo pode: si CUALQUIER módulo de `lib/mock` llega al JS de un build
 * sin mocks, esta cadena viaja con él y `scripts/check-home-bundle.mjs` (postbuild) la encuentra en `.next/static`.
 * En un build sin mocks el alias de `next.config.mjs` vacía también este fichero.
 * Candados: `src/lib/home-bundle.test.ts` (todo módulo lo importa; el script lee este valor de aquí).
 */
export const MOCK_BUNDLE_SENTINEL = 'th-mock-bundle-sentinel-5c1e';

(globalThis as { __thMockBundle?: string }).__thMockBundle = MOCK_BUNDLE_SENTINEL;
