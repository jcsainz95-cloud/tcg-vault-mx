-- §REPORTES-CEO F2b: índice para MIN(settledAt) (firstDataDay) y los barridos de pnlBuckets por rango. Aditivo, sin datos.
-- Reversa: DROP INDEX "Order_settledAt_idx";
CREATE INDEX "Order_settledAt_idx" ON "Order"("settledAt");
