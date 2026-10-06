/**
 * bsd-census.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.11 BSD-B23 y BSD-B25). Los dos censos que vigilan el PRECIO de meter la
 * guía de entrada del buylist como una fila más de `ShipmentRequest` (ARCHITECTURE §4.BSD (b)).
 *
 *  1. `shipmentReaderSites` — cada lector POR FILTRO de `ShipmentRequest` en `src/`: las llamadas
 *     `*.shipmentRequest.{findMany,findFirst,findFirstOrThrow,count,aggregate,groupBy,updateMany}(…)` y todo literal de
 *     plantilla/cadena con `"ShipmentRequest"` (SQL crudo). La tabla del test los clasifica.
 *  2. `sellRequestStatusWriteSites` — cada escritura de `SellRequest` (`update`/`updateMany`/`upsert`) cuyo `data` pone
 *     `status` (o es OPACO: un `...identificador` cuyo contenido no se ve). La tabla del test dice cuáles pueden sacar una
 *     solicitud de `aceptada` (⇒ I-BSD-1: `closeInboundShipment` en la misma función).
 *
 * ### Por qué con el compilador de TypeScript y no con regex
 * Los censos hermanos (`shipment-status-writers.ts`) recortan argumentos contando llaves; aquí hace falta además el
 * NOMBRE de la función que contiene la llamada (la llave estable de la tabla: `fichero función#verbo#ordinal`, sin
 * números de línea que se muevan con cada edición). El AST da las dos cosas sin heurística y sin mirar comentarios.
 *
 * ⛔ Instrumento de pruebas. Su límite, dicho: un lector que llegue a la tabla por una RELACIÓN (`order.findMany({ include:
 * { shipments } })`) o por un alias del cliente (`const sr = tx.shipmentRequest; sr.findMany(…)`) no sale. El contrato
 * acota el censo a esas formas (§BSD.11 BSD-B23) y el CHECK `shipment_kind_link` es el muro de debajo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { stripComments } from './strip-comments';

export const READER_METHODS = ['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany'] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** La función con NOMBRE que contiene el nodo (método, función, o flecha asignada a variable/propiedad). */
function enclosing(node: ts.Node): { name: string; node: ts.Node | null } {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isGetAccessorDeclaration(p)) && p.name) {
      return { name: p.name.getText(), node: p };
    }
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      const q = p.parent;
      if ((ts.isVariableDeclaration(q) || ts.isPropertyAssignment(q) || ts.isPropertyDeclaration(q)) && q.name) {
        return { name: q.name.getText(), node: p };
      }
    }
  }
  return { name: '<top>', node: null };
}

/** El método/función MÁS EXTERNO con nombre (para buscar variables declaradas en el cuerpo del método entero). */
function outermostFunction(node: ts.Node): ts.Node | null {
  let found: ts.Node | null = null;
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) found = p;
    if (ts.isClassDeclaration(p) || ts.isSourceFile(p)) break;
  }
  return found;
}

/** Texto de las inicializaciones de `name` (variables) dentro de `scope`. */
function initializersOf(scope: ts.Node, name: string): string[] {
  const out: string[] = [];
  const v = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.name.getText() === name && n.initializer) out.push(n.initializer.getText());
    ts.forEachChild(n, v);
  };
  v(scope);
  return out;
}

export interface ReaderSite {
  /** `src/…/fichero.ts función#verbo#n` (n = ordinal del verbo dentro de la función). Verbo `sql` = SQL crudo. */
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly method: string;
  /** El texto del argumento (o de la plantilla SQL), sin espacios repetidos. */
  readonly text: string;
  /**
   * El filtro `outbound_only` está: el argumento contiene `OUTBOUND_ONLY` (o el SQL `outboundOnlySql(`), o el argumento
   * nombra una variable cuya inicialización, en la misma función, lo contiene.
   */
  readonly outboundFiltered: boolean;
}

