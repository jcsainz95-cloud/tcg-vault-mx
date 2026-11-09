-- M-99 — `m99_marketing_v2` (MKT-V2, docs/specs/MKT_PANEL_V2.md §7). Contrato: API_CONTRACT §MKT-V2; ARCHITECTURE decisión 18. Va DESPUÉS de M-98.
-- 100% ADITIVA: tres tablas nuevas, sin tocar ninguna existente. `SearchNoResultDaily` (c6) guarda término ya filtrado (PII + vocabulario del
-- catálogo) × día × PERSONAS (sin usuario, IP ni cookie); `SearchNoResultSeen` guarda, solo durante el día, el hash HMAC (sal aleatoria diaria)
-- de quien buscó y se BORRA al cerrar el día; `MarketingWeeklyDigest` solo la semana, el destinatario (hash) y el estado del envío.
-- Reversa (a mano; nada más depende de ellas):
--   DROP TABLE "MarketingWeeklyDigest"; DROP TABLE "SearchNoResultSeen"; DROP TABLE "SearchNoResultDaily";
--   DELETE FROM "ConfigSetting" WHERE "key" LIKE 'search_salt_%';
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261119120000_m99_marketing_v2';
-- G-8 (limpieza PDB): `SearchNoResultDaily` y `MarketingWeeklyDigest` ⇒ conservar (sin datos de prueba de cliente); `SearchNoResultSeen` ⇒ borrar
-- (hashes transitorios de un día, sin valor tras la limpieza). Los interruptores `marketing_search_log` y `marketing_weekly_digest` viven en
-- `ConfigSetting` (ausente = encendido): sin migración de datos.

CREATE TABLE "SearchNoResultDaily" (
    "id" TEXT NOT NULL,
    "termNormalized" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "people" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchNoResultDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchNoResultDaily_termNormalized_day_key" ON "SearchNoResultDaily"("termNormalized", "day");
CREATE INDEX "SearchNoResultDaily_termNormalized_idx" ON "SearchNoResultDaily"("termNormalized");

CREATE TABLE "SearchNoResultSeen" (
    "termNormalized" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "h" TEXT NOT NULL,

    CONSTRAINT "SearchNoResultSeen_pkey" PRIMARY KEY ("termNormalized","day","h")
);

CREATE TABLE "MarketingWeeklyDigest" (
    "weekStart" DATE NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "MarketingWeeklyDigest_pkey" PRIMARY KEY ("weekStart","recipientKey")
);
