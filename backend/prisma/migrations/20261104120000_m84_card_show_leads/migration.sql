-- M-84 (v1.96⟨cardshow-leads⟩) — pivote del Card Show a captura de LEADS (PII · SIN DINERO).
-- Contrato: docs/API_CONTRACT.md §CARDSHOW.1/.1a/.1a-bis/.1b/.12 / Diseño: docs/ARCHITECTURE.md §4.CARDSHOW.p
--
-- DDL ADITIVO Y SEGURO: 1 enum nuevo + columnas nuevas en 2 tablas del Card Show + índice único parcial
-- RECREADO. ⛔ CERO cambios en Order, User, dinero, inventario. ⛔ `mesaInteres` NO se dropea (drop diferido,
-- §CARDSHOW.1a-bis). Patrón de §11 para las columnas NOT NULL sobre tablas con posibles filas productivas:
-- ADD COLUMN con DEFAULT transitorio → (no hay backfill de valor real: las filas M-78 ya son del torneo
-- Pokémon y `name` legado = '') → DROP DEFAULT, para que la app lo exija desde el alta.

-- ============================================ ENUM nuevo ============================================
CREATE TYPE "CardShowGame" AS ENUM ('pokemon', 'riftbound', 'lorcana');

-- ============================================ CardShowLead (columnas nuevas) ============================================
-- `name` NOT NULL sobre tabla con posibles filas productivas (§CARDSHOW.1a): DEFAULT '' transitorio →
-- backfill de las filas existentes → DROP DEFAULT (⛔ nunca ADD COLUMN NOT NULL sin default sobre dato real).
ALTER TABLE "CardShowLead" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
UPDATE "CardShowLead" SET "name" = '' WHERE "name" = '';
ALTER TABLE "CardShowLead" ALTER COLUMN "name" DROP DEFAULT;

-- Nullables sin default ⇒ seguros sobre filas existentes.
ALTER TABLE "CardShowLead" ADD COLUMN "phone" TEXT;
ALTER TABLE "CardShowLead" ADD COLUMN "gameInterest" "CardShowGame";
ALTER TABLE "CardShowLead" ADD COLUMN "raffleTermsVersion" TEXT;
ALTER TABLE "CardShowLead" ADD COLUMN "sellsWhat" TEXT;

-- NOT NULL con default `false` ⇒ seguro sobre filas existentes.
ALTER TABLE "CardShowLead" ADD COLUMN "raffleOptIn" BOOLEAN NOT NULL DEFAULT false;

-- ============================================ CardShowPlayerSignup (game + playerId nullable) ============================================
-- `playerId` pasa a NULLABLE (las filas LIGERA no lo tienen).
ALTER TABLE "CardShowPlayerSignup" ALTER COLUMN "playerId" DROP NOT NULL;

-- `game` NOT NULL sobre posibles filas productivas: DEFAULT 'pokemon' transitorio (toda fila M-78 es del torneo
-- formal Pokémon, con playerId) → DROP DEFAULT. Patrón §11.
ALTER TABLE "CardShowPlayerSignup" ADD COLUMN "game" "CardShowGame" NOT NULL DEFAULT 'pokemon';
ALTER TABLE "CardShowPlayerSignup" ALTER COLUMN "game" DROP DEFAULT;

CREATE INDEX "CardShowPlayerSignup_mailboxHmac_game_day_idx" ON "CardShowPlayerSignup"("mailboxHmac", "game", "day");

-- L0-SEG-02 — índice único PARCIAL RECREADO (§CARDSHOW.12): reemplaza el de M-78 acotándolo a Pokémon. Las filas
-- LIGERA (game≠pokemon, playerId NULL) ⛔ NO entran a la unicidad por playerId. ⛔ No expresable en el DSL de Prisma.
DROP INDEX IF EXISTS "card_show_signup_player_day_active";
CREATE UNIQUE INDEX "card_show_signup_player_day_active"
  ON "CardShowPlayerSignup" ("playerId", "day")
  WHERE status IN ('confirmed', 'waitlist', 'checked_in')
    AND game = 'pokemon' AND "playerId" IS NOT NULL;

-- ============================================ REVERSA (documentada, NO automática) ============================================
-- Primero apagar el código (la app deja de escribir los campos nuevos), luego:
-- REVERSA:BEGIN
-- DROP INDEX IF EXISTS "card_show_signup_player_day_active";
-- CREATE UNIQUE INDEX "card_show_signup_player_day_active"
--   ON "CardShowPlayerSignup" ("playerId", "day")
--   WHERE status IN ('confirmed', 'waitlist', 'checked_in');
-- DROP INDEX IF EXISTS "CardShowPlayerSignup_mailboxHmac_game_day_idx";
-- ALTER TABLE "CardShowPlayerSignup" DROP COLUMN "game";
-- -- (playerId vuelve a NOT NULL solo si no hay filas LIGERA con NULL)
-- ALTER TABLE "CardShowPlayerSignup" ALTER COLUMN "playerId" SET NOT NULL;
-- ALTER TABLE "CardShowLead" DROP COLUMN "raffleOptIn";
-- ALTER TABLE "CardShowLead" DROP COLUMN "sellsWhat";
-- ALTER TABLE "CardShowLead" DROP COLUMN "raffleTermsVersion";
-- ALTER TABLE "CardShowLead" DROP COLUMN "gameInterest";
-- ALTER TABLE "CardShowLead" DROP COLUMN "phone";
-- ALTER TABLE "CardShowLead" DROP COLUMN "name";
-- DROP TYPE IF EXISTS "CardShowGame";
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104120000_m84_card_show_leads';
-- REVERSA:END
