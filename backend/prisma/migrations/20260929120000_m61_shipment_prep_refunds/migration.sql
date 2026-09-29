-- M-61 — migración `v1.80…v1.80.5` (§M4-SHIP: «Pedidos por preparar» en la cubeta ENVÍO, el libro de
-- reembolsos `PaymentRefund`, el apartado «Por reponer» `ReplacementCase`, la cubeta SPEI `ManualRefund`,
-- el reembolso total de una compra a bóveda · API_CONTRACT §M4-SHIP.2 (bloques v1.80, v1.80.1, v1.80.2,
-- v1.80.3, v1.80.4) · ARCHITECTURE §4.57).
--
-- UNA sola migración (v1.80.4/.5: «una sola, según el bloque de M-61»). DDL aditivo:
--   · 7 enums nuevos (MissingReason, PaymentRefundKind, PaymentRefundStatus, ReplacementCaseSource,
--     ReplacementCaseStatus, ManualRefundSource, ManualRefundStatus);
--   · 2 enums EXISTENTES ganan valores: MovementReason + replacement + refund_return;
--     VaultPlacementCancelReason + full_refund (ALTER TYPE … ADD VALUE; Postgres 16: dentro de la tx de
--     la migración es válido mientras el valor no se USE en esta misma tx — y no se usa);
--   · columnas nuevas en KycProfile (clabeUpdatedAt), Order (fullRefundClosedAt), ShipmentRequest
--     (preparedAt, preparedByUserId), ShipmentItem (prepStatus, prepMarkedAt, prepMarkedByUserId,
--     missingReason), VaultPlacementItem (missingReason);
--   · 3 tablas nuevas (PaymentRefund, ReplacementCase, ManualRefund), sus índices y FKs;
--   · CHECKs y ÍNDICES ÚNICOS PARCIALES (SQL crudo, precedente M-25/M-59): «un estado a medias es
--     INEXPRESABLE en la BD, no solo prohibido en el código».
--   · ⛔ Sin `adminNotifiedAt` (D-13, v1.80.4). ⛔ Sin `RefundBasis` (v1.80.2).
--
-- BACKFILL (el ÚNICO `UPDATE`, ANTES de su CHECK, §M4-SHIP.2 v1.80.1): `VaultPlacementItem.missingReason =
-- 'not_found' WHERE prepStatus='missing'` — antes de v1.80.1 `missing` solo podía significar «no la encontré».
-- Cuántas filas toca en producción: ⛔ NO MEDIDO por el arquitecto (esperado 0 o datos de prueba); backend
-- lo cuenta al migrar y lo reporta en BACKEND_NOTES. ⛔ Ningún otro backfill: los envíos existentes nacen
-- `preparedAt NULL` y sus cartas `pending`; `KycProfile.clabeUpdatedAt` nace NULL («fecha desconocida»).
--
-- ⛔ CERO DINERO movido: las tablas nuevas nacen vacías; ningún importe existente cambia.
--
-- REVERSA (en este orden; el artefacto anterior ignora estas tablas/columnas):
--   DROP TABLE "ManualRefund"; DROP TABLE "PaymentRefund"; DROP TABLE "ReplacementCase";
--   ALTER TABLE "VaultPlacementItem" DROP COLUMN "missingReason";
--   ALTER TABLE "ShipmentItem" DROP COLUMN "prepStatus", DROP COLUMN "prepMarkedAt",
--     DROP COLUMN "prepMarkedByUserId", DROP COLUMN "missingReason";
--   ALTER TABLE "ShipmentRequest" DROP COLUMN "preparedAt", DROP COLUMN "preparedByUserId";
--   ALTER TABLE "Order" DROP COLUMN "fullRefundClosedAt";
--   ALTER TABLE "KycProfile" DROP COLUMN "clabeUpdatedAt";
--   DROP TYPE "ManualRefundStatus"; DROP TYPE "ManualRefundSource"; DROP TYPE "ReplacementCaseStatus";
--   DROP TYPE "ReplacementCaseSource"; DROP TYPE "PaymentRefundStatus"; DROP TYPE "PaymentRefundKind";
--   DROP TYPE "MissingReason";
--   (los valores añadidos a MovementReason/VaultPlacementCancelReason NO se pueden quitar de un enum de
--    Postgres: se quedan; el artefacto anterior no los escribe y las filas que los usen se pierden con las
--    tablas de arriba o quedan como movimientos históricos legibles).
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260929120000_m61_shipment_prep_refunds';
-- ⚠️ La reversa PIERDE el libro de reembolsos (qué se reembolsó, a quién, con qué llave de Stripe) y los
-- casos «Por reponer». Detalle en docs/BACKEND_NOTES.md §M-61.

