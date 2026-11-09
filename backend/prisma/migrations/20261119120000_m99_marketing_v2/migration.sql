-- M-99 — `m99_marketing_v2` (MKT-V2, docs/specs/MKT_PANEL_V2.md §7). Contrato: API_CONTRACT §MKT-V2; ARCHITECTURE decisión 18. Va DESPUÉS de M-98.
-- 100% ADITIVA: dos tablas nuevas, sin tocar ninguna existente. Sin datos personales: `SearchNoResultDaily` (c6) guarda término ya
-- filtrado de PII × día × conteo (sin usuario, IP ni cookie); `MarketingWeeklyDigest` solo la semana y el estado del envío.
-- REVERSA (a mano; nada más depende de ellas):
--   DROP TABLE "MarketingWeeklyDigest"; DROP TABLE "SearchNoResultDaily";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261119120000_m99_marketing_v2';
-- Los interruptores `marketing_search_log` y `marketing_weekly_digest` viven en `ConfigSetting` (ausente = encendido): sin migración de datos.

CREATE TABLE "SearchNoResultDaily" (
    "id" TEXT NOT NULL,
    "termNormalized" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchNoResultDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchNoResultDaily_termNormalized_day_key" ON "SearchNoResultDaily"("termNormalized", "day");
CREATE INDEX "SearchNoResultDaily_termNormalized_idx" ON "SearchNoResultDaily"("termNormalized");

CREATE TABLE "MarketingWeeklyDigest" (
    "weekStart" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "MarketingWeeklyDigest_pkey" PRIMARY KEY ("weekStart")
);
