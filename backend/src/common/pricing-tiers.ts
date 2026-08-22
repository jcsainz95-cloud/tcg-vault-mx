/**
 * pricing-tiers.ts (v1.37, P-34, ARCHITECTURE §4.33a) — TAXONOMÍA de tiers de precio: la ÚNICA fuente
 * autoritativa de los 5 peldaños de valor del sistema. Zona compartida (`common/`), sin dependencias de
 * infra (importable desde seeds/tests). Hermana de `rarity-catalog.ts` (§4.28): es una constante CERRADA
 * y VERSIONADA. El dueño NO crea/borra tiers — solo edita (1) los VALORES de la regla de cada tier
 * (`BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES`.tierRules) y (2) el MAPA rareza→tier (`PRICING_TIER_MAP`).
 *
 * La banda `premium` del TIER (T3/T4 = true) es distinta del `premium` de la RAREZA (`rarity-catalog.ts`,
 * §4.28e). El invariante money-safe (§4.33d) las liga: una rareza `premium:true` solo puede caer en un tier
 * cuya regla de COMPRA sea `pct` (nunca en un bin fijo). Con el seed, eso equivale a «premium ⇒ T3/T4», pero
 * el invariante se valida sobre el MODO de la regla de compra vigente, no sobre esta etiqueta.
 */

export type TierId = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export interface PricingTier {
  id: TierId;
  /** Etiqueta de display (LOCKED, no editable por el dueño). */
  name: string;
  /** Banda del tier: T0/T1/T2 = false ; T3/T4 = true (§4.33a/d). */
  premium: boolean;
}

/** Taxonomía LOCKED de 5 tiers (§4.33a). El orden es el de valor ascendente. */
export const PRICING_TIERS: PricingTier[] = [
  { id: 'T0', name: 'Bulk', premium: false },
  { id: 'T1', name: 'Uncommon / Reverse', premium: false },
  { id: 'T2', name: 'Rare / Holo', premium: false },
  { id: 'T3', name: 'Premium / Chase', premium: true },
  { id: 'T4', name: 'Ultra / Grail', premium: true },
];

/** Los `TierId` válidos, en orden. Útil para validar bodies y recorrer las 5 reglas. */
export const TIER_IDS: readonly TierId[] = PRICING_TIERS.map((t) => t.id);

/** Índice `id → PricingTier`. */
const BY_ID = new Map<TierId, PricingTier>(PRICING_TIERS.map((t) => [t.id, t]));

/** ¿`v` es un `TierId` válido de la taxonomía LOCKED? (type guard). */
export function isTierId(v: unknown): v is TierId {
  return typeof v === 'string' && BY_ID.has(v as TierId);
}

/** Devuelve el `PricingTier` de un id, o `undefined` si el id no es válido. */
export function getTier(id: string): PricingTier | undefined {
  return BY_ID.get(id as TierId);
}
