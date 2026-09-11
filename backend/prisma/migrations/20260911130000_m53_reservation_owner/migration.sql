-- M-53 — migración `v1.68-stream-b` (ARCHITECTURE §11 «v1.68-stream-b», §4.48.2; API_CONTRACT §4-R.6).
-- DDL ADITIVO, nullable, SIN default y SIN backfill. Reversible sin ceremonia: el artefacto anterior
-- IGNORA las dos columnas; los índices se pueden dejar.
--
-- La reserva conoce a su ORDEN (dueño) y a su VENCIMIENTO. Una pieza `reserved` con
-- `reservedByOrderId IS NULL` es una reserva LEGADA (en vuelo al desplegar): se libera por los caminos
-- de siempre (rama `IS NULL` de las guardas, §4-R.2 regla 2) y no es recuperable por nadie.
-- ⛔ SIN backfill: no hay de dónde sacar un `reservedUntil` sin inventarlo (§4.48.2).
ALTER TABLE "InventoryItem" ADD COLUMN "reservedByOrderId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "reservedUntil" TIMESTAMP(3);

-- `SET NULL` y no `RESTRICT`: las órdenes no se borran (`Order.userId` ya es `Restrict` hacia `User`);
-- es defensivo y no puede dejar una pieza «reservada por nadie» que la aplicación no sepa liberar.
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_reservedByOrderId_fkey"
  FOREIGN KEY ("reservedByOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pre-scan de reserva propia + guarda de liberación (igualdad por orden).
CREATE INDEX "InventoryItem_reservedByOrderId_idx" ON "InventoryItem"("reservedByOrderId");
-- Barrido `order-reservation-sweep`: `status='reserved' AND reservedUntil < now()`.
CREATE INDEX "InventoryItem_status_reservedUntil_idx" ON "InventoryItem"("status", "reservedUntil");
