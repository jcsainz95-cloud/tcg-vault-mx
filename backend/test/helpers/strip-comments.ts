/**
 * strip-comments.ts — **un candado de código mira CÓDIGO. Si mira comentarios, vigila prosa.**
 *
 * ### De dónde sale (techlead, condición de veredicto de `P-89`, 2026-09-13)
 * `test/enum-values-parity.spec.ts:196-201` corría su regex sobre el **fichero entero**, así que un
 * **comentario** lo disparaba. El síntoma no fue un rojo: fue la **lista blanca por nombre de
 * fichero** que le crecía al lado —
 *
 * ```ts
 * if (f.endsWith(join('common', 'business-rules.ts'))) return false; // ahí VIVE la regla
 * if (f.endsWith(join('common', 'enum-values.ts'))) return false;    // ahí vive el porqué (comentario)
 * ```
 *
 * — que techlead nombró exacto: *«el síntoma de un candado que vigila prosa: cada fichero que quiera
 * explicar la regla tiene que pedirle permiso al test»*. Los dos ficheros de esa lista blanca están
 * ahí **por sus comentarios**, no por su código (medido: `business-rules.ts:13,39` y
 * `enum-values.ts:53` son las únicas coincidencias, las tres en prosa).
 *
 * ⚠️ **Y lo caro no es el falso positivo: es lo que entrena.** Un candado que se rodea reescribiendo
 * un comentario le enseña a quien lo topa que **la salida es cambiar la prosa** — con lo cual el
 * siguiente fichero que quiera explicar la regla, o no la explica, o entra en la lista blanca. La
 * lista blanca es además **más ancha que el problema**: exime el fichero ENTERO, así que un
 * `RAW_CONDITION_VALUES` de verdad dentro de `business-rules.ts` pasaría sin que nada suene.
 *
 * ### Qué hace, y cuál es su límite (dicho, no escondido)
 * Quita comentarios de bloque (los delimitados por barra-asterisco, incluidos los multilínea) y de
 * línea (`// …`). **No es un parser de TypeScript**: una cadena que contenga `//` (una URL, p. ej.)
 * pierde su cola de línea. Se acepta
 * porque el sesgo va en la dirección segura para lo que vigila —el riesgo es dejar de ver código, y
 * eso lo cierra el **canario**, que reintroduce el defecto real y exige el rojo— y porque es
 * exactamente lo que ya hacía el hermano bueno de ese mismo fichero (`:226`,
 * `line.replace(/\/\/.*$/, '')`), solo que ahora también cubre el bloque, que es donde vive la prosa
 * larga de este repo.
 *
 * ⛔ **No lo uses para decidir conducta de producción.** Es un instrumento de pruebas.
 */

/**
 * Devuelve `src` sin comentarios, **conservando los saltos de línea** para que los números de línea
 * y el análisis línea-a-línea sigan cuadrando con el fichero original.
 *
 * ### ⭐⭐ v2 (D56, 2026-09-14) — SE REESCRIBIÓ COMO AUTÓMATA, Y NO ES COSMÉTICA: LA v1 SE QUEDABA CIEGA
 *
 * **El defecto, medido, y lo encontró una prueba nueva al no ver código que sí existía.** La v1
 * quitaba **primero** los bloques con una regex global y **después** las colas de línea. Con eso, una
 * línea de comentario que contuviera la secuencia de apertura de bloque —p. ej.
 * `// el dial viaja solo en /admin/*` — **abría un bloque que se comía el fichero** hasta el siguiente
 * cierre. Medido: en `guest-checkout.service.ts` se tragó **la escritura de la columna
 * `ivaTransferPct`**, y el censo de `iva-derivacion-cableada.spec.ts` reportó *«ese fichero no la
 * emite»* — **un VERDE por ceguera** sobre una columna de dinero.
 *
 * ⚠️ **Y no era un caso de laboratorio:** el mismo patrón vive en **cuatro** ficheros más de `src/`
 * (`uploads.service.ts` con `image/*`, `pricing.controller.ts` y `error-codes.ts` con `/admin/*` y
 * `/checkout/guest/*`). *Un instrumento que deja de ver el código no falla: pasa.*
 *
 * **La v2 recorre el texto UNA vez con estados** —código, cadena `'`/`"`, plantilla `` ` ``,
 * comentario de línea, comentario de bloque— así que el orden ya no decide nada: dentro de un `//`
 * la secuencia de bloque es texto, y dentro de un bloque `//` es texto. **Y las cadenas se
 * conservan**, que es lo correcto para un instrumento que busca literales en código.
 *
 * ⚠️ **Su límite, dicho y no escondido:** no distingue una división de una expresión regular
 * (`a / b` vs `/re/`), así que un literal de regex que contenga `//` o la apertura de bloque podría
 * confundirlo. ⛔ **No lo uses para decidir conducta de producción.** Es un instrumento de pruebas, y
 * lo que cierra su límite es el canario (`strip-comments.spec.ts`).
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  // Estados mutuamente excluyentes. `codigo` es el implícito (ninguno activo).
  let linea = false;
  let bloque = false;
  let comilla: "'" | '"' | '`' | null = null;

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (linea) {
      // Solo el salto de línea cierra un `//`. ⛔ La apertura de bloque aquí es TEXTO.
      if (c === '\n') {
        linea = false;
        out += c;
      }
      i += 1;
      continue;
    }
    if (bloque) {
      // Solo el cierre de bloque lo cierra. Los saltos se preservan para no mover los números.
      if (c === '*' && d === '/') {
        bloque = false;
        i += 2;
        continue;
      }
      if (c === '\n') out += c;
      i += 1;
      continue;
    }
    if (comilla) {
      out += c;
      // Escape: el siguiente carácter es literal, incluida otra comilla o una barra.
      if (c === '\\' && i + 1 < src.length) {
        out += d;
        i += 2;
        continue;
      }
      if (c === comilla) comilla = null;
      i += 1;
      continue;
    }
    // --- código ---
    if (c === '/' && d === '/') {
      linea = true;
      i += 2;
      continue;
    }
    if (c === '/' && d === '*') {
      bloque = true;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') comilla = c as "'" | '"' | '`';
    out += c;
    i += 1;
  }
  return out;
}
