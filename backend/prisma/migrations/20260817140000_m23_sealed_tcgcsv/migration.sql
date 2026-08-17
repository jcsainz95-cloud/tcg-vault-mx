-- M-23 (v1.19-sealed-tcgcsv, WS «Catálogo y precios»): referencia de mercado del SELLADO vía TCGCSV.
-- Aditiva, nullable, SIN backfill (la curación del mapeo es manual post-deploy; el dial
-- `sealed_price_source` se siembra en `off` — dato del seed, no esquema). ARCHITECTURE §4.19 y §11 (M-23) /
-- API_CONTRACT changelog v1.19-sealed-tcgcsv.

-- PriceSource += 'tcgcsv': fuente de la referencia de sellado en PriceReference.source (y en el
-- PriceInfo.source del contrato). En Postgres, ALTER TYPE ... ADD VALUE es aditivo y no reescribe
-- filas. NOTA operativa: ADD VALUE no puede correr dentro de la MISMA transacción que use el valor
-- nuevo (limitación de Postgres); esta migración solo altera el tipo y agrega columnas/índice, no
-- inserta filas con 'tcgcsv', así que `prisma migrate deploy` la aplica sin conflicto.
ALTER TYPE "PriceSource" ADD VALUE 'tcgcsv';

-- InventoryItem.tcgplayerProductId: mapeo curado del item SELLADO al productId de TCGplayer/TCGCSV.
-- Solo aplica a productType='sealed' (regla de APLICACIÓN, no constraint de BD). NULL = no mapeado
-- (alimenta la cola derivada de curación GET /admin/pricing/sealed/unmapped, §4.19c).
ALTER TABLE "InventoryItem" ADD COLUMN "tcgplayerProductId" INTEGER;

-- InventoryItem.tcgplayerGroupId: grupo TCGCSV del producto (el endpoint de precios es POR GRUPO).
-- Se fija JUNTO con tcgplayerProductId; ambos null o ambos poblados (invariante de aplicación).
ALTER TABLE "InventoryItem" ADD COLUMN "tcgplayerGroupId" INTEGER;

-- CreateIndex: sirve la cola de no-mapeados (`sealed AND "tcgplayerProductId" IS NULL`) y el
-- `SELECT DISTINCT "tcgplayerGroupId"` del job sealed-price-ingest sin barrer la tabla.
CREATE INDEX "InventoryItem_tcgplayerProductId_idx" ON "InventoryItem"("tcgplayerProductId");
