-- M-22 (v1.18-master-set-everywhere, WS «Inventario y vault»): ajuste de inventario por
-- LEVANTAMIENTO FÍSICO desde el binder M1 (POST /admin/inventory/adjustments). Aditiva, SIN
-- backfill. NO cambia el modelo por-pieza ni añade valores a InventoryStatus (`error_captura`
-- reusa `withdrawn`; la distinción vive en InventoryAdjustment.reason).
-- API_CONTRACT changelog v1.18 / ARCHITECTURE §4.18e, §11 (M-22). Sin diales nuevos.

-- CreateEnum: motivo OBLIGATORIO del ajuste (tipado y consultable para reportes de merma M7/M9).
CREATE TYPE "AdjustmentReason" AS ENUM ('encontrada', 'perdida', 'danada', 'error_captura');

-- AlterEnum (aditivo): el historial de la pieza distingue un ajuste de operador (`adjustment`)
-- de un `mark` normal (`lost`/`damaged`) o un retiro (`withdrawal`). Nada existente cambia.
ALTER TYPE "MovementReason" ADD VALUE 'adjustment';

-- CreateTable: registro tipado del levantamiento. UNA fila por pieza afectada (para `encontrada`
-- con qty>1, una fila por pieza creada). Complementa —no reemplaza— InventoryMovement y AuditLog.
-- Sin FK dura a User (actorUserId, patrón AuditLog).
CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "fromStatus" "InventoryStatus",
    "toStatus" "InventoryStatus" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryAdjustment_inventoryItemId_idx" ON "InventoryAdjustment"("inventoryItemId");
CREATE INDEX "InventoryAdjustment_reason_idx" ON "InventoryAdjustment"("reason");
CREATE INDEX "InventoryAdjustment_createdAt_idx" ON "InventoryAdjustment"("createdAt");

-- AddForeignKey (onDelete: Cascade — mismo patrón que InventoryMovement.item)
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
