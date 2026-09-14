/**
 * strip-comments.ts — **el ÚNICO limpiador de comentarios del frontend, y su control de no-ceguera.**
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ### De dónde sale (techlead, 2026-09-14) — «la v2 arregló el helper, no la clase»
 *
 * Tres candados de `frontend/` llevaban **cada uno su copia** del algoritmo v1: borrar los bloques
 * con una regex global y **después** quitar las colas de línea.
 *
 * ```ts
 * src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
 * ```
 *
 * **El defecto es de orden**: una línea de comentario que contenga la secuencia de apertura de
 * bloque —p. ej. `// … el portal de una solicitud (/buylist/requests/*), que es «ventas».`— **abre
 * un bloque** para la primera regex, que se come el fichero hasta el siguiente cierre. El candado
 * no se pone rojo: **deja de ver**, y un candado que no ve **pasa**.
 *
 * #### ⚠️ No era teórico: estaba ciego HOY (medido, 2026-09-14, sobre `0e22415`)
 *  - `StorefrontHeader.tsx:95` abre el bloque; el siguiente cierre está en `:109`. En esa ventana el
 *    v1 borraba **12 líneas de código real** — la tabla de navegación entera (`/buylist`, `/vault`,
 *    `/orders`, `/account`, `/login`) y la apertura del `<header>`.
 *  - Barrido completo de `src/`: **107 ficheros y ≥413 líneas de código** que el candado del IVA
 *    —`frontend-never-multiplies.test.ts`, la regla *«⛔ el frontend nunca multiplica»*— **no
 *    miraba**. (Cota **inferior**: se cuenta una línea como ciega solo si su texto no aparece en
 *    ninguna otra parte de la salida.)
 *  - El candado del arnés estaba ciego en 3 specs de `e2e/` (`buylist`, `buylist-offer`,
 *    `master-set`).
 *
 * ⚠️ **Lo que NO se encontró, dicho igual de fuerte:** en ninguna de esas ventanas borradas había un
 * defecto real. El producto no estaba comprometido; lo que estaba comprometido era **el
 * instrumento**.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ### ⭐ Por qué el escáner de TypeScript y NO el autómata de `backend/test/helpers/`
 *
 * La orden era «no dupliques el de backend». **No se duplica: no se reimplementa el algoritmo.**
 * Este fichero le pregunta al compilador que ya parsea estos ficheros cuáles de sus caracteres son
 * **tokens** y cuáles son **trivia**; los comentarios son trivia por definición del lenguaje, no por
 * una heurística nuestra.
 *
 * Y la razón no es de gusto, es **medida** (`cmp3.mjs`, 2026-09-14, sobre los dos árboles):
 *
 * | Instrumento | ficheros donde pierde código | ficheros donde retiene PROSA |
 * |---|---|---|
 * | autómata v2 de `backend/` | 0 | **5** en `frontend/src` + **3** en `backend/src` |
 * | escáner de TypeScript (esto) | **0** | **0** |
 *
 * El autómata **no es ciego** —eso lo arregló su v2— pero **se desincroniza con un literal de
 * expresión regular que lleve una comilla suelta**, que es justo su límite documentado. En
 * `frontend/` eso pasa hoy en `api-client.ts:216` (`/filename\*=(?:UTF-8'')?…/`), en
 * `e2e-harness.test.ts:119` (`/…(['"`])…/`) y en tres ficheros más: a partir de ahí **conserva los
 * comentarios**, que para una prohibición es un **rojo falso** y para un candado que **cuenta**
 * apariciones es un verde falso. *El sesgo va en otra dirección que la ceguera, pero sigue siendo un
 * instrumento que miente.*
 *
 * ⇒ **Solicitud registrada en `docs/FRONTEND_NOTES.md` para el rol BACKEND** (no es ruta mía):
 * `backend/test/helpers/strip-comments.ts` retiene prosa en `mail-shell.ts`, `mail.templates.ts` y
 * `guest-order.templates.ts` por ese mismo límite.
 *
 * ⚠️ **Su límite, dicho y no escondido:** depende de que el fichero **parsee**. Ante un fichero roto
 * TypeScript devuelve un árbol con nodos de error y el reparto token/trivia puede ser cualquier
 * cosa. Eso **no se tapa**: lo caza {@link exigirQueConserveElCodigo}, que compara contra el censo
 * de líneas con token del **mismo** análisis y deja el rojo con los números de línea delante.
 *
 * ⛔ **No lo uses para decidir conducta de producción.** Es un instrumento de pruebas.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Los nodos de JSDoc SÍ están en el árbol: hay que excluirlos a mano o el limpiador conserva prosa. */
function esJsDoc(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstJSDocNode && kind <= ts.SyntaxKind.LastJSDocNode;
}

