-- §BOVEDA-COBRADA-SIN-PIEZAS (DECISIONES). Migración ADITIVA y revertible: tres columnas NULL en "OrderItem", sin backfill
-- ni tocar datos. Revertir = DROP COLUMN de las tres (no hay lector fuera del código nuevo).
ALTER TABLE "OrderItem" ADD COLUMN "replacedInventoryItemId" TEXT,
ADD COLUMN "fulfillmentFailedAt" TIMESTAMP(3),
ADD COLUMN "fulfillmentFailedReason" TEXT;
