-- ===============================================================================================================================
-- M-93 · v1.113⟨portada⟩ (API_CONTRACT §DYN.1, ARCHITECTURE §4.DYN) — portada dinámica y turnos PSA. ADITIVA. Propiedad: backend.
--
-- Qué hace:
--   (1) 3 enums nuevos (`FeaturedSlotKind`, `GradedCardScanOutcome`, `GradedSetScanOutcome`).
--   (2) `InventoryItem.firstListedAt` (nullable, sin índice) + BACKFILL = `createdAt` en toda fila previa
--       (excepción declarada en ARCHITECTURE §4.DYN (c): presentación pura, el error posible va solo hacia OMITIR una
--       «recién llegada», nunca a etiquetar como nueva una pieza ya publicada antes; se extingue a los 7 días).
--   (3) Tablas `FeaturedSelection` / `FeaturedSelectionItem` (Destacadas del día) y `GradedEstimateCardScan` /
--       `GradedEstimateSetScan` (turnos PSA por set) + CHECKs (posición 1..20, créditos ≥ 0).
--   (4) Siembra de los 6 diales de §DYN.3 que no son de dinero (valores EXACTOS de `SETTING_DEFAULTS`; candado
--       `test/dyn.settings.spec.ts`). `ON CONFLICT DO NOTHING` ≡ `upsert update:{}` (no pisa lo ya editado).
--   (5) `SpendAlertKind` += `psa_cycle_short` (AG-24), AL FINAL: ninguna sentencia de este fichero usa el valor nuevo.
-- ⛔ `graded_estimate_ingest_max_cards_per_run` se RETIRA del código pero su fila NO se borra (fila huérfana e inerte,
--    precedente M-48; la lista `RETIRED_SETTING_KEYS` la rotula en el inventario de arranque).
-- IDEMPOTENTE: enums en bloque `duplicate_object`, `IF NOT EXISTS`, constraints quitar-si-existe-y-poner.
--
-- Comprobación (después, quien despliega):
--   SELECT count(*) FILTER (WHERE "firstListedAt" IS NULL) AS sin_fecha FROM "InventoryItem";   -- ⇒ 0
--   SELECT key, "valueJson" FROM "ConfigSetting" WHERE key LIKE 'featured_%' OR key = 'graded_estimate_daily_credit_cap';
--
-- Reversa (contrato §DYN.1; manual, tras desplegar el artefacto anterior):
--   DROP TABLE IF EXISTS "FeaturedSelectionItem", "FeaturedSelection", "GradedEstimateCardScan", "GradedEstimateSetScan";
--   ALTER TABLE "InventoryItem" DROP COLUMN IF EXISTS "firstListedAt";
--   DROP TYPE IF EXISTS "FeaturedSlotKind"; DROP TYPE IF EXISTS "GradedCardScanOutcome"; DROP TYPE IF EXISTS "GradedSetScanOutcome";
--   DELETE FROM "ConfigSetting" WHERE "updatedBy" = 'migration:m93-portada';   -- solo lo no tocado (§11.0)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110120000_m93_portada_dinamica';
--   (el valor `psa_cycle_short` de `SpendAlertKind` no se puede quitar: queda inerte.)
-- ===============================================================================================================================

-- (1) Enums
DO $$ BEGIN
  CREATE TYPE "FeaturedSlotKind" AS ENUM ('new_arrival', 'pool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "GradedCardScanOutcome" AS ENUM ('written', 'no_data');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "GradedSetScanOutcome" AS ENUM ('ok', 'failed', 'unmapped', 'daily_limited', 'over_daily_cap');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (2) «Publicada por primera vez» + backfill
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "firstListedAt" TIMESTAMP(3);
UPDATE "InventoryItem" SET "firstListedAt" = "createdAt" WHERE "firstListedAt" IS NULL;

-- (3) Tablas
CREATE TABLE IF NOT EXISTS "FeaturedSelection" (
    "businessDate" DATE NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seed" TEXT NOT NULL,
    "dials" JSONB NOT NULL,
    "poolCount" INTEGER NOT NULL,
    "newArrivalCandidates" INTEGER NOT NULL,
    "forcedByUserId" TEXT,
    CONSTRAINT "FeaturedSelection_pkey" PRIMARY KEY ("businessDate")
);
CREATE TABLE IF NOT EXISTS "FeaturedSelectionItem" (
    "businessDate" DATE NOT NULL,
    "position" INTEGER NOT NULL,
    "slotKind" "FeaturedSlotKind" NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "gradeKey" TEXT NOT NULL,
    "finish" "Finish" NOT NULL,
    CONSTRAINT "FeaturedSelectionItem_pkey" PRIMARY KEY ("businessDate","position")
);
CREATE TABLE IF NOT EXISTS "GradedEstimateSetScan" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "GradedSetScanOutcome" NOT NULL,
    "creditsEstimated" INTEGER NOT NULL,
    "creditsMeasured" INTEGER,
    "creditsCharged" INTEGER NOT NULL,
    "cardsInScope" INTEGER NOT NULL,
    "cardsReturned" INTEGER NOT NULL,
    CONSTRAINT "GradedEstimateSetScan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "GradedEstimateCardScan" (
    "cardId" TEXT NOT NULL,
    "lastScannedAt" TIMESTAMP(3) NOT NULL,
    "lastOutcome" "GradedCardScanOutcome" NOT NULL,
    "lastSetScanId" TEXT NOT NULL,
    CONSTRAINT "GradedEstimateCardScan_pkey" PRIMARY KEY ("cardId")
);

