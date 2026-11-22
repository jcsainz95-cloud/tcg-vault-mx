-- §BUYLIST-FLUJO F2c (migracion parte B): baja de precio por linea (con aceptacion del vendedor) y recoger. Aditiva, sin backfill.
-- Reversa: DROP INDEX "SellRequestItem_revisionState_idx"; ALTER TABLE "SellRequestItem" DROP COLUMN "revisionState", DROP COLUMN "revisedPriceCents",
--   DROP COLUMN "revisionProposedAt", DROP COLUMN "revisionRespondedAt", DROP COLUMN "revisionReasonCode", DROP COLUMN "revisionNote",
--   DROP COLUMN "revisionReminderSentAt", DROP COLUMN "pickupMethod", DROP COLUMN "pickupChosenAt", DROP COLUMN "pickupDoneAt", DROP COLUMN "pickupDoneBy";
--   DROP TYPE "SellItemRevisionState"; DROP TYPE "SellItemPickupMethod";
CREATE TYPE "SellItemRevisionState" AS ENUM ('pending', 'accepted', 'declined', 'expired');
CREATE TYPE "SellItemPickupMethod" AS ENUM ('in_person', 'ship_back');
ALTER TABLE "SellRequestItem"
  ADD COLUMN "revisionState" "SellItemRevisionState",
  ADD COLUMN "revisedPriceCents" INTEGER,
  ADD COLUMN "revisionProposedAt" TIMESTAMP(3),
  ADD COLUMN "revisionRespondedAt" TIMESTAMP(3),
  ADD COLUMN "revisionReasonCode" "SellItemRejectionCode",
  ADD COLUMN "revisionNote" TEXT,
  ADD COLUMN "revisionReminderSentAt" TIMESTAMP(3),
  ADD COLUMN "pickupMethod" "SellItemPickupMethod",
  ADD COLUMN "pickupChosenAt" TIMESTAMP(3),
  ADD COLUMN "pickupDoneAt" TIMESTAMP(3),
  ADD COLUMN "pickupDoneBy" TEXT;
CREATE INDEX "SellRequestItem_revisionState_idx" ON "SellRequestItem"("revisionState");