export function shipmentReaderSites(backendRoot: string): ReaderSite[] {
  const out: ReaderSite[] = [];
  for (const f of walk(join(backendRoot, 'src'))) {
    const rel = relative(backendRoot, f);
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    const ordinal = new Map<string, number>();
    const push = (node: ts.Node, method: string, textNode: ts.Node, idents: string[]): void => {
      const fn = enclosing(node).name;
      const k = `${fn}#${method}`;
      const n = (ordinal.get(k) ?? 0) + 1;
      ordinal.set(k, n);
      const text = textNode.getText().replace(/\s+/g, ' ');
      let filtered = /\bOUTBOUND_ONLY\b|\boutboundOnlySql\(/.test(text);
      if (!filtered) {
        const scope = outermostFunction(node);
        if (scope) filtered = idents.some((id) => initializersOf(scope, id).some((t) => /\bOUTBOUND_ONLY\b/.test(t)));
      }
      out.push({ key: `${rel} ${k}#${n}`, file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, method, text, outboundFiltered: filtered });
    };
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const verb = n.expression.name.text;
        const obj = n.expression.expression;
        if ((READER_METHODS as readonly string[]).includes(verb) && ts.isPropertyAccessExpression(obj) && obj.name.text === 'shipmentRequest') {
          const arg = n.arguments[0] ?? n;
          const idents: string[] = [];
          if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const p of arg.properties) {
              if (ts.isShorthandPropertyAssignment(p)) idents.push(p.name.getText());
              else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)) idents.push(p.initializer.getText());
            }
          }
          push(n, verb, arg, idents);
        }
      }
      if ((ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isStringLiteral(n)) && /"ShipmentRequest"/.test(n.getText())) {
        push(n, 'sql', n, []);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

export interface StatusWriteSite {
  /** `src/…/fichero.ts función#verbo#n`. */
  readonly key: string;
  readonly file: string;
  readonly line: number;
  /** `data` pone `status` con una propiedad visible (`true`) o es opaco (`'opaque'`: un `...identificador`). */
  readonly writes: true | 'opaque';
  /** El texto (código, sin comentarios) de la función con nombre que contiene la escritura. */
  readonly fnText: string;
}

/** ¿El nodo `data` pone `status`? `true` si hay una propiedad `status`; `'opaque'` si esparce un identificador; si no, `false`. */
function statusIn(node: ts.Node): true | 'opaque' | false {
  let found: true | 'opaque' | false = false;
  const v = (n: ts.Node): void => {
    if (found === true) return;
    if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && n.name.getText() === 'status') {
      found = true;
      return;
    }
    if (ts.isSpreadAssignment(n) && (ts.isIdentifier(n.expression) || ts.isPropertyAccessExpression(n.expression) || ts.isCallExpression(n.expression))) {
      found = 'opaque';
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return found;
}

export function sellRequestStatusWriteSites(backendRoot: string): StatusWriteSite[] {
  const out: StatusWriteSite[] = [];
  for (const f of walk(join(backendRoot, 'src'))) {
    const rel = relative(backendRoot, f);
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    const ordinal = new Map<string, number>();
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const verb = n.expression.name.text;
        const obj = n.expression.expression;
        if (['update', 'updateMany', 'upsert'].includes(verb) && ts.isPropertyAccessExpression(obj) && obj.name.text === 'sellRequest') {
          const arg = n.arguments[0];
          let writes: true | 'opaque' | false = 'opaque';
          if (arg && ts.isObjectLiteralExpression(arg)) {
            writes = false;
            for (const p of arg.properties) {
              if (ts.isPropertyAssignment(p) && ['data', 'update', 'create'].includes(p.name.getText())) {
                const s = ts.isIdentifier(p.initializer) ? 'opaque' : statusIn(p.initializer);
                if (s === true || (s === 'opaque' && writes === false)) writes = s;
              }
              if (ts.isShorthandPropertyAssignment(p) && p.name.getText() === 'data' && writes === false) writes = 'opaque';
            }
          }
          if (writes !== false) {
            const enc = enclosing(n);
            const k = `${enc.name}#${verb}`;
            const i = (ordinal.get(k) ?? 0) + 1;
            ordinal.set(k, i);
            out.push({
              key: `${rel} ${k}#${i}`,
              file: rel,
              line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
              writes,
              fnText: stripComments(enc.node ? enc.node.getText() : ''),
            });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** Ficheros `.ts` de `src/` con su CÓDIGO (sin comentarios), para el candado léxico de BSD-B25 (a). */
export function sourcesWithoutComments(backendRoot: string): { file: string; code: string }[] {
  return walk(join(backendRoot, 'src')).map((f) => ({ file: relative(backendRoot, f), code: stripComments(readFileSync(f, 'utf8')) }));
}
