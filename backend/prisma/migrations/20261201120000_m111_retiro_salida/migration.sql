-- §RETIRO-SALIDA (DECISIONES): aditiva. Ninguna sentencia de este fichero usa los valores de enum nuevos.
--  * SpendAlertKind += manual_label_unshipped (AG-27: guía manual sin marcar enviado), retiro_parcel_returned (AG-28)
--  * ShipmentRequest.labelCapturedAt (NULL, sin default, sin backfill)
-- (El dueño decidió publicar SIN «Recibimos la devolución»: no hay `returnedAt` ni `withdrawal_return`.)
-- REVERSIÓN: los valores de enum no se pueden quitar de Postgres (quedan inertes); la columna: ALTER TABLE ... DROP COLUMN.
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'manual_label_unshipped';
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'retiro_parcel_returned';
ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "labelCapturedAt" TIMESTAMP(3);
