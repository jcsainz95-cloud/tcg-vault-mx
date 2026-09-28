// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';

/**
 * **Candado estático de la frontera servidor → cliente** (rechazo de QA sobre `db7d1c2`).
 *
 * `admin/vaults/[userId]/page.tsx` (componente de SERVIDOR) llamaba a `parseVaultDetailTab`,
 * exportada desde un módulo `'use client'`. Para el servidor, todo lo que exporta un módulo
 * `'use client'` es una *referencia de cliente*: se puede RENDERIZAR (si es componente), pero ⛔ no
 * se puede INVOCAR. En build de producción cada render de la ruta caía con «Attempted to call
 * parseVaultDetailTab() from the server» + «Application error». **Ni vitest ni tsc lo ven**: en
 * jsdom el módulo es un módulo normal, y para tsc la función existe.
 *
 * Regla que se mide aquí: un `page.tsx`/`layout.tsx` de servidor que importa de un módulo
 * `'use client'` solo puede importar **componentes** (PascalCase) o **tipos**. Una importación de
 * valor en minúscula (función, hook, constante) es exactamente la clase del defecto.
 *
 * Además (observación de QA/techlead sobre `f2981e1`: `import * as V from './VaultDetailView'` pasaba
 * verde): ⛔ `import * as X` de un módulo `'use client'` se marca siempre (`X.fn()` es la misma
 * invocación de una referencia de cliente, y no hay forma estática barata de saber qué se usa); y el
 * import POR DEFECTO solo pasa si el nombre local es PascalCase **y** el `export default` del módulo
 * es una función/clase/identificador PascalCase (un componente).
 *
 * ⚠️ Es una aproximación ESTÁTICA (regex de imports, rutas relativas y `@/`). La prueba
 * definitiva es el build de producción + una petición real a la ruta (lo hace el E2E
 * `m4-vault-placement.spec.ts`, que abre `/admin/vaults/<id>?tab=physical` contra `next start`).
 */

const SRC = path.resolve(__dirname, '..');
const APP = path.join(SRC, 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'page.tsx' || e.name === 'layout.tsx') out.push(p);
  }
  return out;
}

const USE_CLIENT = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/;

function isClientModule(source: string): boolean {
  return USE_CLIENT.test(source);
}

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // paquetes: fuera del alcance de este candado
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

/** Nombres de VALOR (no `type`) importados con llaves, con su módulo. */
function namedValueImports(source: string): { names: string[]; spec: string }[] {
  const out: { names: string[]; spec: string }[] = [];
  const re = /import\s+(type\s+)?(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[1]) continue; // `import type { … }`
    const names = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('type '))
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    out.push({ names, spec: m[3] });
  }
  return out;
}

/** `import * as X from '…'` (no `import type * as X`). */
function namespaceImports(source: string): { local: string; spec: string }[] {
  const out: { local: string; spec: string }[] = [];
  const re = /import\s+(type\s+)?\*\s*as\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) if (!m[1]) out.push({ local: m[2], spec: m[3] });
  return out;
}

/** `import X from '…'` y `import X, { … } from '…'` (no `import type X`). */
function defaultImports(source: string): { local: string; spec: string }[] {
  const out: { local: string; spec: string }[] = [];
  const re = /import\s+(type\s+)?([\w$]+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) if (!m[1] && m[2] !== 'type') out.push({ local: m[2], spec: m[3] });
  return out;
}

/** ¿El `export default` del módulo es un componente (función/clase/identificador PascalCase)? */
function defaultExportIsComponent(source: string): boolean {
  const m = /export\s+default\s+(?:async\s+)?(?:function\s*\*?\s*|class\s+)?([\w$]*)/.exec(source);
  return !!m && /^[A-Z]/.test(m[1]);
}

