-- M-70 — migración `v1.82` (arreglos del panel: reembolsar UNA carta tras la entrega de un envío directo y devolver
-- por SPEI UNA carta de un retiro de bóveda entregado · API_CONTRACT §PNL.2, §PNL.3, §PNL.7 · ARCHITECTURE §4.61.2,
-- §4.61.3). Número elegido para no chocar con M-64…M-68 de Skydropx.
--
-- DDL ADITIVO + `DROP NOT NULL`, SIN BACKFILL, IDEMPOTENTE (aplicarla dos veces deja la BD idéntica):
--   · 2 valores nuevos en enums EXISTENTES (`ADD VALUE IF NOT EXISTS`, como M-61/M-62):
--       PaymentRefundKind  + item_delivered        (una carta de un directo YA ENTREGADO, súper-admin, §PNL.2)
--       ManualRefundSource + withdrawal_delivered  (SPEI de una carta de un retiro YA ENTREGADO, §PNL.3)
--   · PaymentRefund + "deliveredReason" (ShippedRefundReason, nullable);
--   · ManualRefund  + "shipmentItemId" (FK ShipmentItem, RESTRICT), "deliveredReason", "deliveredNote";
--                     "replacementCaseId" DROP NOT NULL (la forma por `source` la fija un CHECK);
--   · 4 CHECK (SQL crudo, patrón M-61) y 1 índice único PARCIAL «una viva por línea de retiro».
--
-- ⚠️ Los CHECK comparan `"kind"::text` / `"source"::text` con un LITERAL de texto: Postgres no deja USAR en la misma
-- transacción un valor de enum recién añadido (`unsafe use of new value`), y el cast a texto no lo usa. MEDIDO al
-- migrar (BACKEND_NOTES §PNL-money): cabe en la misma migración, ⛔ no hizo falta M-70b.
--
-- SIN BACKFILL: toda fila existente es `kind ≠ item_delivered` y `source ∈ {case_excess, stripe_failed}` con
-- `replacementCaseId NOT NULL` (era NOT NULL) ⇒ los cuatro CHECK se cumplen tal cual. ⛔ CERO DINERO movido.
--
-- REVERSA (rollback de código; las columnas pueden QUEDARSE — nullable — y el artefacto anterior las ignora). Si hubiera
-- que quitarlas y NO hay filas `item_delivered` ni `withdrawal_delivered`
--   (`SELECT count(*) FROM "PaymentRefund" WHERE "kind"::text = 'item_delivered'` ⇒ 0 y
--    `SELECT count(*) FROM "ManualRefund" WHERE "source"::text = 'withdrawal_delivered'` ⇒ 0):
--   DROP INDEX IF EXISTS "ManualRefund_live_per_withdrawal_line_key";
--   ALTER TABLE "ManualRefund" DROP CONSTRAINT IF EXISTS "ManualRefund_withdrawal_delivered_chk";
--   ALTER TABLE "ManualRefund" DROP CONSTRAINT IF EXISTS "ManualRefund_case_sources_chk";
--   ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_delivered_shape_chk";
--   ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_delivered_chk";
--   ALTER TABLE "ManualRefund" DROP CONSTRAINT IF EXISTS "ManualRefund_shipmentItemId_fkey";
--   ALTER TABLE "ManualRefund" ALTER COLUMN "replacementCaseId" SET NOT NULL;   -- falla si hay NULL: es lo correcto
--   ALTER TABLE "ManualRefund" DROP COLUMN "deliveredNote", DROP COLUMN "deliveredReason", DROP COLUMN "shipmentItemId";
--   ALTER TABLE "PaymentRefund" DROP COLUMN "deliveredReason";
--   (los valores `item_delivered` / `withdrawal_delivered` NO se quitan sin recrear el tipo: se quedan, como M-62)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261020120000_m70_panel_refunds';
-- ⚠️ Con filas `item_delivered` / `withdrawal_delivered` ⛔ NO se borra nada: son el registro de por qué salió dinero.

-- AlterEnum
ALTER TYPE "PaymentRefundKind" ADD VALUE IF NOT EXISTS 'item_delivered';
ALTER TYPE "ManualRefundSource" ADD VALUE IF NOT EXISTS 'withdrawal_delivered';

-- AlterTable
ALTER TABLE "PaymentRefund" ADD COLUMN IF NOT EXISTS "deliveredReason" "ShippedRefundReason";
ALTER TABLE "ManualRefund" ADD COLUMN IF NOT EXISTS "shipmentItemId" TEXT,
ADD COLUMN IF NOT EXISTS "deliveredReason" "ShippedRefundReason",
ADD COLUMN IF NOT EXISTS "deliveredNote" TEXT,
ALTER COLUMN "replacementCaseId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ManualRefund" DROP CONSTRAINT IF EXISTS "ManualRefund_shipmentItemId_fkey";
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================== CHECKs (§PNL.7) =====================================
-- PaymentRefund: `item_delivered` ⇔ motivo de entrega; y su forma (la carta, la línea entregada, la nota, la orden; sin
-- motivo de preparación). `PaymentRefund_item_missing_chk` (M-61) ya la admite: su lado derecho exige `missingReason`.
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_delivered_chk";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_delivered_chk"
  CHECK (("kind"::text = 'item_delivered') = ("deliveredReason" IS NOT NULL));
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_item_delivered_shape_chk";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_item_delivered_shape_chk"
  CHECK ("kind"::text <> 'item_delivered' OR ("orderItemId" IS NOT NULL AND "shipmentItemId" IS NOT NULL
    AND "missingReason" IS NULL AND "reason" IS NOT NULL AND "orderId" IS NOT NULL));

-- ManualRefund: los dos `source` de «Por reponer» llevan caso, y SOLO ellos; `withdrawal_delivered` lleva la línea, el
-- motivo y la nota, y SOLO él.
ALTER TABLE "ManualRefund" DROP CONSTRAINT IF EXISTS "ManualRefund_case_sources_chk";
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_case_sources_chk"
  CHECK (("source"::text IN ('case_excess', 'stripe_failed')) = ("replacementCaseId" IS NOT NULL));
ALTER TABLE "ManualRefund" DROP CONSTRAINT IF EXISTS "ManualRefund_withdrawal_delivered_chk";
ALTER TABLE "ManualRefund" ADD CONSTRAINT "ManualRefund_withdrawal_delivered_chk"
  CHECK (("source"::text = 'withdrawal_delivered') = ("shipmentItemId" IS NOT NULL AND "deliveredReason" IS NOT NULL
    AND "deliveredNote" IS NOT NULL));

-- Una devolución VIVA por línea de retiro (la cancelada no cuenta: se puede volver a capturar o re-emitir).
CREATE UNIQUE INDEX IF NOT EXISTS "ManualRefund_live_per_withdrawal_line_key" ON "ManualRefund"("shipmentItemId")
  WHERE "status" <> 'cancelled' AND "shipmentItemId" IS NOT NULL;
