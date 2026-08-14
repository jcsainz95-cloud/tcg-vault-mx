-- v1.2 / v1.2.1 (2026-08-14) — simplificación. Proyecto GREENFIELD (sin backfill de filas):
-- las migraciones solo redefinen esquema. Ver ARCHITECTURE §11 (M-12, M-13).

-- M-12: InventoryItem.certNumber (nº de certificado PSA/CGC). Solo para productType=graded;
-- null para raw/sealed. REQUERIDO a nivel de aplicación para publicar una gradeada (no NOT NULL
-- en BD porque raw/sealed lo dejan null). Sin validación automática contra la graduadora.
ALTER TABLE "InventoryItem" ADD COLUMN "certNumber" TEXT;

-- M-13: se ELIMINAN los campos de foto de producto (el producto no lleva fotos propias; la imagen
-- mostrada es la de catálogo remota de pokemontcg.io) y las fotos de evidencia de disputa
-- (la evidencia se envía por correo a soporte). Greenfield: sin datos que migrar.
ALTER TABLE "InventoryItem" DROP COLUMN "frontPhotoKey";
ALTER TABLE "InventoryItem" DROP COLUMN "backPhotoKey";
ALTER TABLE "InventoryItem" DROP COLUMN "extraPhotoKeys";
ALTER TABLE "SellRequestItem" DROP COLUMN "photoKeys";
ALTER TABLE "Dispute" DROP COLUMN "ingressPhotoKeys";
ALTER TABLE "Dispute" DROP COLUMN "claimPhotoKeys";

-- INE (KYC) SIN cambio (v1.2.1): KycProfile.ineFrontKey/ineBackKey, cifrado PII (*Enc/*Hmac),
-- retención INE_RETENTION_DAYS y reveal-clabe permanecen intactos.
