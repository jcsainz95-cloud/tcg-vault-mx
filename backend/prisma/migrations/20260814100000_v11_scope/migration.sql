-- v1.1 (2026-08-14) — nuevo alcance. Proyecto GREENFIELD (sin backfill de filas):
-- las migraciones solo redefinen esquema. Ver ARCHITECTURE §11 (M-1..M-11).

-- M-1: RawCondition reducido a un ÚNICO valor NM (se eliminan LP|MP|HP|DMG).
-- Se recrea el enum y se recastean las columnas que lo usan. Greenfield: no hay filas
-- ≠ NM que migrar; el USING castea el texto al nuevo enum (fallaría solo con datos previos).
ALTER TYPE "RawCondition" RENAME TO "RawCondition_old";
CREATE TYPE "RawCondition" AS ENUM ('NM');
ALTER TABLE "InventoryItem"
  ALTER COLUMN "rawCondition" TYPE "RawCondition"
  USING ("rawCondition"::text::"RawCondition");
ALTER TABLE "SellRequestItem"
  ALTER COLUMN "rawCondition" TYPE "RawCondition"
  USING ("rawCondition"::text::"RawCondition");
DROP TYPE "RawCondition_old";

-- M-2: SealedSubtype (enum opcional) + InventoryItem.sealedSubtype (nullable).
CREATE TYPE "SealedSubtype" AS ENUM ('box', 'etb', 'bundle', 'tin', 'blister');
ALTER TABLE "InventoryItem" ADD COLUMN "sealedSubtype" "SealedSubtype";

-- M-3..M-7: campos de auth Google en User.
CREATE TYPE "AuthProvider" AS ENUM ('local', 'google');
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "authProvider" "AuthProvider" NOT NULL DEFAULT 'local';
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- M-8: PortfolioSnapshot (modelo nuevo; serie diaria del valor de portafolio).
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "totalValueMxnCents" INTEGER NOT NULL,
    "costBasisMxnCents" INTEGER,
    "pendingPriceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortfolioSnapshot_userId_asOfDate_key" ON "PortfolioSnapshot"("userId", "asOfDate");
CREATE INDEX "PortfolioSnapshot_userId_asOfDate_idx" ON "PortfolioSnapshot"("userId", "asOfDate");
ALTER TABLE "PortfolioSnapshot"
  ADD CONSTRAINT "PortfolioSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- M-9: seed del dial catalog_sync_from_date (frontera por defecto del sync de catálogo).
-- Idempotente: no sobrescribe si el admin ya lo cambió.
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('catalog_sync_from_date', '"2024/01/01"', 'migration', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- M-10: Dispute.type ya es TEXT libre (default 'condition_raw'); admite 'condition_sealed'
-- sin cambio de esquema (la evidencia canónica del sellado es la foto de la caja al ingreso).
-- M-11: Card.rarity permanece String libre (taxonomía abierta pokemontcg.io) — sin cambio.
