// @vitest-environment node
/**
 * C-F1, mitad de FUENTE (la mitad de ARTEFACTO es el grep sobre `.next` de `e2e/measurement-off.spec.ts`
 * y del paso de devops). Afirma, sobre el código del repo:
 *  1. los hosts de las etiquetas viven SOLO en `lib/measurement/loader.ts` y
 *     `security/measurement-origins.mjs` (ningún otro fichero de `src/`, `messages/` ni comentario);
 *  2. el cargador solo se importa con `import()` dentro de la guarda literal
 *     `process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on'` (lo que deja al compilador quitarlo con off);
 *  3. `measurement-origins.mjs` solo lo importan `next.config.mjs` y pruebas.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const FRONTEND = join(__dirname, '../../..');
const SRC = join(FRONTEND, 'src');
const HOST_RE = /googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|fbevents|gtag\/js/;
const ALLOWED_HOST_FILES = new Set(['src/lib/measurement/loader.ts', 'src/security/measurement-origins.mjs']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).map((p) => ({ rel: relative(FRONTEND, p), src: readFileSync(p, 'utf8') }));
const isTest = (rel: string) => /\.test\.(ts|tsx)$/.test(rel);

describe('C-F1 (fuente) · los hosts de medición no salen del cargador', () => {
  it('ningún fichero de producción fuera de los dos permitidos nombra un host de medición', () => {
    const offenders = files.filter((f) => !isTest(f.rel) && !ALLOWED_HOST_FILES.has(f.rel) && HOST_RE.test(f.src)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('messages/*.json no nombran hosts de medición (C-F15 lo repite por clave)', () => {
    for (const l of ['es', 'en']) {
      expect(readFileSync(join(FRONTEND, 'messages', `${l}.json`), 'utf8')).not.toMatch(HOST_RE);
    }
  });

  it('el cargador solo se importa con import() bajo la guarda literal del modo', () => {
    const importers = files.filter((f) => !isTest(f.rel) && /measurement\/loader['"]/.test(f.src));
    // Dos montajes (v1.109, C-F9): la tienda (`[locale]`) y el árbol raíz de `/card-show`. Ninguno más.
    expect(importers.map((f) => f.rel).sort()).toEqual([
      'src/components/consent/CardShowMeasurement.tsx',
      'src/components/consent/MeasurementProvider.tsx',
    ]);
    for (const { rel, src } of importers) {
      expect(src, rel).not.toMatch(/^\s*import[^(]*measurement\/loader/m);
      const guard = "if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on') {";
      const g = src.indexOf(guard);
      const i = src.indexOf("import('@/lib/measurement/loader')");
      expect(g, rel).toBeGreaterThan(-1);
      expect(i, rel).toBeGreaterThan(g);
      // El import está DENTRO del bloque de la guarda (antes de que cierre).
      const between = src.slice(g + guard.length, i);
      const depth = [...between].reduce((d, ch) => d + (ch === '{' ? 1 : ch === '}' ? -1 : 0), 0);
      expect(depth, rel).toBeGreaterThanOrEqual(0);
      // Y el componente exportado sale con `off` ANTES de montar la rama activa.
      expect(src, rel).toMatch(/process\.env\.NEXT_PUBLIC_MEASUREMENT_MODE === 'on' \?/);
    }
  });

  it('MKT.H.13 · la medición no usa sessionStorage (nada en el dispositivo antes de elegir; cierra FE-MKT2-1)', () => {
    const offenders = files
      .filter((f) => !isTest(f.rel) && (f.rel.startsWith('src/lib/measurement/') || f.rel.startsWith('src/components/consent/')))
      .filter((f) => /sessionStorage/.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('measurement-origins.mjs solo lo importa next.config.mjs (y pruebas)', () => {
    const importers = files.filter(
      (f) => !isTest(f.rel) && /(from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*measurement-origins/.test(f.src),
    );
    expect(importers.map((f) => f.rel)).toEqual([]);
    expect(readFileSync(join(FRONTEND, 'next.config.mjs'), 'utf8')).toContain("from './src/security/measurement-origins.mjs'");
  });
});
