-- promo_collection_link (AUTO-B, docs/specs/AUTO_CATALOGO.md §B). ADITIVA e idempotente: columna nullable + tabla derivada nueva.
-- Ninguna fila existente cambia; reversa = revertir el codigo (la tabla/columna quedan inertes).
--
-- REVERSA (opcional; solo si se quiere limpiar el esquema DESPUES de revertir el codigo; documentada, NO automatica). Ningun codigo
-- anterior lee estos objetos, asi que no es necesaria para volver atras. `ConfigSetting catalog.auto.promoGate` es estado derivado:
-- se puede borrar sin perdida (la compuerta falla CERRADA sin fila).
-- REVERSA:BEGIN
--   DROP TABLE IF EXISTS "PromoCollectionLink";
--   DROP TYPE IF EXISTS "PromoLinkConfidence";
--   DROP INDEX IF EXISTS "Card_contentKey_idx";
--   ALTER TABLE "Card" DROP COLUMN IF EXISTS "contentKey";
--   DELETE FROM "ConfigSetting" WHERE "key" = 'catalog.auto.promoGate';
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261118120000_promo_collection_link';
-- REVERSA:END
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
