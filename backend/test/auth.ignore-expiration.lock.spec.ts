import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as ts from 'typescript';

/**
 * TD-LIVE-2 (gate del techlead sobre `241d4dca`, 2026-10-05) — candado estático de `ignoreExpiration`.
 *
 * v1.84 (LIVE-2) puso `ignoreExpiration: true` en el `verifyAsync` de `AuthService.refresh()` porque ahí la
 * caducidad se comprueba A MANO, después del tope de sesión (para que el 401 lleve `reason: session_max_age`).
 * Copiado a cualquier otro `verifyAsync` (guard de acceso, dispositivo, `reject-authenticated`, `JwtModule`…)
 * sería un token caducado aceptado SIN esa comprobación manual. Nada en el tipo lo impide: lo impide esta prueba.
 *
 * Regla: en TODO `backend/src/**\/*.ts`, el nombre `ignoreExpiration` aparece en código (no en comentarios)
 * EXACTAMENTE una vez, y esa vez es una propiedad del objeto de opciones de una llamada `*.verifyAsync(...)`
 * dentro del método `refresh` de la clase `AuthService`. Se analiza con el AST de TypeScript, así que los
 * comentarios no cuentan y la forma `['ignoreExpiration']` sí.
 *
 * ⛔ Lo que NO cubre (dicho para no venderlo de más): opciones construidas por spread desde otro módulo sin
 * nombrar la clave, ni `clockTolerance` enorme. Ambas formas exigen escribir algo nuevo que la revisión ve.
 */

const SRC = join(__dirname, '..', 'src');
const NAME = 'ignoreExpiration';
const ALLOWED_FILE = ['modules', 'auth', 'auth.service.ts'].join('/');

interface SourceText {
  path: string; // relativo a `src/`, con `/`
  text: string;
}

interface Hit {
  path: string;
  line: number;
  inRefreshVerifyAsync: boolean;
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function loadSources(): SourceText[] {
  return listTs(SRC).map((full) => ({
    path: relative(SRC, full).split(sep).join('/'),
    text: readFileSync(full, 'utf8'),
  }));
}

function isNameNode(node: ts.Node): boolean {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text === NAME;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text === NAME;
  return false;
}

/** ¿El nodo es una propiedad de un objeto literal que es argumento de `<algo>.verifyAsync(...)`, dentro de `AuthService.refresh`? */
function inRefreshVerifyAsync(nameNode: ts.Node): boolean {
  // El nombre debe ser la clave de una PropertyAssignment (`ignoreExpiration: …` o `['ignoreExpiration']: …`).
  let prop: ts.Node = nameNode.parent;
  if (ts.isComputedPropertyName(prop)) prop = prop.parent;
  if (!ts.isPropertyAssignment(prop)) return false;
  const obj = prop.parent;
  if (!ts.isObjectLiteralExpression(obj)) return false;
  const call = obj.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(obj)) return false;
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'verifyAsync') return false;
  // Primer método/función que envuelve la llamada: debe ser el método `refresh` de `AuthService`.
  let n: ts.Node | undefined = call.parent;
  while (n && !ts.isMethodDeclaration(n) && !ts.isFunctionLike(n)) n = n.parent;
  if (!n || !ts.isMethodDeclaration(n)) return false;
  if (!ts.isIdentifier(n.name) || n.name.text !== 'refresh') return false;
  const cls = n.parent;
  return ts.isClassDeclaration(cls) && cls.name?.text === 'AuthService';
}

