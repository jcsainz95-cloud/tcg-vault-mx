-- M-72 — rev BSD-1 (guía Skydropx de ENTRADA del buylist · API_CONTRACT §BSD.1 · ARCHITECTURE §4.BSD y §11 «rev BSD-1»).
-- Número: posterior a M-71 (`20261021120000`); el orquestador midió el 2026-10-06 que ninguna rama abierta tiene una
-- migración posterior a m71. Si al fusionar otro stream ya tomó M-72, se renumera ÉSTA (carpeta y fecha).
--
-- DDL ADITIVO + 1 enum nuevo + 2 valores de enum + 3 columnas + 2 CHECK + FK + 2 índices + relleno ACOTADO de UNA columna
-- nueva. ⛔ CERO dinero, estado o correo movidos.
--   · `ShipmentKind` (outbound | buylist_inbound). `ShipmentRequest.kind` NOT NULL DEFAULT 'outbound': las filas existentes
--     quedan `outbound` POR EL DEFAULT (sin UPDATE).
--   · `ShipmentRequest.sellRequestId` (FK → SellRequest ON DELETE RESTRICT, `@unique`: a lo sumo UNA fila de entrada por
--     solicitud, I-BSD-3) e índice `(kind, status)` para los lectores `outbound_only` (censo BSD-B23).
--   · CHECK `shipment_kind_link` y `shipment_inbound_status` (comparan `::text`, como M-61/M-70).
--   · `SellRequest.inboundGuideClockStartedAt` (ancla re-anclable del cierre a N días naturales sin guía).
--   · Relleno P-BSD-2 (HECHOS 2026-10-06 «Respuestas a P-BSD-1…5»: las abiertas cuentan DESDE EL DESPLIEGUE).
--   · `SellRequestExpiryReason` + `not_continued`; `SpendAlertKind` + `buylist_guide_due` (AG-23).
--
-- ⚠️ ENUMS EN LA MISMA TRANSACCIÓN: los dos `ADD VALUE` van AL FINAL y NINGUNA sentencia de este fichero USA los valores
-- nuevos (Postgres ≥ 12 permite `ADD VALUE` dentro de la transacción; lo que prohíbe es usar el valor en ella:
-- «unsafe use of new value»). Precedente M-70: cupo en la misma migración, sin M-70b. MEDIDO al migrar: ver BACKEND_NOTES
-- §BSD-B1. Si algún día Prisma/Postgres lo rechazara, (7) y (8) se mueven a `M-72b` (API_CONTRACT §BSD.1).
--
-- IDEMPOTENTE: aplicarla dos veces deja la BD idéntica (`IF NOT EXISTS`, constraints quitar-si-existe-y-poner, y el relleno
-- solo toca anclas NULAS). ⚠️ La guarda `"inboundGuideClockStartedAt" IS NULL` del relleno NO está en el texto de
-- §BSD.1: en la primera aplicación es idéntica (la columna acaba de nacer, todo es NULL); en una re-aplicación evita
-- RE-ANCLAR a un `now()` posterior, que aplazaría en silencio el cierre de solicitudes ya ancladas.
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ PRIMERO se revierte el CÓDIGO, después esto (API_CONTRACT §BSD.1, ARCHITECTURE §4.BSD (e)).
-- 0. Comprobación previa:
--      SELECT count(*) FROM "ShipmentRequest" WHERE "kind"::text = 'buylist_inbound';
--      SELECT count(*) FROM "ShipmentRequest" WHERE "kind"::text = 'buylist_inbound'
--        AND "providerShipmentId" IS NOT NULL AND "providerCanceledAt" IS NULL;   -- guías VIVAS
--    > 0 guías vivas ⇒ ⛔ NO revertir sin cancelarlas antes (es saldo de Skydropx).
--    Las filas de entrada CON guía (viva o cancelada) son el registro de dinero pagado: ⛔ no se borran; con ellas la
--    columna `sellRequestId`/`kind` no se puede quitar sin decidir antes qué hacer con ese registro.
-- 1. DELETE FROM "ShipmentRequest" WHERE "kind"::text = 'buylist_inbound' AND "providerShipmentId" IS NULL;  -- solo las sin guía
--    (sus `ShipmentQuote`/`ShipmentLabelAttempt` sin guía caen por CASCADE/RESTRICT: comprobar antes
--     SELECT count(*) FROM "ShipmentLabelAttempt" a JOIN "ShipmentRequest" s ON s.id = a."shipmentRequestId"
--       WHERE s."kind"::text = 'buylist_inbound' AND s."providerShipmentId" IS NULL;   > 0 ⇒ decidir antes)
-- 2. ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_inbound_status",
--                                  DROP CONSTRAINT IF EXISTS "shipment_kind_link";
--    ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "ShipmentRequest_sellRequestId_fkey";
--    DROP INDEX IF EXISTS "ShipmentRequest_sellRequestId_key";
--    DROP INDEX IF EXISTS "ShipmentRequest_kind_status_idx";
--    ALTER TABLE "ShipmentRequest" DROP COLUMN IF EXISTS "sellRequestId", DROP COLUMN IF EXISTS "kind";
--    DROP TYPE IF EXISTS "ShipmentKind";
--    ALTER TABLE "SellRequest" DROP COLUMN IF EXISTS "inboundGuideClockStartedAt";
--    DELETE FROM "_prisma_migrations" WHERE migration_name = '20261025120000_m72_bsd_inbound_label';
-- 3. Los valores de enum NO se quitan (Postgres no tiene DROP VALUE; mismo criterio que M-62/M-70). Antes de revertir el
--    código:  SELECT count(*) FROM "SellRequest" WHERE "expiredReason"::text = 'not_continued';
--             SELECT count(*) FROM "SpendAlert"  WHERE "kind"::text = 'buylist_guide_due';
--    > 0 ⇒ el código viejo los LEE como un valor desconocido: no se revierte el código sin decidir qué hacer con ellos
--    (se quedan; el cliente viejo pinta «expirada»).
-- ===============================================================================================================================

