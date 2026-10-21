/**
 * og-image.ts — resolución PURA de la URL de imagen para la vista previa social (og:image).
 * §MKT.A / ARCHITECTURE §13.2.3 (A3/A4).
 *
 * og/WhatsApp/Meta EXIGEN una URL **absoluta** (una relativa no resuelve en su crawler). Este helper
 * devuelve la PRIMERA candidata que sea una URL `http(s)` absoluta; si ninguna lo es, `null` — y entonces
 * el frontend OMITE `og:image` (⛔ nunca inventa arte, regla del brief §A4).
 *
 * ⚠️ **NO verifica el TAMAÑO del recurso (objetivo ≥1200×630).** El backend no descarga la imagen, así
 * que no puede afirmar sus dimensiones. El llamador pasa las candidatas en orden de preferencia (p. ej.
 * `imageLargeUrl` antes que `imageSmallUrl`) y se queda con la mejor que sea absoluta. Lo NO GARANTIZADO
 * del tamaño está declarado en `docs/BACKEND_NOTES.md` (Q1). Money-safe: solo display.
 */

/** ¿Es una URL absoluta `http(s)://…`? (tras `trim`; exige algo después del esquema). */
function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^https?:\/\/\S/i.test(value.trim());
}

/**
 * Primera candidata absoluta `http(s)`, ya `trim`eada; `null` si ninguna lo es (⇒ frontend omite
 * `og:image`). Las candidatas se evalúan EN ORDEN (la primera absoluta gana): pasa la grande primero.
 */
export function absoluteOgImageUrl(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (isAbsoluteHttpUrl(c)) return c.trim();
  }
  return null;
}
