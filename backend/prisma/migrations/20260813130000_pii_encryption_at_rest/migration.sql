-- Endurecimiento de PII: cifrado en reposo (AES-256-GCM) + blind index (HMAC-SHA256).
-- Greenfield (sin datos productivos): se renombran las columnas PII a `*Enc` sin backfill.
-- Las filas existentes en un entorno de desarrollo quedan con valores en claro dentro de
-- columnas ahora tratadas como cifradas; en greenfield no hay datos que preservar.

-- KycProfile: rfc/clabe -> rfcEnc/clabeEnc; nuevo blind index clabeHmac.
ALTER TABLE "KycProfile" RENAME COLUMN "rfc" TO "rfcEnc";
ALTER TABLE "KycProfile" RENAME COLUMN "clabe" TO "clabeEnc";
ALTER TABLE "KycProfile" ADD COLUMN "clabeHmac" TEXT;

-- BillingProfile: rfc -> rfcEnc.
ALTER TABLE "BillingProfile" RENAME COLUMN "rfc" TO "rfcEnc";

-- SellRequest: clabeSnapshot -> clabeSnapshotEnc.
ALTER TABLE "SellRequest" RENAME COLUMN "clabeSnapshot" TO "clabeSnapshotEnc";

-- Índice para el blind index (match "a nombre propio" + detección de CLABE compartida).
CREATE INDEX "KycProfile_clabeHmac_idx" ON "KycProfile"("clabeHmac");
