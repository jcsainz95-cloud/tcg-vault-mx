-- M-62 — migración `v1.80.8.6` (reembolso TOTAL «depende de si ya salió»: el corte «enviado» y su motivo ·
-- API_CONTRACT §M4-SHIP.18.12 (1) · ARCHITECTURE §4.57 (w), §11 «v1.80.8.6-reembolso-tras-envio»).
--
-- DDL ADITIVO, SIN BACKFILL:
--   · 1 enum nuevo: ShippedRefundReason {not_arrived, arrived_damaged} (PROJECT §S.11.4; clase R en el código);
--   · 1 valor nuevo en un enum EXISTENTE: MovementReason + refund_release (`ALTER TYPE … ADD VALUE`, como
--     `refund_return` en M-61; Postgres 16: válido dentro de la tx de la migración mientras el valor no se USE
--     en esta misma tx — y no se usa);
--   · 5 columnas en Order: fullRefundAfterShipment BOOLEAN NOT NULL DEFAULT false, shippedRefundReason,
--     shippedRefundNote, shippedRefundReasonAt, shippedRefundReasonByUserId (FK User, RESTRICT);
--   · 2 CHECKs (SQL crudo, precedente M-25/M-59/M-61): `order_shipped_refund_reason_shape` (los cuatro campos del
--     motivo van juntos y solo con `fullRefundAfterShipment`) y `order_after_shipment_sealed` (`true` ⇒ sellada).
--   · ⛔ Sin índice nuevo (el contador «por revisar» es un `count` con `WHERE` sobre dos columnas; volumen mínimo).
--
-- SIN BACKFILL (norma v1.64, §11): `false` es el valor VERDADERO para toda fila existente — ninguna orden se cerró
-- con este corte registrado. ⛔ No se inventa `true` (sería «por revisar» un hecho que el sistema no registró).
-- Medición de solo lectura previa al deploy: docs/BACKEND_NOTES.md §«M-62 — conteos previos al despliegue».
--
-- ⛔ CERO DINERO movido: ningún importe cambia; las columnas nuevas nacen en su valor neutro.
--
-- REVERSA (rollback de código; las columnas pueden QUEDARSE — nullable / default — y el artefacto anterior las
-- ignora). Si hubiera que quitarlas y NO hay motivos registrados:
--   ALTER TABLE "Order" DROP CONSTRAINT "order_after_shipment_sealed";
--   ALTER TABLE "Order" DROP CONSTRAINT "order_shipped_refund_reason_shape";
--   ALTER TABLE "Order" DROP CONSTRAINT "Order_shippedRefundReasonByUserId_fkey";
--   ALTER TABLE "Order" DROP COLUMN "shippedRefundReasonByUserId", DROP COLUMN "shippedRefundReasonAt",
--     DROP COLUMN "shippedRefundNote", DROP COLUMN "shippedRefundReason", DROP COLUMN "fullRefundAfterShipment";
--   DROP TYPE "ShippedRefundReason";
--   (el valor `refund_release` de MovementReason NO se puede quitar sin recrear el tipo: se queda; los movimientos
--    que lo usen quedan como historial legible).
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261004120000_m62_shipped_refund_reason';
-- ⚠️ Con motivos registrados ⛔ NO se borran las columnas: son el registro de por qué salió dinero.

-- CreateEnum
CREATE TYPE "ShippedRefundReason" AS ENUM ('not_arrived', 'arrived_damaged');

-- AlterEnum (`IF NOT EXISTS` por idempotencia del deploy, como M-61)
ALTER TYPE "MovementReason" ADD VALUE IF NOT EXISTS 'refund_release';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fullRefundAfterShipment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shippedRefundNote" TEXT,
ADD COLUMN     "shippedRefundReason" "ShippedRefundReason",
ADD COLUMN     "shippedRefundReasonAt" TIMESTAMP(3),
ADD COLUMN     "shippedRefundReasonByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shippedRefundReasonByUserId_fkey" FOREIGN KEY ("shippedRefundReasonByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===================================== CHECKs (§M4-SHIP.18.12 (1)) =====================================
-- El motivo: o NADA, o los cuatro (motivo, cuándo, quién) y solo sobre una orden reembolsada tras salir. La nota
-- puede ir NULL con motivo (opcional en el verbo posterior), pero ⛔ nunca una nota sin motivo.
ALTER TABLE "Order" ADD CONSTRAINT "order_shipped_refund_reason_shape" CHECK (
  ("shippedRefundReason" IS NULL AND "shippedRefundNote" IS NULL AND "shippedRefundReasonAt" IS NULL AND "shippedRefundReasonByUserId" IS NULL)
  OR
  ("shippedRefundReason" IS NOT NULL AND "fullRefundAfterShipment" AND "shippedRefundReasonAt" IS NOT NULL AND "shippedRefundReasonByUserId" IS NOT NULL)
);
-- El corte se congela CON el sello: `fullRefundAfterShipment = true` sin `fullRefundClosedAt` es inexpresable.
ALTER TABLE "Order" ADD CONSTRAINT "order_after_shipment_sealed" CHECK (NOT "fullRefundAfterShipment" OR "fullRefundClosedAt" IS NOT NULL);
