-- M-68 = `M-GAS-1` — control del gasto en guías: el libro de intentos, el libro de guías pagadas, los avisos al dueño y la
-- marca del dueño. Norma: API_CONTRACT §M4-SHIP.19.29.2 (v1.80.12.9) AMPLIADA por §19.30.1, §19.30.2 (5) y §19.30.6
-- (v1.80.12.10: `User.isOwner` + índice parcial + CHECK + marca condicionada, `SpendOwnerWatch`, `SpendAlert.muted`,
-- `ShipmentPaidLabel.autoCancelIntentAt` + CHECK + índice, AG-21/AG-22 en `SpendAlertKind`); diales de §19.29.8.
-- ARCHITECTURE §4.60 (v)…(w). Número asignado por el orquestador; confirmado contra `migrations/` (última previa:
-- `20261008120000_m67_sdx_e_folio`, que esta migración necesita delante: el token del intento lleva el folio).
-- Notas: BACKEND_NOTES §62.
--
-- DDL ADITIVO E IDEMPOTENTE (aplicarla dos veces no cambia nada): enums con `duplicate_object`, `CREATE TABLE/INDEX IF NOT
-- EXISTS`, `ADD COLUMN IF NOT EXISTS`, constraints en bloques sobre `pg_constraint`, seeds con `ON CONFLICT DO NOTHING`, la
-- marca del dueño solo con EXACTAMENTE un candidato y nunca pisa una marca existente.
-- ⛔ SIN BACKFILL de dinero: la cuenta de Skydropx nunca compró (§19.27.1, PROD:285) ⇒ los libros nacen vacíos.
--
-- 💰 El saldo bajo (`skydropx_low_balance_cents` 50000 → 100000, `HECHOS.md:62`): medido el 2026-10-04 con
-- `git log origin/production -- backend/prisma/migrations/20261007120000_m66_sdx_d_skydropx` ⇒ VACÍO (M-66 no está en
-- `production`) ⇒ por §19.29.2 se corrige la línea de M-66 (ya siembra 100000) y ⛔ NADA aquí.
--
-- 🔒 LA MARCA DEL DUEÑO (§19.30.1 (1), C-20). `HECHOS.md` fila «El dueño: una sola cuenta de administrador total» (2026-10-04,
-- «Solo la mía»): con exactamente un súper-admin activo con correo, esta migración lo marca sola. Con 0 o con más de uno
-- ⛔ NO marca a nadie (nunca «el más antiguo»): lo decide el dueño con `prisma/set-owner.ts`, y el arranque de
-- `spend-alerts` registra `NO_OWNER_ACCOUNT`. Precondición de despliegue: la medición C-20 (a) por SQL en la ventana.
-- Si ya hay una cuenta marcada (segunda aplicación, o `set-owner.ts` corrió antes) ⇒ no se toca.
--
-- REVERSA (código revertido antes; ⛔ con intentos o guías pagadas registrados los libros son REGISTRO DE DINERO GASTADO:
-- solo mientras `SELECT (SELECT count(*) FROM "ShipmentLabelAttempt") + (SELECT count(*) FROM "ShipmentPaidLabel")` = 0;
-- si no, rollback de código conservando tablas, como M-66):
--   DELETE FROM "ConfigSetting" WHERE key IN ('operator_label_cap_24h_cents','shipping_label_reissue_max_per_shipment',
--     'spend_alerts_disabled','spend_alert_label_cap_warn_pct','spend_alert_shipment_cancel_count',
--     'spend_alert_person_cancel_count_24h','spend_alert_charge_drift_immediate_cents',
--     'spend_alert_extra_charge_immediate_cents','spend_alert_cancel_refund_days','spend_alert_label_not_shipped_days')
--     AND "updatedBy" = 'migration:m68-gas';   -- solo lo que esta migración sembró y nadie tocó (§11.0)
--   DROP TABLE IF EXISTS "SpendOwnerWatch";
--   DROP TABLE IF EXISTS "SpendDigestRun";
--   DROP TABLE IF EXISTS "SpendAlert";
--   DROP TABLE IF EXISTS "ShipmentPaidLabel";
--   DROP TABLE IF EXISTS "ShipmentLabelAttempt";
--   DROP INDEX IF EXISTS "user_single_owner";
--   ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_owner_shape";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "isOwner";   -- ⚠️ pierde QUIÉN es el dueño (se vuelve a marcar con set-owner.ts)
--   DROP TYPE IF EXISTS "SpendAlertMailStatus";
--   DROP TYPE IF EXISTS "SpendAlertSeverity";
--   DROP TYPE IF EXISTS "SpendAlertKind";
--   DROP TYPE IF EXISTS "LabelCancelKind";
--   DROP TYPE IF EXISTS "PaidLabelOrigin";
--   DROP TYPE IF EXISTS "LabelAttemptOutcome";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261009120000_m68_gas_1_spend_control';

