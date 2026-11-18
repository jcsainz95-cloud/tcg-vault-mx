-- §PERSONA (DECISIONES §PERSONA, ARCHITECTURE §5 decisión 20): «Entregado en persona». Aditiva, sin backfill.
-- ALTER TYPE ... ADD VALUE no puede usarse en la misma transacción que lo consume: el CHECK referencia el valor por
-- texto ('in_person'::text) y no por el enum, así que la recreación no necesita el valor ya confirmado.
--
-- REVERSIÓN (a mano; un valor de enum no se puede quitar, queda inerte): (1) pasar las filas `labelSource='in_person'` a otro
-- estado/origen consentido por el dueño (p. ej. `UPDATE "ShipmentRequest" SET "labelSource"='manual', "deliveredNoticeSentAt"=NULL
-- WHERE "labelSource"='in_person'`; sin hacerlo, el CHECK viejo falla al recrearlo); (2) `DROP CONSTRAINT
-- "shipment_delivered_notice_skydropx_only"` y recrearlo con `IS NOT DISTINCT FROM 'skydropx'::"ShipmentLabelSource"` (m66). m109 lo corrige.
ALTER TYPE "ShipmentLabelSource" ADD VALUE IF NOT EXISTS 'in_person';

ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_delivered_notice_skydropx_only";
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_delivered_notice_skydropx_only"
  CHECK ("deliveredNoticeSentAt" IS NULL OR "labelSource"::text IN ('skydropx', 'in_person'));
