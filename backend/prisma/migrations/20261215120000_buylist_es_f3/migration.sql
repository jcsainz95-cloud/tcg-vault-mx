-- §BUYLIST-ES F3 (API_CONTRACT_BUYLIST_ES §1, §4.5). ADITIVA, sin backfill de dinero: toda fila previa queda con language='en' (DEFAULT) y el resto en NULL.
-- Reversa: ALTER TABLE "SellRequestItem" DROP COLUMN "spanishPenaltyPctAtQuote", DROP COLUMN "versionMarkets", DROP COLUMN "receivedBreakdown";
--          ALTER TABLE "PendingPriceEntry" DROP COLUMN "language";
ALTER TABLE "SellRequestItem"
  ADD COLUMN IF NOT EXISTS "spanishPenaltyPctAtQuote" INTEGER,
  ADD COLUMN IF NOT EXISTS "versionMarkets" JSONB,
  ADD COLUMN IF NOT EXISTS "receivedBreakdown" JSONB;

ALTER TABLE "PendingPriceEntry"
  ADD COLUMN IF NOT EXISTS "language" "CardLanguage" NOT NULL DEFAULT 'en';