-- =============================================== enums ===============================================
DO $$
BEGIN
  BEGIN
    CREATE TYPE "LabelAttemptOutcome" AS ENUM ('pending', 'labeled', 'not_charged', 'released_unverified');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "PaidLabelOrigin" AS ENUM ('response', 'adopted', 'orphan', 'duplicate');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "LabelCancelKind" AS ENUM ('reissue', 'auto_close', 'orphan_auto', 'orphan_manual');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "SpendAlertKind" AS ENUM (
      'label_after_address_fix', 'label_cap_warning', 'label_cap_blocked', 'label_reissue_loop', 'label_charge_drift',
      'carrier_extra_charge', 'provider_balance_low', 'cancel_refund_missing', 'label_charged_unexplained',
      'label_not_shipped', 'parcel_returned', 'parcel_problem', 'label_costly_choice', 'operator_refund_cap',
      'super_admin_money_out', 'shrinkage', 'chargeback', 'buylist_manual_price', 'psa_credits', 'stuck_refund',
      'owner_account_changed', 'staff_control_by_non_owner');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "SpendAlertSeverity" AS ENUM ('immediate', 'digest');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "SpendAlertMailStatus" AS ENUM ('not_applicable', 'pending', 'sending', 'sent', 'batched', 'batch_sent',
      'failed', 'failed_unknown', 'no_recipient');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- =============================================== User.isOwner (§19.30.1) ===============================================
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;

-- Cardinalidad ≤ 1 EN LA BASE (índice parcial; Prisma no lo expresa: se declara en el comentario del modelo).
CREATE UNIQUE INDEX IF NOT EXISTS "user_single_owner" ON "User" ("isOwner") WHERE "isOwner";

-- =============================================== tablas ===============================================
CREATE TABLE IF NOT EXISTS "ShipmentLabelAttempt" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "capExempt" BOOLEAN NOT NULL,
    "rateId" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "expectedChargeCents" INTEGER NOT NULL,
    "recommendedPriceCents" INTEGER,
    "marginCents" INTEGER NOT NULL,
    "attemptNo" INTEGER,
    "providerReference" TEXT,
    "sentAt" TIMESTAMP(3),
    "outcome" "LabelAttemptOutcome" NOT NULL DEFAULT 'pending',
    "outcomeReason" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentLabelAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShipmentPaidLabel" (
    "id" TEXT NOT NULL,
    "providerShipmentId" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "attemptId" TEXT,
    "origin" "PaidLabelOrigin" NOT NULL,
    "chargedCents" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelKind" "LabelCancelKind",
    "cancelledByUserId" TEXT,
    "unrefundedCents" INTEGER,
    "refundAlertedAt" TIMESTAMP(3),
    "autoCancelIntentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentPaidLabel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SpendAlert" (
    "id" TEXT NOT NULL,
    "kind" "SpendAlertKind" NOT NULL,
    "severity" "SpendAlertSeverity" NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "subjectUserId" TEXT,
    "shipmentRequestId" TEXT,
    "orderId" TEXT,
    "amountCents" INTEGER,
    "facts" JSONB NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOccurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "seenByUserId" TEXT,
    "mailStatus" "SpendAlertMailStatus" NOT NULL,
    "mailedAt" TIMESTAMP(3),
    "mailAttempts" INTEGER NOT NULL DEFAULT 0,
    "batchHour" TIMESTAMP(3),
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SpendAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SpendDigestRun" (
    "day" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "alertCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SpendDigestRun_pkey" PRIMARY KEY ("day")
);

