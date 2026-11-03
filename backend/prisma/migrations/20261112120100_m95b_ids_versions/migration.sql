-- ===============================================================================================================================
-- M-95b · v1.116⟨ids⟩ (API_CONTRACT §IDS.1, ARCHITECTURE §15.3) — idioma de la pieza y versiones de liga. ADITIVA. 💰
-- Propiedad: backend.
--
-- Qué hace:
--   (1) enums `CardLanguage` (en, es) y `StampType` (prize_pack, league, championship, prerelease, staff);
--   (2) `CardProduct` += `stampType`, `stampLabel`, `sourceGroupId` + CHECK ("kind" = 'stamped') = ("stampType" IS NOT NULL);
--   (3) `InventoryItem` += `language NOT NULL DEFAULT 'en'`;
--   (4) `OrderItem` += `language NOT NULL DEFAULT 'en'`, `stampType`, `stampLabel`;
--   (5) tabla `StampedProductCandidate` (empates ambiguos, §IDS.3);
--   (6) seed `spanish_market_pct = 75` (§IDS.7; ON CONFLICT DO NOTHING).
-- ⛔ SIN backfill (I-1): los DEFAULT dejan toda pieza y toda línea en inglés sin liga; ningún `variantKey`, `ListingPrice` ni
--    precio se mueve (prueba IDS-B1, `test/integration/ids-m95.e2e-spec.ts`).
-- IDEMPOTENTE: enums en bloque `duplicate_object`, `IF NOT EXISTS`, constraints quitar-si-existe-y-poner.
--
-- Comprobación (después, quien despliega):
--   SELECT language, count(*) FROM "InventoryItem" GROUP BY 1;   -- todo `en`
--   SELECT language, count(*) FROM "OrderItem" GROUP BY 1;       -- todo `en`
--   SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'spanish_market_pct';  -- 75
--
-- Reversa (SOLO tras retirar las piezas `es`/`stamped` y desplegar el artefacto anterior, ARCHITECTURE §15.3):
--   DROP TABLE IF EXISTS "StampedProductCandidate";
--   ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "language", DROP COLUMN IF EXISTS "stampType", DROP COLUMN IF EXISTS "stampLabel";
--   ALTER TABLE "InventoryItem" DROP COLUMN IF EXISTS "language";
--   ALTER TABLE "CardProduct" DROP CONSTRAINT IF EXISTS "CardProduct_stamped_type_check",
--     DROP COLUMN IF EXISTS "stampType", DROP COLUMN IF EXISTS "stampLabel", DROP COLUMN IF EXISTS "sourceGroupId";
--   DROP TYPE IF EXISTS "StampType"; DROP TYPE IF EXISTS "CardLanguage";
--   DELETE FROM "ConfigSetting" WHERE key = 'spanish_market_pct';
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261112120100_m95b_ids_versions';
-- ===============================================================================================================================

-- (1) Enums
DO $$ BEGIN
  CREATE TYPE "CardLanguage" AS ENUM ('en', 'es');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "StampType" AS ENUM ('prize_pack', 'league', 'championship', 'prerelease', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (2) CardProduct
ALTER TABLE "CardProduct" ADD COLUMN IF NOT EXISTS "stampType" "StampType";
ALTER TABLE "CardProduct" ADD COLUMN IF NOT EXISTS "stampLabel" TEXT;
ALTER TABLE "CardProduct" ADD COLUMN IF NOT EXISTS "sourceGroupId" INTEGER;
ALTER TABLE "CardProduct" DROP CONSTRAINT IF EXISTS "CardProduct_stamped_type_check";
ALTER TABLE "CardProduct" ADD CONSTRAINT "CardProduct_stamped_type_check"
  CHECK (("kind" = 'stamped'::"CardProductKind") = ("stampType" IS NOT NULL));

-- (3) InventoryItem
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "language" "CardLanguage" NOT NULL DEFAULT 'en';

-- (4) OrderItem
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "language" "CardLanguage" NOT NULL DEFAULT 'en';
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stampType" "StampType";
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "stampLabel" TEXT;

-- (5) StampedProductCandidate
CREATE TABLE IF NOT EXISTS "StampedProductCandidate" (
    "tcgplayerProductId" INTEGER NOT NULL,
    "cardId" TEXT NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "stampType" "StampType" NOT NULL,
    "stampLabel" TEXT,
    "finishes" "Finish"[] DEFAULT ARRAY[]::"Finish"[],
    "refreshedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StampedProductCandidate_pkey" PRIMARY KEY ("tcgplayerProductId", "cardId")
);
CREATE INDEX IF NOT EXISTS "StampedProductCandidate_cardId_idx" ON "StampedProductCandidate"("cardId");
ALTER TABLE "StampedProductCandidate" DROP CONSTRAINT IF EXISTS "StampedProductCandidate_cardId_fkey";
ALTER TABLE "StampedProductCandidate" ADD CONSTRAINT "StampedProductCandidate_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- (6) Seed del dial (§IDS.7)
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('spanish_market_pct', '75'::jsonb, 'migration:m95-ids', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
