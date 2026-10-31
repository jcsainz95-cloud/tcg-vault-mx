import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { mockImportersOf, moduleImportersOf, unguardedMockReferences } from './mock-boundary';
import { stripComments } from './strip-comments';

/**
 * R1 (techlead §DYN.3, 2026-10-29) · CANDADO de la frontera de los mocks. Ver `mock-boundary.ts` y
 * FRONTEND_NOTES §DYN.3. Un build sin mocks vacía `src/lib/mock/*` (alias de `next.config.mjs`): todo uso de
 * esos módulos fuera de una rama `(MOCKS_BUILD && config.useMocks)` vale `undefined` en producción, y la suite
 * (que corre con mocks) no lo vería nunca. Esto lo mide sobre el código fuente.
 */

const SRC = join(process.cwd(), 'src');
const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const CODE = walk(SRC).filter((f) => !isTest(f));
const rel = (f: string) => relative(join(SRC, '..'), f);

/** Los dos únicos clientes que deciden en cada función entre el servidor y el fixture. */
const MOCK_CLIENTS = ['src/lib/api.ts', 'src/lib/marketing-api.ts'];

/**
 * Lista EXPLÍCITA de ficheros de apoyo de pruebas que no siguen la convención `*.test.*` y usan `lib/mock`.
 * Cada uno solo puede importarse desde pruebas (lo comprueba el caso de abajo).
 */
const TEST_SUPPORT = ['src/app/[locale]/(admin)/admin/m4/capture/sdx-test-fixtures.ts'];

const allowed = (r: string) => MOCK_CLIENTS.includes(r) || r.startsWith('src/lib/mock/') || TEST_SUPPORT.includes(r);

describe('R1 (a) · nadie fuera de los dos clientes importa lib/mock', () => {
  it('ningún fichero de código (no prueba) importa src/lib/mock, salvo api.ts, marketing-api.ts y lib/mock/**', () => {
    const hits = mockImportersOf(CODE.map((path) => ({ path, source: readFileSync(path, 'utf8') })), SRC);
    // No pasa en verde por no ver nada: los dos clientes SÍ importan lib/mock.
    for (const c of MOCK_CLIENTS) expect(hits.some((h) => h.file === c)).toBe(true);
    const offenders = hits.filter((h) => !allowed(h.file)).map((h) => `${h.file}:${h.line} importa ${h.spec}`);
    expect(offenders).toEqual([]);
  });

  it('los ficheros de apoyo de la lista explícita existen y solo los importan pruebas (también por import()/require())', () => {
    const files = CODE.map((path) => ({ path, source: readFileSync(path, 'utf8') }));
    for (const support of TEST_SUPPORT) {
      expect(CODE.map(rel)).toContain(support);
      expect(moduleImportersOf(files, SRC, join(SRC, '..', support))).toEqual([]);
    }
  });

  it('canario TL-DYN3R-1 (menor): importar el fichero de apoyo por import estático, import(), require() o plantilla ⇒ detectado', () => {
    const support = join(SRC, '..', TEST_SUPPORT[0]);
    const dir = join(support, '..');
    const fake = (name: string, source: string) => ({ path: join(dir, name), source });
    const hits = moduleImportersOf(
      [
        fake('A.tsx', "import { x } from './sdx-test-fixtures';"),
        fake('B.ts', "const m = () => import('./sdx-test-fixtures');"),
        fake('C.ts', "const m = require('./sdx-test-fixtures');"),
        fake('D.ts', 'const m = () => import(`./sdx-test-fixtures`);'),
        fake('E.ts', "import { y } from '@/app/[locale]/(admin)/admin/m4/capture/sdx-test-fixtures';"),
        fake('F.ts', "import type { Z } from './sdx-test-fixtures';"),
        fake('G.ts', "import { y } from './sdx-test-fixtures-otro';"),
      ],
      SRC,
      support,
    );
    expect(hits.map((h) => h.file.split('/').pop())).toEqual(['A.tsx', 'B.ts', 'C.ts', 'D.ts', 'E.ts']);
  });

  it('canario: un componente que importa lib/mock (@/ o relativo, estático, dinámico o re-export) ⇒ detectado; `import type` no', () => {
    const fake = (name: string, source: string) => ({ path: join(SRC, 'components', name), source });
    const hits = mockImportersOf(
      [
        fake('A.tsx', "import { mockSettings } from '@/lib/mock/fixtures';"),
        fake('B.ts', "import * as fx from '../lib/mock/fixtures';"),
        fake('C.ts', "export { mockCsv } from '@/lib/mock/fixtures';"),
        fake('D.ts', "const m = () => import('@/lib/mock/sales');"),
        fake('E.ts', "import type { DiscountLine } from '@/lib/mock/discounts';"),
        fake('F.ts', "import { config } from '@/lib/config';"),
      ],
      SRC,
    );
    expect(hits.map((h) => h.file.split('/').pop())).toEqual(['A.tsx', 'B.ts', 'C.ts', 'D.ts']);
  });
});

