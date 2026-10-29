/**
 * R1 (techlead §DYN.3, 2026-10-29) · la frontera de los MOCKS, como análisis de código.
 *
 * Con mocks apagados, `next.config.mjs` (`mockModuleAliases`) resuelve cada módulo de `src/lib/mock/` a un
 * módulo VACÍO. Un export de `lib/mock/*` usado fuera de una rama inalcanzable vale entonces `undefined` en
 * producción, y ni webpack, ni vitest (que corre con mocks), ni el E2E de mocks lo ven. Esto lo mide:
 *
 *  (a) `mockImportersOf`: qué fichero de código (no prueba) importa algo de `src/lib/mock/`;
 *  (b) `unguardedMockReferences`: en un fichero autorizado, qué referencia a un nombre importado de
 *      `./mock/*` NO queda bajo la guarda `(MOCKS_BUILD && config.useMocks)`.
 *
 * Lo usa `mock-boundary.test.ts`. Vive en `src/test/` (no se empaqueta).
 */
import ts from 'typescript';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Guarda canónica: la única forma que el minificador pliega con `MOCKS_BUILD` horneado a `false`. */
export const GUARD_TEXT = 'MOCKS_BUILD && config.useMocks';

const strip = (e: ts.Expression): ts.Expression => {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
};

const isGuard = (e: ts.Expression, sf: ts.SourceFile): boolean => {
  const x = strip(e);
  if (x.getText(sf).replace(/\s+/g, ' ') === GUARD_TEXT) return true;
  // `(guarda) && otra cosa`: la guarda es un conyunto, la rama verdadera sigue bajo ella.
  return ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ? isGuard(x.left, sf) || isGuard(x.right, sf)
    : false;
};

const isNegGuard = (e: ts.Expression, sf: ts.SourceFile): boolean => {
  const x = strip(e);
  return ts.isPrefixUnaryExpression(x) && x.operator === ts.SyntaxKind.ExclamationToken && strip(x.operand).getText(sf).replace(/\s+/g, ' ') === GUARD_TEXT;
};

/** La sentencia siempre sale (return/throw), también como bloque cuyo último paso sale. */
const exits = (s: ts.Statement): boolean => {
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return true;
  if (ts.isBlock(s)) return s.statements.length > 0 && exits(s.statements[s.statements.length - 1]);
  return false;
};

/** ¿El especificador apunta a `src/lib/mock` (o dentro)? Resuelve `@/` y rutas relativas. */
export function resolvesToMock(spec: string, fromFile: string, srcDir: string): boolean {
  const mockDir = join(srcDir, 'lib', 'mock');
  let target: string;
  if (spec === '@/lib/mock' || spec.startsWith('@/lib/mock/')) return true;
  if (spec.startsWith('@/')) target = join(srcDir, spec.slice(2));
  else if (spec.startsWith('.')) target = resolve(dirname(fromFile), spec);
  else return false;
  return target === mockDir || target.startsWith(mockDir + sep);
}

