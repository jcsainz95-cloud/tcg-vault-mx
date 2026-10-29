import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homeBundleProblems, HOME_ENTRIES } from '../../scripts/check-home-bundle.mjs';
import { mockModuleAliases, useMocksBuild } from '../../next.config.mjs';

/**
 * PERF portada (§DYN.3). La conducta real del candado (sobre un `.next` de verdad) la corre el
 * `postbuild`; aquí se fija su lógica y la del alias de mocks de `next.config.mjs`.
 */
describe('check-home-bundle · lógica del candado', () => {
  const pages = {
    [HOME_ENTRIES[0]]: ['static/chunks/a.js', 'static/css/x.css'],
    [HOME_ENTRIES[2]]: ['static/chunks/b.js', 'static/chunks/a.js'],
    '/[locale]/(admin)/admin/page': ['static/chunks/admin.js'],
  };

  it('verde si ningún chunk de la portada trae lo vetado (lo de admin no cuenta)', () => {
    const chunks: Record<string, string> = { 'static/chunks/a.js': 'ok', 'static/chunks/b.js': 'ok', 'static/chunks/admin.js': 'recharts' };
    expect(homeBundleProblems(pages, (f: string) => chunks[f])).toEqual([]);
  });

  it('rojo con recharts, con un fixture o con la rama mock de login', () => {
    const chunks: Record<string, string> = {
      'static/chunks/a.js': 'x="recharts-wrapper"',
      'static/chunks/b.js': '{email:"cliente@example.com",refreshToken:"mock.refresh.token"}',
    };
    const problems: string[] = homeBundleProblems(pages, (f: string) => chunks[f]);
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/a\.js contiene «recharts»/);
    expect(problems.join('\n')).toMatch(/b\.js contiene «@example\.»/);
    expect(problems.join('\n')).toMatch(/b\.js contiene «mock\.refresh\.token»/);
  });

  it('rojo si el manifiesto no trae la portada (no pasa en verde por no mirar nada)', () => {
    expect(homeBundleProblems({}, () => '')).toHaveLength(1);
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
    expect(modules.length).toBeGreaterThan(0);
    for (const f of modules) {
      expect(aliases[join(dir, f)]).toBe(false);
      expect(aliases[join(dir, f.replace(/\.ts$/, ''))]).toBe(false);
    }
    expect(Object.keys(aliases).some((k) => k.includes('.test'))).toBe(false);
    expect(Object.values(aliases).every((v) => v === false)).toBe(true);
  });
});
