-- M-101 — `m101_index_inspection` (§GSHOP.A, docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md). Va DESPUÉS de M-100.
-- 100% ADITIVA: una tabla nueva, sin tocar ninguna existente. Guarda, por URL pública que debe indexarse, el último veredicto de Google
-- (Search Console URL Inspection) y la racha del problema. Sin datos personales. Filas ≈ 1,030. El interruptor `gsc_index_inspect` vive
-- en `ConfigSetting` (ausente = encendido): sin migración de datos.
-- Reversa (a mano; nada más depende de ella):
--   DROP TABLE "IndexInspection";
--   DELETE FROM "ConfigSetting" WHERE "key" = 'gsc_index_inspect';
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261121120000_m101_index_inspection';
-- G-8 (limpieza PDB): ⇒ conservar (refleja el índice de Google de URLs públicas; ni datos de prueba ni de cliente).

CREATE TABLE "IndexInspection" (
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "verdict" TEXT,
    "coverageState" TEXT,
    "pageFetchState" TEXT,
    "robotsTxtState" TEXT,
    "indexingState" TEXT,
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "lastCrawlTime" TIMESTAMP(3),
    "flag" TEXT,
    "flagSince" TIMESTAMP(3),
    "flagStreak" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "IndexInspection_pkey" PRIMARY KEY ("url")
);

CREATE INDEX "IndexInspection_lastCheckedAt_idx" ON "IndexInspection"("lastCheckedAt");
