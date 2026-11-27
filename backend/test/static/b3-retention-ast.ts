/**
 * §AUTO-ENLACE §13.4 — analizador ESTÁTICO (compilador de TypeScript: AST + type checker) de los escritores de `PriceReference` de fuente TCGCSV.
 * Detecta por TIPO, no por el literal `'tcgcsv_singles'`: una fuente que PUEDA resolver a TCGCSV (literal, constante, parámetro, spread, enum) en una
 * escritura (`priceReference.create|createMany|upsert|update|updateMany`, `persistMarketReference`, `$executeRaw*` sobre la tabla) exige el tipo
 * `RetainedPriceRow` (fila ya pasada por `shouldRetainTcgcsvPrice`): como argumento escrito o como parámetro de la función que escribe Y USADO en lo que se escribe.
 * AE-14 (§13.4(a), «lista cerrada de llamadores»): además, (1) todo uso de `releaseTcgcsvRow`/`tcgcsvPersistInput` (la única fuente de la marca, también por alias o
 * referencia suelta) fuera de `RELEASE_CALLERS` falla; (2) una aserción de tipo hacia `RetainedPriceRow` (alias, doble cast) fuera del módulo de la regla falla; (3) un escritor
 * alcanzado por el TIPO del delegado (desestructurado, alias, referencia suelta, `.call`) se trata igual que `db.priceReference.create`; (4) `$executeRaw*`/`$queryRaw*` en
 * forma de llamada (`Unsafe`) o etiquetada que escriba `PriceReference` falla igual.
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

/**
 * LISTA CERRADA de los únicos sitios (`archivo#función`) que pueden llamar a `releaseTcgcsvRow` / `tcgcsvPersistInput` (§13.4(a)): reciben filas ya filtradas o,
 * en los marcados, tienen un veredicto distinto del de B3 por construcción. Añadir uno exige revisión de dinero (qa + seguridad).
 */