CREATE TABLE IF NOT EXISTS "SpendOwnerWatch" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ownerUserId" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpendOwnerWatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentLabelAttempt_providerReference_key" ON "ShipmentLabelAttempt"("providerReference");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentLabelAttempt_shipmentRequestId_since_key" ON "ShipmentLabelAttempt"("shipmentRequestId", "since");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentLabelAttempt_shipmentRequestId_attemptNo_key" ON "ShipmentLabelAttempt"("shipmentRequestId", "attemptNo");
CREATE INDEX IF NOT EXISTS "ShipmentLabelAttempt_actorUserId_since_idx" ON "ShipmentLabelAttempt"("actorUserId", "since");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentPaidLabel_providerShipmentId_key" ON "ShipmentPaidLabel"("providerShipmentId");
CREATE INDEX IF NOT EXISTS "ShipmentPaidLabel_shipmentRequestId_idx" ON "ShipmentPaidLabel"("shipmentRequestId");
CREATE INDEX IF NOT EXISTS "ShipmentPaidLabel_cancelledByUserId_cancelledAt_idx" ON "ShipmentPaidLabel"("cancelledByUserId", "cancelledAt");
CREATE INDEX IF NOT EXISTS "ShipmentPaidLabel_autoCancelIntentAt_idx" ON "ShipmentPaidLabel"("autoCancelIntentAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SpendAlert_dedupKey_key" ON "SpendAlert"("dedupKey");
CREATE INDEX IF NOT EXISTS "SpendAlert_firstOccurredAt_idx" ON "SpendAlert"("firstOccurredAt");
CREATE INDEX IF NOT EXISTS "SpendAlert_severity_seenAt_idx" ON "SpendAlert"("severity", "seenAt");
CREATE INDEX IF NOT EXISTS "SpendAlert_kind_firstOccurredAt_idx" ON "SpendAlert"("kind", "firstOccurredAt");
CREATE INDEX IF NOT EXISTS "SpendAlert_subjectUserId_firstOccurredAt_idx" ON "SpendAlert"("subjectUserId", "firstOccurredAt");
CREATE INDEX IF NOT EXISTS "SpendAlert_mailStatus_batchHour_idx" ON "SpendAlert"("mailStatus", "batchHour");

-- =============================================== FK + CHECKs ===============================================
DO $$
BEGIN
  -- Libros de dinero: RESTRICT (un intento o una guía pagada no se borra con su envío).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentLabelAttempt_shipmentRequestId_fkey') THEN
    ALTER TABLE "ShipmentLabelAttempt" ADD CONSTRAINT "ShipmentLabelAttempt_shipmentRequestId_fkey"
      FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentPaidLabel_attemptId_fkey') THEN
    ALTER TABLE "ShipmentPaidLabel" ADD CONSTRAINT "ShipmentPaidLabel_attemptId_fkey"
      FOREIGN KEY ("attemptId") REFERENCES "ShipmentLabelAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- User (§19.30.1 (1)): respaldo de las guardas de §19.30.2 — la marca solo en un súper-admin con correo, no borrado.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_owner_shape') THEN
    ALTER TABLE "User" ADD CONSTRAINT "user_owner_shape"
      CHECK (NOT "isOwner" OR ("role" = 'super_admin' AND "email" IS NOT NULL AND "deletedAt" IS NULL AND "status" <> 'deleted'));
  END IF;

  -- ShipmentLabelAttempt (§19.29.2)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'label_attempt_expected_charge_nonneg') THEN
    ALTER TABLE "ShipmentLabelAttempt" ADD CONSTRAINT "label_attempt_expected_charge_nonneg" CHECK ("expectedChargeCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'label_attempt_no_range') THEN
    ALTER TABLE "ShipmentLabelAttempt" ADD CONSTRAINT "label_attempt_no_range" CHECK ("attemptNo" IS NULL OR ("attemptNo" BETWEEN 1 AND 99));
  END IF;
  -- `(sentAt IS NULL) = (providerReference IS NULL) = (attemptNo IS NULL)`: el 7b.2 escribe los tres juntos (C-17/C-18).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'label_attempt_sent_triplet') THEN
    ALTER TABLE "ShipmentLabelAttempt" ADD CONSTRAINT "label_attempt_sent_triplet"
      CHECK ((("sentAt" IS NULL) = ("providerReference" IS NULL)) AND (("providerReference" IS NULL) = ("attemptNo" IS NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'label_attempt_pending_without_outcome_at') THEN
    ALTER TABLE "ShipmentLabelAttempt" ADD CONSTRAINT "label_attempt_pending_without_outcome_at"
      CHECK ("outcome" <> 'pending' OR "outcomeAt" IS NULL);
  END IF;

  -- ShipmentPaidLabel (§19.29.2 + §19.30.6)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paid_label_charged_nonneg') THEN
    ALTER TABLE "ShipmentPaidLabel" ADD CONSTRAINT "paid_label_charged_nonneg" CHECK ("chargedCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paid_label_unrefunded_nonneg') THEN
    ALTER TABLE "ShipmentPaidLabel" ADD CONSTRAINT "paid_label_unrefunded_nonneg" CHECK ("unrefundedCents" IS NULL OR "unrefundedCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paid_label_cancel_paired') THEN
    ALTER TABLE "ShipmentPaidLabel" ADD CONSTRAINT "paid_label_cancel_paired" CHECK (("cancelledAt" IS NULL) = ("cancelKind" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paid_label_reissue_has_actor') THEN
    ALTER TABLE "ShipmentPaidLabel" ADD CONSTRAINT "paid_label_reissue_has_actor"
      CHECK ("cancelKind" IS DISTINCT FROM 'reissue' OR "cancelledByUserId" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paid_label_auto_cancel_intent_orphans_only') THEN
    ALTER TABLE "ShipmentPaidLabel" ADD CONSTRAINT "paid_label_auto_cancel_intent_orphans_only"
      CHECK ("autoCancelIntentAt" IS NULL OR "origin" IN ('orphan', 'duplicate'));
  END IF;

  -- SpendAlert (§19.29.2)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spend_alert_occurrence_min_1') THEN
    ALTER TABLE "SpendAlert" ADD CONSTRAINT "spend_alert_occurrence_min_1" CHECK ("occurrenceCount" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spend_alert_seen_paired') THEN
    ALTER TABLE "SpendAlert" ADD CONSTRAINT "spend_alert_seen_paired" CHECK (("seenAt" IS NULL) = ("seenByUserId" IS NULL));
  END IF;

  -- SpendOwnerWatch: una sola fila (§19.30.1 (5)).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spend_owner_watch_single_row') THEN
    ALTER TABLE "SpendOwnerWatch" ADD CONSTRAINT "spend_owner_watch_single_row" CHECK ("id" = 1);
  END IF;
END $$;

-- =============================================== la marca inicial del dueño (§19.30.1 (1)) ===============================================
-- EXACTAMENTE un candidato ⇒ se marca; 0 o > 1 ⇒ nadie. Y solo si NADIE está marcado ya (idempotente; no pisa set-owner.ts).
UPDATE "User" SET "isOwner" = true
 WHERE id = (SELECT id FROM "User" WHERE role = 'super_admin' AND email IS NOT NULL AND status = 'active' AND "deletedAt" IS NULL)
   AND (SELECT count(*) FROM "User" WHERE role = 'super_admin' AND email IS NOT NULL AND status = 'active' AND "deletedAt" IS NULL) = 1
   AND NOT EXISTS (SELECT 1 FROM "User" WHERE "isOwner");

-- =============================================== diales (§19.29.8; regla §11.0 ≡ upsert update:{}) ===============================================
-- Los valores son EXACTAMENTE `SETTING_DEFAULTS` (candado: `test/sdx-d.dials.spec.ts`). `HECHOS.md:62` («Acepto todos»):
-- tope MX$2,500 por persona en 24 h; una recompra por pedido; cargo extra > MX$150; aviso de guía sin salir en 3 días.
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('operator_label_cap_24h_cents', '250000'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('shipping_label_reissue_max_per_shipment', '1'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alerts_disabled', '[]'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_label_cap_warn_pct', '80'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_shipment_cancel_count', '2'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_person_cancel_count_24h', '3'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_charge_drift_immediate_cents', '2000'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_extra_charge_immediate_cents', '15000'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_cancel_refund_days', '3'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP),
       ('spend_alert_label_not_shipped_days', '3'::jsonb, 'migration:m68-gas', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