/** Devuelve las violaciones de un fichero de servidor (vacío si está limpio). */
function boundaryViolations(
  file: string,
  source: string,
  readModule: (resolved: string) => string = (p) => fs.readFileSync(p, 'utf8'),
  resolve: (from: string, spec: string) => string | null = resolveImport,
): string[] {
  if (isClientModule(source)) return [];
  const bad: string[] = [];
  for (const { names, spec } of namedValueImports(source)) {
    const target = resolve(file, spec);
    if (!target || !isClientModule(readModule(target))) continue;
    for (const n of names) {
      if (!/^[A-Z]/.test(n)) bad.push(`${path.relative(SRC, file)}: «${n}» de ${spec} ('use client')`);
    }
  }
  for (const { local, spec } of namespaceImports(source)) {
    const target = resolve(file, spec);
    if (!target || !isClientModule(readModule(target))) continue;
    bad.push(`${path.relative(SRC, file)}: «* as ${local}» de ${spec} ('use client')`);
  }
  for (const { local, spec } of defaultImports(source)) {
    const target = resolve(file, spec);
    if (!target) continue;
    const mod = readModule(target);
    if (!isClientModule(mod)) continue;
    if (!/^[A-Z]/.test(local) || !defaultExportIsComponent(mod)) {
      bad.push(`${path.relative(SRC, file)}: default «${local}» de ${spec} ('use client')`);
    }
  }
  return bad;
}

describe('frontera servidor → cliente en page/layout', () => {
  it('ningún page.tsx/layout.tsx de servidor importa una función/hook/constante de un módulo `use client`', () => {
    const files = walk(APP);
    expect(files.length).toBeGreaterThan(10); // el recorrido encontró las rutas
    const violations = files.flatMap((f) => boundaryViolations(f, fs.readFileSync(f, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('canario: el patrón exacto del defecto de db7d1c2 SÍ se detecta', () => {
    const page = "import { VaultDetailView, parseVaultDetailTab } from './VaultDetailView';\n";
    const view = "'use client';\nexport function parseVaultDetailTab() {}\nexport function VaultDetailView() {}\n";
    const v = boundaryViolations(path.join(APP, 'x/page.tsx'), page, () => view, () => 'VaultDetailView.tsx');
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('parseVaultDetailTab');
  });

  it('canario: `import * as X` de un módulo `use client` SÍ se detecta (medido por QA: pasaba verde)', () => {
    const page = "import * as V from './VaultDetailView';\n";
    const view = "'use client';\nexport function parseVaultDetailTab() {}\nexport function VaultDetailView() {}\n";
    const v = boundaryViolations(path.join(APP, 'x/page.tsx'), page, () => view, () => 'VaultDetailView.tsx');
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('* as V');
    // `import type * as V` es solo de tipos: pasa.
    const pageT = "import type * as V from './VaultDetailView';\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), pageT, () => view, () => 'v.tsx')).toEqual([]);
  });

  it('canario: el import por defecto de una función de un módulo `use client` SÍ se detecta (aunque el nombre local sea PascalCase)', () => {
    const fnView = "'use client';\nexport default function parseVaultDetailTab() {}\n";
    for (const page of [
      "import parse from './tabs';\n",
      "import Parse from './tabs';\n",
      "import parse, { VaultDetailView } from './tabs';\n",
    ]) {
      const v = boundaryViolations(path.join(APP, 'x/page.tsx'), page, () => fnView, () => 't.tsx');
      expect(v, page).toHaveLength(1);
      expect(v[0]).toContain('default');
    }
    // Un componente por defecto, importado con nombre PascalCase, pasa.
    const compView = "'use client';\nexport default function VaultDetailView() {}\n";
    const ok = "import VaultDetailView from './VaultDetailView';\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), ok, () => compView, () => 'v.tsx')).toEqual([]);
    // …pero con nombre local en minúscula, no (la regla es la misma que para los imports con nombre).
    const low = "import view from './VaultDetailView';\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), low, () => compView, () => 'v.tsx')).toHaveLength(1);
  });

  it('canario: componentes y tipos de un módulo cliente, y funciones de un módulo SIN `use client`, pasan', () => {
    const page =
      "import { VaultDetailView, type VaultDetailTab } from './VaultDetailView';\nimport type { X } from './VaultDetailView';\n";
    const view = "'use client';\nexport function VaultDetailView() {}\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), page, () => view, () => 'v.tsx')).toEqual([]);
    const page2 = "import { parseVaultDetailTab } from './tabs';\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), page2, () => 'export function parseVaultDetailTab() {}', () => 't.ts')).toEqual([]);
  });
});