export const RELEASE_CALLERS: Record<string, string> = {
  'modules/pricing/providers/tcgcsv-singles-bulk.provider.ts#fetchPricesForSet': 'provider único de §12.2(ii): aplica la regla con `{groupId, via}` reales y la referencia previa por producto|subtipo',
  'modules/catalog/card-product-resolver.service.ts#resolveCardProductsForSet': 'resolver (job, link-repair, sync, confirmaciones): `resolution` real y `prior` por producto|subtipo; falla cerrada',
  'modules/catalog/card-product-resolver.service.ts#writeConfirmedLink': 'confirmación por carta: el llamador ya aplicó `shouldRetainTcgcsvPrice` (card-link-confirm); `resolution` real y `prior` por producto|subtipo',
  'modules/pricing/price-ingest.service.ts#ingestSinglesForSet': 'barrido diario: `tcgcsvPersistInput` solo acepta la fila que el provider único ya marcó (lanza si no pasó por `releaseTcgcsvRow`)',
  'modules/pricing/stamped-ingest.service.ts#refreshPublished': '§14.2: en B3 sin confirmar solo refresca claves ya publicadas (prior=true), bajo price_jump y freno de cordura',
  'modules/pricing/stamped-ingest.service.ts#writePrices': 'liga ya con veredicto `release` de `cardVerdict` (explícito); `retain` no llega aquí y `b3` va por refreshPublished',
  'modules/catalog/tcgcsv-set-import.service.ts#writePrices': 'P-PROMOS import desde un grupo que elige el dueño: set nuevo sin enlaces previos; vía `confirmed` explícita',
  'modules/catalog/promo-set-products.service.ts#run': 'sets de promos de la tabla fija `PTCG_PROMO_GROUPS` (`promo_table`): sin escalera B3',
};
const RELEASERS = new Set(['releaseTcgcsvRow', 'tcgcsvPersistInput']);
const RULE_FILE = 'modules/pricing/providers/tcgcsv-group-match.ts';

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

  /**
   * AE-14: ¿lo que se escribe (`node`) DERIVA de un parámetro `RetainedPriceRow` de una función que lo envuelve? No basta con que la función declare uno
   * («parámetro irrelevante»): el parámetro marcado debe aparecer en la expresión escrita.
   */
  const usesBrandedParam = (node: ts.Node): boolean => {
    const branded = new Set<ts.Symbol>();
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (!ts.isFunctionLike(n)) continue;
      for (const prm of n.parameters) {
        if (!hasBrand(checker.getTypeAtLocation(prm))) continue;
        const sym = ts.isIdentifier(prm.name) ? checker.getSymbolAtLocation(prm.name) : undefined;
        if (sym) branded.add(sym);
        else return true; // parámetro desestructurado: no se puede seguir por símbolo; se acepta (la marca viaja en su tipo)
      }
    }
    if (branded.size === 0) return false;
    let used = false;
    const seen = new Set<ts.Node>();
    const scan = (x: ts.Node): void => {
      if (used || seen.has(x)) return;
      seen.add(x);
      if (ts.isIdentifier(x)) {
        const sym = checker.getSymbolAtLocation(x) ?? (ts.isShorthandPropertyAssignment(x.parent) ? checker.getShorthandAssignmentValueSymbol(x.parent) : undefined);
        if (sym && branded.has(sym)) used = true;
        // Sigue las variables locales (`const data = { source: market.source }; …create({ data })`): la fila marcada puede llegar por una constante intermedia.
        const decl = sym?.valueDeclaration;
        if (!used && decl && ts.isVariableDeclaration(decl) && decl.initializer) scan(decl.initializer);
        if (!used && decl && ts.isBindingElement(decl)) {
          let d: ts.Node = decl;
          while (d && !ts.isVariableDeclaration(d) && !ts.isParameter(d)) d = d.parent;
          if (d && ts.isVariableDeclaration(d) && d.initializer) scan(d.initializer);
          if (d && ts.isParameter(d) && hasBrand(checker.getTypeAtLocation(d))) used = true; // desestructurado desde un parámetro marcado
        }
      }
      ts.forEachChild(x, scan);
    };
    scan(node);
    return used;
  };

  /** ¿La expresión es el delegado Prisma de `PriceReference` (por nombre o por TIPO: desestructurado, alias, `tx`, `db['priceReference']`)? */
  const isPriceRefDelegate = (e: ts.Expression): boolean => {
    if (ts.isPropertyAccessExpression(e) && e.name.text === 'priceReference') return true;
    if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) && e.argumentExpression.text === 'priceReference') return true;
    const t = checker.getTypeAtLocation(e);
    return /PriceReferenceDelegate/.test(t.symbol?.name ?? '') || /PriceReferenceDelegate/.test(checker.typeToString(t));
  };

  /** Símbolo de `releaseTcgcsvRow`/`tcgcsvPersistInput` (con alias resuelto) si el identificador/acceso lo nombra. */
  const releaserOf = (e: ts.Node): string | null => {
    const id = ts.isPropertyAccessExpression(e) ? e.name : ts.isIdentifier(e) ? e : null;
    if (!id) return null;
    let sym = checker.getSymbolAtLocation(id);
    if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const name = sym?.name ?? id.text;
    if (!RELEASERS.has(name)) return null;
    return sym?.declarations?.some((d) => d.getSourceFile().fileName.endsWith(RULE_FILE)) || !sym?.declarations?.length ? name : null;
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
      const inRule = rel === RULE_FILE;
      // (1) lista cerrada de llamadores del liberador de marca (también por alias, namespace o referencia suelta).
      if (!inRule && (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n)) && !ts.isImportSpecifier(n.parent) && !ts.isExportSpecifier(n.parent) && !ts.isImportClause(n.parent) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
        const r = releaserOf(n);
        if (r && !RELEASE_CALLERS[`${rel}#${fnName(n)}`]) report(n, `${r} llamado fuera de la lista cerrada de llamadores (RELEASE_CALLERS)`);
      }
      // (2) forjar la marca con una aserción (alias de tipo, doble cast) fuera del módulo de la regla.
      if (!inRule && (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && hasBrand(checker.getTypeFromTypeNode(n.type))) report(n, 'aserción de tipo hacia RetainedPriceRow (forja de la marca)');
      // (3) escritor alcanzado por el TIPO del delegado, también como referencia suelta (`const c = db.priceReference.create`, `.call`, `.bind`).
      if (ts.isPropertyAccessExpression(n) && WRITERS.has(n.name.text) && isPriceRefDelegate(n.expression)) {
        const isCallee = ts.isCallExpression(n.parent) && n.parent.expression === n;
        if (!isCallee && !usesBrandedParam(n)) report(n, `referencia suelta a priceReference.${n.name.text} (el escritor escapa del análisis)`);
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const callee = n.expression;
        const name = callee.name.text;
        const onPriceRef = isPriceRefDelegate(callee.expression);
        if (onPriceRef && WRITERS.has(name) && n.arguments[0]) {
          const risky = sourceTypes(n.arguments[0]).some(mayBeTcgcsv);
          const branded = usesBrandedParam(n.arguments[0]) || hasBrand(checker.getTypeAtLocation(n.arguments[0]));
          if (risky && !branded) report(n, `priceReference.${name} con fuente que puede ser TCGCSV sin RetainedPriceRow`);
        } else if (name === 'persistMarketReference' && n.arguments[2]) {
          const t = checker.getTypeAtLocation(n.arguments[2]);
          const risky = [...sourceTypes(n.arguments[2]), ...typeSources(t, 0)].some(mayBeTcgcsv);
          if (risky && !hasBrand(t) && !(ts.isObjectLiteralExpression(n.arguments[2]) && !sourceTypes(n.arguments[2]).some(mayBeTcgcsv))) report(n, 'persistMarketReference con fuente que puede ser TCGCSV sin RetainedPriceRow');
        } else if (/^\$(execute|query)Raw(Unsafe)?$/.test(name)) {
          // (4) forma de llamada (`Unsafe` o `$executeRaw(Prisma.sql…)`): SQL que escribe PriceReference, o SQL no literal en un `$execute*` (no se puede probar que no escriba).
          const a0 = n.arguments[0];
          const lit = a0 && ts.isStringLiteralLike(a0) ? a0.text : a0 && ts.isTemplateExpression(a0) ? a0.getText() : null;
          const writesTable = lit != null ? /PriceReference/.test(lit) && !/^\s*(SELECT|WITH\s[\s\S]*\bSELECT)\b/i.test(lit) && /\b(INSERT|UPDATE|DELETE|MERGE|COPY)\b/i.test(lit) : (/PriceReference/.test(n.getText()) && /\b(INSERT|UPDATE|DELETE|MERGE|COPY)\b/i.test(n.getText())) || name === '$executeRawUnsafe';
          if (writesTable && !usesBrandedParam(n)) report(n, `${name} que puede escribir PriceReference sin RetainedPriceRow`);
        }
      }
      if (ts.isTaggedTemplateExpression(n) && /^\$(executeRaw|queryRaw)/.test(n.tag.getText().split('.').pop() ?? '') && /PriceReference/.test(n.template.getText()) && !/^\s*SELECT\b/i.test(n.template.getText().replace(/^`/, ''))) {
        if (!usesBrandedParam(n)) report(n, '$executeRaw sobre PriceReference sin RetainedPriceRow');
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
