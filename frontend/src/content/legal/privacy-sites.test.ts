// @vitest-environment node
/**
 * LIVE-8 · LEG-5 en la suite normal (API_CONTRACT v1.84.1 §14.14 E-9): los sitios de los lotes YA
 * construidos usan el componente del aviso. Los siete juntos los exige `npm run check:legal`
 * (`publish-ready.test.ts`); aquí los de lotes pendientes se listan como saltados, con su lote.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test/strip-comments';
import { PRIVACY_NOTICE_SITES, missingUses } from './privacy-sites';

const ROOT = join(__dirname, '../../..');
/** Lotes construidos en esta rama. Al construir el lote 2 o 3, se añade aquí. */
const BUILT_LOTES = new Set([1]);

function source(file: string) {
  return stripComments(readFileSync(join(ROOT, file), 'utf8'), file);
}

describe('LEG-5 · sitios del aviso de privacidad (lotes construidos)', () => {
  it('son siete, con números 1…7 y ficheros que existen', () => {
    expect(PRIVACY_NOTICE_SITES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const s of PRIVACY_NOTICE_SITES) expect(() => readFileSync(join(ROOT, s.file)), s.file).not.toThrow();
  });

  for (const site of PRIVACY_NOTICE_SITES) {
    const title = `sitio ${site.id} · ${site.name} (${site.file}) usa el componente`;
    if (BUILT_LOTES.has(site.lote)) {
      it(title, () => {
        expect(missingUses(site, source(site.file)), `sitio ${site.id} · ${site.name}`).toEqual([]);
      });
    } else {
      it.skip(`${title} — pendiente del lote ${site.lote}; lo exige check:legal`, () => {});
    }
  }

  it('missingUses nombra lo que falta (canario del candado)', () => {
    const s = PRIVACY_NOTICE_SITES.find((x) => x.id === 2)!;
    expect(missingUses(s, '<PrivacySiteNote site="register" />')).toEqual(['<PrivacySiteNote\\s+site="googleSignIn"']);
    // Un comentario que mencione el componente no cuenta.
    expect(missingUses(s, stripComments('// <PrivacySiteNote site="register" /> <PrivacySiteNote site="googleSignIn" />', 'x.tsx'))).toHaveLength(2);
  });
});
