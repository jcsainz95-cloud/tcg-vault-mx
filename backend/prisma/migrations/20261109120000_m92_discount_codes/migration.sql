-- ===============================================================================================================================
-- M-92 · v1.110⟨descuentos⟩ (API_CONTRACT §DSC.1) — CÓDIGOS DE DESCUENTO. Propiedad: backend.
--
-- DDL ADITIVO, sin relleno: 4 enums nuevos, 4 tablas nuevas y 5 columnas `NOT NULL DEFAULT 0` (`Order.discountCents`,
-- `Order.shippingWaivedCents`, `OrderItem.unitDiscountCents`, `OrderAccessoryLine.unitDiscountCents`,
-- `ShipmentRequest.shippingWaivedCents`). El `0` es la verdad de toda fila previa: ningún pedido anterior llevó código.
-- Los CHECK de forma van a mano al final (Prisma no los modela; precedente M-61/M-73).
-- v1.112.1 (§DSC.1, QA): `productScopes`, `destinations` y `countedCodeHashes` van `NOT NULL DEFAULT '{}'` (editada en sitio:
-- M-92 no estaba publicada). `prisma migrate diff` no marca deriva por la nulabilidad de listas. Candado: DCO-B18 (23502).
--
-- Comprobación (quien despliega, después):
--   SELECT count(*) FROM "Order" WHERE "discountCents" <> 0 OR "shippingWaivedCents" <> 0;   -- 0 al desplegar
--   SELECT count(*) FROM "DiscountCode";                                                      -- 0 al desplegar
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- Solo ANTES de que exista un pedido o retiro con código (`SELECT count(*) FROM "DiscountRedemption"` = 0). Después, la
-- reversa es desplegar el artefacto anterior, que ignora tablas y columnas (§DSC.1).
-- REVERSA:BEGIN
-- DROP TABLE IF EXISTS "DiscountRedemption", "DiscountCodeThrottle", "DiscountCode", "DiscountCodeBatch";
-- ALTER TABLE IF EXISTS "Order" DROP CONSTRAINT IF EXISTS "order_discount_nonneg", DROP COLUMN IF EXISTS "discountCents", DROP COLUMN IF EXISTS "shippingWaivedCents";
-- ALTER TABLE IF EXISTS "OrderItem" DROP CONSTRAINT IF EXISTS "order_item_discount_shape", DROP COLUMN IF EXISTS "unitDiscountCents";
-- ALTER TABLE IF EXISTS "OrderAccessoryLine" DROP CONSTRAINT IF EXISTS "order_accessory_line_discount_shape", DROP COLUMN IF EXISTS "unitDiscountCents";
-- ALTER TABLE IF EXISTS "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_waived_nonneg", DROP COLUMN IF EXISTS "shippingWaivedCents";
-- DROP TYPE IF EXISTS "DiscountRedemptionStatus", "DiscountProductScope", "DiscountCodeStatus", "DiscountKind";
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261109120000_m92_discount_codes';
-- REVERSA:END
-- ===============================================================================================================================

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('percent', 'fixed_amount', 'free_shipping');

-- CreateEnum
CREATE TYPE "DiscountCodeStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "DiscountProductScope" AS ENUM ('raw', 'graded', 'sealed', 'accessory');

