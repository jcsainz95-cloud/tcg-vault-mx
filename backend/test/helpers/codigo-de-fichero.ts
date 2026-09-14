/**
 * codigo-de-fichero.ts — ⭐⭐ **UNA SOLA PUERTA PARA LEER CÓDIGO EN UN CANDADO, CON SU CONTROL DE
 * NO-VACUIDAD POR CONTENIDO.**
 *
 * ### De dónde sale (techlead, 2026-09-14 — «la v2 arregló el helper, no la clase»)
 * `stripComments` se reescribió como autómata (v2) porque la v1 —regex global de bloques, luego colas
 * de línea— **se quedaba ciega a trozos**. Pero el algoritmo v1 seguía **copiado a mano en once
 * sitios**, cada uno con su variante. Un helper arreglado no arregla a quien no lo llama.
 *
 * **Y la ceguera no es teórica; está MEDIDA con el mecanismo, no con un conteo de líneas** *(el
 * conteo engaña: la v1 borra la línea entera y la v2 conserva el `\n`, así que comparar «líneas no
 * vacías» entre las dos da diferencias que no son ceguera)*. La condición exacta que abre un bloque
 * fantasma es **que la secuencia de apertura de bloque aparezca dentro de un comentario de línea o
 * de una cadena**. Barriendo `backend/src` el 2026-09-14, eso ocurre en **siete ficheros**:
 *
 * | fichero | aperturas fantasma | dónde |
 * |---|---|---|
 * | `modules/buylist/mail-shell.ts` | **31** | cadenas (CSS `* { … }`, comentarios condicionales de Outlook) |
 * | `modules/orders/mail/guest-order.templates.ts` | 3 | cadenas |
 * | `common/error-codes.ts` | 2 | comentarios de línea (`/checkout/guest/*`) |
 * | `modules/mail/mail.templates.ts` | 2 | cadenas |
 * | `modules/uploads/uploads.service.ts` | 2 | `image/*` y una cadena |
 * | `modules/orders/guest-checkout.service.ts` | 1 | comentario de línea |
 * | `modules/pricing/pricing.controller.ts` | 1 | comentario de línea (`/admin/*`) |
 *
 * ⇒ Un candado con la v1 sobre cualquiera de esos **lee un fichero mutilado y sale VERDE por
 * ceguera**, que es el peor color: afirma una cobertura que no existe.
 *
 * ### ⭐⭐ El control de no-vacuidad es POR CONTENIDO, y esto es lo que más enseña del pase
 * `PendingsBell.test.tsx:140` **ya tenía** un control de no-vacuidad: su autor conocía el modo de
 * fallo y blindó el caso **TOTAL** («el fichero quedó vacío»). **El que ocurre de verdad es el
 * PARCIAL**: el fichero conserva el 90 % y pierde justo la región que el candado vigila. *Un candado
 * puede estar ciego a trozos y pasar todos sus propios controles.*
 *
 * Aquí la no-vacuidad tiene **dos mitades, y ninguna es «no está vacío»**:
 *  1. ⭐ **ANCLAS** — cada llamante nombra fragmentos de **código** que el texto limpio tiene que
 *     seguir conteniendo. Si el limpiador se come una región, el ancla que vive ahí **desaparece** y
 *     esto revienta señalando cuál. *Es la única mitad que detecta la ceguera PARCIAL.*
 *  2. **COTA INDEPENDIENTE** — el texto limpio tiene que conservar al menos tantas líneas no vacías
 *     como líneas del original que *no parecen comentario* (no empiezan por `*`, `//` ni por la
 *     apertura de bloque). Es un conteo **calculado por otra vía** que la que se está comprobando.
 *     ⚠️ Se midió sobre **todos los `.ts` de `backend/src`**: la cota
 *     se cumple en **todos** con la v2 (nunca da un rojo falso) y **muerde** con la v1 en
 *     `pricing.controller.ts`, `uploads.service.ts` y `guest-checkout.service.ts`. En `mail-shell.ts`
 *     **NO muerde** —la región que se pierde son cadenas cuyas líneas empiezan por `*`— y por eso la
 *     cota **no basta sola** y las anclas no son decorativas.
 *
 * ⛔ **No se usa para decidir conducta de producción.** Es un instrumento de pruebas.
 */
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments';

/** Líneas del original que **no parecen comentario**: cota inferior calculada por otra vía. */
export function cotaDeCodigo(fuente: string): number {
  return fuente.split('\n').filter((l) => {
    const t = l.trim();
    return t !== '' && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  }).length;
}

