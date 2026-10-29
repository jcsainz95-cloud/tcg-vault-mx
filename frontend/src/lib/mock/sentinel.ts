/**
 * TL-DYN3-2 / TL-DYN3R-2 (§DYN.3) · VALOR del centinela del candado de bundle (`scripts/check-home-bundle.mjs`, postbuild,
 * lo lee de aquí como texto). Nadie importa este fichero en código: cada módulo de `lib/mock` lleva el LITERAL en su
 * propio efecto de nivel superior (`(globalThis …).__thMockBundle = '<valor>'`, al final del fichero). Así, si un
 * módulo llega al JS de un build sin mocks (escapa al alias de `next.config.mjs`), su centinela viaja con su código,
 * y no depende de un `import './sentinel'` que el mismo alias vaciaría, ni de `sideEffects` en `package.json`.
 * Lo que NO cubre: un fixture copiado fuera de `lib/mock` (eso lo mide R1, `src/test/mock-boundary.test.ts`).
 * Candados: `src/lib/home-bundle.test.ts` (cada módulo lleva el literal exacto; sin `sideEffects` en package.json).
 */
export const MOCK_BUNDLE_SENTINEL = 'th-mock-bundle-sentinel-5c1e';