-- CreateEnum
CREATE TYPE "DiscountRedemptionStatus" AS ENUM ('reserved', 'consumed', 'released');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shippingWaivedCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "unitDiscountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ShipmentRequest" ADD COLUMN     "shippingWaivedCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderAccessoryLine" ADD COLUMN     "unitDiscountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DiscountCodeBatch" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCodeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "batchId" TEXT,
    "kind" "DiscountKind" NOT NULL,
    "percentPct" INTEGER,
    "amountCents" INTEGER,
    "maxDiscountCents" INTEGER,
    "minSubtotalCents" INTEGER,
    "productScopes" "DiscountProductScope"[] NOT NULL DEFAULT ARRAY[]::"DiscountProductScope"[],
    "destinations" "FulfillmentMode"[] NOT NULL DEFAULT ARRAY[]::"FulfillmentMode"[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "maxTotalUses" INTEGER,
    "maxUsesPerCustomer" INTEGER DEFAULT 1,
    "status" "DiscountCodeStatus" NOT NULL DEFAULT 'active',
    "firstReservedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRedemption" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "orderId" TEXT,
    "shipmentRequestId" TEXT,
    "status" "DiscountRedemptionStatus" NOT NULL DEFAULT 'reserved',
    "customerUserId" TEXT,
    "customerEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "lateConsumed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCodeThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "countedCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "DiscountCodeThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE INDEX "DiscountCode_batchId_idx" ON "DiscountCode"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRedemption_orderId_key" ON "DiscountRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRedemption_shipmentRequestId_key" ON "DiscountRedemption"("shipmentRequestId");

-- CreateIndex
CREATE INDEX "DiscountRedemption_codeId_status_idx" ON "DiscountRedemption"("codeId", "status");

-- CreateIndex
CREATE INDEX "DiscountRedemption_customerUserId_idx" ON "DiscountRedemption"("customerUserId");

-- CreateIndex
CREATE INDEX "DiscountRedemption_customerEmail_idx" ON "DiscountRedemption"("customerEmail");

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DiscountCodeBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "DiscountCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_shipmentRequestId_fkey" FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================================== CHECKs (§DSC.1) =====================================
-- Columnas nuevas de dinero: nunca negativas.
ALTER TABLE "Order" ADD CONSTRAINT "order_discount_nonneg"
  CHECK ("discountCents" >= 0 AND "shippingWaivedCents" >= 0);
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_waived_nonneg"
  CHECK ("shippingWaivedCents" >= 0);
-- I-4: una unidad con descuento conserva ≥ 1 centavo cobrado.
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_discount_shape"
  CHECK ("unitDiscountCents" >= 0 AND ("unitDiscountCents" = 0 OR "unitPriceCents" >= 1));
-- [D9]: el paquete de energías nunca lleva descuento (el `unitPriceCents >= 1` del renglón ya lo pone M-73).
ALTER TABLE "OrderAccessoryLine" ADD CONSTRAINT "order_accessory_line_discount_shape"
  CHECK ("unitDiscountCents" >= 0 AND ("kind" <> 'energy_bundle' OR "unitDiscountCents" = 0));

-- El código: texto normalizado, campos por tipo, vigencia y límites.
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_text" CHECK ("code" ~ '^[A-Z0-9-]{4,20}$');
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_percent"
  CHECK (("kind" = 'percent') = ("percentPct" IS NOT NULL) AND ("percentPct" IS NULL OR "percentPct" BETWEEN 1 AND 100));
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_amount"
  CHECK (("kind" = 'fixed_amount') = ("amountCents" IS NOT NULL) AND ("amountCents" IS NULL OR "amountCents" >= 1));
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_max_discount"
  CHECK ("maxDiscountCents" IS NULL OR ("kind" = 'percent' AND "maxDiscountCents" >= 1));
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_min_subtotal" CHECK ("minSubtotalCents" IS NULL OR "minSubtotalCents" >= 1);
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_window" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "DiscountCode" ADD CONSTRAINT "discount_code_limits"
  CHECK (("maxTotalUses" IS NULL OR "maxTotalUses" >= 1) AND ("maxUsesPerCustomer" IS NULL OR "maxUsesPerCustomer" >= 1));

-- El uso (I-5): exactamente un pedido o un retiro; al menos una identidad de cliente; sellos por estado.
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "discount_redemption_subject"
  CHECK (("orderId" IS NULL) <> ("shipmentRequestId" IS NULL));
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "discount_redemption_customer"
  CHECK ("customerUserId" IS NOT NULL OR "customerEmail" IS NOT NULL);
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "discount_redemption_consumed_at"
  CHECK (("status" = 'consumed') = ("consumedAt" IS NOT NULL));
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "discount_redemption_released_at"
  CHECK ("status" <> 'released' OR "releasedAt" IS NOT NULL);

ALTER TABLE "DiscountCodeThrottle" ADD CONSTRAINT "discount_code_throttle_failures" CHECK ("failures" >= 0);
