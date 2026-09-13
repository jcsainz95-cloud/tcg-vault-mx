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
 */
export function stripComments(src: string): string {
  // Bloques primero: pueden contener `//` dentro y abarcar varias líneas. Los saltos de línea del
  // bloque se preservan (se sustituye cada carácter que no sea `\n` por nada, el `\n` se mantiene).
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  return noBlocks
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}
