import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { homeBundleProblems, HOME_ENTRIES, mockSentinel, staticJsFiles } from '../../scripts/check-home-bundle.mjs';
import { mockModuleAliases, useMocksBuild } from '../../next.config.mjs';
import { MOCK_BUNDLE_SENTINEL } from './mock/sentinel';

/**
 * PERF portada (§DYN.3) y TL-DYN3-2. La conducta real del candado (sobre un `.next` de verdad) la corre el
 * `postbuild`; aquí se fija su lógica, la del alias de mocks de `next.config.mjs` y la del centinela.
 */
const SENTINEL = MOCK_BUNDLE_SENTINEL;
const allEntries = (extra: Record<string, string[]> = {}) => ({
  [HOME_ENTRIES[0]]: ['static/chunks/a.js', 'static/css/x.css'],
  [HOME_ENTRIES[1]]: ['static/chunks/a.js'],
  [HOME_ENTRIES[2]]: ['static/chunks/b.js', 'static/chunks/a.js'],
  '/[locale]/(admin)/admin/page': ['static/chunks/admin.js'],
  ...extra,
});
const STATIC = ['static/chunks/a.js', 'static/chunks/b.js', 'static/chunks/admin.js'];

describe('check-home-bundle · lógica del candado', () => {
  it('verde si ningún chunk de la portada trae lo vetado y ningún chunk de static/ trae el centinela', () => {
    const chunks: Record<string, string> = { 'static/chunks/a.js': 'ok', 'static/chunks/b.js': 'ok', 'static/chunks/admin.js': 'recharts' };
    expect(homeBundleProblems(allEntries(), (f: string) => chunks[f], { staticChunks: STATIC, sentinel: SENTINEL })).toEqual([]);
  });

  it('rojo con recharts o con la rama mock de login en la portada', () => {
    const chunks: Record<string, string> = { 'static/chunks/a.js': 'x="recharts-wrapper"', 'static/chunks/b.js': '{refreshToken:"mock.refresh.token"}' };
    const problems: string[] = homeBundleProblems(allEntries(), (f: string) => chunks[f]);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/a\.js contiene «recharts»/);
    expect(problems.join('\n')).toMatch(/b\.js contiene «mock\.refresh\.token»/);
  });

  it('rojo con el centinela de lib/mock en CUALQUIER chunk de static/ (también fuera de la portada)', () => {
    const chunks: Record<string, string> = { 'static/chunks/a.js': 'ok', 'static/chunks/b.js': 'ok', 'static/chunks/admin.js': `globalThis.__thMockBundle="${SENTINEL}"` };
    const problems: string[] = homeBundleProblems(allEntries(), (f: string) => chunks[f], { staticChunks: STATIC, sentinel: SENTINEL });
    expect(problems).toEqual([expect.stringMatching(/^static\/chunks\/admin\.js contiene el centinela de lib\/mock/)]);
  });

  it('rojo si falta CUALQUIERA de las entradas de la portada (una por una), o si no hay chunks que mirar', () => {
    for (const k of HOME_ENTRIES) {
      const pages: Record<string, string[]> = allEntries();
      delete pages[k];
      expect(homeBundleProblems(pages, () => 'ok')).toEqual([`falta la entrada de la portada ${k} en el manifiesto`]);
    }
    expect(homeBundleProblems({}, () => '')).toHaveLength(HOME_ENTRIES.length);
    expect(homeBundleProblems(allEntries(), () => 'ok', { staticChunks: [], sentinel: SENTINEL })).toEqual(['no hay chunks .js en static/ (no se midió nada)']);
  });

  it('el script lee el centinela de src/lib/mock/sentinel.ts (mismo valor que exporta el módulo)', () => {
    expect(mockSentinel()).toBe(SENTINEL);
    expect(() => mockSentinel('export const OTRO = 1;')).toThrow(/HOME_BUNDLE_FAIL/);
  });

  const tmp = mkdtempSync(join(tmpdir(), 'home-bundle-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('staticJsFiles recorre static/ entero (subcarpetas), solo .js', () => {
    mkdirSync(join(tmp, 'dist/static/chunks/app/x'), { recursive: true });
    writeFileSync(join(tmp, 'dist/static/chunks/a.js'), '');
    writeFileSync(join(tmp, 'dist/static/chunks/app/x/b.js'), '');
    writeFileSync(join(tmp, 'dist/static/chunks/c.css'), '');
    expect(staticJsFiles(join(tmp, 'dist')).sort()).toEqual(['static/chunks/a.js', 'static/chunks/app/x/b.js']);
  });
});

