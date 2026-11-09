-- psa_finish_scope (HECHOS 2026-11-09; docs/specs/PSA_ACABADO.md §1). ADITIVA e idempotente: sin backfill, sin DELETE,
-- sin tocar priceMxnCents. Las filas previas quedan con estimateFinishScoped=false (el lector las ignora salvo manuales
-- del acabado principal; el barrido borra las automáticas al escribir las nuevas).
ALTER TABLE "PriceReference" ADD COLUMN IF NOT EXISTS "estimateFinishScoped" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "GradedCardScanOutcome" ADD VALUE IF NOT EXISTS 'no_finish_split';
