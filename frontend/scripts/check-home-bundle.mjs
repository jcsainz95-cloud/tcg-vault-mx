#!/usr/bin/env node
/**
 * PERF portada (§DYN.3) · paso `postbuild` de `npm run build`. Candado de lo que NO debe viajar en
 * el JS de la portada (`/[locale]`: layout raíz + layout de tienda + página):
 *  - `recharts` — solo lo usa el vistazo del portafolio con sesión (`HomeView`, `next/dynamic`).
 *  - los fixtures de MOCK — `next.config.mjs` (`mockModuleAliases` + `MOCKS_BUILD`) los saca de un
 *    build sin mocks; si vuelven, la portada vuelve a cargar ~50–70 KB gzip de datos de mentira.
 * Medido 2026-10-29 (FRONTEND_NOTES «PERF portada»): 383 → 192 KB gzip con los dos arreglos.
 *
 * Con `NEXT_PUBLIC_USE_MOCKS=true` (bundle de E2E, no se publica) no comprueba nada.
 * `npx next build` directo no pasa por aquí (igual que `prebuild`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME_ENTRIES = ['/[locale]/layout', '/[locale]/(storefront)/layout', '/[locale]/(storefront)/page'];

/** Cadenas que solo existen en el código vetado (sobreviven al minificador: son datos, no nombres). */
export const FORBIDDEN_IN_HOME = [
  { needle: 'recharts', why: 'recharts (PortfolioGlance debe ir con next/dynamic)' },
  { needle: '@example.', why: 'fixtures de MOCK (emails de prueba de lib/mock o de las ramas mock de api.ts)' },
  { needle: 'mock.refresh.token', why: 'rama mock de login en lib/api.ts (MOCKS_BUILD no se plegó)' },
];

/**
 * @param {Record<string, string[]>} pages  `app-build-manifest.json` → `pages`
 * @param {(file: string) => string} readChunk
 * @returns {string[]} problemas (vacío = OK)
 */
export function homeBundleProblems(pages, readChunk) {
  const files = [...new Set(HOME_ENTRIES.flatMap((k) => pages[k] ?? []))].filter((f) => f.endsWith('.js'));
  if (files.length === 0) return [`ninguna entrada de la portada en el manifiesto (${HOME_ENTRIES.join(', ')})`];
  const problems = [];
  for (const f of files) {
    const src = readChunk(f);
    for (const { needle, why } of FORBIDDEN_IN_HOME) {
      if (src.includes(needle)) problems.push(`${f} contiene «${needle}»: ${why}`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.env.NEXT_PUBLIC_USE_MOCKS === 'true') {
    console.log('HOME_BUNDLE_SKIPPED mocks=on');
    process.exit(0);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dist = process.argv[2] ?? join(root, process.env.NEXT_DIST_DIR || '.next');
  const manifest = join(dist, 'app-build-manifest.json');
  if (!existsSync(manifest)) {
    console.error(`HOME_BUNDLE_FAIL: no existe ${manifest}`);
    process.exit(1);
  }
  const pages = JSON.parse(readFileSync(manifest, 'utf8')).pages ?? {};
  const problems = homeBundleProblems(pages, (f) => readFileSync(join(dist, f), 'utf8'));
  if (problems.length > 0) {
    for (const p of problems) console.error(`HOME_BUNDLE_FAIL: ${p}`);
    process.exit(1);
  }
  console.log('HOME_BUNDLE_OK');
}
