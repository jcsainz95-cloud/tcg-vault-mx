import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { stripComments } from './strip-comments';

/**
 * §DYN.6.7 (c1) — qué namespaces de traducción necesita EN EL CLIENTE un árbol de módulos. Lo usa el candado
 * DYN-F10 (a) para MEDIR las listas de `i18n/message-scopes.ts` contra el código, no suponerlas.
 *
 * Recorre las importaciones (`@/…` y relativas; estáticas, `export … from` e `import()`) desde las entradas, con la
 * regla de Next: un módulo es de CLIENTE si lleva `'use client'` o lo importa (transitivamente) uno de cliente. Solo
 * los de cliente cuentan, porque en el servidor `getTranslations`/`useTranslations` leen el catálogo completo de la
 * petición, no el provider. De cada módulo de cliente toma:
 *  - `useTranslations('<ns>[.…]')` ⇒ `<ns>`;
 *  - todo literal `'<ns>.<clave>'` / `` `<ns>.${…}` `` cuyo `<ns>` existe en el catálogo (cubre `useTranslations()` sin
 *    namespace + `t('error.X')`). Esto SOBRE-aproxima (un literal que no se traduce cuenta igual): los falsos
 *    positivos se nombran en el candado, uno por uno, con su porqué.
 * `src/lib/mock/**` no cuenta (el build sin mocks lo vacía, `next.config.mjs`), ni las pruebas.
 */
const SRC = resolve(__dirname, '..');
const EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const e of EXT) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile() && /\.tsx?$/.test(p)) return p;
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

export interface Closure {
  /** namespace → ficheros (relativos a `src/`) que lo piden. */
  used: Map<string, Set<string>>;
  clientFiles: Set<string>;
}

export function clientNamespaces(entries: string[], knownNamespaces: Iterable<string>): Closure {
  const known = new Set(knownNamespaces);
  const state = new Map<string, boolean>(); // fichero → ¿ya visitado como cliente?
  const queue: Array<[string, boolean]> = entries.map((e) => [resolve(SRC, e), false]);
  const used = new Map<string, Set<string>>();
  const clientFiles = new Set<string>();
  while (queue.length) {
    const [file, parentClient] = queue.pop()!;
    if (/\/lib\/mock\//.test(file) || /\.(test|spec)\.tsx?$/.test(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const client = parentClient || /^\s*['"]use client['"]/.test(raw);
    const prev = state.get(file);
    if (prev === true || (prev === false && !client)) continue;
    state.set(file, client);
    const code = stripComments(raw, file);
    for (const m of code.matchAll(IMPORT_RE)) {
      const r = resolveImport(file, m[1] ?? m[2] ?? m[3]);
      if (r) queue.push([r, client]);
    }
    if (!client) continue;
    const rel = relative(SRC, file);
    clientFiles.add(rel);
    const add = (ns: string) => {
      if (!known.has(ns)) return;
      if (!used.has(ns)) used.set(ns, new Set());
      used.get(ns)!.add(rel);
    };
    for (const m of code.matchAll(/useTranslations\(\s*['"]([^'"]+)['"]/g)) add(m[1].split('.')[0]);
    for (const m of code.matchAll(/['"`]([a-zA-Z]+)\.[a-zA-Z_$]/g)) add(m[1]);
  }
  return { used, clientFiles };
}
