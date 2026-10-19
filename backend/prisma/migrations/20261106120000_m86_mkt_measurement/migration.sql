-- M-86 — migración `v1.102⟨mkt-fase2⟩` (Fase 2 de medición: consentimiento, GA4 Measurement Protocol, Meta CAPI).
-- Contrato: API_CONTRACT §MKT.H.7. Diseño: ARCHITECTURE §14.6. Siguiente libre tras M-85 (`20261105120000_m85_card_show_shardbugs`).
--
-- QUÉ HACE (100% ADITIVO, seguro con la app corriendo):
--   · enum `BannerResponse` gana `custom` (segunda capa del banner), con `IF NOT EXISTS`: la reversa lo deja (Postgres no
--     quita valores) y sin él el re-deploy tras la reversa falla con 42710 (QA I1). ⚠️ `ALTER TYPE … ADD VALUE` no se puede
--     usar en la misma transacción que lo crea: NINGUNA sentencia de esta migración usa 'custom'.
--   · enums nuevos `MeasurementEventKind` (purchase|generate_lead) y `MeasurementDestination` (ga4_mp|meta_capi).
--   · `Order` y `SellRequest`: tres columnas NULLABLE sin default (`measurementConsentAnalytics`, `measurementConsentAds`,
--     `measurementNoticeVersion`). Sin backfill: NULL es la verdad de toda fila previa («antes de Fase 2»).
--   · `MeasurementContext` (identificadores de navegador, ≤7 días) y `MeasurementOutbox` (cola SIN cuerpo, ≤7 días).
--     ⛔ Sin FK en ninguna de las dos.
--   CERO `DROP`, CERO cambio de tipo, CERO dinero.
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- Primero apagar (`MEASUREMENT_MODE=off`) y desplegar el código anterior; después:
-- REVERSA:BEGIN
--   DROP TABLE IF EXISTS "MeasurementOutbox";
--   DROP TABLE IF EXISTS "MeasurementContext";
--   ALTER TABLE "Order"       DROP COLUMN IF EXISTS "measurementConsentAnalytics", DROP COLUMN IF EXISTS "measurementConsentAds", DROP COLUMN IF EXISTS "measurementNoticeVersion";
--   ALTER TABLE "SellRequest" DROP COLUMN IF EXISTS "measurementConsentAnalytics", DROP COLUMN IF EXISTS "measurementConsentAds", DROP COLUMN IF EXISTS "measurementNoticeVersion";
--   DROP TYPE  IF EXISTS "MeasurementEventKind";
--   DROP TYPE  IF EXISTS "MeasurementDestination";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261106120000_m86_mkt_measurement';
--   -- `custom` se queda en "BannerResponse": Postgres no quita valores de un enum (inocuo; m86 lo re-añade con IF NOT EXISTS).
-- REVERSA:END
-- Borrada la fila de `_prisma_migrations`, `prisma migrate deploy` vuelve a aplicar m86 (QA lo midió: «Applying migration
-- `20261106120000_m86_mkt_measurement`»); `prisma migrate resolve --rolled-back` es para migraciones FALLIDAS, no hace falta.

-- AlterEnum
ALTER TYPE "BannerResponse" ADD VALUE IF NOT EXISTS 'custom';

-- CreateEnum
CREATE TYPE "MeasurementEventKind" AS ENUM ('purchase', 'generate_lead');

-- CreateEnum
CREATE TYPE "MeasurementDestination" AS ENUM ('ga4_mp', 'meta_capi');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "measurementConsentAds" BOOLEAN,
ADD COLUMN     "measurementConsentAnalytics" BOOLEAN,
ADD COLUMN     "measurementNoticeVersion" TEXT;

-- AlterTable
ALTER TABLE "SellRequest" ADD COLUMN     "measurementConsentAds" BOOLEAN,
ADD COLUMN     "measurementConsentAnalytics" BOOLEAN,
ADD COLUMN     "measurementNoticeVersion" TEXT;

-- CreateTable
CREATE TABLE "MeasurementContext" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "sellRequestId" TEXT,
    "gaClientId" TEXT,
    "fbp" TEXT,
    "fbc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementContext_pkey" PRIMARY KEY ("id"),
    -- v1.106 (API_CONTRACT §MKT.H.7, D8 / C-B11): exactamente un sujeto. Tabla nueva y vacía ⇒ no valida filas.
    -- Prisma no modela CHECKs: vive solo aquí (como los de m25).
    CONSTRAINT "MeasurementContext_one_subject" CHECK (num_nonnulls("orderId", "sellRequestId") = 1)
);

-- CreateTable
CREATE TABLE "MeasurementOutbox" (
    "id" TEXT NOT NULL,
    "kind" "MeasurementEventKind" NOT NULL,
    "destination" "MeasurementDestination" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementContext_orderId_key" ON "MeasurementContext"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementContext_sellRequestId_key" ON "MeasurementContext"("sellRequestId");

-- CreateIndex
CREATE INDEX "MeasurementContext_expiresAt_idx" ON "MeasurementContext"("expiresAt");

-- CreateIndex
CREATE INDEX "MeasurementOutbox_nextAttemptAt_idx" ON "MeasurementOutbox"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "MeasurementOutbox_expiresAt_idx" ON "MeasurementOutbox"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementOutbox_destination_eventId_key" ON "MeasurementOutbox"("destination", "eventId");
