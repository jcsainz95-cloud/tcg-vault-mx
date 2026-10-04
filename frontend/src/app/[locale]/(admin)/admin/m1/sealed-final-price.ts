/**
 * Constantes del precio final a mano del sellado (`DESIGN_SYSTEM §39.2`, criterio 255), fuera del componente para que
 * tengan UN dueño (techlead s5 D-8, 2026-10-04).
 */

/**
 * Cota de `UpdateItemDto.listPriceCents` (`@Max(MAX_LIST_PRICE_CENTS)`, `backend/src/modules/inventory/dto/inventory.dto.ts:57`,
 * citada en `DESIGN_SYSTEM §39`) ⇒ MX$1,000,000.00. La pantalla no deja escribir lo que el servidor rechazaría con
 * `422 VALIDATION_ERROR`. ⚠️ El contrato aún no la declara (solicitud al arquitecto en `FRONTEND_NOTES`); mientras
 * tanto `sealed-final-price.test.ts` la ata a la cifra que cita el sistema de diseño.
 */
export const MAX_LIST_PRICE_CENTS = 100_000_000;

/**
 * Las consultas que pintan el precio de una pieza sellada (cola «Listas para publicar», cajón de variante, pestaña
 * «Sellado» de M1 y estado de precios de M11). UNA lista para los dos momentos que la usan: tras guardar y al pulsar
 * «Recargar» tras un `409/422`. Antes eran dos listas y «Recargar» no refrescaba el panel de «Sellado» — justo el
 * sitio donde el editor vive con `layout='panel'`.
 */
export const SEALED_FINAL_PRICE_INVALIDATES = [
  'pending-publish',
  'admin-inventory',
  'variant-pieces',
  'sealed-sets',
  'sealed-set-detail',
  'sealed-price-status',
] as const;
