-- M-32 (v1.30-buylist-quote-por-producto, ARCHITECTURE §11 / §4.29) — LÍNEA de buylist por
-- `productId`: cotizar/vender un `CardProduct` SEPARADO (deck_exclusive/promo) como línea PROPIA.
-- ESTRICTAMENTE ADITIVA: dos columnas nuevas NULLABLE, SIN backfill, SIN dropear nada. Segura con la
-- app corriendo: hasta que el código nuevo despliegue nadie las escribe; filas viejas quedan en NULL =
-- línea de set_base (retrocompatible). La LECTURA de precios NO necesita migración: reusa
-- `CardProduct` + `PriceReference.cardProductId` de M-31 (§4.27b).

-- 1) `SellRequestItem.cardProductId` (Int nullable): snapshot del `tcgplayerProductId` cotizado cuando
--    la línea es un producto separado. Se propaga al InventoryItem al convertir (M5). NULL = set_base.
--    Análogo a como M-19 añadió `SellRequestItem.finish`.
ALTER TABLE "SellRequestItem" ADD COLUMN "cardProductId" INTEGER;

-- 2) `PendingPriceEntry.cardProductId` (Int nullable): entra a la clave LÓGICA de dedupe de la cola de
--    precio pendiente — resolver el precio del set_base NO cierra la del Deck Exclusive (money-safe,
--    §4.29d). NULL = base.
ALTER TABLE "PendingPriceEntry" ADD COLUMN "cardProductId" INTEGER;
