-- ===============================================================================================================================
-- M-95c · v1.116.5⟨ids⟩ (API_CONTRACT §IDS.1, ARCHITECTURE §15.1 D-IDS-V, PT-IDS-3) — FK de la versión de liga de la pieza.
-- Propiedad: backend. Aparte de `m95b` para poder revertirla sola.
--
-- Qué hace:
--   (1) índice `InventoryItem_cardProductId_idx` sobre `InventoryItem."cardProductId"`;
--   (2) FK `InventoryItem_cardProductId_fkey`: `InventoryItem."cardProductId"` → `CardProduct."tcgplayerProductId"`
--       `ON DELETE RESTRICT ON UPDATE RESTRICT`. Un id colgante se vendería y valuaría como (idioma, sin liga) con la
--       referencia de la base (`pieceVersionOf`: `?? null`); la BD es la única defensa que no depende de que nadie añada un
--       `delete` de `CardProduct`.
-- ⛔ Sin arreglo automático de huérfanos: si hay `InventoryItem` con `cardProductId` sin `CardProduct`, el `ADD CONSTRAINT`
--    ABORTA la migración (falla cerrado). Q1d (`API_CONTRACT §IDS.9`, devops) los cuenta ANTES en producción.
-- IDEMPOTENTE: `CREATE INDEX IF NOT EXISTS` y la FK quitar-si-existe-y-poner.
--
-- Comprobación (antes, quien despliega; debe dar 0 — Q1d):
--   SELECT count(*) FROM "InventoryItem" i WHERE i."cardProductId" IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM "CardProduct" c WHERE c."tcgplayerProductId" = i."cardProductId");
-- Comprobación (después):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'InventoryItem_cardProductId_fkey';
--
-- Reversa (inocua para el dinero; deja la tabla como `m95b`):
--   ALTER TABLE "InventoryItem" DROP CONSTRAINT IF EXISTS "InventoryItem_cardProductId_fkey";
--   DROP INDEX IF EXISTS "InventoryItem_cardProductId_idx";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261112120200_m95c_ids_card_product_fk';
-- ===============================================================================================================================

-- (1) Índice
CREATE INDEX IF NOT EXISTS "InventoryItem_cardProductId_idx" ON "InventoryItem"("cardProductId");

-- (2) FK Restrict
ALTER TABLE "InventoryItem" DROP CONSTRAINT IF EXISTS "InventoryItem_cardProductId_fkey";
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_cardProductId_fkey" FOREIGN KEY ("cardProductId") REFERENCES "CardProduct"("tcgplayerProductId") ON DELETE RESTRICT ON UPDATE RESTRICT;