/** Líneas no vacías de un texto ya limpio. */
function lineasVivas(texto: string): number {
  return texto.split('\n').filter((l) => l.trim() !== '').length;
}

/**
 * Limpia `fuente` con {@link stripComments} (v2) y **comprueba que sigue habiendo código**.
 * Lanza —⛔ no devuelve un texto mutilado— si alguna ancla desapareció o si la cota no se cumple.
 *
 * @param anclas fragmentos de CÓDIGO que el llamante sabe que existen. **Al menos uno**, y que
 *   vivan cerca de lo que el candado vigila: son lo único que detecta la ceguera PARCIAL.
 */
export function codigoDeTexto(fuente: string, etiqueta: string, anclas: readonly string[]): string {
  return comprobarNoVacuidad(fuente, stripComments(fuente), etiqueta, anclas);
}

/**
 * ⭐ **La comprobación, aparte del limpiador, para que el canario pueda inyectarle un limpiador
 * ROTO.** Si esto viviera pegado a `stripComments` (que hoy es correcto), el control **no se podría
 * probar**: solo se sabría que no salta, no que sabría saltar. *Un control que nunca se ha visto
 * morder es una intención.*
 *
 * @param fuente el texto ORIGINAL (de él sale la cota independiente)
 * @param limpio lo que el limpiador devolvió (en el canario, la salida de la v1)
 */
export function comprobarNoVacuidad(
  fuente: string,
  limpio: string,
  etiqueta: string,
  anclas: readonly string[],
): string {
  if (anclas.length === 0) {
    throw new Error(
      `codigoDeTexto(${etiqueta}): hace falta al menos un ancla. Un candado sin control de ` +
        'no-vacuidad POR CONTENIDO no distingue «no encontré el defecto» de «no vi el fichero».',
    );
  }
  const perdidas = anclas.filter((a) => !limpio.includes(a));
  const cota = cotaDeCodigo(fuente);
  const vivas = lineasVivas(limpio);
  if (perdidas.length > 0 || vivas < cota) {
    throw new Error(
      `codigoDeTexto(${etiqueta}): el texto limpio perdió código y este candado NO va a opinar ` +
        'sobre un fichero mutilado.\n' +
        `  anclas ausentes: ${JSON.stringify(perdidas)}\n` +
        `  líneas vivas tras limpiar: ${vivas} · cota independiente: ${cota}\n` +
        '  Causa típica: el limpiador abrió un bloque fantasma (la secuencia de apertura de bloque ' +
        'dentro de un comentario de línea o de una cadena). ⛔ No se arregla bajando el ancla.',
    );
  }
  return limpio;
}


/**
 * ⭐⭐ **Anclas estructurales de un fichero, para los barridos que leen `src/` ENTERO** (donde
 * nombrarlas a mano una por una no escala).
 *
 * Devuelve **la PRIMERA y la ÚLTIMA** declaración de primer nivel —o, si no hay ninguna, el primer
 * y el último `describe(`—. **Las dos puntas, y no una, a propósito:** un bloque fantasma que se
 * abra a mitad del fichero se come **todo lo que va detrás**, así que un ancla del principio
 * sobreviviría y el candado seguiría ciego de la mitad para abajo. *La ceguera de esta clase es
 * PARCIAL: hay que anclar por los dos extremos o no se ancla.*
 */
const DECLARACION =
  /^(?:export )?(?:default )?(?:abstract )?(?:async )?(?:class|function|const|let|type|interface|enum) [A-Za-z0-9_$]+/gm;
const DESCRIBE = /^describe\(/gm;

export function anclasEstructurales(fuente: string, etiqueta: string): string[] {
  for (const re of [DECLARACION, DESCRIBE]) {
    re.lastIndex = 0;
    const todas = fuente.match(re) ?? [];
    if (todas.length > 0) return [...new Set([todas[0]!, todas[todas.length - 1]!])];
  }
  throw new Error(
    `anclasEstructurales(${etiqueta}): el fichero no declara nada de primer nivel ni abre un ` +
      '`describe`. ⛔ Un fichero sin ancla es un fichero del que el candado no sabe si leyó entero: ' +
      'nómbrale un ancla a mano en el llamante.',
  );
}

/** Igual que {@link codigoDeTexto}, leyendo de disco. `ruta` debe ser absoluta. */
export function codigoDeFichero(ruta: string, anclas: readonly string[]): string {
  return codigoDeTexto(readFileSync(ruta, 'utf8'), ruta, anclas);
}
