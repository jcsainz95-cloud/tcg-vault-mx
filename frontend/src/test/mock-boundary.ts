/**
 * R1 (techlead §DYN.3, 2026-10-29) · la frontera de los MOCKS, como análisis de código.
 *
 * Con mocks apagados, `next.config.mjs` (`mockModuleAliases`) resuelve cada módulo de `src/lib/mock/` a un
 * módulo VACÍO. Un export de `lib/mock/*` usado fuera de una rama inalcanzable vale entonces `undefined` en
 * producción, y ni webpack, ni vitest (que corre con mocks), ni el E2E de mocks lo ven. Esto lo mide:
 *
 *  (a) `mockImportersOf`: qué fichero de código (no prueba) importa algo de `src/lib/mock/`;
 *  (b) `unguardedMockReferences`: en un fichero autorizado, qué referencia a un nombre importado de
 *      `src/lib/mock` (cualquier forma del especificador que resuelva ahí) NO queda bajo la guarda
 *      `(MOCKS_BUILD && config.useMocks)`; y, como problema, todo `import()`/`require()` de `lib/mock` (TL-DYN3R-1).
 *
 * Lo usa `mock-boundary.test.ts`. Vive en `src/test/` (no se empaqueta).
 */
import ts from 'typescript';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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

/** Ruta absoluta a la que apunta un especificador (`@/` o relativo), sin resolver extensión; `null` si es un paquete. */
export function resolveSpec(spec: string, fromFile: string, srcDir: string): string | null {
  if (spec === '@' || spec.startsWith('@/')) return join(srcDir, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(fromFile), spec);
  return null;
}

/** ¿El especificador apunta a `src/lib/mock` (o dentro)? Resuelve `@/` y rutas relativas. */
export function resolvesToMock(spec: string, fromFile: string, srcDir: string): boolean {
  const mockDir = join(srcDir, 'lib', 'mock');
  const target = resolveSpec(spec, fromFile, srcDir);
  return target !== null && (target === mockDir || target.startsWith(mockDir + sep));
}

export type SpecKind = 'import' | 'export' | 'dynamic' | 'require';

/** Especificadores de módulo de un fichero: `import`/`export … from`, `import()` y `require()` (también con
 * plantilla sin sustituciones e `import x = require(…)`), con su tipo y su forma. */
