-- M-73 — v1.86⟨accesorios⟩ (accesorios, existencias, fotos, renglones, cajas con tarifa · API_CONTRACT §AC.1 ·
-- ARCHITECTURE §4.AC y §11 «v1.86⟨accesorios⟩»). Número y carpeta reservados por el orquestador el 2026-10-07: posterior
-- a M-72 (`20261025120000`); `M-74` de `claude/wishlist` usa `20261027120000` (posterior a ésta).
--
-- DDL ADITIVO: 5 enums nuevos + 6 tablas nuevas + 2 columnas en `Order` + 1 en `ShippingPackage` + 3 en `PaymentRefund`
-- + CHECKs + índices (uno único PARCIAL) + 1 CONSTRAINT TRIGGER + 8 filas semilla. ⛔ SIN relleno de filas existentes:
--   · `Order.shippingBoxReview` nace `false` por DEFAULT (ningún pedido histórico eligió caja); `shippingBoxSnapshot`
--     nace NULL = «tarifa fija de hoy».
--   · `ShippingPackage.customerFeeCents` nace NULL en las semillas: el catálogo de cajas con tarifa empieza VACÍO (F3).
--   · Las 3 columnas de `PaymentRefund` nacen NULL: toda fila existente cumple los CHECK nuevos.
-- Hay datos (norma v1.64 de ARCHITECTURE §11): ninguna columna NOT NULL nueva sin DEFAULT.
--
-- IDEMPOTENTE: aplicarla dos veces deja la BD idéntica (`IF NOT EXISTS`, constraints quitar-si-existe-y-poner,
-- `CREATE OR REPLACE FUNCTION`, semilla con `WHERE NOT EXISTS`).
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ PRIMERO se revierte el CÓDIGO, después esto (API_CONTRACT §AC.1 y §AC.18.4, ARCHITECTURE §11).
-- 0. Comprobación previa:
--      SELECT count(*) FROM "OrderAccessoryLine";
--    > 0 ⇒ ⛔ NO se revierte: borraría el detalle de lo cobrado. Se desactivan los accesorios
--    (UPDATE "Accessory" SET "active" = false) y se dejan las tablas.
-- 1. Con 0 renglones, el bloque de abajo ENTERO (entre los marcadores; quitar el «-- » inicial de cada línea). Lo
--    ejecuta tal cual AC-B51 (`test/integration/accessories-m73-refund-shapes.e2e-spec.ts`) en una tx deshecha.
--    ⚠️ (§AC.18.4) Los dos CHECK de M-61/M-70 se REPONEN con su texto literal ANTES de quitar las columnas de
--    `PaymentRefund`: un `DROP COLUMN` borra en silencio todo CHECK que la nombre, y la tabla quedaría SIN las formas de
--    la carta.
-- REVERSA:BEGIN
-- DROP TRIGGER IF EXISTS "order_accessory_line_direct_ship" ON "OrderAccessoryLine";
-- DROP FUNCTION IF EXISTS order_accessory_line_direct_ship_check();
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_shape";
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_missing_chk";
-- ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_missing_chk"
--   CHECK (("kind" = 'item_missing') = ("orderItemId" IS NOT NULL AND "shipmentItemId" IS NOT NULL AND "missingReason" IS NOT NULL));
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_delivered_shape_chk";
-- ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_delivered_shape_chk"
--   CHECK ("kind"::text <> 'item_delivered' OR ("orderItemId" IS NOT NULL AND "shipmentItemId" IS NOT NULL
--     AND "missingReason" IS NULL AND "reason" IS NOT NULL AND "orderId" IS NOT NULL));
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_qty_pair";
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_qty_min";
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_card_xor_accessory";
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_shipment_line";
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_orderAccessoryLineId_fkey";
-- ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_shipmentAccessoryLineId_fkey";
-- DROP INDEX IF EXISTS "PaymentRefund_shipmentAccessoryLineId_key";
-- DROP INDEX IF EXISTS "PaymentRefund_orderAccessoryLineId_idx";
-- ALTER TABLE "PaymentRefund" DROP COLUMN IF EXISTS "accessoryQty";
-- ALTER TABLE "PaymentRefund" DROP COLUMN IF EXISTS "shipmentAccessoryLineId";
-- ALTER TABLE "PaymentRefund" DROP COLUMN IF EXISTS "orderAccessoryLineId";
-- DROP TABLE IF EXISTS "ShipmentAccessoryLine", "OrderEnergyBundleComponent", "OrderAccessoryLine",
--   "AccessoryStockMovement", "AccessoryPhoto", "Accessory";
-- ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_shipping_box_review";
-- ALTER TABLE "Order" DROP COLUMN IF EXISTS "shippingBoxReview", DROP COLUMN IF EXISTS "shippingBoxSnapshot";
-- ALTER TABLE "ShippingPackage" DROP CONSTRAINT IF EXISTS "shipping_package_customer_fee";
-- -- ⚠️ la siguiente pierde las tarifas capturadas por caja
-- ALTER TABLE "ShippingPackage" DROP COLUMN IF EXISTS "customerFeeCents";
-- DROP TYPE IF EXISTS "AccessoryStockMovementKind", "AccessoryLineStatus", "AccessoryLineKind", "EnergyType",
--   "AccessoryCategory";
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261026120000_m73_accessories';
-- REVERSA:END
-- ===============================================================================================================================

