/**
 * §PRICE-PATTERN (docs/DECISIONES.md): los productos de TCGplayer «X (Master Ball Pattern)», «X (Poke Ball Pattern)», «X (Friend Ball)»,
 * «X (Energy Symbol Pattern)»… son VERSIONES ALTERNAS de la misma carta con su propio precio (a veces 50× el de la carta normal). Se clasifican
 * por el SUFIJO ENTRE PARÉNTESIS AL FINAL del nombre y NO prestan su precio a la carta base.
 *
 * ⭐ UN SOLO CLASIFICADOR (prohibido un regex duplicado): el provider, el import `tcgcsv-set-import` y el job `pattern-reclassify` llaman a
 * `isVariantProductName` (el job NO tiene un patrón en SQL: pre-filtra con `ILIKE` —un superconjunto— y decide aquí). Por eso no puede haber
 * divergencia JS↔SQL con acentos.
 *  - Normalización: NFKD, sin marcas diacríticas, minúsculas («Poké Ball Pattern» ⇒ «poke ball pattern»).
 *  - Sin ReDoS: nombres de más de {@link MAX_PRODUCT_NAME_LENGTH} caracteres NUNCA son variante (el clasificador de `kind` los manda a `other`),
 *    y el sufijo se extrae con búsqueda LINEAL del último «(»; la lista de palabras se prueba solo sobre esa subcadena (≤ 200).
 */
import { normalizeMatchText } from './card-version';

export const MAX_PRODUCT_NAME_LENGTH = 200;

/** Las palabras que hacen «versión alterna» a un sufijo `( … )`, con límite de palabra (sobre texto YA normalizado, sin acentos). */
const VARIANT_WORDS = /\b(?:pattern|ball|energy symbol)\b/;

/** NFKD + sin marcas diacríticas + minúsculas (no toca espacios ni símbolos: el sufijo se busca con «(» y «)» reales). */
function foldName(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** El contenido del paréntesis FINAL (`X (contenido)` ⇒ `contenido`), o `null` si el nombre no termina en un paréntesis simple. Lineal. */
export function trailingParenthetical(name: string): string | null {
  const t = name.trimEnd();
  if (!t.endsWith(')')) return null;
  const open = t.lastIndexOf('(');
  if (open < 0) return null;
  const inner = t.slice(open + 1, -1);
  return inner.includes(')') ? null : inner; // `[^)]*`: sin «)» dentro
}

/** Solo el paréntesis FINAL: «Ultra Ball», «Poké Ball» (cartas de entrenador, sin paréntesis) NO califican. */
export function isVariantProductName(name: string | null | undefined): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_PRODUCT_NAME_LENGTH) return false;
  const inner = trailingParenthetical(name);
  return inner != null && VARIANT_WORDS.test(foldName(inner));
}

/** Pre-filtro SQL (`ILIKE`, un SUPERCONJUNTO barato) para el job: la decisión final la toma `isVariantProductName`. */
export const VARIANT_PRODUCT_PREFILTER_LIKE: readonly string[] = ['%ball%', '%pattern%', '%energy symbol%'];

/** Preferencia de producto para el desempate (§PRICE-PATTERN punto 3): 0 = ES el ancla de la carta; 1 = nombre exacto; 2 = el resto. */
export type ProductPreference = 0 | 1 | 2;

export function productPreferenceOf(
  product: { tcgplayerProductId: number; name: string },
  card: { tcgplayerId: string | null; name: string },
): ProductPreference {
  if (card.tcgplayerId != null && String(product.tcgplayerProductId) === card.tcgplayerId) return 0;
  if (normalizeMatchText(product.name) === normalizeMatchText(card.name)) return 1;
  return 2;
}
