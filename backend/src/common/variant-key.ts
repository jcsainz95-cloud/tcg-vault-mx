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

/**
 * v1.51 (M-46, ARCHITECTURE §4.39g) — **LLAVE DE POSICIÓN**: la canónica MÁS la identidad de
 * PRODUCTO (§4.29d / D7).
 *
 * `variantKey()` **NO se toca**: la consumen los mapas de `PriceReference`/`VariantPriceOverride`
 * (cuya `@@unique` NO incluye `cardProductId`), y cambiarle la forma produciría misses silenciosos de
 * override/referencia — es decir, dinero mal. Esta llave es **derivada, no paralela**: se construye
 * SOBRE `variantKey()`, así que no puede divergir de ella por un cambio de orden o de separador.
 *
 * El caso base va **explícito** (`'base'`) y no como cadena vacía: una cadena vacía se confunde a
 * simple vista con un `productId` ausente y las dos se leerían igual en un log.
 *
 * ⚠️ **NORMA (§4.39g):** las CUATRO fuentes de la posición de la mesa de decisión —inventario
 * on-hand (vía `INVENTORY_POSITION_PORT`), verificando, en tránsito y comprometido— **usan esta
 * función**. Prohibida la interpolación a mano: si una de las cuatro construyera la llave distinto,
 * las cifras de la mesa se desalinearían **en silencio** y el operador compraría mal.
 */
export function variantPositionKey(parts: VariantKeyParts & { cardProductId: number | null }): string {
  return `${variantKey(parts)}|${parts.cardProductId ?? 'base'}`;
}
