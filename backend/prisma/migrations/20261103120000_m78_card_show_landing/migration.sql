-- M-78 (v1.93⟨cardshow⟩) — landing del Card Show: captura pública, doble opt-in y anti-abuso.
-- Contrato: docs/API_CONTRACT.md §CARDSHOW.1 / Diseño: docs/ARCHITECTURE.md §4.CARDSHOW.k
--
-- DDL ADITIVO Y SEGURO: 3 tablas nuevas + 5 enums nuevos. ⛔ CERO columnas sobre tablas existentes,
-- ⛔ CERO relleno (backfill), ⛔ ninguna reescritura de CHECK. No toca Order, User, dinero ni inventario.
-- Las tablas nacen vacías. La advertencia de §11 (ADD COLUMN NOT NULL sin backfill) NO aplica: no se
-- añade ninguna columna a ninguna tabla existente.
--
-- ⚠️ El índice único PARCIAL `(playerId, day) WHERE status IN (...)` (L0-SEG-02) va LITERAL aquí: el
-- DSL de Prisma no expresa índices parciales, así que `prisma migrate diff` no lo generaría. Es la
-- pieza que impide que una preinscripción PENDING/CANCELLED bloquee el cupo de otro, pero que SÍ
-- garantiza una sola fila activa (confirmed|waitlist|checked_in) por (playerId, day).

-- ============================================ ENUMS ============================================
CREATE TYPE "CardShowLeadType" AS ENUM ('merchant', 'sponsor', 'visitor');
CREATE TYPE "CardShowLeadStatus" AS ENUM ('pending', 'new', 'contacted', 'closed', 'discarded');
CREATE TYPE "CardShowLeadSource" AS ENUM ('cta_hero', 'cta_mesas', 'cta_patrocinio', 'header');
CREATE TYPE "CardShowDay" AS ENUM ('sat', 'sun');
CREATE TYPE "CardShowSignupStatus" AS ENUM ('pending', 'confirmed', 'waitlist', 'cancelled', 'checked_in');

-- ============================================ CardShowLead ============================================
CREATE TABLE "CardShowLead" (
    "id" TEXT NOT NULL,
    "type" "CardShowLeadType" NOT NULL,
    "email" TEXT NOT NULL,
    "mailboxHmac" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmationHeldAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "suppressedUntil" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "referrerHost" TEXT,
    "mesaInteres" INTEGER,
    "source" "CardShowLeadSource" NOT NULL,
    "status" "CardShowLeadStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardShowLead_pkey" PRIMARY KEY ("id")
);

-- un correo puede ser lead de >1 tipo (fila por tipo)
CREATE UNIQUE INDEX "CardShowLead_email_type_key" ON "CardShowLead"("email", "type");
CREATE INDEX "CardShowLead_mailboxHmac_idx" ON "CardShowLead"("mailboxHmac");
CREATE INDEX "CardShowLead_status_idx" ON "CardShowLead"("status");
CREATE INDEX "CardShowLead_confirmationHeldAt_idx" ON "CardShowLead"("confirmationHeldAt");
CREATE INDEX "CardShowLead_suppressedUntil_idx" ON "CardShowLead"("suppressedUntil");

-- ============================================ CardShowPlayerSignup ============================================
CREATE TABLE "CardShowPlayerSignup" (
    "id" TEXT NOT NULL,
    "day" "CardShowDay" NOT NULL,
    "playerName" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mailboxHmac" TEXT NOT NULL,
    "isMinor" BOOLEAN NOT NULL,
    "guardianConsentAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3) NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "status" "CardShowSignupStatus" NOT NULL DEFAULT 'pending',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardShowPlayerSignup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CardShowPlayerSignup_mailboxHmac_day_idx" ON "CardShowPlayerSignup"("mailboxHmac", "day");
CREATE INDEX "CardShowPlayerSignup_status_idx" ON "CardShowPlayerSignup"("status");

-- L0-SEG-02 — índice único PARCIAL: SOLO una fila ACTIVA por (playerId, day). Las PENDING/CANCELLED
-- coexisten (varias personas pueden tener un alta PENDING del mismo Player ID/día), pero solo una
-- llega a activa. El cupo se asigna AL CONFIRMAR, por orden. ⛔ No expresable en el DSL de Prisma.
CREATE UNIQUE INDEX "card_show_signup_player_day_active"
  ON "CardShowPlayerSignup" ("playerId", "day")
  WHERE status IN ('confirmed', 'waitlist', 'checked_in');

-- ============================================ CardShowClick ============================================
CREATE TABLE "CardShowClick" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "destino" TEXT NOT NULL,
    "mesa" INTEGER,
    "utmSource" TEXT,
    "utmContent" TEXT,

    CONSTRAINT "CardShowClick_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CardShowClick_ts_idx" ON "CardShowClick"("ts");
CREATE INDEX "CardShowClick_destino_idx" ON "CardShowClick"("destino");

-- ============================================ REVERSA (documentada, NO automática) ============================================
-- Primero el código (apagar la landing), luego el DROP. No borra nada de la tienda (3 tablas aisladas).
-- REVERSA:BEGIN
-- DROP TABLE IF EXISTS "CardShowClick";
-- DROP TABLE IF EXISTS "CardShowPlayerSignup";
-- DROP TABLE IF EXISTS "CardShowLead";
-- DROP TYPE IF EXISTS "CardShowSignupStatus";
-- DROP TYPE IF EXISTS "CardShowDay";
-- DROP TYPE IF EXISTS "CardShowLeadSource";
-- DROP TYPE IF EXISTS "CardShowLeadStatus";
-- DROP TYPE IF EXISTS "CardShowLeadType";
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261103120000_m78_card_show_landing';
-- REVERSA:END
