-- §ALTA-LIGA-2 (m104, docs/API_CONTRACT_ALTA_LIGA.md): versión de liga MANUAL desde el alta rápida. ADITIVA.
-- Producto manual ⇔ CardProduct.tcgplayerProductId < 0, sacado de una secuencia propia que decrece desde -1 (nunca choca con TCGCSV).
CREATE SEQUENCE IF NOT EXISTS "manual_product_id_seq" INCREMENT BY -1 MINVALUE -2147483648 MAXVALUE -1 START WITH -1;

-- Etiqueta normalizada (decisión de backend: columna nullable + índice parcial, porque un índice por expresión con quitar acentos
-- necesitaría `unaccent`, que no es IMMUTABLE). NULL en los productos reales.
ALTER TABLE "CardProduct" ADD COLUMN "stampLabelNorm" TEXT;

-- Una sola versión manual por (carta, tipo de sello, etiqueta normalizada): nunca dos productos (el advisory lock del servicio
-- serializa; este índice es la red).
CREATE UNIQUE INDEX "CardProduct_manual_stamp_key" ON "CardProduct" ("cardId", "stampType", COALESCE("stampLabelNorm", ''))
  WHERE "tcgplayerProductId" < 0;

-- Un producto manual es de liga y los reales no llevan etiqueta normalizada.
ALTER TABLE "CardProduct" ADD CONSTRAINT "CardProduct_manual_shape_check"
  CHECK ("tcgplayerProductId" < 0 OR "stampLabelNorm" IS NULL);

-- Reversa (a mano; nada más depende de ello):
--   ALTER TABLE "CardProduct" DROP CONSTRAINT "CardProduct_manual_shape_check";
--   DROP INDEX "CardProduct_manual_stamp_key";
--   ALTER TABLE "CardProduct" DROP COLUMN "stampLabelNorm";
--   DROP SEQUENCE "manual_product_id_seq";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261124120000_m104_manual_stamp_versions';
