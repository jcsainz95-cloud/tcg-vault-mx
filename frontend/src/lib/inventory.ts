import type { ProductType } from '@/types/contract';

/**
 * INV-3: ¿la pieza tiene un precio de venta MANUAL (override) que GANA sobre las reglas de precio
 * globales? Espeja EXACTAMENTE la precedencia del motor server-side (SEC-A1):
 *
 *  - sellado (`productType === 'sealed'`): el override cuenta SOLO si es `> 0`. Un `listPriceCents`
 *    `<= 0` es INPUT DEGENERADO y el motor lo trata como AUSENTE (H-1, v1.24 · `computeSealedSalePrice`
 *    en `backend/src/common/money.ts`): el precio cae a mercado×spread. Mostrar "Precio manual · MX$0.00"
 *    para un sellado con override 0 sería FALSO.
 *  - raw/graded: cualquier valor no-nulo es override (catalog.service usa `!= null`).
 *
 * Helper PURO (sin i18n ni render) para poder testearlo aislado y reusarlo en lista y detalle.
 */
export function hasManualPrice(item: {
  productType: ProductType;
  listPriceCents?: number | null;
}): boolean {
  if (item.listPriceCents == null) return false;
  if (item.productType === 'sealed') return item.listPriceCents > 0;
  return true;
}