export function findIgnoreExpiration(sources: SourceText[]): Hit[] {
  const hits: Hit[] = [];
  for (const s of sources) {
    if (!s.text.includes(NAME)) continue;
    const sf = ts.createSourceFile(s.path, s.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (isNameNode(node)) {
        hits.push({
          path: s.path,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          inRefreshVerifyAsync: inRefreshVerifyAsync(node),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}

/** Lista de violaciones; vacía ⇒ el candado está verde. */
export function ignoreExpirationViolations(sources: SourceText[]): string[] {
  const hits = findIgnoreExpiration(sources);
  const v: string[] = [];
  if (hits.length !== 1) {
    v.push(`se esperaba EXACTAMENTE 1 aparición de ${NAME}; hay ${hits.length}: ${hits.map((h) => `${h.path}:${h.line}`).join(', ') || '(ninguna)'}`);
  }
  for (const h of hits) {
    if (h.path !== ALLOWED_FILE || !h.inRefreshVerifyAsync) {
      v.push(`${h.path}:${h.line} — ${NAME} fuera del verifyAsync de AuthService.refresh()`);
    }
  }
  return v;
}

describe('TD-LIVE-2 · ignoreExpiration solo en AuthService.refresh()', () => {
  const sources = loadSources();
  const authSrc = sources.find((s) => s.path === ALLOWED_FILE);
  const guardPath = ['common', 'guards', 'jwt-auth.guard.ts'].join('/');
  const guardSrc = sources.find((s) => s.path === guardPath);

  it('el árbol real cumple: una sola aparición, dentro del verifyAsync de refresh()', () => {
    expect(sources.length).toBeGreaterThan(50); // escaneó src/ de verdad, no un directorio vacío
    expect(ignoreExpirationViolations(sources)).toEqual([]);
    const hits = findIgnoreExpiration(sources);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: ALLOWED_FILE, inRefreshVerifyAsync: true });
  });

  it('los comentarios no cuentan (auth.service.ts menciona el nombre en comentarios y sigue siendo 1)', () => {
    expect(authSrc).toBeDefined();
    const textual = authSrc!.text.split(NAME).length - 1;
    expect(textual).toBeGreaterThan(1); // hay menciones en comentarios…
    expect(findIgnoreExpiration([authSrc!])).toHaveLength(1); // …y el AST solo ve la de código
  });

  describe('canario: el candado muerde', () => {
    const withGuard = (guardText: string): SourceText[] =>
      sources.map((s) => (s.path === guardPath ? { ...s, text: guardText } : s));

    it('copiarlo al verifyAsync del guard de acceso ⇒ rojo', () => {
      expect(guardSrc).toBeDefined();
      const anchor = "algorithms: ['HS256'],";
      expect(guardSrc!.text).toContain(anchor);
      const mutated = guardSrc!.text.replace(anchor, `${anchor}\n        ignoreExpiration: true,`);
      const v = ignoreExpirationViolations(withGuard(mutated));
      expect(v.length).toBeGreaterThan(0);
      expect(v.join('\n')).toContain(guardPath);
    });

    it('la forma con corchetes [\'ignoreExpiration\'] también se detecta', () => {
      const anchor = "algorithms: ['HS256'],";
      const mutated = guardSrc!.text.replace(anchor, `${anchor}\n        ['ignoreExpiration']: true,`);
      expect(ignoreExpirationViolations(withGuard(mutated)).join('\n')).toContain(guardPath);
    });

    it('moverlo de refresh() a otro método de AuthService ⇒ rojo', () => {
      const mutated = authSrc!.text.replace(/\n\s*ignoreExpiration: true,/, '\n');
      expect(mutated).not.toBe(authSrc!.text);
      // Se añade a un método nuevo de la clase, en un verifyAsync, para aislar «método equivocado».
      const moved = mutated.replace(
        /\n  async refresh\(/,
        "\n  async other(t: string) {\n    return this.jwt.verifyAsync(t, { ignoreExpiration: true });\n  }\n\n  async refresh(",
      );
      const v = ignoreExpirationViolations(sources.map((s) => (s.path === ALLOWED_FILE ? { ...s, text: moved } : s)));
      expect(v.join('\n')).toContain('fuera del verifyAsync de AuthService.refresh()');
    });

    it('fuera de una llamada verifyAsync (p. ej. una constante de opciones) ⇒ rojo', () => {
      const v = ignoreExpirationViolations([
        { path: 'common/x.ts', text: 'export const OPTS = { ignoreExpiration: true };\n' },
      ]);
      expect(v.length).toBeGreaterThan(0);
    });

    it('quitarlo de refresh() (cero apariciones) ⇒ rojo', () => {
      const mutated = authSrc!.text.replace(/\n\s*ignoreExpiration: true,/, '\n');
      const v = ignoreExpirationViolations(sources.map((s) => (s.path === ALLOWED_FILE ? { ...s, text: mutated } : s)));
      expect(v.join('\n')).toContain('hay 0');
    });
  });
});
