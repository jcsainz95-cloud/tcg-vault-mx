-- M-64 = `M-SDX-C` — fase C de Skydropx: la dirección (API_CONTRACT §M4-SHIP.19.5 y §M4-SHIP.19.20.1, errata v1.80.12;
-- ARCHITECTURE §4.60 (e)/(m), §11 «v1.81-skydropx»). Número asignado por el orquestador; confirmado contra
-- `migrations/` (última previa: `20261005120000_m63_staff_username`).
--
-- DDL ADITIVO, SIN BACKFILL, IDEMPOTENTE (cada sentencia se puede aplicar dos veces sin cambiar nada):
--   · `Address.references` (TEXT, nullable) — «referencias» para el repartidor, ≤ 70 (la cota es del servidor);
--   · tabla `PostalCode` (catálogo SEPOMEX, una fila por CP+colonia). ⛔ La migración NO la llena: la carga devops
--     con `scripts/geo/import-sepomex.ts`. Vacía ⇒ todo CP es `POSTAL_CODE_UNKNOWN` (ver BACKEND_NOTES §58);
--   · `ShipmentRequest.addressVersion` (INT NOT NULL DEFAULT 0), `addressCorrectedAt`, `addressCorrectedByUserId`
--     (sin FK dura, patrón AuditLog) + 3 CHECK de §19.20.1 + 1 CHECK de forma del CP en `PostalCode`.
--
-- SIN BACKFILL: las filas existentes nacen con `addressVersion = 0` y sin corrección ⇒ los tres CHECK se cumplen.
-- `Address.neighborhood` sigue nullable: `AddressDTO.complete` deriva la falta (⛔ no se inventa una colonia).
--
-- ⛔ CERO DINERO movido: ninguna fila existente cambia de valor.
--
-- REVERSA (código revertido antes):
--   ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_address_version_nonneg";
--   ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_address_corrected_paired";
--   ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_address_version_iff_corrected";
--   ALTER TABLE "ShipmentRequest" DROP COLUMN IF EXISTS "addressVersion", DROP COLUMN IF EXISTS "addressCorrectedAt",
--     DROP COLUMN IF EXISTS "addressCorrectedByUserId";   -- ⚠️ pierde la ÚLTIMA corrección (la bitácora la conserva)
--   DROP TABLE IF EXISTS "PostalCode";                    -- se recarga con el import
--   ALTER TABLE "Address" DROP COLUMN IF EXISTS "references";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261006120000_m64_sdx_c_address';
-- ⚠️ Los `addressSnapshot` ya escritos con `references` (10 campos) se leen igual sin la columna (clave JSON extra).

-- AlterTable
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS "references" TEXT;

-- AlterTable
ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "addressCorrectedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "addressCorrectedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "addressVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PostalCode" (
    "id" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,

    CONSTRAINT "PostalCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PostalCode_postalCode_idx" ON "PostalCode"("postalCode");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PostalCode_postalCode_neighborhood_key" ON "PostalCode"("postalCode", "neighborhood");

-- ===================================== CHECKs (§M4-SHIP.19.20.1) =====================================
-- `ADD CONSTRAINT` no admite IF NOT EXISTS en Postgres: cada uno va en un bloque que mira `pg_constraint`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_address_version_nonneg') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_address_version_nonneg" CHECK ("addressVersion" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_address_corrected_paired') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_address_corrected_paired"
      CHECK (("addressCorrectedAt" IS NULL) = ("addressCorrectedByUserId" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_address_version_iff_corrected') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_address_version_iff_corrected"
      CHECK (("addressVersion" = 0) = ("addressCorrectedAt" IS NULL));
  END IF;
  -- Forma del CP del catálogo (el lector compara contra `^\d{5}$`; una fila mal importada no debe existir).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'postal_code_five_digits') THEN
    ALTER TABLE "PostalCode" ADD CONSTRAINT "postal_code_five_digits" CHECK ("postalCode" ~ '^[0-9]{5}$');
  END IF;
END $$;
