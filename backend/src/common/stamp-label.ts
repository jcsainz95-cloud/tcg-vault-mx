/**
 * §ALTA-LIGA-2 (API_CONTRACT_ALTA_LIGA §2): la etiqueta de una versión de liga manual y su forma NORMALIZADA (la llave de duplicado
 * junto a `(cardId, stampType)`). UN sitio: lo usan el alta manual y la fusión con el producto real.
 */

/** Etiqueta mostrada: recortada; vacío ⇒ `null`; 1..40 caracteres, sin control ni HTML. `{ok:false}` ⇒ 400 `details.field = stampLabel`. */
export function cleanStampLabel(raw: unknown): { ok: true; label: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, label: null };
  if (typeof raw !== 'string') return { ok: false };
  const t = raw.trim();
  if (t === '') return { ok: true, label: null };
  if ([...t].length > 40) return { ok: false };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f<>]/.test(t)) return { ok: false };
  return { ok: true, label: t };
}

/** Minúsculas, sin acentos, espacios colapsados. `null`/vacío ⇒ `null` (sin etiqueta). */
export function normalizeStampLabel(label: string | null | undefined): string | null {
  if (label == null) return null;
  const n = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return n === '' ? null : n;
}
