// @vitest-environment node
/**
 * I-2 de QA (§WSH sobre 503cf07) · criterio 824: el aviso de privacidad, en es y en en, contiene el párrafo «Lista de
 * deseos» con el texto LITERAL de `PROJECT.md §WSH.5` «Texto exacto de la línea del aviso de privacidad» (aba09760).
 * El ancla es PROJECT.md (manda sobre todo): el texto se lee de ahí, con los saltos de línea del markdown hechos un
 * espacio. Falla cerrado si alguien reformatea ese párrafo (se relee y se re-bendice).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { privacyNoticeEs } from './privacidad.es';
import { WISHLIST_PRIVACY_EN, WISHLIST_PRIVACY_ES } from './privacy-wishlist';

const PROJECT = readFileSync(join(__dirname, '..', '..', '..', '..', 'PROJECT.md'), 'utf8');

function literal(lang: 'es' | 'en'): string {
  const start = PROJECT.indexOf('Texto exacto de la línea del aviso de privacidad');
  expect(start).toBeGreaterThan(-1);
  const tail = PROJECT.slice(start, start + 6000);
  const m = new RegExp(`- \\*\\*${lang}:\\*\\* «([\\s\\S]*?)»\\n`).exec(tail);
  expect(m, `texto ${lang} en PROJECT §WSH.5`).toBeTruthy();
  return m![1].replace(/\s*\n\s*/g, ' ');
}

describe('824 · párrafo «Lista de deseos» literal de PROJECT §WSH.5', () => {
  it('es: idéntico al texto de PROJECT.md', () => {
    expect(WISHLIST_PRIVACY_ES).toBe(literal('es'));
    expect(WISHLIST_PRIVACY_ES.startsWith('**Lista de deseos.** ')).toBe(true);
  });

  it('en: idéntico al texto de PROJECT.md', () => {
    expect(WISHLIST_PRIVACY_EN).toBe(literal('en'));
    expect(WISHLIST_PRIVACY_EN.startsWith('**Wishlist.** ')).toBe(true);
  });

  it('el aviso (texto español, el que se publica) lo lleva como párrafo propio en las finalidades (§LEG.2 p. 3)', () => {
    const sec = privacyNoticeEs.sections.find((s) => s.id === 'finalidades-primarias');
    expect(sec?.blocks).toContainEqual({ type: 'p', text: WISHLIST_PRIVACY_ES });
  });

  it('cambio de fondo ⇒ versión y fecha suben (no se publica texto nuevo con versión vieja)', () => {
    expect(privacyNoticeEs.version).toBe('0.4-provisional-2026-10-07');
    expect(privacyNoticeEs.updatedAt).toBe('7 de octubre de 2026');
  });
});
