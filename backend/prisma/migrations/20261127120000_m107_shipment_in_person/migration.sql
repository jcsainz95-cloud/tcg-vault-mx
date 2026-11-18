-- §PERSONA (DECISIONES §PERSONA, ARCHITECTURE §5 decisión 20): «Entregado en persona». Aditiva, sin backfill.
-- ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción que lo consume: el CHECK referencia el valor por
-- texto ('in_person'::text) y no por el enum, así que la recreación no necesita el valor ya confirmado.
ALTER TYPE "ShipmentLabelSource" ADD VALUE IF NOT EXISTS 'in_person';

ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_delivered_notice_skydropx_only";
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_delivered_notice_skydropx_only"
  CHECK ("deliveredNoticeSentAt" IS NULL OR "labelSource"::text IN ('skydropx', 'in_person'));