-- (1) CreateEnum (tipos NUEVOS: usables en esta misma transacción, a diferencia de un `ADD VALUE`)
DO $$ BEGIN
  CREATE TYPE "AccessoryCategory" AS ENUM ('sleeves', 'toploaders', 'binders', 'deck_boxes', 'playmats', 'energy', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "EnergyType" AS ENUM ('grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "AccessoryLineKind" AS ENUM ('accessory', 'energy_bundle');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "AccessoryLineStatus" AS ENUM ('reserved', 'released', 'sold', 'restocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "AccessoryStockMovementKind" AS ENUM ('initial', 'receive', 'adjust', 'sale', 'restock', 'settle_recovery');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- (2) AlterTable — columnas aditivas en tablas existentes (anulables o con DEFAULT; ⛔ sin relleno)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shippingBoxReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "shippingBoxSnapshot" JSONB;

ALTER TABLE "PaymentRefund" ADD COLUMN IF NOT EXISTS "accessoryQty" INTEGER,
ADD COLUMN IF NOT EXISTS "orderAccessoryLineId" TEXT,
ADD COLUMN IF NOT EXISTS "shipmentAccessoryLineId" TEXT;

ALTER TABLE "ShippingPackage" ADD COLUMN IF NOT EXISTS "customerFeeCents" INTEGER;

-- (3) CreateTable
CREATE TABLE IF NOT EXISTS "Accessory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "AccessoryCategory" NOT NULL,
    "energyType" "EnergyType",
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "weightG" INTEGER,
    "priceCents" INTEGER,
    "unitCostCents" INTEGER,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "suggested" BOOLEAN NOT NULL DEFAULT false,
    "photoVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accessory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccessoryPhoto" (
    "accessoryId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fullWebp" BYTEA NOT NULL,
    "thumbWebp" BYTEA NOT NULL,
    "sourceMime" TEXT NOT NULL,
    "sourceBytes" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessoryPhoto_pkey" PRIMARY KEY ("accessoryId")
);

CREATE TABLE IF NOT EXISTS "AccessoryStockMovement" (
    "id" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "kind" "AccessoryStockMovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessoryStockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderAccessoryLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "AccessoryLineKind" NOT NULL,
    "accessoryId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "snapshot" JSONB NOT NULL,
    "metaDeckId" TEXT,
    "metaDeckListId" TEXT,
    "deckSlug" TEXT,
    "deckName" TEXT,
    "deckOrderItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AccessoryLineStatus" NOT NULL DEFAULT 'reserved',
    "reservedUntil" TIMESTAMP(3) NOT NULL,
    "soldAt" TIMESTAMP(3),
    "settledWithoutStock" BOOLEAN NOT NULL DEFAULT false,
    "restockedAt" TIMESTAMP(3),
    "refundedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAccessoryLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderEnergyBundleComponent" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "accessoryId" TEXT NOT NULL,
    "energyType" "EnergyType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostCents" INTEGER,

    CONSTRAINT "OrderEnergyBundleComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShipmentAccessoryLine" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "orderAccessoryLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "prepStatus" "PreparationItemStatus" NOT NULL DEFAULT 'pending',
    "missingQty" INTEGER NOT NULL DEFAULT 0,
    "missingReason" "MissingReason",
    "prepMarkedAt" TIMESTAMP(3),
    "prepMarkedByUserId" TEXT,

    CONSTRAINT "ShipmentAccessoryLine_pkey" PRIMARY KEY ("id")
);

-- (4) CreateIndex
CREATE INDEX IF NOT EXISTS "Accessory_active_category_idx" ON "Accessory"("active", "category");
CREATE INDEX IF NOT EXISTS "AccessoryStockMovement_accessoryId_createdAt_idx" ON "AccessoryStockMovement"("accessoryId", "createdAt");
CREATE INDEX IF NOT EXISTS "OrderAccessoryLine_orderId_idx" ON "OrderAccessoryLine"("orderId");
CREATE INDEX IF NOT EXISTS "OrderAccessoryLine_status_reservedUntil_idx" ON "OrderAccessoryLine"("status", "reservedUntil");
CREATE INDEX IF NOT EXISTS "OrderAccessoryLine_accessoryId_idx" ON "OrderAccessoryLine"("accessoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderEnergyBundleComponent_lineId_energyType_key" ON "OrderEnergyBundleComponent"("lineId", "energyType");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentAccessoryLine_orderAccessoryLineId_key" ON "ShipmentAccessoryLine"("orderAccessoryLineId");
CREATE INDEX IF NOT EXISTS "ShipmentAccessoryLine_shipmentRequestId_idx" ON "ShipmentAccessoryLine"("shipmentRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRefund_shipmentAccessoryLineId_key" ON "PaymentRefund"("shipmentAccessoryLineId");
CREATE INDEX IF NOT EXISTS "PaymentRefund_orderAccessoryLineId_idx" ON "PaymentRefund"("orderAccessoryLineId");

-- Criterio 732: no puede haber dos productos ACTIVOS del mismo tipo de energía. Índice único PARCIAL (Prisma no lo modela).
CREATE UNIQUE INDEX IF NOT EXISTS "accessory_energy_type_active_key" ON "Accessory"("energyType") WHERE "active" AND "energyType" IS NOT NULL;

-- (5) AddForeignKey (todas RESTRICT salvo la foto, que cae con su accesorio)
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_orderAccessoryLineId_fkey";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_orderAccessoryLineId_fkey" FOREIGN KEY ("orderAccessoryLineId") REFERENCES "OrderAccessoryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_shipmentAccessoryLineId_fkey";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shipmentAccessoryLineId_fkey" FOREIGN KEY ("shipmentAccessoryLineId") REFERENCES "ShipmentAccessoryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessoryPhoto" DROP CONSTRAINT IF EXISTS "AccessoryPhoto_accessoryId_fkey";
ALTER TABLE "AccessoryPhoto" ADD CONSTRAINT "AccessoryPhoto_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessoryStockMovement" DROP CONSTRAINT IF EXISTS "AccessoryStockMovement_accessoryId_fkey";
ALTER TABLE "AccessoryStockMovement" ADD CONSTRAINT "AccessoryStockMovement_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "OrderAccessoryLine_orderId_fkey";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "OrderAccessoryLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "OrderAccessoryLine_accessoryId_fkey";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "OrderAccessoryLine_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderEnergyBundleComponent" DROP CONSTRAINT IF EXISTS "OrderEnergyBundleComponent_lineId_fkey";
ALTER TABLE "OrderEnergyBundleComponent" ADD CONSTRAINT "OrderEnergyBundleComponent_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "OrderAccessoryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderEnergyBundleComponent" DROP CONSTRAINT IF EXISTS "OrderEnergyBundleComponent_accessoryId_fkey";
ALTER TABLE "OrderEnergyBundleComponent" ADD CONSTRAINT "OrderEnergyBundleComponent_accessoryId_fkey" FOREIGN KEY ("accessoryId") REFERENCES "Accessory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentAccessoryLine" DROP CONSTRAINT IF EXISTS "ShipmentAccessoryLine_shipmentRequestId_fkey";
ALTER TABLE "ShipmentAccessoryLine" ADD CONSTRAINT "ShipmentAccessoryLine_shipmentRequestId_fkey" FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ShipmentAccessoryLine" DROP CONSTRAINT IF EXISTS "ShipmentAccessoryLine_orderAccessoryLineId_fkey";
ALTER TABLE "ShipmentAccessoryLine" ADD CONSTRAINT "ShipmentAccessoryLine_orderAccessoryLineId_fkey" FOREIGN KEY ("orderAccessoryLineId") REFERENCES "OrderAccessoryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- (6) CHECKs (SQL a mano; Prisma no los modela — precedente M-61/M-70/M-72). Comparan enums como `::text`.
-- ---- Accessory ----
--   I-AC-2: `0 ≤ reservedQty ≤ stockQty`. Es LA guarda de la carrera de la última unidad: un apartado de más revienta aquí
--   aunque el código olvide su CAS.
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_stock";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_stock"
  CHECK ("stockQty" >= 0 AND "reservedQty" >= 0 AND "reservedQty" <= "stockQty");
--   Energía ⇔ tipo de energía.
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_energy_type";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_energy_type"
  CHECK (("category"::text = 'energy') = ("energyType" IS NOT NULL));
--   Una energía nunca es «Sugerido» (P-EN-2, F3).
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_energy_not_suggested";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_energy_not_suggested"
  CHECK (NOT ("category"::text = 'energy' AND "suggested"));
--   Activo ⇒ precio + foto (+ medidas y peso, salvo la energía: criterio 729).
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_active_ready";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_active_ready"
  CHECK (NOT "active" OR ("priceCents" IS NOT NULL AND "photoVersion" IS NOT NULL AND ("category"::text = 'energy'
    OR ("lengthMm" IS NOT NULL AND "widthMm" IS NOT NULL AND "heightMm" IS NOT NULL AND "weightG" IS NOT NULL))));
--   Rangos.
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_price_range";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_price_range"
  CHECK ("priceCents" IS NULL OR "priceCents" BETWEEN 1 AND 100000000);
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_cost_range";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_cost_range"
  CHECK ("unitCostCents" IS NULL OR "unitCostCents" BETWEEN 0 AND 100000000);
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_dims_range";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_dims_range"
  CHECK (("lengthMm" IS NULL OR "lengthMm" BETWEEN 1 AND 2000) AND ("widthMm" IS NULL OR "widthMm" BETWEEN 1 AND 2000)
    AND ("heightMm" IS NULL OR "heightMm" BETWEEN 1 AND 2000));
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_weight_range";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_weight_range"
  CHECK ("weightG" IS NULL OR "weightG" BETWEEN 1 AND 50000);
--   Nombre 1..120 y no solo espacios (la aplicación guarda el trim); descripción ≤ 500.
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_name_length";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_name_length"
  CHECK (char_length("name") BETWEEN 1 AND 120 AND char_length(btrim("name")) >= 1);
ALTER TABLE "Accessory" DROP CONSTRAINT IF EXISTS "accessory_description_length";
ALTER TABLE "Accessory" ADD CONSTRAINT "accessory_description_length"
  CHECK ("description" IS NULL OR char_length("description") <= 500);

-- ---- AccessoryStockMovement ---- (solo cambios de `stockQty`)
ALTER TABLE "AccessoryStockMovement" DROP CONSTRAINT IF EXISTS "accessory_movement_identity";
ALTER TABLE "AccessoryStockMovement" ADD CONSTRAINT "accessory_movement_identity"
  CHECK ("stockAfter" = "stockBefore" + "delta" AND "stockBefore" >= 0 AND "stockAfter" >= 0);
--   Un movimiento sin cambio no es movimiento (un `adjust` sin cambio se rechaza con 400 en la aplicación).
ALTER TABLE "AccessoryStockMovement" DROP CONSTRAINT IF EXISTS "accessory_movement_delta";
ALTER TABLE "AccessoryStockMovement" ADD CONSTRAINT "accessory_movement_delta"
  CHECK ("delta" <> 0);
ALTER TABLE "AccessoryStockMovement" DROP CONSTRAINT IF EXISTS "accessory_movement_adjust_reason";
ALTER TABLE "AccessoryStockMovement" ADD CONSTRAINT "accessory_movement_adjust_reason"
  CHECK ("kind"::text <> 'adjust' OR ("reason" IS NOT NULL AND char_length("reason") BETWEEN 3 AND 200));

-- ---- OrderAccessoryLine ----
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_kind_accessory";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_kind_accessory"
  CHECK (("kind"::text = 'accessory') = ("accessoryId" IS NOT NULL));
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_quantity";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_quantity"
  CHECK ("quantity" BETWEEN 1 AND 99 AND ("kind"::text <> 'energy_bundle' OR "quantity" = 1));
--   Paquete ⇔ todos sus campos de deck no nulos y al menos un OrderItem del deck; accesorio ⇔ todos nulos y lista vacía.
--   (`deckOrderItemIds` NULL se lee como vacío: Prisma no lo escribe en un `create` que omite el campo.)
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_bundle_shape";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_bundle_shape"
  CHECK (
    ("kind"::text = 'energy_bundle' AND "metaDeckId" IS NOT NULL AND "metaDeckListId" IS NOT NULL AND "deckSlug" IS NOT NULL
      AND "deckName" IS NOT NULL AND COALESCE(cardinality("deckOrderItemIds"), 0) >= 1)
    OR ("kind"::text = 'accessory' AND "metaDeckId" IS NULL AND "metaDeckListId" IS NULL AND "deckSlug" IS NULL
      AND "deckName" IS NULL AND COALESCE(cardinality("deckOrderItemIds"), 0) = 0)
  );
--   💰 Precio congelado ≥ 1; costo congelado ≥ 0; el paquete NO lleva costo propio (está en sus componentes: contarlo
--   aquí también lo contaría dos veces en el P&L).
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_money";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_money"
  CHECK ("unitPriceCents" >= 1 AND ("unitCostCents" IS NULL OR "unitCostCents" >= 0)
    AND ("kind"::text <> 'energy_bundle' OR "unitCostCents" IS NULL));
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_sold_at";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_sold_at"
  CHECK (("soldAt" IS NOT NULL) = ("status"::text IN ('sold', 'restocked')));
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_restocked_at";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_restocked_at"
  CHECK (("restockedAt" IS NOT NULL) = ("status"::text = 'restocked'));
--   💰 Nunca se reembolsan más unidades de las que se vendieron (el CAS de la aplicación tiene red debajo).
ALTER TABLE "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_refunded_qty";
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_refunded_qty"
  CHECK ("refundedQty" >= 0 AND "refundedQty" <= "quantity");

-- ---- OrderEnergyBundleComponent ----
ALTER TABLE "OrderEnergyBundleComponent" DROP CONSTRAINT IF EXISTS "order_energy_bundle_component_quantity";
ALTER TABLE "OrderEnergyBundleComponent" ADD CONSTRAINT "order_energy_bundle_component_quantity"
  CHECK ("quantity" >= 1 AND ("unitCostCents" IS NULL OR "unitCostCents" >= 0));

-- ---- ShipmentAccessoryLine ----
ALTER TABLE "ShipmentAccessoryLine" DROP CONSTRAINT IF EXISTS "shipment_accessory_line_quantity";
ALTER TABLE "ShipmentAccessoryLine" ADD CONSTRAINT "shipment_accessory_line_quantity"
  CHECK ("quantity" >= 1);
--   `missing` ⇔ missingQty ≥ 1 ∧ motivo; fuera de `missing`, ni cantidad faltante ni motivo; missingQty ≤ quantity.
ALTER TABLE "ShipmentAccessoryLine" DROP CONSTRAINT IF EXISTS "shipment_accessory_line_missing";
ALTER TABLE "ShipmentAccessoryLine" ADD CONSTRAINT "shipment_accessory_line_missing"
  CHECK ("missingQty" >= 0 AND "missingQty" <= "quantity"
    AND (("prepStatus"::text = 'missing') = ("missingQty" >= 1 AND "missingReason" IS NOT NULL))
    AND ("prepStatus"::text = 'missing' OR ("missingQty" = 0 AND "missingReason" IS NULL)));

-- ---- Order ----
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_shipping_box_review";
ALTER TABLE "Order" ADD CONSTRAINT "order_shipping_box_review"
  CHECK (NOT "shippingBoxReview" OR "shippingBoxSnapshot" IS NOT NULL);

-- ---- ShippingPackage ----
ALTER TABLE "ShippingPackage" DROP CONSTRAINT IF EXISTS "shipping_package_customer_fee";
ALTER TABLE "ShippingPackage" ADD CONSTRAINT "shipping_package_customer_fee"
  CHECK ("customerFeeCents" IS NULL OR "customerFeeCents" BETWEEN 1 AND 10000000);

-- ---- PaymentRefund ---- (las filas existentes cumplen: las 3 columnas nacen NULL; medido en AC-B50 con una fila de cada kind)
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_qty_pair";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "payment_refund_accessory_qty_pair"
  CHECK (("accessoryQty" IS NULL) = ("orderAccessoryLineId" IS NULL));
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_qty_min";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "payment_refund_accessory_qty_min"
  CHECK ("accessoryQty" IS NULL OR "accessoryQty" >= 1);
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_card_xor_accessory";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "payment_refund_card_xor_accessory"
  CHECK (NOT ("orderItemId" IS NOT NULL AND "orderAccessoryLineId" IS NOT NULL));
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_shipment_line";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "payment_refund_accessory_shipment_line"
  CHECK ("shipmentAccessoryLineId" IS NULL OR "orderAccessoryLineId" IS NOT NULL);

-- v1.86.2 (API_CONTRACT §AC.18.2/.3): las formas de M-61/M-70 aceptan el renglón de accesorio. Filas existentes: todas
-- de carta, con las 3 columnas de accesorio en NULL ⇒ cumplen la rama de carta (que es la de antes más «accesorio nulo»).
-- Los NOMBRES de M-61/M-70 se conservan (`pnl-delivered-refunds.e2e-spec.ts` busca `…_item_delivered_shape_chk`).
--   · faltante de accesorio: renglón + línea de envío + motivo (lo leen `missing_at_prep` y AV-12).
--   · entregado de accesorio: renglón SIN línea de envío (`shipmentAccessoryLineId` es @unique y es de la ÚNICA fila de
--     faltante; con ella el segundo entregado del renglón chocaría con P2002), nota obligatoria, sin motivo de preparación.
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_missing_chk";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_missing_chk"
  CHECK (("kind"::text = 'item_missing') = (
    "missingReason" IS NOT NULL AND (
      ("orderItemId" IS NOT NULL AND "shipmentItemId" IS NOT NULL
        AND "orderAccessoryLineId" IS NULL AND "shipmentAccessoryLineId" IS NULL)
      OR
      ("orderAccessoryLineId" IS NOT NULL AND "shipmentAccessoryLineId" IS NOT NULL
        AND "orderItemId" IS NULL AND "shipmentItemId" IS NULL))));

ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_delivered_shape_chk";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_delivered_shape_chk"
  CHECK ("kind"::text <> 'item_delivered' OR (
    "missingReason" IS NULL AND "reason" IS NOT NULL AND "orderId" IS NOT NULL AND (
      ("orderItemId" IS NOT NULL AND "shipmentItemId" IS NOT NULL
        AND "orderAccessoryLineId" IS NULL)
      OR
      ("orderAccessoryLineId" IS NOT NULL AND "shipmentAccessoryLineId" IS NULL
        AND "orderItemId" IS NULL AND "shipmentItemId" IS NULL))));

-- Un renglón de accesorio solo aparece en las dos formas de arriba, y nunca junto a un nodo de carta.
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "payment_refund_accessory_shape";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "payment_refund_accessory_shape"
  CHECK ("orderAccessoryLineId" IS NULL OR (
    "kind"::text IN ('item_missing', 'item_delivered') AND "orderId" IS NOT NULL
    AND "orderItemId" IS NULL AND "shipmentItemId" IS NULL AND "replacementCaseId" IS NULL));

-- (7) I-AC-4 en BD: un renglón de accesorio SOLO en un pedido `direct_ship`. Es un CHECK entre tablas (Postgres no admite
-- subconsultas en CHECK) ⇒ CONSTRAINT TRIGGER, NO diferible: revienta al final de la sentencia, dentro de la tx de quien
-- inserta. Cubre también el UPDATE de `orderId` (mover un renglón a un pedido de bóveda), que §AC.1 no nombra y que de
-- otro modo saltaría la invariante. ⛔ No cubre cambiar `Order.fulfillmentMode` con renglones dentro (el modo es
-- inmutable en la aplicación desde M-25; ver BACKEND_NOTES §83).
CREATE OR REPLACE FUNCTION order_accessory_line_direct_ship_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Order" o WHERE o."id" = NEW."orderId" AND o."fulfillmentMode"::text = 'direct_ship'
  ) THEN
    RAISE EXCEPTION 'order_accessory_line_direct_ship: el pedido % no es direct_ship (I-AC-4)', NEW."orderId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS "order_accessory_line_direct_ship" ON "OrderAccessoryLine";
CREATE CONSTRAINT TRIGGER "order_accessory_line_direct_ship"
  AFTER INSERT OR UPDATE OF "orderId" ON "OrderAccessoryLine"
  FOR EACH ROW EXECUTE FUNCTION order_accessory_line_direct_ship_check();

-- (8) Semilla: las 8 «Energía <tipo>», INACTIVAS, MX$5 (`priceCents = 500`, F1), existencias 0, sin foto ni medidas.
-- Sin movimiento `initial` (con 0 no hay movimiento). `gen_random_uuid()` es nativo desde Postgres 13 (medido local: 16.15;
-- Railway: NO MEDIDO — si falla, el id va literal). Idempotente: una por tipo, solo si ese tipo no tiene ya un producto
-- de energía (sea cual sea su nombre: el dueño puede haberlo renombrado).
INSERT INTO "Accessory" ("id", "name", "category", "energyType", "priceCents", "stockQty", "reservedQty", "active",
                         "suggested", "updatedAt")
SELECT gen_random_uuid()::text, v.name, 'energy'::"AccessoryCategory", v.t::"EnergyType", 500, 0, 0, false, false, now()
  FROM (VALUES ('grass', 'Energía Planta'), ('fire', 'Energía Fuego'), ('water', 'Energía Agua'),
               ('lightning', 'Energía Rayo'), ('psychic', 'Energía Psíquica'), ('fighting', 'Energía Lucha'),
               ('darkness', 'Energía Oscura'), ('metal', 'Energía Metálica')) AS v(t, name)
 WHERE NOT EXISTS (SELECT 1 FROM "Accessory" a WHERE a."energyType"::text = v.t);
