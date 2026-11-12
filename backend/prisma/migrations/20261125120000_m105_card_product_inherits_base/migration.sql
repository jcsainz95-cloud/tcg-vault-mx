-- §ALTA-LIGA-2 (m105, correcciones de gate AL2-4): la herencia de precio de la normal depende de «sin PriceReference propia» y de esta
-- marca, NO del signo del productId: el producto REAL que absorbe una versión manual la hereda hasta tener mercado propio. ADITIVA.
ALTER TABLE "CardProduct" ADD COLUMN "inheritsBase" BOOLEAN NOT NULL DEFAULT false;
UPDATE "CardProduct" SET "inheritsBase" = true WHERE "tcgplayerProductId" < 0;

-- Reversa de m104 + m105 (a mano; SOLO vale antes del primer uso: con versiones manuales las piezas (InventoryItem.cardProductId,
-- FK RESTRICT) las referencian ⇒ primero reapuntar o borrar esas piezas y luego los productos manuales):
--   ALTER TABLE "CardProduct" DROP COLUMN "inheritsBase";
--   ALTER TABLE "CardProduct" DROP CONSTRAINT "CardProduct_manual_shape_check";
--   DROP INDEX "CardProduct_manual_stamp_key";
--   ALTER TABLE "CardProduct" DROP COLUMN "stampLabelNorm";
--   DROP SEQUENCE "manual_product_id_seq";
--   DELETE FROM "_prisma_migrations" WHERE migration_name IN ('20261125120000_m105_card_product_inherits_base', '20261124120000_m104_manual_stamp_versions');
