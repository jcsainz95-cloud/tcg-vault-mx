import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { stripComments } from './strip-comments';

/**
 * ident-census.ts — **censo cerrado de un identificador en `src/`** (patrón **VK-6**, v1.80.2.2).
 *
 * Nació en `pricing.valuation-callers-census.spec.ts` (VK-6, SK-5) y se extrae aquí para que los
 * candados de forma de dinero compartan UN instrumento en vez de tres copias del mismo recorrido:
 * VK-6 (llave de cola), BC-9(b) (`bountyPayoutCents`/`bountyGuardBasis`/`isBountyEffective`) y el
 * candado de `quoteAcquisitionFromCurve` con controles (D-2 del techlead, 2026-09-29).
 *
 * Qué mide: **apariciones del identificador en CÓDIGO** (comentarios fuera, con el autómata compartido
 * `strip-comments.ts`), no solo llamadas con paréntesis — `xs.map(fn)` también es usarla, y un
 * `import` también cuenta porque es el primer síntoma de un llamador nuevo.
 *
 * ⛔ Instrumento de pruebas (léxico): un alias o un `...args` lo esquiva; la revisión lo cubre.
 */

/** Ficheros `.ts` de producción bajo `dir` (sin `.spec.ts`). */
export function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSources(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** Nº de apariciones de `ident` (regex GLOBAL) en el CÓDIGO (sin comentarios) de un texto fuente. */
export function countIdentUses(source: string, ident: RegExp): number {
  if (!ident.global) throw new Error('countIdentUses: la regex debe ser global (/g)');
  return (stripComments(source).match(ident) ?? []).length;
}

/** `{ 'ruta/relativa/a/src.ts': n }` solo para los ficheros con `n > 0`. */
export function identCensus(srcRoot: string, ident: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walkSources(srcRoot)) {
    const n = countIdentUses(readFileSync(f, 'utf8'), ident);
    if (n > 0) out[relative(srcRoot, f).split(sep).join('/')] = n;
  }
  return out;
}

/**
 * Cuerpo de un MIEMBRO de clase desde `anchor` (p. ej. `'async publicBounties('`) hasta el siguiente
 * miembro (`\n  private|protected|public|static|async|readonly|get|set `) o el cierre de la clase.
 * Lanza si el ancla no existe: una prueba que mide sobre un cuerpo vacío no mide nada.
 */
export function methodBody(code: string, anchor: string): string {
  return sliceFrom(code, anchor, /\n  (?:private|protected|public|static|async|readonly|get|set)\b|\n\}/);
}

/** Cuerpo de una FUNCIÓN de nivel superior desde `anchor` hasta la siguiente declaración de nivel superior. */
export function topLevelBody(code: string, anchor: string): string {
  return sliceFrom(code, anchor, /\n(?:export|function|const|let|var|class|interface|type|declare|enum)\b/);
}

/**
 * Nº de argumentos de CADA llamada `fnName(...)` en `code` (paréntesis/corchetes/llaves balanceados;
 * las comas de profundidad 1 separan argumentos). `[]` si no hay llamadas. Pásale código ya sin
 * comentarios (`stripComments`) si no quieres contar la prosa.
 */
export function callArgCounts(code: string, fnName: string): number[] {
  const out: number[] = [];
  const re = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let depth = 1;
    let commas = 0;
    let nonBlank = false;
    let lastSignificant = '';
    let i = m.index + m[0].length;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === "'" || c === '"' || c === '`') {
        // Cadena: se salta entera (sus comas/paréntesis no cuentan); es UN token no vacío.
        i += 1;
        while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
        nonBlank = true;
        lastSignificant = c;
        i += 1;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 1) commas += 1;
      if (depth > 0 && !/\s/.test(c)) {
        nonBlank = true;
        lastSignificant = c;
      }
      i += 1;
    }
    // Coma final (`"trailingComma": "all"` de prettier): no abre un argumento más.
    if (lastSignificant === ',') commas -= 1;
    out.push(nonBlank ? commas + 1 : 0);
  }
  return out;
}

function sliceFrom(code: string, anchor: string, boundary: RegExp): string {
  const at = code.indexOf(anchor);
  if (at < 0) throw new Error(`ancla no encontrada: ${anchor}`);
  const rest = code.slice(at + anchor.length);
  const m = boundary.exec(rest);
  return anchor + (m ? rest.slice(0, m.index) : rest);
}