export interface AnalisisDeFuente {
  /** El fuente sin comentarios. **Mismo número de líneas que el original**, para que los `:N` cuadren. */
  readonly limpio: string;
  /**
   * ⭐ **El censo POR CONTENIDO**: las líneas (1-based) que llevan al menos un carácter de token
   * —código de verdad, cadenas y texto JSX incluidos—. Es lo que {@link exigirQueConserveElCodigo}
   * exige que sobreviva, y es lo que distingue este control del que ya había.
   */
  readonly lineasConCodigo: readonly number[];
}

/** Analiza un fuente: lo limpia y censa sus líneas con código **en una sola pasada**. */
export function analizarFuente(src: string, file: string): AnalisisDeFuente {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const esToken = new Uint8Array(src.length);
  const visitar = (n: ts.Node): void => {
    if (esJsDoc(n.kind)) return;
    const hijos = n.getChildren(sf);
    if (hijos.length === 0) {
      for (let i = n.getStart(sf, /* includeJsDocComment */ false); i < n.end; i++) esToken[i] = 1;
      return;
    }
    for (const h of hijos) visitar(h);
  };
  visitar(sf);

  const trozos: string[] = [];
  const lineasConCodigo: number[] = [];
  let linea = 1;
  let lineaYaCensada = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (esToken[i]) {
      trozos.push(c);
      // Un espacio dentro de un literal de plantilla es token, pero no es «contenido».
      if (!/\s/.test(c) && lineaYaCensada !== linea) {
        lineasConCodigo.push(linea);
        lineaYaCensada = linea;
      }
    } else {
      trozos.push(c === '\n' ? '\n' : ' ');
    }
    if (c === '\n') linea += 1;
  }
  return { limpio: trozos.join(''), lineasConCodigo };
}

/** El fuente sin comentarios, conservando la numeración de líneas. */
export function stripComments(src: string, file: string): string {
  return analizarFuente(src, file).limpio;
}

/**
 * ⭐⭐ **EL CONTROL POR CONTENIDO — y por qué NO es «el fichero no quedó vacío».**
 *
 * `PendingsBell.test.tsx:140-141` ya traía un control de no-vacuidad, con su comentario al lado:
 * *«si el stripper se rompiera y vaciara el fichero, el candado quedaría mirando al vacío»*. **El
 * autor conocía el modo de fallo y blindó el caso TOTAL. El que ocurre de verdad es el PARCIAL:**
 * el v1 se comía doce líneas de `StorefrontHeader.tsx` y dejaba las otras doscientas — con lo cual
 * `expect(src).toMatch(/export (function|const)/)` pasaba **tan campante**.
 *
 * ⇒ Este control no pregunta si queda algo. Pregunta si queda **lo que había**: cada una de las
 * `N` líneas con código del original tiene que seguir teniendo contenido en el texto limpiado.
 *
 * @param limpio el texto a auditar. **No tiene por qué venir de aquí** — el canario le pasa la
 * salida del v1 y exige el rojo, que es lo que demuestra que el control muerde.
 */
export function exigirQueConserveElCodigo(
  src: string,
  limpio: string,
  file: string,
  lineasConCodigo?: readonly number[],
): void {
  const censo = lineasConCodigo ?? analizarFuente(src, file).lineasConCodigo;
  const original = src.split('\n');
  const resultado = limpio.split('\n');
  const perdidas = censo.filter((n) => !(resultado[n - 1] ?? '').trim());
  if (perdidas.length === 0) return;
  const muestra = perdidas
    .slice(0, 8)
    .map((n) => `  ${file}:${n} · ${(original[n - 1] ?? '').trim().slice(0, 96)}`)
    .join('\n');
  throw new Error(
    `EL LIMPIADOR SE QUEDÓ CIEGO en ${file}: de ${censo.length} líneas con código, ` +
      `${perdidas.length} desaparecieron del texto que el candado va a mirar.\n${muestra}` +
      (perdidas.length > 8 ? `\n  … y ${perdidas.length - 8} más` : ''),
  );
}

const cache = new Map<string, string>();

/**
 * **La puerta única que usan los tres candados**: lee el fichero, lo limpia, **comprueba que no se
 * quedó ciego** y memoiza. La memoización no es un lujo: el candado del IVA barre 462 ficheros una
 * vez por patrón prohibido, y sin caché el árbol se parsearía siete veces.
 */
export function codigoDe(abs: string, etiqueta = abs): string {
  const yaEsta = cache.get(abs);
  if (yaEsta !== undefined) return yaEsta;
  const src = readFileSync(abs, 'utf8');
  const { limpio, lineasConCodigo } = analizarFuente(src, etiqueta);
  exigirQueConserveElCodigo(src, limpio, etiqueta, lineasConCodigo);
  cache.set(abs, limpio);
  return limpio;
}
