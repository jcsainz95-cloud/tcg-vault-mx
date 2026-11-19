-- §RETIRO-SALIDA (DECISIONES): aditiva. Ninguna sentencia de este fichero usa los valores de enum nuevos.
--  * MovementReason += withdrawal_return (la devolución física vuelve la pieza a la bóveda)
--  * SpendAlertKind += manual_label_unshipped (AG-27: guía manual sin marcar enviado), retiro_parcel_returned (AG-28), return_received_by_non_owner (AG-29)
--  * ShipmentRequest.labelCapturedAt / returnedAt (NULL, sin default, sin backfill)
-- REVERSIÓN: los valores de enum no se pueden quitar de Postgres (quedan inertes); las columnas: ALTER TABLE ... DROP COLUMN.
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'withdrawal_return';
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'manual_label_unshipped';
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'retiro_parcel_returned';
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'return_received_by_non_owner';
ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "labelCapturedAt" TIMESTAMP(3);
ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
