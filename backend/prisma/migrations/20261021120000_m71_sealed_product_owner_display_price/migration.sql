-- M-71 — migración `v1.83.1` (precio del sellado POR PRODUCTO, lo pone el dueño, CON IVA · API_CONTRACT §M11-SP.12.12
-- (sustituye el SQL de §M11-SP.7) · ARCHITECTURE §4.62 / §4.62.8).
--
-- DDL ADITIVO, SIN RELLENO:
--   · 1 columna nueva, nullable y sin default: `SealedProduct.ownerDisplayPriceCents` (INTEGER) = `P` del dueño:
--     lo que paga el cliente por pieza, IVA DENTRO, exactamente lo tecleado. `NULL` = no lo ha fijado.
--   · 1 CHECK: `NULL` o `1…100_000_000` (`MAX_LIST_PRICE_CENTS`).
--
-- ⛔ SIN RELLENO (E-7): rellenar `P` desde el `listPriceCents` común de las piezas exigiría escribir
-- `displayPriceCentsOf` EN SQL con los diales del momento — una segunda fórmula del dinero. Sin relleno NINGÚN precio
-- se mueve: toda fila nace `NULL` ⇒ el peldaño 1 está ausente ⇒ cada pieza cobra exactamente lo de hoy.
-- ⛔ CERO filas de bitácora, cero `InventoryItem` tocados.
--
-- IDEMPOTENTE: `ADD COLUMN IF NOT EXISTS` y el CHECK se quita-si-existe y se vuelve a poner (re-aplicar el fichero
-- sobre una base que ya lo tiene deja el mismo estado y no falla).
--
-- REVERSA (código anterior primero; los precios que el dueño haya fijado se pierden — están en la bitácora
-- `sealed_product.sale_price_set` para re-teclearlos):
--     ALTER TABLE "SealedProduct" DROP CONSTRAINT IF EXISTS "sealed_product_owner_display_price_range";
--     ALTER TABLE "SealedProduct" DROP COLUMN IF EXISTS "ownerDisplayPriceCents";
--     DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021120000_m71_sealed_product_owner_display_price';

-- AlterTable
ALTER TABLE "SealedProduct" ADD COLUMN IF NOT EXISTS "ownerDisplayPriceCents" INTEGER;

-- CHECK (SQL a mano; Prisma no los modela — precedente M-62/M-63)
ALTER TABLE "SealedProduct" DROP CONSTRAINT IF EXISTS "sealed_product_owner_display_price_range";
ALTER TABLE "SealedProduct" ADD CONSTRAINT "sealed_product_owner_display_price_range"
  CHECK ("ownerDisplayPriceCents" IS NULL OR ("ownerDisplayPriceCents" BETWEEN 1 AND 100000000));
