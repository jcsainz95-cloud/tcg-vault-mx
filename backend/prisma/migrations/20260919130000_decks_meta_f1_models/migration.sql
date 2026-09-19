-- DECKS-META §3.1 (Fase 1) — MODELOS del módulo `decks-meta` (DECKS_META_ARCH.md §3.1 /
-- ARCHITECTURE §12.2). Diseño: DECK (arquetipo persistente) vs LISTA (inmutable). Se apoya en la
-- legalidad de Fase 0 (columnas `Card.regulationMark`/`legalStandardRaw` + config), YA migrada.
--
-- ADITIVA PURA Y SEGURA CON LA APP CORRIENDO: crea TIPOS y TABLAS NUEVAS, más UN índice sobre la
-- tabla nueva `MetaDeckCard.matchedCardId` y su FK a `Card`. NO altera ninguna tabla existente salvo
-- ese FK entrante (una tabla nueva que referencia a `Card`; `Card` no cambia de forma). SIN `DROP`,
-- SIN `UPDATE`/`DELETE`/`TRUNCATE`, SIN tocar precios/órdenes/inventario. Ningún importe puede
-- moverse por esta migración (no toca dinero; sólo crea contenedores vacíos).
--
-- MONEY-SAFE POR CONSTRUCCIÓN: estos modelos NO guardan precio ni disponibilidad (se calculan al
-- render reusando pricing/catalog) y la legalidad NO se persiste (se deriva). `matchedCardId` es
-- nullable: una línea que no casa por `ptcgoCode`+`número` queda con `matchedCardId = NULL` y su
-- `matchStatus` no-mapeado — NUNCA se inventa una carta.
--
-- ROLLBACK (limpio, sin pérdida — no transforma ni borra datos de `Card`/inventario/precio):
--   DROP TABLE "MetaFetchRun";
--   DROP TABLE "MetaDeckCard";
--   ALTER TABLE "MetaDeck" DROP CONSTRAINT "MetaDeck_currentListId_fkey";
--   DROP TABLE "MetaDeckList";
--   DROP TABLE "MetaDeck";
--   DROP TYPE "MetaMatchStatus";
--   DROP TYPE "MetaCardGroup";
--   DROP TYPE "MetaDeckSource";
-- (El feature-flag del módulo se apaga en el mismo deploy; nada más en el sistema referencia estas
--  tablas ni tipos, así que dropearlos revierte la Fase 1 sin efecto colateral.)

-- ── TIPOS (enums) ────────────────────────────────────────────────────────────────────────────────
CREATE TYPE "MetaDeckSource" AS ENUM ('limitless', 'manual');
CREATE TYPE "MetaCardGroup" AS ENUM ('pokemon', 'trainer', 'energy');
CREATE TYPE "MetaMatchStatus" AS ENUM ('matched', 'ambiguous', 'unmatched_set', 'unmatched_number', 'unmatched_basic_energy');

-- ── MetaDeck: arquetipo persistente ───────────────────────────────────────────────────────────────
CREATE TABLE "MetaDeck" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "MetaDeckSource" NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "rank" INTEGER,
    "sharePct" DOUBLE PRECISION,
    "trend" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "pausedByOperator" BOOLEAN NOT NULL DEFAULT false,
    "currentListId" TEXT,
    "imageCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaDeck_pkey" PRIMARY KEY ("id")
);

-- ── MetaDeckList: lista INMUTABLE con fecha y fuente ───────────────────────────────────────────────
CREATE TABLE "MetaDeckList" (
    "id" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "formatLabel" TEXT NOT NULL,
    "activeMarksSnapshot" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "sourceTournament" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededById" TEXT,
    CONSTRAINT "MetaDeckList_pkey" PRIMARY KEY ("id")
);

-- ── MetaDeckCard: una línea (crudo set+número+cantidad + resultado del emparejado) ─────────────────
CREATE TABLE "MetaDeckCard" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawSetCode" TEXT NOT NULL,
    "rawNumber" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "group" "MetaCardGroup" NOT NULL,
    "matchStatus" "MetaMatchStatus" NOT NULL DEFAULT 'unmatched_set',
    "matchedCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaDeckCard_pkey" PRIMARY KEY ("id")
);

-- ── MetaFetchRun: provenance + canario del job (Fase 2); curaduría manual en Fase 1 ───────────────
CREATE TABLE "MetaFetchRun" (
    "id" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "MetaDeckSource" NOT NULL,
    "formatVersion" TEXT NOT NULL,
    "deckCount" INTEGER NOT NULL,
    "applied" BOOLEAN NOT NULL,
    "note" TEXT,
    CONSTRAINT "MetaFetchRun_pkey" PRIMARY KEY ("id")
);

-- ── Índices y unicidad ────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "MetaDeck_slug_key" ON "MetaDeck"("slug");
CREATE UNIQUE INDEX "MetaDeck_currentListId_key" ON "MetaDeck"("currentListId");
CREATE INDEX "MetaDeck_published_rank_idx" ON "MetaDeck"("published", "rank");
CREATE INDEX "MetaDeckList_deckId_fetchedAt_idx" ON "MetaDeckList"("deckId", "fetchedAt");
CREATE INDEX "MetaDeckCard_listId_idx" ON "MetaDeckCard"("listId");
CREATE INDEX "MetaDeckCard_matchStatus_idx" ON "MetaDeckCard"("matchStatus");

-- ── Claves foráneas ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE "MetaDeck" ADD CONSTRAINT "MetaDeck_currentListId_fkey" FOREIGN KEY ("currentListId") REFERENCES "MetaDeckList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetaDeckList" ADD CONSTRAINT "MetaDeckList_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "MetaDeck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetaDeckCard" ADD CONSTRAINT "MetaDeckCard_listId_fkey" FOREIGN KEY ("listId") REFERENCES "MetaDeckList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- `matchedCardId` → `Card`: ON DELETE SET NULL — si una carta sale del catálogo, la línea CONSERVA el
-- crudo (rawSetCode/rawNumber) y sólo pierde el vínculo; el matcher la re-evaluará. NUNCA borra la línea.
ALTER TABLE "MetaDeckCard" ADD CONSTRAINT "MetaDeckCard_matchedCardId_fkey" FOREIGN KEY ("matchedCardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
