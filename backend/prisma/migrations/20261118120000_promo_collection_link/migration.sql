-- promo_collection_link (AUTO-B, docs/specs/AUTO_CATALOGO.md §B). ADITIVA e idempotente: columna nullable + tabla derivada nueva.
-- Ninguna fila existente cambia; reversa = revertir el codigo (la tabla/columna quedan inertes).
ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "contentKey" TEXT;
CREATE INDEX IF NOT EXISTS "Card_contentKey_idx" ON "Card"("contentKey") WHERE "contentKey" IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE "PromoLinkConfidence" AS ENUM ('high', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PromoCollectionLink" (
  "promoCardId" TEXT NOT NULL,
  "expansionSetId" TEXT NOT NULL,
  "confidence" "PromoLinkConfidence" NOT NULL,
  "evidence" JSONB NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromoCollectionLink_pkey" PRIMARY KEY ("promoCardId"),
  CONSTRAINT "PromoCollectionLink_promoCardId_fkey" FOREIGN KEY ("promoCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromoCollectionLink_expansionSetId_fkey" FOREIGN KEY ("expansionSetId") REFERENCES "CardSet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PromoCollectionLink_expansionSetId_confidence_idx" ON "PromoCollectionLink"("expansionSetId", "confidence");
