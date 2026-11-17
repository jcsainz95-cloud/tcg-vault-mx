/**
 * §PRICE-PATTERN (docs/DECISIONES.md): los productos de TCGplayer «X (Master Ball Pattern)», «X (Poke Ball Pattern)», «X (Friend Ball)»,
 * «X (Energy Symbol Pattern)»… son VERSIONES ALTERNAS de la misma carta con su propio precio (a veces 50× el de la carta normal). Se clasifican
 * por el SUFIJO ENTRE PARÉNTESIS AL FINAL del nombre y NO prestan su precio a la carta base. UN solo sitio para la regla: el clasificador del
 * provider, el job `pattern-reclassify` (SQL equivalente) y las pruebas importan de aquí.
 */
import { normalizeMatchText } from './card-version';

/** Solo el paréntesis FINAL: «Ultra Ball», «Poké Ball» (cartas de entrenador, sin paréntesis) NO califican. */
export const VARIANT_PRODUCT_SUFFIX = /\(([^)]*\b(?:pattern|ball|energy symbol)\b[^)]*)\)\s*$/i;

/**
 * El MISMO patrón en POSIX ARE de Postgres (`\y` = límite de palabra), para el `UPDATE … WHERE name ~* …` del job. Paridad con el de
 * arriba verificada contra la base en `test/integration/pattern-reclassify.e2e-spec.ts`.
 */
export const VARIANT_PRODUCT_SUFFIX_PG = String.raw`\(([^)]*\y(pattern|ball|energy symbol)\y[^)]*)\)\s*$`;

export function isVariantProductName(name: string | null | undefined): boolean {
  return typeof name === 'string' && VARIANT_PRODUCT_SUFFIX.test(name);
}

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
