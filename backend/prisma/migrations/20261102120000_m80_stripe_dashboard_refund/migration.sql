-- M-80 — migración `v1.95⟨pnl-finanzas⟩` (punto B1 · API_CONTRACT §M4-SHIP.20 (B1), candado REF-DASH-1).
-- Número elegido como el siguiente libre tras M-79 (`20261101120000_m79_inventory_acquisition_cost_iva`).
--
-- EL HUECO: un reembolso hecho DIRECTO en el panel de Stripe (fuera de la app) llega por webhook
-- `charge.refunded`/`refund.updated` SIN `metadata.paymentRefundId` ⇒ hoy NO nace fila de libro ⇒ invisible
-- al P&L. Esta migración habilita que nazca una fila `stripe_dashboard` conciliada (la crea el webhook).
--
-- DDL ADITIVO, SIN BACKFILL, IDEMPOTENTE (aplicarla dos veces deja la BD idéntica):
--   · 1 valor nuevo en un enum EXISTENTE (`ADD VALUE IF NOT EXISTS`, patrón M-61/M-62/M-70):
--       PaymentRefundKind + stripe_dashboard
--   · Se RELAJA, de forma MÍNIMA Y REVERSIBLE, UN solo CHECK: `PaymentRefund_shipment_fee_chk`. Hoy exige
--     `shipmentRequestId IS NOT NULL ⇔ kind = 'shipment_fee'`; relajado admite además `kind = 'stripe_dashboard'`
--     colgado de un `shipmentRequestId` (el cobro propio de un retiro reembolsado en el panel). Para TODO otro
--     `kind` la equivalencia original se conserva intacta.
--
-- ⚠️ MEDIDO (BACKEND_NOTES §PNL-B1): una fila `stripe_dashboard` colgada solo de `orderId`, SIN líneas
-- (`orderItemId`/`shipmentItemId`/accesorio NULL) y con `compensationCents = 0`, YA cumple TODOS los demás CHECK
-- de `PaymentRefund` sin tocarlos (`one_charge`, `item_missing`, `case_refund*`, `item_delivered*`,
-- `amount_identity`, `amount_positive`, `submitted_has_stripe_id`, los de accesorio…). El ÚNICO que la bloquea
-- es `shipment_fee_chk`, y SOLO en la variante colgada de `shipmentRequestId`. Por eso se relaja ese y nada más.
--
-- ⚠️ El CHECK compara `"kind"::text` con un LITERAL de texto: Postgres no deja USAR en la misma transacción un
-- valor de enum recién añadido (`unsafe use of new value`), y el cast a texto no lo usa (igual que M-70, medido).
--
-- SIN BACKFILL: toda fila existente tiene `kind ≠ stripe_dashboard` ⇒ la rama relajada (OR) no cambia su
-- evaluación; el CHECK las acepta exactamente como antes. ⛔ CERO DINERO movido, CERO fila reescrita.
--
-- REVERSA (rollback de código; el valor del enum puede QUEDARSE — como M-62/M-70). Para volver al CHECK estricto
-- hace falta que NO exista ninguna fila `stripe_dashboard` colgada de `shipmentRequestId`
--   (`SELECT count(*) FROM "PaymentRefund" WHERE "kind"::text = 'stripe_dashboard' AND "shipmentRequestId" IS NOT NULL` ⇒ 0):
--   ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_shipment_fee_chk";
--   ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shipment_fee_chk"
--     CHECK (("kind" = 'shipment_fee') = ("shipmentRequestId" IS NOT NULL));
--   (el valor `stripe_dashboard` NO se quita sin recrear el tipo: se queda, como M-62/M-70)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261102120000_m80_stripe_dashboard_refund';
-- ⚠️ Con filas `stripe_dashboard` ⛔ NO se borra nada: son el registro de por qué salió dinero.

-- AlterEnum
ALTER TYPE "PaymentRefundKind" ADD VALUE IF NOT EXISTS 'stripe_dashboard';

-- RelaxCheck: `shipment_fee_chk` admite además `stripe_dashboard` colgado de un retiro; para todo otro `kind`
-- la equivalencia original se conserva (`=` liga más fuerte que `OR`: es `(kind='shipment_fee')=(shipReq NOT NULL) OR kind='stripe_dashboard'`).
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_shipment_fee_chk";
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_shipment_fee_chk"
  CHECK (("kind"::text = 'shipment_fee') = ("shipmentRequestId" IS NOT NULL) OR "kind"::text = 'stripe_dashboard');
