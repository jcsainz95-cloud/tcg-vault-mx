-- M-41 (v2.0-pricing-curve, P-48, WS «Catálogo y precios»): PRECIO PURO POR VALOR DE MERCADO.
-- Instrumentación de los dos ejes de dinero (§N.8 / §4.36.7c) + razón del pendiente (§4.36.5c).
-- ARCHITECTURE §11 (M-41.1–M-41.6) / API_CONTRACT changelog v2.0-pricing-curve.
--
-- ADITIVA PURA Y REVERSIBLE: tres enums nuevos + ocho columnas NULLABLE + un índice. SIN `DROP`, SIN
-- backfill, SIN migración de dinero, segura con la app corriendo. `backend/prisma/` es ZONA COMPARTIDA
-- → el orquestador SERIALIZA M-41.
--
-- POR QUÉ NO HAY MIGRACIÓN DE DINERO (§4.36.9c): el precio de venta NO está persistido — se resuelve EN
-- LECTURA. Lo único persistido es (i) `InventoryItem.listPriceCents` (override por pieza, DELIBERADO, se
-- conserva) y (ii) `OrderItem.unitPriceCents` de órdenes pasadas (historia inmutable, no se toca). El
-- «catálogo repriciado por completo» se satisface RE-RESOLVIENDO, no con un UPDATE.
--
-- POR QUÉ NO HAY `DELETE` DE CONFIG (§4.36.9b): los cinco settings retirados (`sales_price_rules`,
-- `sales_price_fallback_pct`, `buylist_price_rules`, `buylist_price_fallback_pct`, `pricing_tier_map`)
-- quedan HUÉRFANOS E INERTES en `ConfigSetting` — nadie los lee. Borrar configuración en el MISMO paso
-- que cambia la matemática elimina la vía de diagnóstico y el rollback barato. Limpieza = follow-up.
-- Mismo precedente que `rarity_map` (v1.32). El seed de `pricing_curve` lo hace `prisma/seed.ts`
-- (upsert idempotente: NO pisa un valor ya editado por el dueño).

-- PASO 1 (M-41.1) — enum PriceBasis: los CINCO valores LOCKED de PROJECT §N.7.
CREATE TYPE "PriceBasis" AS ENUM ('market', 'floor', 'override', 'bounty', 'pending');

-- PASO 2 (M-41.2) — enum MarketBracket: ESCALA FIJA, independiente de la curva. Cambiarla parte la serie.
CREATE TYPE "MarketBracket" AS ENUM ('lt_3', 'r3_10', 'r10_25', 'r25_80', 'r80_300', 'gte_300');

-- PASO 3 (M-41.3) — enum PendingPriceReason: hace TRIABLE la cola de precio pendiente.
CREATE TYPE "PendingPriceReason" AS ENUM ('no_market', 'premium_at_floor');

-- PASO 4 (M-41.4) — instrumentación de VENTA sobre la fila de dinero que YA es el snapshot inmutable.
ALTER TABLE "OrderItem" ADD COLUMN "marketMxnCents" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "priceBasis" "PriceBasis";
ALTER TABLE "OrderItem" ADD COLUMN "marketBracket" "MarketBracket";
ALTER TABLE "OrderItem" ADD COLUMN "finish" "Finish";

-- PASO 5 (M-41.5) — instrumentación de COMPRA (`finish` y `quotedPriceCents` ya existen).
ALTER TABLE "SellRequestItem" ADD COLUMN "marketMxnCents" INTEGER;
ALTER TABLE "SellRequestItem" ADD COLUMN "priceBasis" "PriceBasis";
ALTER TABLE "SellRequestItem" ADD COLUMN "marketBracket" "MarketBracket";

-- PASO 6 (M-41.6) — razón del pendiente + índice que sirve el filtro `?reason=` de M2.
-- `null` = filas históricas. NO entra a la clave de dedupe de la cola.
ALTER TABLE "PendingPriceEntry" ADD COLUMN "reason" "PendingPriceReason";
CREATE INDEX "PendingPriceEntry_reason_idx" ON "PendingPriceEntry"("reason");
