/**
 * §AUTO-ENLACE §13.4 — analizador ESTÁTICO (compilador de TypeScript: AST + type checker) de los escritores de `PriceReference` de fuente TCGCSV.
 * Detecta por TIPO, no por el literal `'tcgcsv_singles'`: una fuente que PUEDA resolver a TCGCSV (literal, constante, parámetro, spread, enum) en una
 * escritura (`priceReference.create|createMany|upsert|update|updateMany`, `persistMarketReference`, `$executeRaw*` sobre la tabla) exige el tipo
 * `RetainedPriceRow` (fila ya pasada por `shouldRetainTcgcsvPrice`): como argumento escrito o como parámetro de la función que escribe.
 */
import * as ts from 'typescript';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

export const BACKEND = join(__dirname, '..', '..');
const WRITERS = new Set(['create', 'createMany', 'upsert', 'update', 'updateMany']);
const DATA_KEYS = new Set(['data', 'create', 'update']);

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [join(d, f)] : []));

export interface Violation { file: string; line: number; kind: string; text: string; fn: string }

/** Escritores que PUEDEN llevar fuente TCGCSV sin `RetainedPriceRow`, con su motivo (lista CERRADA; añadir uno exige revisión de dinero). */
export const EXEMPT: Record<string, string> = {
  'modules/pricing/pricing.service.ts#promoteRobustReference': 'acción humana del dueño (`accept` de un caso de revisión): promueve el número que él aceptó; no ingiere ningún feed',
};

/** Programa con `src/**` real más archivos virtuales (los mutantes) que no existen en disco. */
export function buildProgram(virtual: Record<string, string> = {}): ts.Program {
  const cfg = ts.readConfigFile(join(BACKEND, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, BACKEND);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined, skipLibCheck: true };
  const virtualAbs = new Map(Object.entries(virtual).map(([k, v]) => [join(BACKEND, k), v]));
  const host = ts.createCompilerHost(options);
  const orig = { getSourceFile: host.getSourceFile.bind(host), fileExists: host.fileExists.bind(host), readFile: host.readFile.bind(host) };
  host.fileExists = (f) => virtualAbs.has(f) || orig.fileExists(f);
  host.readFile = (f) => virtualAbs.get(f) ?? orig.readFile(f);
  host.getSourceFile = (f, lang, ...rest) => (virtualAbs.has(f) ? ts.createSourceFile(f, virtualAbs.get(f)!, lang, true) : orig.getSourceFile(f, lang, ...rest));
  return ts.createProgram({ rootNames: [...walk(join(BACKEND, 'src')), ...virtualAbs.keys()], options, host });
}

const hasBrand = (t: ts.Type): boolean => (t.isUnionOrIntersection() ? t.types.some(hasBrand) : t.getProperties().some((p) => p.name.includes('retainedBrand')));

function mayBeTcgcsv(t: ts.Type): boolean {
  if (t.isUnion()) return t.types.some(mayBeTcgcsv);
  if (t.isStringLiteral()) return t.value === 'tcgcsv_singles';
  return (t.flags & (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0;
}

export function analyze(program: ts.Program, onlyFiles?: (rel: string) => boolean): Violation[] {
  const checker = program.getTypeChecker();
  const out: Violation[] = [];

  /** Tipos de todo valor `source` que la escritura pueda llevar (literal por nodo; el resto por tipo, acotado a data/create/update). */
  const sourceTypes = (node: ts.Node, depth = 0): ts.Type[] => {
    if (depth > 6) return [];
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return sourceTypes(node.expression, depth + 1);
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((e) => sourceTypes(e, depth + 1));
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return ts.isBlock(node.body) ? [] : sourceTypes(node.body, depth + 1);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') return node.arguments.flatMap((a) => sourceTypes(a, depth + 1));
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.flatMap((p): ts.Type[] => {
        if (ts.isSpreadAssignment(p)) return typeSources(checker.getTypeAtLocation(p.expression), 0);
        const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : '';
        if (name === 'source') return [ts.isShorthandPropertyAssignment(p) ? checker.getTypeAtLocation(p.name) : ts.isPropertyAssignment(p) ? checker.getTypeAtLocation(p.initializer) : checker.getTypeAtLocation(p)];
        if (DATA_KEYS.has(name) && ts.isPropertyAssignment(p)) return sourceTypes(p.initializer, depth + 1);
        return [];
      });
    }
    return typeSources(checker.getTypeAtLocation(node), 0);
  };
  const typeSources = (t: ts.Type, depth: number): ts.Type[] => {
    if (depth > 4) return [];
    if (t.isUnionOrIntersection()) return t.types.flatMap((x) => typeSources(x, depth + 1));
    const elem = checker.getIndexTypeOfType(t, ts.IndexKind.Number);
    if (elem) return typeSources(elem, depth + 1);
    const out2: ts.Type[] = [];
    for (const p of t.getProperties()) {
      const pt = checker.getTypeOfSymbol(p);
      if (p.name === 'source') out2.push(pt);
      else if (DATA_KEYS.has(p.name)) out2.push(...typeSources(pt, depth + 1));
    }
    return out2;
  };

  /** ¿Alguna función que envuelve el nodo recibe un parámetro de tipo `RetainedPriceRow`? */
  const enclosingHasBrandedParam = (node: ts.Node): boolean => {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n) && n.parameters.some((prm) => hasBrand(checker.getTypeAtLocation(prm)))) return true;
    }
    return false;
  };

  for (const sf of program.getSourceFiles()) {
    const rel = relative(join(BACKEND, 'src'), sf.fileName).replace(/\\/g, '/');
    if (!sf.fileName.startsWith(join(BACKEND, 'src'))) continue;
    if (onlyFiles && !onlyFiles(rel)) continue;
    const fnName = (n: ts.Node): string => {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p)) && p.name) return p.name.getText();
      return '';
    };
    const report = (n: ts.Node, kind: string): void => {
      const fn = fnName(n);
      if (EXEMPT[`${rel}#${fn}`]) return;
      out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, kind, text: n.getText().slice(0, 80).replace(/\s+/g, ' '), fn });
    };
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const callee = n.expression;
        const name = callee.name.text;
        const onPriceRef = ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'priceReference';
        if (onPriceRef && WRITERS.has(name) && n.arguments[0]) {
          const risky = sourceTypes(n.arguments[0]).some(mayBeTcgcsv);
          const branded = enclosingHasBrandedParam(n) || hasBrand(checker.getTypeAtLocation(n.arguments[0]));
          if (risky && !branded) report(n, `priceReference.${name} con fuente que puede ser TCGCSV sin RetainedPriceRow`);
        } else if (name === 'persistMarketReference' && n.arguments[2]) {
          const t = checker.getTypeAtLocation(n.arguments[2]);
          const risky = [...sourceTypes(n.arguments[2]), ...typeSources(t, 0)].some(mayBeTcgcsv);
          if (risky && !hasBrand(t) && !(ts.isObjectLiteralExpression(n.arguments[2]) && !sourceTypes(n.arguments[2]).some(mayBeTcgcsv))) report(n, 'persistMarketReference con fuente que puede ser TCGCSV sin RetainedPriceRow');
        }
      }
      if (ts.isTaggedTemplateExpression(n) && /^\$(executeRaw|queryRaw)/.test(n.tag.getText().split('.').pop() ?? '') && /PriceReference/.test(n.template.getText()) && !/^\s*SELECT\b/i.test(n.template.getText().replace(/^`/, ''))) {
        if (!enclosingHasBrandedParam(n)) report(n, '$executeRaw sobre PriceReference sin RetainedPriceRow');
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