-- (1) CreateEnum
DO $$ BEGIN
  CREATE TYPE "ShipmentKind" AS ENUM ('outbound', 'buylist_inbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- (2) AlterTable
ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "kind" "ShipmentKind" NOT NULL DEFAULT 'outbound',
ADD COLUMN IF NOT EXISTS "sellRequestId" TEXT;

-- (3) índice único + FK + índice (kind, status)
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentRequest_sellRequestId_key" ON "ShipmentRequest"("sellRequestId");
ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "ShipmentRequest_sellRequestId_fkey";
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "ShipmentRequest_sellRequestId_fkey" FOREIGN KEY ("sellRequestId") REFERENCES "SellRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ShipmentRequest_kind_status_idx" ON "ShipmentRequest"("kind", "status");

-- (4) CHECKs (SQL a mano; Prisma no los modela — precedente M-61/M-62/M-70)
--   `shipment_kind_link`: una fila de salida NO lleva solicitud; una de entrada lleva solicitud y NADA de cliente ni de
--   cobro. Por qué `userId` nulo: `GET /shipments` filtra por `userId` de forma POSITIVA ⇒ la fila de entrada no puede
--   aparecer en «Mis envíos» del vendedor aunque un lector olvide el `kind`. Por qué los montos en 0: ningún sumador de
--   ingresos del P&L puede leer ingreso fantasma de una fila de entrada.
ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_kind_link";
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_kind_link" CHECK (
  ("kind"::text = 'outbound' AND "sellRequestId" IS NULL)
  OR ("kind"::text = 'buylist_inbound' AND "sellRequestId" IS NOT NULL AND "orderId" IS NULL AND "userId" IS NULL
      AND "stripePaymentIntentId" IS NULL AND "shippingFeeCents" = 0 AND "ivaCents" = 0 AND "processingFeeCents" = 0
      AND "totalCents" = 0)
);
--   `shipment_inbound_status`: una fila de entrada solo vive en `solicitado | guia | cancelado`.
ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_inbound_status";
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_inbound_status" CHECK (
  "kind"::text = 'outbound' OR "status"::text IN ('solicitado', 'guia', 'cancelado')
);

-- (5) AlterTable
ALTER TABLE "SellRequest" ADD COLUMN IF NOT EXISTS "inboundGuideClockStartedAt" TIMESTAMP(3);

-- (6) Relleno P-BSD-2 — ÚNICO y ACOTADO. ⛔ No cambia estado, dinero ni correo de nadie: solo APLAZA el cierre de las
-- `aceptada` abiertas sin guía a «despliegue + N días». Sin él, la primera pasada del barrido (regla 8) cerraría con
-- correo la del 15-sep y todas las viejas. `now()` es el instante de la TRANSACCIÓN de la migración ⇒ un solo valor.
-- Antes de desplegar se cuenta (NM-6) y la cifra va a la solicitud de fusión.
UPDATE "SellRequest" SET "inboundGuideClockStartedAt" = now()
 WHERE "status" = 'aceptada' AND "closedAt" IS NULL AND "guideSentAt" IS NULL AND "inboundGuideClockStartedAt" IS NULL;

-- (7) AlterEnum — ⛔ sin uso en esta migración
ALTER TYPE "SellRequestExpiryReason" ADD VALUE IF NOT EXISTS 'not_continued';

-- (8) AlterEnum — AG-23. ⛔ sin uso en esta migración
ALTER TYPE "SpendAlertKind" ADD VALUE IF NOT EXISTS 'buylist_guide_due';
