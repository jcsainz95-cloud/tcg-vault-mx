-- §ORIGEN-VISITA (DECISIONES 8). Migración ADITIVA: columnas NULL sin default ni backfill en "Order" y "SellRequest".
-- Reversa: ALTER TABLE ... DROP COLUMN "visitUtmSource","visitUtmMedium","visitUtmCampaign","visitUtmContent","visitReferrer"
-- en ambas tablas y luego DROP TYPE "VisitReferrer".
CREATE TYPE "VisitReferrer" AS ENUM ('google', 'bing', 'chatgpt', 'perplexity', 'gemini', 'instagram', 'facebook', 'otro', 'directo');

ALTER TABLE "Order"
  ADD COLUMN "visitUtmSource" TEXT,
  ADD COLUMN "visitUtmMedium" TEXT,
  ADD COLUMN "visitUtmCampaign" TEXT,
  ADD COLUMN "visitUtmContent" TEXT,
  ADD COLUMN "visitReferrer" "VisitReferrer";

ALTER TABLE "SellRequest"
  ADD COLUMN "visitUtmSource" TEXT,
  ADD COLUMN "visitUtmMedium" TEXT,
  ADD COLUMN "visitUtmCampaign" TEXT,
  ADD COLUMN "visitUtmContent" TEXT,
  ADD COLUMN "visitReferrer" "VisitReferrer";