export function moduleSpecifiers(source: string, fileName: string): { spec: string; typeOnly: boolean; line: number; kind: SpecKind }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { spec: string; typeOnly: boolean; line: number; kind: SpecKind }[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const typeOnly =
        !!c &&
        (c.isTypeOnly ||
          (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      out.push({ spec: n.moduleSpecifier.text, typeOnly, line: line(n), kind: 'import' });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push({ spec: n.moduleSpecifier.text, typeOnly: n.isTypeOnly, line: line(n), kind: 'export' });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteralLike(n.moduleReference.expression)) {
      out.push({ spec: n.moduleReference.expression.text, typeOnly: n.isTypeOnly, line: line(n), kind: 'require' });
    } else if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])) {
      const isDyn = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isReq = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if (isDyn || isReq) out.push({ spec: (n.arguments[0] as ts.StringLiteralLike).text, typeOnly: false, line: line(n), kind: isDyn ? 'dynamic' : 'require' });
    } else if (ts.isImportTypeNode(n)) {
      // `import('…').X` en posición de tipo: se borra al compilar.
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Ficheros que importan en valor (cualquier forma de `moduleSpecifiers`) algo para lo que `isTarget` es cierto. */
export function importersOf(
  files: { path: string; source: string }[],
  srcDir: string,
  isTarget: (spec: string, fromFile: string) => boolean,
): { file: string; line: number; spec: string }[] {
  const hits: { file: string; line: number; spec: string }[] = [];
  for (const { path, source } of files) {
    for (const s of moduleSpecifiers(source, path)) {
      if (!s.typeOnly && isTarget(s.spec, path)) hits.push({ file: relative(join(srcDir, '..'), path), line: s.line, spec: s.spec });
    }
  }
  return hits;
}

/** (a) Ficheros que importan de `src/lib/mock` en valor (los `import type` se borran al compilar). */
export function mockImportersOf(files: { path: string; source: string }[], srcDir: string): { file: string; line: number; spec: string }[] {
  return importersOf(files, srcDir, (spec, from) => resolvesToMock(spec, from, srcDir));
}

/** Ficheros que importan en valor el módulo `target` (ruta absoluta con extensión), por cualquier forma. */
export function moduleImportersOf(files: { path: string; source: string }[], srcDir: string, target: string): { file: string; line: number; spec: string }[] {
  const noExt = target.replace(/\.tsx?$/, '');
  return importersOf(files, srcDir, (spec, from) => {
    const t = resolveSpec(spec, from, srcDir);
    return t !== null && (t === target || t === noExt || t.replace(/\.(js|mjs|cjs)$/, '') === noExt);
  });
}

export interface MockReference {
  name: string;
  line: number;
  text: string;
}

/**
 * (b) Referencias a nombres importados de `src/lib/mock` (cualquier especificador que resuelva ahí: `./mock/x`,
 * `../lib/mock/x`, `./mock/../mock/x`, `@/lib/mock/x`) que NO quedan bajo la guarda. Una referencia queda
 * guardada si, subiendo por sus ancestros, encuentra una de estas formas antes de llegar al nivel del módulo:
 *  - `if (guarda) { ref }` (también `if ((guarda) && x)`), `guarda ? ref : …`, `guarda && ref`;
 *  - `if (!(guarda)) … else { ref }`, `!(guarda) ? … : ref`;
 *  - en un bloque, tras `if (!(guarda)) return/throw …;` sin `else` (la forma de casi todas las funciones). Una
 *    `function f(){}` declarada en ese bloque NO hereda esa guarda por su posición: se eleva (hoisting) y se puede
 *    llamar antes del `return` (TL-DYN3R-1 H3); sube como cualquier otra.
 * Si llega al nivel del módulo dentro de una función (o `const f = () => …`) NO exportada, la referencia
 * cuenta como guardada solo si TODAS las referencias a esa función están guardadas (p. ej. `mocked()` de
 * `marketing-api.ts`). Las posiciones de tipo no cuentan (se borran al compilar). Cualquier otra cosa
 * (nivel de módulo, `export … from './mock/…'`) es una referencia sin guarda. Una función EXPORTADA solo cuenta
 * como guardada si, además, `usedOutside(nombre)` es falso (la exportan las pruebas de paridad: `mockDiscountedDirectShip`,
 * `mockWithdrawalDiscount`); quien llama decide qué es «fuera» (en la prueba: cualquier fichero de código que no sea prueba).
 * Son `problems` (no se auditan, se prohíben): `import()`/`require()` de `lib/mock`, `import()`/`require()` con
 * argumento no literal, `import` de efecto lateral y re-export de `lib/mock`, y `MOCKS_BUILD` que no es el literal.
 * `fileName` relativo se toma bajo `srcDir/..` si empieza por `src/`, y si no, bajo `srcDir/lib/` (los clientes).
 */
export function unguardedMockReferences(
  source: string,
  fileName: string,
  usedOutside: (exportedName: string) => boolean = () => true,
  srcDir: string = join(process.cwd(), 'src'),
): { refs: number; unguarded: MockReference[]; problems: string[] } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  const mockNames = new Set<string>();
  const absFile = isAbsolute(fileName) ? fileName : fileName.startsWith('src/') ? join(srcDir, '..', fileName) : join(srcDir, 'lib', fileName);
  const isMockSpec = (s: string) => resolvesToMock(s, absFile, srcDir);
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // H2: `import()`/`require()` no pasan por la guarda que mide este análisis: se prohíben, no se auditan.
  for (const m of moduleSpecifiers(source, fileName)) {
    if ((m.kind === 'dynamic' || m.kind === 'require') && isMockSpec(m.spec)) problems.push(`${m.kind === 'dynamic' ? 'import()' : 'require()'} de ${m.spec} (línea ${m.line})`);
  }
  const visitCalls = (n: ts.Node) => {
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      if (n.arguments.length === 0 || !ts.isStringLiteralLike(n.arguments[0])) problems.push(`import()/require() con argumento no literal (línea ${lineOf(n)}): no se puede auditar`);
    }
    ts.forEachChild(n, visitCalls);
  };
  visitCalls(sf);

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
      problems.push(`re-export de ${st.moduleSpecifier.text} (línea ${lineOf(st)})`);
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
        // H3: una declaración de función se eleva; las sentencias anteriores no la guardan.
        const i = ts.isFunctionDeclaration(child) ? -1 : stmts.indexOf(child as ts.Statement);
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