CREATE INDEX IF NOT EXISTS "FeaturedSelection_effectiveFrom_idx" ON "FeaturedSelection"("effectiveFrom");
CREATE UNIQUE INDEX IF NOT EXISTS "FeaturedSelectionItem_businessDate_cardId_productType_grade_key"
  ON "FeaturedSelectionItem"("businessDate", "cardId", "productType", "gradeKey", "finish");
CREATE INDEX IF NOT EXISTS "GradedEstimateSetScan_businessDate_idx" ON "GradedEstimateSetScan"("businessDate");
CREATE INDEX IF NOT EXISTS "GradedEstimateSetScan_setId_startedAt_idx" ON "GradedEstimateSetScan"("setId", "startedAt");

ALTER TABLE "FeaturedSelectionItem" DROP CONSTRAINT IF EXISTS "FeaturedSelectionItem_businessDate_fkey";
ALTER TABLE "FeaturedSelectionItem" ADD CONSTRAINT "FeaturedSelectionItem_businessDate_fkey"
  FOREIGN KEY ("businessDate") REFERENCES "FeaturedSelection"("businessDate") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GradedEstimateCardScan" DROP CONSTRAINT IF EXISTS "GradedEstimateCardScan_cardId_fkey";
ALTER TABLE "GradedEstimateCardScan" ADD CONSTRAINT "GradedEstimateCardScan_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GradedEstimateCardScan" DROP CONSTRAINT IF EXISTS "GradedEstimateCardScan_lastSetScanId_fkey";
ALTER TABLE "GradedEstimateCardScan" ADD CONSTRAINT "GradedEstimateCardScan_lastSetScanId_fkey"
  FOREIGN KEY ("lastSetScanId") REFERENCES "GradedEstimateSetScan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GradedEstimateSetScan" DROP CONSTRAINT IF EXISTS "GradedEstimateSetScan_setId_fkey";
ALTER TABLE "GradedEstimateSetScan" ADD CONSTRAINT "GradedEstimateSetScan_setId_fkey"
  FOREIGN KEY ("setId") REFERENCES "CardSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (Prisma no los modela; los vigila `test/integration/dyn-m93.e2e-spec.ts`)
ALTER TABLE "FeaturedSelectionItem" DROP CONSTRAINT IF EXISTS "FeaturedSelectionItem_position_check";
ALTER TABLE "FeaturedSelectionItem" ADD CONSTRAINT "FeaturedSelectionItem_position_check" CHECK ("position" BETWEEN 1 AND 20);
ALTER TABLE "GradedEstimateSetScan" DROP CONSTRAINT IF EXISTS "GradedEstimateSetScan_credits_check";
ALTER TABLE "GradedEstimateSetScan" ADD CONSTRAINT "GradedEstimateSetScan_credits_check"
  CHECK ("creditsEstimated" >= 0 AND "creditsCharged" >= 0 AND ("creditsMeasured" IS NULL OR "creditsMeasured" >= 0));

-- (4) Diales de §DYN.3 sin dinero (valores = `SETTING_DEFAULTS`). Regla §11.0 ≡ upsert update:{}.
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('featured_pool_size', '60'::jsonb, 'migration:m93-portada', CURRENT_TIMESTAMP),
       ('featured_random_slots', '8'::jsonb, 'migration:m93-portada', CURRENT_TIMESTAMP),
       ('featured_new_arrival_slots', '2'::jsonb, 'migration:m93-portada', CURRENT_TIMESTAMP),
       ('featured_new_arrival_window_days', '7'::jsonb, 'migration:m93-portada', CURRENT_TIMESTAMP),
       ('featured_rotation_hour', '6'::jsonb, 'migration:m93-portada', CURRENT_TIMESTAMP),
       ('graded_estimate_daily_credit_cap', '3000'::jsonb, 'migration:m93-portada', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- (5) AG-24 — al final (precedente M-72): nada de este fichero usa el valor nuevo.
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'psa_cycle_short';
