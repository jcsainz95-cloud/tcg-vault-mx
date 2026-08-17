-- M-22 (v1.18-buylist-rejects, WS «Catálogo y precios»): rechazo de ítem de buylist operable.
-- Aditiva, nullable, SIN backfill (los ítems rechazados pre-M-22 quedan con rejectedAt/rejectionReason
-- NULL y sus plazos derivados se proyectan null — legacy contemplado por el contrato §M5/§11).
-- API_CONTRACT changelog v1.18-buylist-rejects / ARCHITECTURE §4.18 y §11 (M-22).

-- SellRequestItem.rejectedAt: timestamp de la decisión `reject` (= notificación al vendedor).
-- ANCLA ÚNICA de los plazos derivados: returnDeadlineAt = rejectedAt + 7d (devolución a costo del
-- usuario) y abandonDeadlineAt = rejectedAt + 30d (abandono). Los plazos NO se persisten.
ALTER TABLE "SellRequestItem" ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- SellRequestItem.rejectionReason: motivo del rechazo (obligatorio en el request con
-- decision:"reject", 3–500 chars). Alimenta el correo al vendedor, la pestaña «Rechazadas»
-- (GET /admin/buylist/rejected-items) y el detalle del propio cliente.
ALTER TABLE "SellRequestItem" ADD COLUMN "rejectionReason" TEXT;

-- CreateIndex: sirve el listado transversal GET /admin/buylist/rejected-items
-- (filtro por itemStatus='rechazada') sin barrer la tabla.
CREATE INDEX "SellRequestItem_itemStatus_idx" ON "SellRequestItem"("itemStatus");
