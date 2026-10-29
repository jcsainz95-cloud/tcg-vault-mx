#!/usr/bin/env node
/**
 * PERF portada (§DYN.3) · paso `postbuild` de `npm run build`. Candado de lo que NO debe viajar en el JS:
 *  - en la PORTADA (`/[locale]`: layout raíz + layout de tienda + página): `recharts` (solo lo usa el vistazo del
 *    portafolio con sesión, `HomeView` con `next/dynamic`) y la rama mock de login de `lib/api.ts` (la constante
 *    `MOCKS_BUILD` vive en `lib/api.ts` y `lib/marketing-api.ts`; `next.config.mjs` solo hornea el literal
 *    `NEXT_PUBLIC_USE_MOCKS` del que sale; si aparece, la guarda no se plegó);
 *  - en TODO `.next/static` (TL-DYN3-2, TL-DYN3R-2): el centinela cuyo valor vive en `src/lib/mock/sentinel.ts` y
 *    que cada módulo de `lib/mock` lleva como literal en su propio efecto de nivel superior. Si aparece, algún
 *    módulo de MOCK llegó a un build sin mocks (el alias de `next.config.mjs` no lo vació).
 * Falla también si falta CUALQUIERA de las entradas de la portada en el manifiesto (no pasa en verde por no mirar).
 * Medido 2026-10-29 (FRONTEND_NOTES §DYN.3).
 *
 * Con `NEXT_PUBLIC_USE_MOCKS=true` (bundle de E2E, no se publica) no comprueba nada.
 * `npx next build` directo no pasa por aquí (igual que `prebuild`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const HOME_ENTRIES = ['/[locale]/layout', '/[locale]/(storefront)/layout', '/[locale]/(storefront)/page'];

/** Cadenas vetadas en el JS de la portada (sobreviven al minificador: son datos, no nombres). */
export const FORBIDDEN_IN_HOME = [
  { needle: 'recharts', why: 'recharts (PortfolioGlance debe ir con next/dynamic)' },
  { needle: 'mock.refresh.token', why: 'rama mock de login en lib/api.ts (la guarda MOCKS_BUILD de api.ts no se plegó)' },
];

/** Lee el valor del centinela de `src/lib/mock/sentinel.ts` (un `.mjs` no importa `.ts`). */
export function mockSentinel(source = readFileSync(join(ROOT, 'src/lib/mock/sentinel.ts'), 'utf8')) {
  const m = source.match(/export const MOCK_BUNDLE_SENTINEL = '([^']+)';/);
  if (!m) throw new Error('HOME_BUNDLE_FAIL: no se encontró MOCK_BUNDLE_SENTINEL en src/lib/mock/sentinel.ts');
  return m[1];
}

/**
 * @param {Record<string, string[]>} pages  `app-build-manifest.json` → `pages`
 * @param {(file: string) => string} readChunk
 * @param {{ staticChunks?: string[], sentinel?: string }} [opts] todos los `.js` de `static/` (relativos al dist)
 * @returns {string[]} problemas (vacío = OK)
 */
export function homeBundleProblems(pages, readChunk, { staticChunks = [], sentinel } = {}) {
  const problems = [];
  const missing = HOME_ENTRIES.filter((k) => !(pages[k] ?? []).some((f) => f.endsWith('.js')));
  for (const k of missing) problems.push(`falta la entrada de la portada ${k} en el manifiesto`);
  const files = [...new Set(HOME_ENTRIES.flatMap((k) => pages[k] ?? []))].filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = readChunk(f);
    for (const { needle, why } of FORBIDDEN_IN_HOME) {
      if (src.includes(needle)) problems.push(`${f} contiene «${needle}»: ${why}`);
    }
  }
  if (sentinel !== undefined) {
    if (staticChunks.length === 0) problems.push('no hay chunks .js en static/ (no se midió nada)');
    for (const f of staticChunks) {
      if (readChunk(f).includes(sentinel)) problems.push(`${f} contiene el centinela de lib/mock: un fixture de MOCK llegó al build sin mocks`);
    }
  }
  return problems;
}

/** Todos los `.js` bajo `<dist>/static`, relativos a `dist`. */
export function staticJsFiles(dist) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.js')) out.push(relative(dist, p));
    }
  };
  const root = join(dist, 'static');
  if (existsSync(root)) walk(root);
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.env.NEXT_PUBLIC_USE_MOCKS === 'true') {
    console.log('HOME_BUNDLE_SKIPPED mocks=on');
    process.exit(0);
  }
  const dist = process.argv[2] ?? join(ROOT, process.env.NEXT_DIST_DIR || '.next');
  const manifest = join(dist, 'app-build-manifest.json');
  if (!existsSync(manifest)) {
    console.error(`HOME_BUNDLE_FAIL: no existe ${manifest}`);
    process.exit(1);
  }
  const pages = JSON.parse(readFileSync(manifest, 'utf8')).pages ?? {};
  const staticChunks = staticJsFiles(dist);
  const problems = homeBundleProblems(pages, (f) => readFileSync(join(dist, f), 'utf8'), { staticChunks, sentinel: mockSentinel() });
  if (problems.length > 0) {
    for (const p of problems) console.error(`HOME_BUNDLE_FAIL: ${p}`);
    process.exit(1);
  }
  console.log(`HOME_BUNDLE_OK (${staticChunks.length} chunks de static/ sin el centinela de lib/mock)`);
}