describe('lib/mock · centinela en cada módulo', () => {
  const dir = join(__dirname, 'mock');
  const modules: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && f !== 'sentinel.ts') modules.push(p);
    }
  };
  walk(dir);

  it('todo módulo de lib/mock (no prueba) importa el centinela, para que el candado lo vea si llega al build', () => {
    expect(modules.length).toBeGreaterThan(10);
    const without = modules.filter((p) => !/^import '(\.\/|(\.\.\/)+)sentinel';$/m.test(readFileSync(p, 'utf8'))).map((p) => relative(dir, p));
    expect(without).toEqual([]);
  });

  it('el centinela tiene efecto lateral (si no, webpack lo poda y el candado no ve nada)', () => {
    expect(readFileSync(join(dir, 'sentinel.ts'), 'utf8')).toMatch(/^\(globalThis as [^)]+\)\.__thMockBundle = MOCK_BUNDLE_SENTINEL;$/m);
  });
});

describe('next.config · mocks fuera del build de producción', () => {
  it('NEXT_PUBLIC_USE_MOCKS se hornea siempre como literal', () => {
    expect(useMocksBuild({})).toBe('false');
    expect(useMocksBuild({ NEXT_PUBLIC_USE_MOCKS: 'false' })).toBe('false');
    expect(useMocksBuild({ NEXT_PUBLIC_USE_MOCKS: 'yes' })).toBe('false');
    expect(useMocksBuild({ NEXT_PUBLIC_USE_MOCKS: 'true' })).toBe('true');
  });

  it('el alias vacía cada módulo de lib/mock (con y sin extensión) y nunca una prueba', () => {
    const aliases = mockModuleAliases() as Record<string, false>;
    const dir = join(__dirname, 'mock');
    const modules = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(modules).toContain('sentinel.ts');
    for (const f of modules) {
      expect(aliases[join(dir, f)]).toBe(false);
      expect(aliases[join(dir, f.replace(/\.ts$/, ''))]).toBe(false);
    }
    expect(Object.keys(aliases).some((k) => k.includes('.test'))).toBe(false);
    expect(Object.values(aliases).every((v) => v === false)).toBe(true);
  });

  it('TL-DYN3-5 · el alias cubre .tsx y subcarpetas (y la carpeta de un index); no las pruebas', () => {
    const base = mkdtempSync(join(tmpdir(), 'mock-alias-'));
    try {
      const m = join(base, 'src/lib/mock');
      mkdirSync(join(m, 'sub/deep'), { recursive: true });
      mkdirSync(join(m, 'pkg'), { recursive: true });
      for (const f of ['a.ts', 'b.tsx', 'sub/c.ts', 'sub/deep/d.tsx', 'pkg/index.ts', 'a.test.ts', 'sub/e.test.tsx', 'sub/f.spec.ts', 'types.d.ts']) {
        writeFileSync(join(m, f), '');
      }
      const aliases = mockModuleAliases({ baseDir: base }) as Record<string, false>;
      expect(Object.keys(aliases).map((k) => relative(m, k)).sort()).toEqual(
        ['a', 'a.ts', 'b', 'b.tsx', 'pkg', 'pkg/index', 'pkg/index.ts', 'sub/c', 'sub/c.ts', 'sub/deep/d', 'sub/deep/d.tsx'].sort(),
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
