-- ===============================================================================================================================
-- M-94 · v1.113⟨portada⟩ + erratas v1.113.1 y v1.113.3 (API_CONTRACT §DYN.1/§DYN.5, ARCHITECTURE §4.DYN (e)) — precio del día. ADITIVA. 💰
-- Propiedad: backend.
--
-- Qué hace:
--   (1) 3 enums nuevos (`ListingPriceStatus`, `ListingPriceRunTrigger`, `ListingPriceRunStatus`).
--   (2) Tablas `ListingPriceRun` (bitácora de cálculos) y `ListingPrice` (UNA fila por pieza vendible: el precio que se
--       exhibe y se cobra; sin columnas de precio anterior, errata v1.113.1; con el «valor de mercado» exhibido congelado,
--       `referenceMxnCents`/`referenceCapturedDate`, errata v1.113.3, añadidas EDITANDO esta migración en sitio: aún no
--       publicada; una BD local o de CI que ya aplicó la versión anterior se recrea) + CHECKs.
-- ⛔ No siembra diales ni filas: la primera corrida (`bootstrap`) la lanza el arranque del artefacto nuevo; mientras tanto
--    los lectores precian en vivo por el cuerpo único (§DYN.5.6, «sin fila») y encolan `missing_row`.
-- IDEMPOTENTE: enums en bloque `duplicate_object`, `IF NOT EXISTS`, constraints quitar-si-existe-y-poner.
--
-- Comprobación (después, quien despliega):
--   SELECT trigger, status, "scopeItemCount", "pricedCount", "pendingCount" FROM "ListingPriceRun" ORDER BY "startedAt";
--   SELECT status, count(*) FROM "ListingPrice" GROUP BY status;
--
-- Reversa (contrato §DYN.1; SOLO tras desplegar el artefacto anterior, que no lee estas tablas):
--   DROP TABLE IF EXISTS "ListingPrice", "ListingPriceRun";
--   DROP TYPE IF EXISTS "ListingPriceStatus"; DROP TYPE IF EXISTS "ListingPriceRunTrigger"; DROP TYPE IF EXISTS "ListingPriceRunStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261111120000_m94_listing_price';
--   (los pedidos ya cobrados congelaron su precio en `OrderItem` y no dependen de `ListingPrice`.)
-- ===============================================================================================================================

-- (1) Enums
DO $$ BEGIN
  CREATE TYPE "ListingPriceStatus" AS ENUM ('priced', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ListingPriceRunTrigger" AS ENUM ('daily', 'manual_ingest', 'publish_all', 'publish', 'dial_change', 'manual_price', 'bootstrap', 'missing_row');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ListingPriceRunStatus" AS ENUM ('running', 'ok', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (2) Tablas
CREATE TABLE IF NOT EXISTS "ListingPriceRun" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "trigger" "ListingPriceRunTrigger" NOT NULL,
    "status" "ListingPriceRunStatus" NOT NULL,
    "scopeItemCount" INTEGER NOT NULL,
    "pricedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    CONSTRAINT "ListingPriceRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ListingPrice" (
    "inventoryItemId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "ListingPriceStatus" NOT NULL,
    "unitPriceCents" INTEGER,
    "listPriceCents" INTEGER,
    "fixedDisplayCents" INTEGER,
    "priceBasis" "PriceBasis",
    "marketMxnCents" INTEGER,
    "ivaRatePct" INTEGER NOT NULL,
    "ivaTransferPct" INTEGER NOT NULL,
    "referenceMxnCents" INTEGER,
    "referenceCapturedDate" DATE,
    "computedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingPrice_pkey" PRIMARY KEY ("inventoryItemId")
);

CREATE INDEX IF NOT EXISTS "ListingPrice_variantKey_idx" ON "ListingPrice"("variantKey");
CREATE INDEX IF NOT EXISTS "ListingPriceRun_trigger_businessDate_status_idx" ON "ListingPriceRun"("trigger", "businessDate", "status");

ALTER TABLE "ListingPrice" DROP CONSTRAINT IF EXISTS "ListingPrice_inventoryItemId_fkey";
ALTER TABLE "ListingPrice" ADD CONSTRAINT "ListingPrice_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ListingPrice" DROP CONSTRAINT IF EXISTS "ListingPrice_runId_fkey";
ALTER TABLE "ListingPrice" ADD CONSTRAINT "ListingPrice_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ListingPriceRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (Prisma no los modela; los vigila `test/integration/dyn-listing-price.e2e-spec.ts`):
--   `priced` ⇔ hay P ≥ 1 y L ≥ 1; `pending` ⇔ sin P ni L (no se exhibe ni se cobra).
ALTER TABLE "ListingPrice" DROP CONSTRAINT IF EXISTS "ListingPrice_status_price_check";
ALTER TABLE "ListingPrice" ADD CONSTRAINT "ListingPrice_status_price_check" CHECK (
  ("status" = 'priced' AND "unitPriceCents" IS NOT NULL AND "unitPriceCents" >= 1 AND "listPriceCents" IS NOT NULL AND "listPriceCents" >= 1)
  OR ("status" = 'pending' AND "unitPriceCents" IS NULL AND "listPriceCents" IS NULL)
);
ALTER TABLE "ListingPriceRun" DROP CONSTRAINT IF EXISTS "ListingPriceRun_counts_check";
ALTER TABLE "ListingPriceRun" ADD CONSTRAINT "ListingPriceRun_counts_check"
  CHECK ("scopeItemCount" >= 0 AND "pricedCount" >= 0 AND "pendingCount" >= 0);
