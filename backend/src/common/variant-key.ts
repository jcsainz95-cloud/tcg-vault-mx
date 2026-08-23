import { Finish, ProductType } from '@prisma/client';

/**
 * variant-key.ts (P-30 H2, TECH_DEBT) — ÚNICA definición de la clave compuesta de VARIANTE
 * `K = (cardId, productType, gradeKey, finish)` que agrupa/llave­a piezas equivalentes en pricing,
 * catálogo (agrupado de Compra §4.9a) y los mapas batch de `PriceReference`/`VariantPriceOverride`.
 *
 * Antes se interpolaba a mano (`${cardId}|${productType}|${gradeKey}|${finish}`) en varios sitios: un
 * cambio de orden/separador/componentes en uno solo producía un DRIFT silencioso (un grupo llaveado
 * distinto de su override/referencia → miss del map). Centralizarla aquí elimina esa fuente de drift.
 *
 * SIN cambio de comportamiento: produce EXACTAMENTE el mismo string que las interpolaciones previas
 * (`gradeKey` es el canónico ya resuelto por `PricingService.gradeKeyFor`, p. ej. `raw:NM` |
 * `graded:PSA:10`). Money-safe: es solo una clave de agrupación en memoria, no toca importes.
 */
export interface VariantKeyParts {
  cardId: string;
  productType: ProductType;
  /** gradeKey canónico ya resuelto (`gradeKeyFor(item)`): `raw:NM` | `graded:PSA:10` | `sealed` | … */
  gradeKey: string;
  finish: Finish;
}

/** Construye la clave `K = cardId|productType|gradeKey|finish` (mismo formato que las 3 copias previas). */
export function variantKey(parts: VariantKeyParts): string {
  return `${parts.cardId}|${parts.productType}|${parts.gradeKey}|${parts.finish}`;
}