/** Especificadores de módulo de un fichero: `import`/`export … from`, `import()` y `require()`, con su tipo. */
export function moduleSpecifiers(source: string, fileName: string): { spec: string; typeOnly: boolean; line: number }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { spec: string; typeOnly: boolean; line: number }[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      out.push({ spec: n.moduleSpecifier.text, typeOnly, line: line(n) });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ spec: n.moduleSpecifier.text, typeOnly: n.isTypeOnly, line: line(n) });
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])) {
      const isDyn = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isReq = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if (isDyn || isReq) out.push({ spec: (n.arguments[0] as ts.StringLiteralLike).text, typeOnly: false, line: line(n) });
    } else if (ts.isImportTypeNode(n)) {
      // `import('…').X` en posición de tipo: se borra al compilar.
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** (a) Ficheros que importan de `src/lib/mock` en valor (los `import type` se borran al compilar). */
export function mockImportersOf(files: { path: string; source: string }[], srcDir: string): { file: string; line: number; spec: string }[] {
  const hits: { file: string; line: number; spec: string }[] = [];
  for (const { path, source } of files) {
    for (const s of moduleSpecifiers(source, path)) {
      if (!s.typeOnly && resolvesToMock(s.spec, path, srcDir)) hits.push({ file: relative(join(srcDir, '..'), path), line: s.line, spec: s.spec });
    }
  }
  return hits;
}

export interface MockReference {
  name: string;
  line: number;
  text: string;
}

/**
 * (b) Referencias a nombres importados de `./mock/*` que NO quedan bajo la guarda. Una referencia queda
 * guardada si, subiendo por sus ancestros, encuentra una de estas formas antes de llegar al nivel del módulo:
 *  - `if (guarda) { ref }` (también `if ((guarda) && x)`), `guarda ? ref : …`, `guarda && ref`;
 *  - `if (!(guarda)) … else { ref }`, `!(guarda) ? … : ref`;
 *  - en un bloque, tras `if (!(guarda)) return/throw …;` sin `else` (la forma de casi todas las funciones).
 * Si llega al nivel del módulo dentro de una función (o `const f = () => …`) NO exportada, la referencia
 * cuenta como guardada solo si TODAS las referencias a esa función están guardadas (p. ej. `mocked()` de
 * `marketing-api.ts`). Las posiciones de tipo no cuentan (se borran al compilar). Cualquier otra cosa
 * (nivel de módulo, `export … from './mock/…'`) es una referencia sin guarda. Una función EXPORTADA solo cuenta
 * como guardada si, además, `usedOutside(nombre)` es falso (la exportan las pruebas de paridad: `mockDiscountedDirectShip`,
 * `mockWithdrawalDiscount`); quien llama decide qué es «fuera» (en la prueba: cualquier fichero de código que no sea prueba).
 */
export function unguardedMockReferences(
  source: string,
  fileName: string,
  usedOutside: (exportedName: string) => boolean = () => true,
): { refs: number; unguarded: MockReference[]; problems: string[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  const mockNames = new Set<string>();
  const isMockSpec = (s: string) => /^\.\/mock(\/|$)/.test(s) || /^@\/lib\/mock(\/|$)/.test(s);

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && isMockSpec(st.moduleSpecifier.text)) {
      const c = st.importClause;
      if (!c) problems.push(`import de efecto lateral de ${st.moduleSpecifier.text}`);
      if (!c || c.isTypeOnly) continue;
      if (c.name) mockNames.add(c.name.text);
      const nb = c.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) mockNames.add(nb.name.text);
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!e.isTypeOnly) mockNames.add(e.name.text);
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && isMockSpec(st.moduleSpecifier.text) && !st.isTypeOnly) {
      problems.push(`re-export de ${st.moduleSpecifier.text} (línea ${sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1})`);
    }
  }

  // La guarda solo pliega si MOCKS_BUILD es el literal horneado.
  const mb = source.match(/^const MOCKS_BUILD = (.*);$/m);
  if (mockNames.size > 0 && (!mb || mb[1].trim() !== "process.env.NEXT_PUBLIC_USE_MOCKS === 'true'")) {
    problems.push("falta `const MOCKS_BUILD = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';` (la guarda no se pliega sin él)");
  }

  // Funciones de nivel de módulo: nombre → nodo de su sentencia, y si se exportan.
  const topFns = new Map<string, { stmt: ts.Statement; exported: boolean }>();
  const isExported = (s: ts.Statement) => !!ts.getModifiers(s as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) topFns.set(st.name.text, { stmt: st, exported: isExported(st) });
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          topFns.set(d.name.text, { stmt: st, exported: isExported(st) });
        }
      }
    }
  }

  const isTypePosition = (n: ts.Node): boolean => {
    for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
      if (ts.isExpression(p) && !ts.isExpressionWithTypeArguments(p)) return false;
    }
    return false;
  };

  /** Identificadores que nombran `name` como valor (no como propiedad, clave ni declaración de import). */
  const referencesTo = (names: Set<string>): ts.Identifier[] => {
    const out: ts.Identifier[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isIdentifier(n) && names.has(n.text)) {
        const p = n.parent;
        const isDecl =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isQualifiedName(p) && p.right === n) ||
          ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isParameter(p) || ts.isBindingElement(p)) &&
            (p as ts.NamedDeclaration).name === n);
        if (!isDecl && !isTypePosition(n)) out.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };

  /** Guarda local (sin cruzar el nivel de módulo). Devuelve 'guarded' o la sentencia de nivel de módulo. */
  const localGuard = (node: ts.Node): 'guarded' | ts.Statement => {
    let child: ts.Node = node;
    for (let p = node.parent; p; child = p, p = p.parent) {
      if (ts.isIfStatement(p)) {
        if (child === p.thenStatement && isGuard(p.expression, sf)) return 'guarded';
        if (child === p.elseStatement && isNegGuard(p.expression, sf)) return 'guarded';
      }
      if (ts.isConditionalExpression(p)) {
        if (child === p.whenTrue && isGuard(p.condition, sf)) return 'guarded';
        if (child === p.whenFalse && isNegGuard(p.condition, sf)) return 'guarded';
      }
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && child === p.right && isGuard(p.left, sf)) return 'guarded';
      if ((ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) && !ts.isSourceFile(p)) {
        const stmts = (p as ts.Block).statements;
        const i = stmts.indexOf(child as ts.Statement);
        for (let j = 0; j < i; j++) {
          const s = stmts[j];
          if (ts.isIfStatement(s) && !s.elseStatement && isNegGuard(s.expression, sf) && exits(s.thenStatement)) return 'guarded';
        }
      }
      if (ts.isSourceFile(p)) return child as ts.Statement;
    }
    throw new Error('sin SourceFile');
  };

  const fnGuarded = new Map<string, boolean>();
  const isGuardedRef = (node: ts.Node, stack: Set<string>): boolean => {
    const r = localGuard(node);
    if (r === 'guarded') return true;
    const fn = [...topFns.entries()].find(([, v]) => v.stmt === r);
    if (!fn) return false; // nivel de módulo: se evalúa al cargar
    const [name, { exported }] = fn;
    if (exported && usedOutside(name)) return false;
    if (fnGuarded.has(name)) return fnGuarded.get(name)!;
    if (stack.has(name)) return true; // recursión: decide la llamada externa
    stack.add(name);
    const ok = referencesTo(new Set([name])).every((id) => isGuardedRef(id, stack));
    stack.delete(name);
    fnGuarded.set(name, ok);
    return ok;
  };

  const refs = referencesTo(mockNames);
  const unguarded = refs
    .filter((id) => !isGuardedRef(id, new Set()))
    .map((id) => {
      const line = sf.getLineAndCharacterOfPosition(id.getStart(sf)).line + 1;
      return { name: id.text, line, text: source.split('\n')[line - 1].trim() };
    });
  return { refs: refs.length, unguarded, problems };
}
