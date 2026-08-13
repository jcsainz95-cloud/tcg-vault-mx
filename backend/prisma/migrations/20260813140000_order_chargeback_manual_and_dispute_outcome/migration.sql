-- Fix 4/5: gestión de contracargo consciente del estado físico + cierre de disputa.
-- Order gana dos columnas escalares (NO se cambia el enum OrderStatus, para no tocar el contrato):
--   chargebackNeedsManual: la carta ya estaba enviada/entregada al llegar el contracargo,
--     no se pudo revertir al inventario y requiere gestión manual (pelear con la guía).
--   disputeOutcome: resultado del cierre de la disputa ("won" | "lost"); informativo/auditoría.
ALTER TABLE "Order" ADD COLUMN "chargebackNeedsManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "disputeOutcome" TEXT;