/**
 * Funciones EXPORTADAS de los clientes que tocan `lib/mock` sin guarda propia porque solo las llaman las pruebas
 * (paridad del cálculo mock con el contrato). Lista EXPLÍCITA (TL-DYN3R-1): cualquier otra función exportada cuenta
 * como usada fuera aunque hoy nadie la llame (una exportada sin llamadas no prueba nada: la próxima importación sí).
 */
const TEST_ONLY_EXPORTS = ['computeBreakdown', 'mockWithdrawalDiscount', 'mockDiscountedDirectShip'];

describe('R1 (b) · en los dos clientes, toda referencia a lib/mock queda bajo la guarda', () => {
  /** Código (sin comentarios) de los ficheros que no son prueba ni lib/mock, menos el propio cliente (H4: el OTRO
   * cliente sí cuenta como fuera). Conservador: una mención en código cuenta como uso (falso rojo posible, falso verde no). */
  const stripped = new Map<string, string>();
  const code = (f: string) => stripped.get(f) ?? stripped.set(f, stripComments(readFileSync(f, 'utf8'), f)).get(f)!;
  const outsideOf = (client: string) => CODE.filter((f) => rel(f) !== client && (!allowed(rel(f)) || MOCK_CLIENTS.includes(rel(f)))).map(code);
  const usedOutsideOf = (client: string) => {
    const outside = outsideOf(client);
    return (name: string) => !TEST_ONLY_EXPORTS.includes(name) || outside.some((s) => new RegExp(`\\b${name}\\b`).test(s));
  };

  it('H4: «fuera» de cada cliente incluye al otro cliente', () => {
    const others = CODE.filter((f) => !allowed(rel(f))).length;
    for (const c of MOCK_CLIENTS) {
      const other = MOCK_CLIENTS.find((o) => o !== c)!;
      expect(outsideOf(c)).toHaveLength(others + 1);
      expect(outsideOf(c)).toContain(stripComments(readFileSync(join(SRC, '..', other), 'utf8'), other));
    }
  });

  it('TEST_ONLY_EXPORTS: cada nombre es una función exportada de un cliente y la llama al menos una prueba', () => {
    const clients = MOCK_CLIENTS.map((c) => readFileSync(join(SRC, '..', c), 'utf8')).join('\n');
    const tests = walk(SRC).filter(isTest).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const name of TEST_ONLY_EXPORTS) {
      expect(clients).toMatch(new RegExp(`^export function ${name}\\b`, 'm'));
      expect(tests).toMatch(new RegExp(`\\b${name}\\(`));
    }
  });

  for (const file of MOCK_CLIENTS) {
    it(`${file}: 0 referencias sin guarda`, () => {
      const { refs, unguarded, problems } = unguardedMockReferences(readFileSync(join(SRC, '..', file), 'utf8'), file, usedOutsideOf(file), SRC);
      expect(problems).toEqual([]);
      // No pasa en verde por no ver nada (medido 2026-10-29: api.ts 484, marketing-api.ts 13).
      expect(refs).toBeGreaterThan(file.endsWith('/api.ts') ? 400 : 10);
      expect(unguarded.map((u) => `${file}:${u.line} ${u.text}`)).toEqual([]);
    });
  }

  const SNIPPET = (body: string, extra = '') => `
import { config } from './config';
import * as fx from './mock/fixtures';
import { directShipFeeOf } from './mock/shipping-rule';
const MOCKS_BUILD = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';
${extra}
export async function getSettings() {
${body}
}`;
  const unguardedOf = (src: string, usedOutside?: (n: string) => boolean) => unguardedMockReferences(src, 'x.ts', usedOutside).unguarded.map((u) => u.text);

  it('canario: `fx.mockSettings` en la rama real ⇒ rojo', () => {
    expect(unguardedOf(SNIPPET(`  if (!(MOCKS_BUILD && config.useMocks)) return { iva: fx.mockSettings.ivaPct };\n  return fx.mockSettings;`))).toEqual([
      'if (!(MOCKS_BUILD && config.useMocks)) return { iva: fx.mockSettings.ivaPct };',
    ]);
    expect(unguardedOf(SNIPPET(`  const pct = fx.mockSettings.ivaPct;\n  if (!(MOCKS_BUILD && config.useMocks)) return pct;\n  return fx.mockSettings;`))).toEqual([
      'const pct = fx.mockSettings.ivaPct;',
    ]);
    // guarda débil (solo `config.useMocks`): no se pliega en el build ⇒ cuenta como rama real
    expect(unguardedOf(SNIPPET(`  if (config.useMocks) return fx.mockSettings;\n  return null;`))).toEqual(['if (config.useMocks) return fx.mockSettings;']);
    // nivel de módulo
    expect(unguardedOf(SNIPPET('  return 1;', 'const DEFAULTS = fx.mockSettings;'))).toEqual(['const DEFAULTS = fx.mockSettings;']);
  });

  it('las formas guardadas no dan falso rojo (if, else, ternario, &&, return temprano, ayudante solo llamado bajo guarda)', () => {
    const helper = 'function mockFee() { return directShipFeeOf("cards_only", 0, fx.mockSettings); }';
    expect(
      unguardedOf(
        SNIPPET(
          [
            '  if (MOCKS_BUILD && config.useMocks) { fx.mockSettings; }',
            '  if (!(MOCKS_BUILD && config.useMocks)) { void 0; } else { fx.mockSettings; }',
            '  const a = (MOCKS_BUILD && config.useMocks) ? fx.mockSettings : null;',
            '  const b = (MOCKS_BUILD && config.useMocks) && fx.mockSettings;',
            '  if ((MOCKS_BUILD && config.useMocks) && a) { fx.mockSettings; }',
            '  if (!(MOCKS_BUILD && config.useMocks)) return null;',
            '  return [a, b, mockFee(), fx.mockSettings];',
          ].join('\n'),
          helper,
        ),
      ),
    ).toEqual([]);
  });

  it('canario «mutación C» de QA: `.catch(translateFixtureError)` en la rama real ⇒ rojo (instanceof undefined en producción)', () => {
    const helper = 'function translateFixtureError(e: unknown) { return e instanceof fx.ApiFixtureError ? new Error("x") : e; }';
    const body = [
      '  if (!(MOCKS_BUILD && config.useMocks)) return apiRequest("/catalog/cards/1").catch((e) => { throw translateFixtureError(e); });',
      '  try { return fx.mockSettings; } catch (e) { throw translateFixtureError(e); }',
    ].join('\n');
    expect(unguardedOf(SNIPPET(body, helper))).toEqual([helper]);
    // la misma función sin la llamada de la rama real ⇒ verde
    expect(unguardedOf(SNIPPET(body.replace('.catch((e) => { throw translateFixtureError(e); })', ''), helper))).toEqual([]);
  });

  it('canario: ayudante llamado desde la rama real, o exportado y usado fuera ⇒ rojo', () => {
    const helper = 'function mockFee() { return fx.mockSettings; }';
    expect(unguardedOf(SNIPPET('  if (!(MOCKS_BUILD && config.useMocks)) return mockFee();\n  return null;', helper))).toEqual([
      'function mockFee() { return fx.mockSettings; }',
    ]);
    const exported = 'export function mockFee() { return fx.mockSettings; }';
    expect(unguardedOf(SNIPPET('  return null;', exported), () => true)).toHaveLength(1);
    expect(unguardedOf(SNIPPET('  return null;', exported), () => false)).toEqual([]);
  });

  // TL-DYN3R-1 · los tres canarios del techlead (M-a, M-b, M-c), tal cual, sobre la ruta real de api.ts.
  const API = join(SRC, 'lib', 'api.ts');
  const inApi = (extra: string) => unguardedMockReferences(SNIPPET('  return null;', extra), API, () => true, SRC);

  it("canario M-a (H1): `import * as leak from '../lib/mock/sales'` y otras formas que resuelven a lib/mock ⇒ rojo", () => {
    expect(inApi("import * as leak from '../lib/mock/sales';\nexport const LEAK = leak;").unguarded.map((u) => u.text)).toEqual(['export const LEAK = leak;']);
    for (const spec of ['./mock/../mock/sales', '../lib/mock/sales', '@/lib/mock/sales', './mock', '../../src/lib/mock/sales']) {
      expect(inApi(`import { salesFx } from '${spec}';\nexport const LEAK = salesFx;`).unguarded).toHaveLength(1);
    }
    // no es lib/mock ⇒ no cuenta
    expect(inApi("import { a } from './mockery';\nexport const X = a;").unguarded).toEqual([]);
  });

  it('canario M-b (H2): import()/require() de lib/mock (o con argumento no literal) en un cliente ⇒ problema, guardado o no', () => {
    expect(inApi("export async function leakDyn(){ return (await import('./mock/sales')); }").problems).toEqual(['import() de ./mock/sales (línea 6)']);
    expect(inApi("export function leakReq(){ if (MOCKS_BUILD && config.useMocks) return require('../lib/mock/sales'); return null; }").problems).toHaveLength(1);
    expect(inApi("import leakEq = require('./mock/sales');").problems).toHaveLength(1);
    expect(inApi('export async function leakTpl(){ return import(`./mock/sales`); }').problems).toHaveLength(1);
    expect(inApi('export async function leakVar(p: string){ return import(p); }').problems).toEqual([
      'import()/require() con argumento no literal (línea 6): no se puede auditar',
    ]);
    expect(inApi("export async function ok(){ return import('./config'); }").problems).toEqual([]);
  });

  it('canario M-c (H3): una función anidada tras el return temprano se eleva ⇒ no cuenta como guardada', () => {
    const leakHoist = 'export function leakHoist(){ if (!(MOCKS_BUILD && config.useMocks)) return h(); return null; function h(){ return fx.mockSettings; } }';
    expect(inApi(leakHoist).unguarded.map((u) => u.text)).toEqual([leakHoist]);
    // anidada bajo `if (guarda) { … }` sí queda guardada; una const tras el return temprano (no se eleva) también
    expect(inApi('export function ok(){ if (MOCKS_BUILD && config.useMocks) { function h(){ return fx.mockSettings; } return h(); } return null; }').unguarded).toEqual([]);
    expect(inApi('export function ok2(){ if (!(MOCKS_BUILD && config.useMocks)) return null; const h = () => fx.mockSettings; return h(); }').unguarded).toEqual([]);
  });

  it('canario: re-export de lib/mock o MOCKS_BUILD que no es el literal horneado ⇒ problema', () => {
    expect(unguardedMockReferences(`export { mockCsv } from './mock/fixtures';`, 'x.ts').problems).toHaveLength(1);
    const forced = SNIPPET('  if (!(MOCKS_BUILD && config.useMocks)) return 1;\n  return fx.mockSettings;').replace(
      "process.env.NEXT_PUBLIC_USE_MOCKS === 'true'",
      'true',
    );
    expect(unguardedMockReferences(forced, 'x.ts').problems).toHaveLength(1);
  });
});
