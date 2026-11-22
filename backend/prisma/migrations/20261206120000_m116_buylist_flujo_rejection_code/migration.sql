-- §BUYLIST-FLUJO F2b (migracion parte A): causa estructurada del rechazo de una linea. Aditiva, sin backfill.
-- Reversa: ALTER TABLE "SellRequestItem" DROP COLUMN "rejectionCode"; DROP TYPE "SellItemRejectionCode";
CREATE TYPE "SellItemRejectionCode" AS ENUM ('not_received', 'condition_mismatch', 'wrong_card', 'other', 'revision_declined', 'revision_expired');
ALTER TABLE "SellRequestItem" ADD COLUMN "rejectionCode" "SellItemRejectionCode";
