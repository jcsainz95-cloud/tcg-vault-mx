import { expect } from 'vitest';

/**
 * Utilidades de test del «gancho de grading» (DESIGN_SYSTEM §21 R3.1 / PROJECT §N.5).
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
 * Las DOS ideas obligatorias de §N.5, por idioma: **«ilustrativo»** y **«no evaluamos esta carta»**.
 * Un aviso que solo cargue una de las dos NO cumple (§N.5 lo dice con todas sus letras).
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
