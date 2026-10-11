-- M-65 = `M-SDX-C2` — errata v1.80.12.2, `SKX-SEC-1` opción (a) (API_CONTRACT §M4-SHIP.19.22.1; ARCHITECTURE §4.60 (o)).
-- Número confirmado contra `migrations/` (última previa: `20261006120000_m64_sdx_c_address`).
--
-- Los VALORES de cada corrección de la dirección del envío salen de `AuditLog` (que es inmutable y nunca se purga) y
-- viven en `ShipmentAddressRevision`, que la anonimización de cuenta BORRA. La bitácora conserva quién, cuándo, qué
-- claves y qué versión.
--
-- DDL ADITIVO, SIN BACKFILL, IDEMPOTENTE. ⛔ No toca `AuditLog` ni ninguna fila existente. CERO dinero.
--
-- ⚠️ PRECONDICIÓN DE DESPLIEGUE (§19.22.1): en la BD destino `SELECT count(*) FROM "AuditLog" WHERE action =
-- 'shipment.address_corrected'` debe ser 0 (la fase C no ha llegado a producción). Si no lo es: PARAR y preguntar al
-- dueño (reescribir esas filas rompería la inmutabilidad de `AuditLog`).
--
-- REVERSA (código revertido antes; ⚠️ revertir el código a la fase C sin esta errata vuelve a escribir domicilios en
-- `AuditLog` y reabre SKX-SEC-1):
--   DROP TABLE IF EXISTS "ShipmentAddressRevision";   -- pierde los valores intermedios (quién/cuándo siguen en AuditLog)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006130000_m65_sdx_c2_address_revision';

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentAddressRevision" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "changedKeys" TEXT[],
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "correctedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentAddressRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentAddressRevision_shipmentRequestId_fromVersion_key" ON "ShipmentAddressRevision"("shipmentRequestId", "fromVersion");

-- FK + CHECKs (`ADD CONSTRAINT` no admite IF NOT EXISTS: bloque sobre `pg_constraint`, patrón M-64).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentAddressRevision_shipmentRequestId_fkey') THEN
    ALTER TABLE "ShipmentAddressRevision" ADD CONSTRAINT "ShipmentAddressRevision_shipmentRequestId_fkey"
      FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_address_revision_from_version_nonneg') THEN
    ALTER TABLE "ShipmentAddressRevision" ADD CONSTRAINT "shipment_address_revision_from_version_nonneg" CHECK ("fromVersion" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_address_revision_changed_keys_nonempty') THEN
    ALTER TABLE "ShipmentAddressRevision" ADD CONSTRAINT "shipment_address_revision_changed_keys_nonempty"
      CHECK ("changedKeys" IS NOT NULL AND cardinality("changedKeys") >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_address_revision_changed_keys_known') THEN
    ALTER TABLE "ShipmentAddressRevision" ADD CONSTRAINT "shipment_address_revision_changed_keys_known"
      CHECK ("changedKeys" <@ ARRAY['recipientName','line1','line2','postalCode','neighborhood','city','state','country','references']::text[]);
  END IF;
END $$;