-- CreateEnum
CREATE TYPE "MissingReason" AS ENUM ('not_found', 'damaged');

-- CreateEnum
CREATE TYPE "PaymentRefundKind" AS ENUM ('item_missing', 'order_remaining', 'shipment_fee', 'order_full', 'case_refund');

-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('requested', 'submitted', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ReplacementCaseSource" AS ENUM ('withdrawal', 'vault_purchase');

-- CreateEnum
CREATE TYPE "ReplacementCaseStatus" AS ENUM ('open', 'replaced', 'found', 'refunded', 'voided');

-- CreateEnum
CREATE TYPE "ManualRefundSource" AS ENUM ('case_excess', 'stripe_failed');

-- CreateEnum
CREATE TYPE "ManualRefundStatus" AS ENUM ('pending', 'paid', 'cancelled');

-- AlterEnum (enums EXISTENTES que ganan valores; `IF NOT EXISTS` por idempotencia del deploy)
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'replacement';
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'refund_return';
ALTER TYPE "VaultPlacementCancelReason" ADD VALUE IF NOT EXISTS 'full_refund';

-- AlterTable
ALTER TABLE "KycProfile" ADD COLUMN     "clabeUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fullRefundClosedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "missingReason" "MissingReason",
ADD COLUMN     "prepMarkedAt" TIMESTAMP(3),
ADD COLUMN     "prepMarkedByUserId" TEXT,
ADD COLUMN     "prepStatus" "PreparationItemStatus" NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE "ShipmentRequest" ADD COLUMN     "preparedAt" TIMESTAMP(3),
ADD COLUMN     "preparedByUserId" TEXT;

-- AlterTable
ALTER TABLE "VaultPlacementItem" ADD COLUMN     "missingReason" "MissingReason";

-- BACKFILL (v1.80.1) — ANTES del CHECK de VaultPlacementItem.
UPDATE "VaultPlacementItem" SET "missingReason" = 'not_found' WHERE "prepStatus" = 'missing' AND "missingReason" IS NULL;

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" "PaymentRefundKind" NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'requested',
    "orderId" TEXT,
    "shipmentRequestId" TEXT,
    "orderItemId" TEXT,
    "shipmentItemId" TEXT,
    "missingReason" "MissingReason",
    "amountCents" INTEGER NOT NULL,
    "merchandiseCents" INTEGER NOT NULL,
    "merchandiseIvaCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "shippingIvaCents" INTEGER NOT NULL,
    "processingFeeCents" INTEGER NOT NULL,
    "compensationCents" INTEGER NOT NULL DEFAULT 0,
    "replacementCaseId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" "Role" NOT NULL,
    "reason" TEXT,
    "stripeRefundId" TEXT,
    "failureCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "attemptStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "customerNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementCase" (
    "id" TEXT NOT NULL,
    "source" "ReplacementCaseSource" NOT NULL,
    "status" "ReplacementCaseStatus" NOT NULL DEFAULT 'open',
    "shipmentItemId" TEXT,
    "shipmentRequestId" TEXT,
    "placementItemId" TEXT,
    "customerUserId" TEXT NOT NULL,
    "originalInventoryItemId" TEXT NOT NULL,
    "missingReason" "MissingReason" NOT NULL,
    "originOrderItemId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "customerNotifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "replacementInventoryItemId" TEXT,
    "replacementShipmentItemId" TEXT,
    "voidNote" TEXT,
    "refundAmountCents" INTEGER,
    "refundReason" TEXT,
    "refundPaidRefCents" INTEGER,
    "refundMarketRefCents" INTEGER,
    "refundMarketRefDate" TIMESTAMP(3),
    "refundAboveRefConfirmed" BOOLEAN,

    CONSTRAINT "ReplacementCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualRefund" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" "ManualRefundSource" NOT NULL,
    "status" "ManualRefundStatus" NOT NULL DEFAULT 'pending',
    "customerUserId" TEXT NOT NULL,
    "replacementCaseId" TEXT NOT NULL,
    "paymentRefundId" TEXT,
    "orderId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "merchandiseCents" INTEGER NOT NULL,
    "merchandiseIvaCents" INTEGER NOT NULL,
    "processingFeeCents" INTEGER NOT NULL,
    "compensationCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "speiReference" TEXT,
    "paidNote" TEXT,
    "paidClabeHmac" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelNote" TEXT,
    "reissuedFromId" TEXT,
    "announcedNotifiedAt" TIMESTAMP(3),
    "paidNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "ManualRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentRefund_orderItemId_key" ON "PaymentRefund"("orderItemId");
CREATE UNIQUE INDEX "PaymentRefund_shipmentItemId_key" ON "PaymentRefund"("shipmentItemId");
CREATE UNIQUE INDEX "PaymentRefund_replacementCaseId_key" ON "PaymentRefund"("replacementCaseId");
CREATE UNIQUE INDEX "PaymentRefund_stripeRefundId_key" ON "PaymentRefund"("stripeRefundId");
CREATE INDEX "PaymentRefund_orderId_idx" ON "PaymentRefund"("orderId");
CREATE INDEX "PaymentRefund_requestedByUserId_createdAt_idx" ON "PaymentRefund"("requestedByUserId", "createdAt");
CREATE INDEX "PaymentRefund_status_createdAt_idx" ON "PaymentRefund"("status", "createdAt");

CREATE UNIQUE INDEX "ReplacementCase_shipmentItemId_key" ON "ReplacementCase"("shipmentItemId");
CREATE UNIQUE INDEX "ReplacementCase_placementItemId_key" ON "ReplacementCase"("placementItemId");
CREATE UNIQUE INDEX "ReplacementCase_replacementShipmentItemId_key" ON "ReplacementCase"("replacementShipmentItemId");
CREATE INDEX "ReplacementCase_status_openedAt_idx" ON "ReplacementCase"("status", "openedAt");
CREATE INDEX "ReplacementCase_shipmentRequestId_status_idx" ON "ReplacementCase"("shipmentRequestId", "status");
CREATE INDEX "ReplacementCase_customerUserId_status_idx" ON "ReplacementCase"("customerUserId", "status");

CREATE UNIQUE INDEX "ManualRefund_idempotencyKey_key" ON "ManualRefund"("idempotencyKey");
CREATE UNIQUE INDEX "ManualRefund_reissuedFromId_key" ON "ManualRefund"("reissuedFromId");
CREATE INDEX "ManualRefund_status_createdAt_idx" ON "ManualRefund"("status", "createdAt");
CREATE INDEX "ManualRefund_customerUserId_idx" ON "ManualRefund"("customerUserId");
CREATE INDEX "ManualRefund_orderId_idx" ON "ManualRefund"("orderId");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shipmentRequestId_fkey" FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_replacementCaseId_fkey" FOREIGN KEY ("replacementCaseId") REFERENCES "ReplacementCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_shipmentRequestId_fkey" FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_placementItemId_fkey" FOREIGN KEY ("placementItemId") REFERENCES "VaultPlacementItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_originalInventoryItemId_fkey" FOREIGN KEY ("originalInventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_originOrderItemId_fkey" FOREIGN KEY ("originOrderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_replacementInventoryItemId_fkey" FOREIGN KEY ("replacementInventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_replacementShipmentItemId_fkey" FOREIGN KEY ("replacementShipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_replacementCaseId_fkey" FOREIGN KEY ("replacementCaseId") REFERENCES "ReplacementCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_paymentRefundId_fkey" FOREIGN KEY ("paymentRefundId") REFERENCES "PaymentRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_reissuedFromId_fkey" FOREIGN KEY ("reissuedFromId") REFERENCES "ManualRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================== CHECKs (§M4-SHIP.2) =====================================

-- ShipmentRequest: el sello de preparado va entero o no va.
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "ShipmentRequest_prepared_seal_chk"
  CHECK (("preparedAt" IS NULL) = ("preparedByUserId" IS NULL));

-- ShipmentItem: la marca por carta va entera; el motivo ⇔ `missing`.
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_prep_mark_chk"
  CHECK (
    ("prepStatus" = 'pending' AND "prepMarkedAt" IS NULL AND "prepMarkedByUserId" IS NULL)
    OR ("prepStatus" <> 'pending' AND "prepMarkedAt" IS NOT NULL AND "prepMarkedByUserId" IS NOT NULL));
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_missing_reason_chk"
  CHECK (("missingReason" IS NOT NULL) = ("prepStatus" = 'missing'));

-- VaultPlacementItem (v1.80.1): el motivo ⇔ `missing` (tras el backfill de arriba).
ALTER TABLE "VaultPlacementItem" ADD CONSTRAINT "VaultPlacementItem_missing_reason_chk"
  CHECK (("missingReason" IS NOT NULL) = ("prepStatus" = 'missing'));

-- PaymentRefund: un cobro y solo uno; la forma de cada `kind`; identidad del importe; estados con su sello.
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_one_charge_chk"
  CHECK (("orderId" IS NULL) <> ("shipmentRequestId" IS NULL));
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shipment_fee_chk"
  CHECK (("kind" = 'shipment_fee') = ("shipmentRequestId" IS NOT NULL));
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_missing_chk"
  CHECK (("kind" = 'item_missing') = ("orderItemId" IS NOT NULL AND "shipmentItemId" IS NOT NULL AND "missingReason" IS NOT NULL));
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_case_refund_chk"
  CHECK (("kind" = 'case_refund') = ("replacementCaseId" IS NOT NULL AND "orderItemId" IS NOT NULL));
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_case_refund_shape_chk"
  CHECK ("kind" <> 'case_refund' OR ("shipmentItemId" IS NULL AND "orderId" IS NOT NULL));
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_compensation_only_case_chk"
  CHECK ("compensationCents" = 0 OR "kind" = 'case_refund');
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_amount_positive_chk"
  CHECK ("amountCents" > 0 AND "merchandiseCents" >= 0 AND "merchandiseIvaCents" >= 0 AND "shippingCents" >= 0
    AND "shippingIvaCents" >= 0 AND "processingFeeCents" >= 0 AND "compensationCents" >= 0 AND "attemptCount" >= 0);
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_amount_identity_chk"
  CHECK ("amountCents" = "merchandiseCents" + "shippingCents" + "processingFeeCents" + "compensationCents");
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_submitted_has_stripe_id_chk"
  CHECK ("status" NOT IN ('submitted', 'succeeded') OR "stripeRefundId" IS NOT NULL);
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_failed_has_failed_at_chk"
  CHECK ("status" <> 'failed' OR "failedAt" IS NOT NULL);

-- ReplacementCase: a lo más UN caso ABIERTO por pieza (índice único PARCIAL); el nodo que lo abrió; resolución.
CREATE UNIQUE INDEX "ReplacementCase_open_original_key" ON "ReplacementCase"("originalInventoryItemId") WHERE "status" = 'open';
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_one_node_chk"
  CHECK (("shipmentItemId" IS NULL) <> ("placementItemId" IS NULL));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_withdrawal_shape_chk"
  CHECK (("source" = 'withdrawal') = ("shipmentItemId" IS NOT NULL) AND ("shipmentItemId" IS NOT NULL) = ("shipmentRequestId" IS NOT NULL));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_open_unresolved_chk"
  CHECK (("status" = 'open') = ("resolvedAt" IS NULL AND "resolvedByUserId" IS NULL));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_replacement_piece_chk"
  CHECK (("status" IN ('replaced', 'found')) = ("replacementInventoryItemId" IS NOT NULL));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_found_same_piece_chk"
  CHECK ("status" <> 'found' OR ("replacementInventoryItemId" = "originalInventoryItemId" AND "missingReason" = 'not_found'));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_replaced_other_piece_chk"
  CHECK ("status" <> 'replaced' OR "replacementInventoryItemId" <> "originalInventoryItemId");
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_replacement_line_chk"
  CHECK ("replacementShipmentItemId" IS NULL OR "status" = 'replaced');
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_voided_note_chk"
  CHECK (("status" = 'voided') = ("voidNote" IS NOT NULL));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_refunded_capture_chk"
  CHECK (("status" = 'refunded') = ("refundAmountCents" IS NOT NULL AND "refundReason" IS NOT NULL
    AND "refundPaidRefCents" IS NOT NULL AND "refundAboveRefConfirmed" IS NOT NULL));
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_refund_amount_chk"
  CHECK ("refundAmountCents" IS NULL OR "refundAmountCents" >= 1);
ALTER TABLE "ReplacementCase" ADD CONSTRAINT "ReplacementCase_market_ref_pair_chk"
  CHECK (("refundMarketRefCents" IS NULL) = ("refundMarketRefDate" IS NULL));

-- ManualRefund: identidad del importe; forma por `source`; estados con su sello; una viva por caso y canal.
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_amount_positive_chk"
  CHECK ("amountCents" > 0 AND "merchandiseCents" >= 0 AND "merchandiseIvaCents" >= 0
    AND "processingFeeCents" >= 0 AND "compensationCents" >= 0);
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_amount_identity_chk"
  CHECK ("amountCents" = "merchandiseCents" + "processingFeeCents" + "compensationCents");
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_stripe_failed_chk"
  CHECK (("source" = 'stripe_failed') = ("paymentRefundId" IS NOT NULL));
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_paid_seal_chk"
  CHECK (("status" = 'paid') = ("paidAt" IS NOT NULL AND "paidByUserId" IS NOT NULL));
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_cancelled_seal_chk"
  CHECK (("status" = 'cancelled') = ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL AND "cancelNote" IS NOT NULL));
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_reissue_key_chk"
  CHECK ("reissuedFromId" IS NULL OR "idempotencyKey" = 'reissue:' || "reissuedFromId");
CREATE UNIQUE INDEX "ManualRefund_live_per_case_source_key" ON "ManualRefund"("replacementCaseId", "source") WHERE "status" <> 'cancelled';
CREATE UNIQUE INDEX "ManualRefund_live_per_payment_refund_key" ON "ManualRefund"("paymentRefundId") WHERE "status" <> 'cancelled' AND "paymentRefundId" IS NOT NULL;
