-- M-75 — v1.91⟨precios⟩ (PRECIOS ROBUSTOS: redundancia multi-fuente, árbitro de mediana y candado
-- anti-inflado · API_CONTRACT §PRE · ARCHITECTURE §4.PRE y §11 «v1.91⟨precios⟩»). Número y carpeta
-- reservados por el orquestador (O-24): posterior a M-74 (`20261027120000_m74_wishlist`).
--
-- DDL ADITIVO: 2 valores nuevos en `PriceSource` + 2 enums nuevos + 1 tabla nueva (`PriceReviewCase`).
-- ⛔ SIN relleno de filas existentes; ⛔ NO toca `PendingPriceReason`, `PriceReference` (su forma),
-- `FxRate` (ya es `base String` libre ⇒ Cardmarket EUR se persiste como filas `base='EUR'`, SIN DDL).
-- Ninguna columna NOT NULL nueva sin DEFAULT sobre tabla existente (norma v1.64 de ARCHITECTURE §11):
-- la única tabla con columnas NOT NULL sin default es NUEVA y nace vacía.
--
-- IDEMPOTENTE: aplicarla dos veces deja la BD idéntica (`IF NOT EXISTS`, `DO $$ … duplicate_object`).
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ PRIMERO se revierte el CÓDIGO, después esto.
-- 0. Comprobación previa:
--      SELECT count(*) FROM "PriceReviewCase";
--    > 0 ⇒ la cola tiene casos; borrar la tabla pierde el detalle de qué se detuvo. Con la app nueva
--    revertida, los casos quedan inertes; se puede conservar la tabla o vaciarla antes de dropearla.
-- 1. Bloque de abajo (quitar el «-- » inicial de cada línea).
--    ⚠️ Un valor de enum NO se puede quitar de `PriceSource` con `ALTER TYPE … DROP VALUE` (Postgres no
--    lo soporta); `tcgdex`/`cardmarket` quedan inertes si nadie los escribe. Las filas `PriceReference`
--    con esos `source` dejan de votar el árbitro (el código viejo no los conoce) — no mueven precio.
-- REVERSA:BEGIN
-- DROP TABLE IF EXISTS "PriceReviewCase";
-- DROP TYPE IF EXISTS "PriceAxis";
-- DROP TYPE IF EXISTS "PriceReviewStatus";
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261028120000_m75_robust_pricing';
-- REVERSA:END
-- ===============================================================================================================================

-- (1) Valores de enum nuevos en `PriceSource` (las dos fuentes que VOTAN el árbitro). ⚠️ NO se usan
--     dentro de esta misma migración (evita el "unsafe use of new value" de Postgres); los escribe el
--     provider de TCGdex en runtime. `pokemontcg_io`/`pokemonpricetracker` NO cambian de rol.
ALTER TYPE "PriceSource" ADD VALUE IF NOT EXISTS 'tcgdex';
ALTER TYPE "PriceSource" ADD VALUE IF NOT EXISTS 'cardmarket';

-- (2) Enums NUEVOS (tipos usables en esta misma transacción, a diferencia de un `ADD VALUE`).
DO $$ BEGIN
  CREATE TYPE "PriceReviewStatus" AS ENUM ('open', 'accepted', 'kept', 'manual', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "PriceAxis" AS ENUM ('sell', 'buy');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- (3) Tabla NUEVA `PriceReviewCase` — cola de revisión del candado anti-inflado (§PRE.D).
CREATE TABLE IF NOT EXISTS "PriceReviewCase" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "gradeKey" TEXT NOT NULL,
    "finish" "Finish" NOT NULL DEFAULT 'normal',
    "cardProductId" TEXT,
    "sealedProductId" TEXT,
    "axis" "PriceAxis" NOT NULL,
    "proposedMxnCents" INTEGER NOT NULL,
    "baselineMxnCents" INTEGER,
    "jumpFactorMilli" INTEGER NOT NULL,
    "sourceCount" INTEGER NOT NULL,
    "familyCount" INTEGER NOT NULL,
    "consensus" BOOLEAN NOT NULL,
    "quotesSnapshot" JSONB NOT NULL,
    "status" "PriceReviewStatus" NOT NULL DEFAULT 'open',
    "resolvedAction" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedPriceRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PriceReviewCase_pkey" PRIMARY KEY ("id")
);

-- Dedupe por `findFirst` (NO índice único, doctrina de la casa, §3.2). Índice por estado para la cola.
CREATE INDEX IF NOT EXISTS "PriceReviewCase_status_idx" ON "PriceReviewCase"("status");

-- FK a Card (integridad; el schema de Prisma NO declara la relación a propósito — el DTO resuelve la
-- carta con un findMany aparte). `ON DELETE CASCADE`: borrar una carta se lleva su cola de revisión.
DO $$ BEGIN
  ALTER TABLE "PriceReviewCase"
    ADD CONSTRAINT "PriceReviewCase_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
