import { expect } from 'vitest';

/**
 * Utilidades de test del «gancho de grading» (DESIGN_SYSTEM §22 R3.1 / PROJECT §O.5).
 *
 * El bloqueante que reportó QA fue exactamente este: el aviso existía **solo** como `sr-only`, así
 * que un comprador vidente veía la cifra **sin** ningún aviso. Estas utilidades reproducen esa
 * verificación en unitarios: **se retira del árbol todo lo `sr-only`** y se comprueba que el aviso
 * SIGUE ahí. Si alguien vuelve a mover el micro-aviso a `sr-only`, `title` o tooltip, estos
 * helpers lo detectan.
 */

/** Texto que ve un usuario VIDENTE: el subárbol sin ningún nodo `sr-only`. */
export function sightedText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.sr-only').forEach((node) => node.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Las DOS ideas obligatorias de §O.5, por idioma: **«ilustrativo»** y **«no evaluamos esta carta»**.
 * Un aviso que solo cargue una de las dos NO cumple (§O.5 lo dice con todas sus letras).
 */
export const MICRO_NOTICE_IDEAS: Record<'es' | 'en', [RegExp, RegExp]> = {
  es: [/ilustrativ/i, /no evaluamos (el estado de )?esta carta/i],
  en: [/illustrative/i, /we (haven't|have not) assessed this card/i],
};

/** Afirma que el subárbol muestra, VISIBLE (no `sr-only`), el micro-aviso con sus dos ideas. */
export function expectVisibleMicroNotice(root: HTMLElement, locale: 'es' | 'en' = 'es') {
  const text = sightedText(root);
  for (const idea of MICRO_NOTICE_IDEAS[locale]) {
    expect(text).toMatch(idea);
  }
}

/** Afirma que el subárbol NO muestra micro-aviso alguno (superficie sin cifra ⇒ sin aviso). */
export function expectNoMicroNotice(root: HTMLElement, locale: 'es' | 'en' = 'es') {
  const text = sightedText(root);
  for (const idea of MICRO_NOTICE_IDEAS[locale]) {
    expect(text).not.toMatch(idea);
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * §22.13(d.1) — LA CIFRA DE CRÉDITOS NUNCA VIAJA SOLA
 *
 * El techo diario en créditos solo vale **si el proveedor cobra por petición**; si cobra por carta
 * devuelta, la petición pide el set entero y la factura puede ser varias veces esa cifra. Por eso
 * el invariante no es «que aparezca la frase buena» —eso se burla añadiendo una frase mala al
 * lado— sino: **ninguna oración que publique un techo en «créditos al día» puede hacerlo sin su
 * calificador en la MISMA oración**.
 *
 * Vive aquí, y no copiado en cada pantalla, porque hay **dos** superficies que publican esa cifra
 * (el aviso de encendido de M10 y el aviso de gasto de M2, §22.14c) y dos copias del candado
 * divergen igual que divergen dos aritméticas.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Corta el texto renderido en oraciones. **El corte es lo que hace o deshace el candado**: la
 * versión anterior partía por `/(?<=\.)\s+/` —exigía espacio tras el punto— y `textContent` no
 * pone espacio entre bloques, así que una cifra desnuda pegada al punto anterior
 * (`…esa cifra.En resumen: gasta 1000 créditos al día.`) se **fusionaba** con la oración
 * calificada, heredaba su condicional y pasaba. Lo demostró QA con la suite entera en verde.
 *
 * Aquí se corta tras un punto **con o sin** espacio detrás. La única excepción es el punto
 * seguido de dígito (`1.000`), que es separador de millares y no fin de oración.
 *
 * **Alcance honesto:** esto caza toda continuación tras un punto. No inventa fronteras donde el
 * copy no puso ninguna — un texto sin puntos es una sola oración y se juzga como tal.
 */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=\.)(?:\s+|(?=[^\s\d]))/).filter((s) => s.trim() !== '');
}

/** Lo que convierte la cifra en publicable: el régimen que la condiciona, o que esté MEDIDA. */
const CREDITS_QUALIFIER = /cobra por petición|ya está medido|medida el/;

/**
 * Afirma el invariante sobre un texto ya renderizado (aviso de M10 o de M2): hay **al menos una**
 * oración con la cifra —cederla del todo tampoco vale (§22.13d: sin orden de magnitud no se puede
 * decidir)— y **todas** las que la llevan van calificadas.
 */
export function expectCreditsFigureQualified(text: string) {
  const oraciones = splitSentences(text);
  const conCifra = oraciones.filter((o) => /créditos al día/.test(o));
  expect(conCifra.length, 'ninguna oración publica el techo en créditos').toBeGreaterThan(0);
  for (const oracion of conCifra) {
    expect(oracion, `cifra de créditos SIN calificador en su oración: «${oracion.trim()}»`).toMatch(
      CREDITS_QUALIFIER,
    );
  }
}
