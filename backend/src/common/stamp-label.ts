/**
 * §ALTA-LIGA-2 (API_CONTRACT_ALTA_LIGA §2): la etiqueta de una versión de liga manual y su forma NORMALIZADA (la llave de duplicado
 * junto a `(cardId, stampType)`). UN sitio: lo usan el alta manual y la fusión con el producto real.
 */

/** Namespace del candado consultivo de las versiones de liga manuales (alta y fusión): UN sitio (censo `lock-keys`). */
export const ALTA_LIGA_NAMESPACE = 116_000_217;
/** Llave del candado alta↔fusión: por `(carta, tipo de sello)` (API_CONTRACT_ALTA_LIGA §2.5). */
export const manualVersionLockKey = (cardId: string, stampType: string): string => `${cardId}|${stampType}`;
/** Llave del candado del cupo por usuario (AL2-1: el conteo y la escritura de las altas de UN actor se serializan). */
export const manualQuotaLockKey = (actorId: string): string => `quota|${actorId}`;

/** Etiqueta mostrada: recortada; vacío ⇒ `null`; 1..40 caracteres, sin control ni HTML. `{ok:false}` ⇒ 400 `details.field = stampLabel`. */
export function cleanStampLabel(raw: unknown): { ok: true; label: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, label: null };
  if (typeof raw !== 'string') return { ok: false };
  // Unicode Cc (control), Cf (formato/dirección/invisibles: U+200B, U+202E, U+2060, U+FEFF…), Zl/Zp (U+2028/9) y HTML. Se mira el texto CRUDO,
  // antes de recortar/normalizar (`trim()` se come U+FEFF y similares): AL2-2.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(raw)) return { ok: false };
  const t = raw.trim();
  if (t === '') return { ok: true, label: null };
  if ([...t].length > 40) return { ok: false };
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
