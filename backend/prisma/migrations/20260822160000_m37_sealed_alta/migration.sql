-- M-37 (v1.36-sealed-alta, P-35, WS «Inventario y vault»): alta dedicada de producto SELLADO con
-- imagen de API. Aditiva, nullable, SIN backfill (las columnas se pueblan al dar de alta un sellado
-- por el flujo dedicado; piezas legacy quedan `null` y el display cae a la `Card` ancla). Money-safe:
-- ninguna de estas columnas fija precio. ARCHITECTURE §4.32 + §11 (M-37) / API_CONTRACT changelog
-- v1.36-sealed-alta. Las columnas de MAPEO (`InventoryItem.tcgplayerProductId/tcgplayerGroupId`) ya
-- existen desde M-23: esta migración NO las recrea.

-- CardSet.tcgcsvGroupId: grupo TCGCSV CURADO por set. Resuelve `GET /admin/inventory/sealed-catalog`
-- (set → productos sellados de la API). NULL = aún no curado ⇒ fallback por hermanos ya mapeados
-- (§4.32b). Solo lectura de catálogo; jamás fija precio.
ALTER TABLE "CardSet" ADD COLUMN "tcgcsvGroupId" INTEGER;

-- InventoryItem.sealedImageUrl: URL de imagen del producto sellado DESDE LA API (TCGCSV/TCGplayer),
-- validada server-side contra el host allowlist. Solo productType='sealed' (regla de APLICACIÓN).
-- Display-only, money-safe. NULL ⇒ fallback a la imagen de catálogo de la `Card` ancla.
ALTER TABLE "InventoryItem" ADD COLUMN "sealedImageUrl" TEXT;

-- InventoryItem.sealedProductName: nombre del producto sellado desde la API (TCGCSV name/cleanName).
-- Solo productType='sealed'. Display-only. NULL ⇒ fallback a `Card.name` (ancla).
ALTER TABLE "InventoryItem" ADD COLUMN "sealedProductName" TEXT;
