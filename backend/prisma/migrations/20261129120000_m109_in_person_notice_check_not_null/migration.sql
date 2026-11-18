-- §PERSONA (qa QA-PER-CHECK): el CHECK de m107 usaba `"labelSource"::text IN (…)`, que es NULL (⇒ el CHECK pasa) cuando
-- `labelSource` es NULL: admitía un aviso de entregado sin origen (m66 lo rechazaba con IS NOT DISTINCT FROM). Se recrea con
-- `IS NOT NULL AND …`. Sin backfill; no toca filas (las existentes con sello son todas skydropx/in_person).
--
-- REVERSIÓN (a mano, solo si no hay filas `labelSource='in_person'` con sello; si las hay, primero deshacer m107):
--   ALTER TABLE "ShipmentRequest" DROP CONSTRAINT "shipment_delivered_notice_skydropx_only";
--   ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_delivered_notice_skydropx_only"
--     CHECK ("deliveredNoticeSentAt" IS NULL OR "labelSource" IS NOT DISTINCT FROM 'skydropx'::"ShipmentLabelSource");
ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_delivered_notice_skydropx_only";
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_delivered_notice_skydropx_only"
  CHECK ("deliveredNoticeSentAt" IS NULL OR ("labelSource" IS NOT NULL AND "labelSource"::text IN ('skydropx', 'in_person')));
