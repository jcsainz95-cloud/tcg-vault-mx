-- §BUYLIST-ES F1 (API_CONTRACT_BUYLIST_ES §1). ADITIVA, sin backfill: toda fila previa queda con language='en' (DEFAULT) y el resto en NULL/false.
-- Reversa (literal; va ANTES que la de M-95b, que borra el tipo "CardLanguage" del que dependen estas columnas):
--   ALTER TABLE "SellRequestItem" DROP COLUMN IF EXISTS "language", DROP COLUMN IF EXISTS "versionOffers", DROP COLUMN IF EXISTS "receivedLanguage",
--     DROP COLUMN IF EXISTS "receivedCardProductId", DROP COLUMN IF EXISTS "receivedVersionSet", DROP COLUMN IF EXISTS "offerBreakdown";
--   DELETE FROM "ConfigSetting" WHERE key IN ('buylist_spanish_penalty_pct','buylist_spanish_enabled','buylist_league_enabled');
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261214120100_buylist_es_f1';
ALTER TABLE "SellRequestItem"
  ADD COLUMN IF NOT EXISTS "language" "CardLanguage" NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "versionOffers" JSONB,
  ADD COLUMN IF NOT EXISTS "receivedLanguage" "CardLanguage",
  ADD COLUMN IF NOT EXISTS "receivedCardProductId" INTEGER,
  ADD COLUMN IF NOT EXISTS "receivedVersionSet" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "offerBreakdown" JSONB;

-- Diales (sembrado idempotente: no pisa un valor ya escrito). Los dos interruptores nacen APAGADOS (F3/F4 los encienden tras su gate).
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt") VALUES
  ('buylist_spanish_penalty_pct', '15'::jsonb, 'migration:buylist-es-f1', CURRENT_TIMESTAMP),
  ('buylist_spanish_enabled', 'false'::jsonb, 'migration:buylist-es-f1', CURRENT_TIMESTAMP),
  ('buylist_league_enabled', 'false'::jsonb, 'migration:buylist-es-f1', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
