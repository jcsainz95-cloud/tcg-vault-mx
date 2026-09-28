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
 * ⚠️ Es una aproximación ESTÁTICA (regex de imports con nombre, rutas relativas y `@/`). La prueba
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

  it('canario: componentes y tipos de un módulo cliente, y funciones de un módulo SIN `use client`, pasan', () => {
    const page =
      "import { VaultDetailView, type VaultDetailTab } from './VaultDetailView';\nimport type { X } from './VaultDetailView';\n";
    const view = "'use client';\nexport function VaultDetailView() {}\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), page, () => view, () => 'v.tsx')).toEqual([]);
    const page2 = "import { parseVaultDetailTab } from './tabs';\n";
    expect(boundaryViolations(path.join(APP, 'x/page.tsx'), page2, () => 'export function parseVaultDetailTab() {}', () => 't.ts')).toEqual([]);
  });
});
