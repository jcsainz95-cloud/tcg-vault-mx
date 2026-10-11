import { Role } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';

/**
 * 💰 v1.83 (`API_CONTRACT §M11-SP.3`) — **«solo el dueño» pone o cambia el precio de venta del sellado.**
 *
 * EL predicado único del backend (su espejo en frontend es `canSetSealedPrice(me)` en `frontend/src/lib/`). Lo usan el
 * `PUT …/sealed-products/:id/sale-price` (además de su `@Roles('super_admin')` de método), los escritores de SP.4 y la
 * hoja (`canEdit`). ⛔ Ningún otro sitio decide el rol del precio del sellado.
 *
 * **Hoy = `super_admin`** (desviación temporal `D-SP-1`: cualquier súper-admin). ⚠️ **SP-14 — convergencia al fusionar
 * con Skydropx** (`M-68`, `User.isOwner`, v1.80.12.10 §19.30.1): el cuerpo pasa a `isOwnerAccount(fila leída de BD)` en
 * el PR de la fusión (lo hace el stream que fusione segundo), con la tabla de SP-4 actualizada (súper-admin **no** dueño
 * ⇒ `403`). Sin dueño marcado, nadie fija precio (falla cerrado) y el automático sigue vendiendo.
 *
 * Pura y falla cerrado: sin actor (o sin rol) ⇒ `false`.
 */
export function canSetSealedSalePrice(actor: { role?: Role | string | null } | null | undefined): boolean {
  return actor?.role === Role.super_admin;
}

/** Una línea de un escritor de `listPriceCents` / `manualMarketMxnCents`, tal como la ve la regla SP.4. */
export interface SealedPriceWriteLine {
  productType: string;
  /** Presente ⇔ `!== undefined && !== null` (los DTO ya exigen `>= 1`). */
  listPriceCents?: number | null;
  /** El producto de la pieza: el de la línea (alta) o el de la pieza ya existente (`PATCH`, `bulk-publish`). */
  sealedProductId?: string | null;
  manualMarketMxnCents?: number | null;
  /** Solo cuando la pieza ya existe (`PATCH`, `bulk-publish`). */
  itemId?: string;
}

/**
 * 💰 v1.83 (`§M11-SP.4`) — **el personal da de alta sin precio.** Se evalúa DESPUÉS de la validación del DTO y ANTES de
 * toda otra guarda y escritura, sobre TODAS las líneas del cuerpo: el primer incumplimiento lanza y **nada** del
 * cuerpo se escribe (un lote entero se rechaza).
 *
 * | Línea | Sellado ligado | Sellado sin producto | Raw / graded |
 * |---|---|---|---|
 * | `listPriceCents` | `422 SEALED_PRICE_IS_PER_PRODUCT` (cualquier rol, también el dueño) | dueño ⇒ pasa; otro ⇒ `403` | sin cambio |
 * | `manualMarketMxnCents` | dueño ⇒ pasa; otro ⇒ `403` | dueño ⇒ pasa (lo rechaza la regla de siempre); otro ⇒ `403` | n/a |
 *
 * `details` del `422`: `{ sealedProductId, itemId? }` (§Errores).
 */
export function assertSealedPriceWriters(
  lines: SealedPriceWriteLine[],
  actor: { role?: Role | string | null } | null | undefined,
): void {
  const owner = canSetSealedSalePrice(actor);
  for (const line of lines) {
    if (line.productType !== 'sealed') continue;
    if (line.listPriceCents !== undefined && line.listPriceCents !== null) {
      if (line.sealedProductId) {
        throw BusinessException.validation(
          'SEALED_PRICE_IS_PER_PRODUCT',
          'The sale price of a sealed product is per product: set it with PUT /admin/inventory/sealed-products/:id/sale-price',
          { sealedProductId: line.sealedProductId, ...(line.itemId ? { itemId: line.itemId } : {}) },
        );
      }
      if (!owner) {
        throw BusinessException.forbidden('FORBIDDEN', 'Only the owner sets the sale price of sealed products');
      }
    }
    if (line.manualMarketMxnCents !== undefined && line.manualMarketMxnCents !== null && !owner) {
      throw BusinessException.forbidden('FORBIDDEN', 'Only the owner sets a manual market for sealed products');
    }
  }
}
