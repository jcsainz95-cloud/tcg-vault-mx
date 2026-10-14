-- M-79 (v1.95⟨pnl-finanzas⟩, punto A — API_CONTRACT §M10-IVA.8-bis (A) / ARCHITECTURE §4.44.f-quater)
--
-- `InventoryItem` gana `acquisitionCostIvaCents` — el **IVA ACREDITABLE del costo de adquisición,
-- CONGELADO al capturar**, para que el COGS del P&L sea una RESTA (`acquisitionCostCents −
-- acquisitionCostIvaCents`) en vez de restar un costo BRUTO contra un ingreso NETO. Es el **espejo
-- exacto** de `ShipmentRequest.shippingCostIvaCents` (M-50 punto 3-bis, §4.44.f-ter), un nivel más abajo.
--
-- ⛔ SIN BACKFILL (doctrina IVA-11(d): «nadie backfillea un crédito fiscal que nadie verificó»). Las
-- filas históricas nacen con `acquisitionCostIvaCents = 0` ⇒ `net = bruto` = EXACTAMENTE el
-- comportamiento de hoy (conservador: subestima la ganancia, no la infla). La venta ya reportada por el
-- dueño NO cambia sola: se corrige al re-capturar o con un retroajuste explícito, auditado y autorizado
-- por el dueño (decisión por defecto del diseño: NO tocar lo histórico).
--
-- ⛔ NO reescribe NI borra NINGUNA fila; NINGÚN costo se mueve (añadir una columna NOT NULL con DEFAULT 0
-- no toca datos de negocio). `@default(0)` es honesto: la ausencia de verdad significa cero.

-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ Se revierte DESPUÉS del código (el P&L vuelve a leer el COGS BRUTO). La columna no la lee nadie más.
-- REVERSA:BEGIN
-- ALTER TABLE "InventoryItem" DROP COLUMN "acquisitionCostIvaCents";
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101120000_m79_inventory_acquisition_cost_iva';
-- REVERSA:END

ALTER TABLE "InventoryItem" ADD COLUMN "acquisitionCostIvaCents" INTEGER NOT NULL DEFAULT 0;
