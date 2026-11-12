import { cleanStampLabel, normalizeStampLabel } from '../src/common/stamp-label';

/** §ALTA-LIGA-2 (AL2-2/AL2-5c): la etiqueta de una versión de liga manual y su forma normalizada. */
describe('stamp-label', () => {
  it('recorta, vacío ⇒ null, 1..40 caracteres', () => {
    expect(cleanStampLabel('  Liga Mayo ')).toEqual({ ok: true, label: 'Liga Mayo' });
    expect(cleanStampLabel('   ')).toEqual({ ok: true, label: null });
    expect(cleanStampLabel(undefined)).toEqual({ ok: true, label: null });
    expect(cleanStampLabel(null)).toEqual({ ok: true, label: null });
    expect(cleanStampLabel('x'.repeat(40)).ok).toBe(true);
    expect(cleanStampLabel('x'.repeat(41)).ok).toBe(false);
    expect(cleanStampLabel(7).ok).toBe(false);
  });
  it.each(['a​b', 'a‮b', 'a b', 'a b', 'a\u0007b', '﻿a', 'a⁠b', 'a\u0085b', '<b>x</b>', 'a>b'])('rechaza invisibles, de dirección, de control y HTML: %j', (bad) => {
    expect(cleanStampLabel(bad)).toEqual({ ok: false });
  });
  it('acepta acentos, ñ, emoji y espacios normales', () => {
    for (const ok of ['Éxito ñandú', 'Liga ⚡', 'Prize  Pack 2026']) expect(cleanStampLabel(ok).ok).toBe(true);
  });
  it('normaliza: minúsculas, sin acentos, espacios colapsados', () => {
    expect(normalizeStampLabel('  líga   MAYO ')).toBe('liga mayo');
    expect(normalizeStampLabel('ÉXITO')).toBe('exito');
    expect(normalizeStampLabel('a  b')).toBe('a b');
    expect(normalizeStampLabel('   ')).toBeNull();
    expect(normalizeStampLabel(null)).toBeNull();
  });
});
