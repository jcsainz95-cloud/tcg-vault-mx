-- M-60 · rev `decks-portada` (2026-09-28) — PORTADA DEL DECK en `MetaDeckList`.
-- Diseño: ARCHITECTURE §12.4.3; contrato: API_CONTRACT §13 «Portada del deck (`imageUrl`) — regla normativa».
--
-- La imagen de cada deck pasa a ser la PORTADA que Limitless pinta para el arquetipo en su home
-- (`a.leader-image > img[alt="SET-NÚM"]`). El job semanal guarda en la lista el `set-número` CRUDO y el
-- resultado de casarlo contra NUESTRO catálogo (mismo motor que las 60). ⛔ Nunca se guarda la URL de
-- imagen de Limitless (nunca arte externo).
--
-- ADITIVA PURA Y SEGURA CON LA APP CORRIENDO: 4 columnas NULLABLE en una tabla existente + 1 FK
-- saliente a `Card`. Sin DEFAULT (nada que reescribir), SIN backfill (las listas previas quedan con
-- portada null ⇒ la teja cae a la regla por nombre; se rellenan solas en la siguiente corrida viva),
-- SIN índice (se lee lista→carta, nunca al revés), SIN enum nuevo (reusa "MetaMatchStatus"). No toca
-- precios, órdenes ni inventario: ningún importe puede moverse por esta migración.
--
-- ON DELETE SET NULL: si la carta sale del catálogo, la lista conserva su crudo y su estado, y la
-- portada deja de apuntar (la teja cae a la regla por nombre). Nunca bloquea el borrado de una `Card`.
--
-- ROLLBACK (limpio; sólo pierde la procedencia de portada, que el job re-escribe en su siguiente corrida):
--   ALTER TABLE "MetaDeckList" DROP CONSTRAINT "MetaDeckList_coverCardId_fkey";
--   ALTER TABLE "MetaDeckList" DROP COLUMN "coverCardId", DROP COLUMN "coverMatchStatus",
--     DROP COLUMN "coverNumber", DROP COLUMN "coverSetCode";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260928120000_m60_meta_deck_list_cover';
-- (y desplegar el backend anterior: el código previo no lee estas columnas.)

-- AlterTable
ALTER TABLE "MetaDeckList" ADD COLUMN "coverSetCode" TEXT,
ADD COLUMN "coverNumber" TEXT,
ADD COLUMN "coverMatchStatus" "MetaMatchStatus",
ADD COLUMN "coverCardId" TEXT;

-- AddForeignKey
ALTER TABLE "MetaDeckList" ADD CONSTRAINT "MetaDeckList_coverCardId_fkey" FOREIGN KEY ("coverCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
