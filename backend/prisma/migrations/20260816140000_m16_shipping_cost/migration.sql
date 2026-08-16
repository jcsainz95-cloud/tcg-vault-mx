-- M-16 (v1.4-finance): Costo real de paquetería en el P&L.
-- ShipmentRequest gana `shippingCostCents` = costo real MXN (centavos) que la plataforma
-- paga al carrier por ese envío. Aditivo; NO toca `shippingFeeCents` (ingreso cobrado al
-- cliente). El `@default(0)` cubre filas históricas/sin captura para no romper el P&L (§M7).
-- Se captura en M4 al asignar carrier/guía (POST /admin/shipments/:id/tracking), opcional
-- y editable, validación de app entero >= 0. Greenfield: sin backfill.

ALTER TABLE "ShipmentRequest" ADD COLUMN "shippingCostCents" INTEGER NOT NULL DEFAULT 0;
