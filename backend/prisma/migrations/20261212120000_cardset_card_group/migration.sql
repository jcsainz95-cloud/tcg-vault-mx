-- §AUTO-ENLACE fase 3 (DECISIONES §AUTO-ENLACE 7). Migración ADITIVA: dos columnas NULL sin default ni backfill en "CardSet".
-- `cardGroupVia` solo toma 'auto' | 'confirmed' (lo valida la aplicación; sin CHECK para que la reversa y los cambios de regla no choquen con filas).
-- Reversa: ALTER TABLE "CardSet" DROP COLUMN "cardGroupId", DROP COLUMN "cardGroupVia";  (nada depende de ellas: la resolución vuelve a pptSetId/nombre).
ALTER TABLE "CardSet" ADD COLUMN "cardGroupId" INTEGER, ADD COLUMN "cardGroupVia" TEXT;
