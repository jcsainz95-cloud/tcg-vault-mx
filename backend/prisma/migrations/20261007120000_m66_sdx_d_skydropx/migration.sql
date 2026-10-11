-- M-66 = `M-SDX-D` — fase D de Skydropx: esquema y diales (pieza D2a).
-- Norma: API_CONTRACT §M4-SHIP.19.2 (schema + CHECKs), §19.19.14 (delta v1.80.11), §19.20.1/.2 (v1.80.12:
-- `ShipmentQuote.addressVersion`, `ShipmentRequest.providerCancelConfirmedAt`), §19.19.6 (empaques) y §19.19.12 (diales);
-- ARCHITECTURE §4.60, §11 «v1.81-skydropx». Número asignado por el orquestador; confirmado contra `migrations/` (última
-- previa: `20261006130000_m65_sdx_c2_address_revision`). Notas: BACKEND_NOTES §61.
--
-- DDL ADITIVO, SIN BACKFILL, IDEMPOTENTE (aplicarla dos veces no cambia nada):
--   · 4 enums (`ShipmentLabelSource`, `CarrierStatus`, `ShippingIvaSource`, `ShipmentCostAdjustmentKind`);
--   · `ShipmentRequest` + 27 columnas NULLABLE (salvo `insuranceCostCents INT NOT NULL DEFAULT 0`) + 3 índices + 11 CHECK;
--   · tablas `ShipmentQuote`, `ShipmentCarrierEvent`, `ShipmentCostAdjustment`, `ShippingPackage` con sus CHECK;
--   · seeds (`ON CONFLICT DO NOTHING` = la regla §11.0 `upsert … update:{}`): dos `ShippingPackage` y los 12 diales de
--     §19.19.12 con `shipping_provider='off'` y `shipping_label_purchase='disabled'` (FAIL-CLOSED).
--
-- SIN BACKFILL: las filas existentes de `ShipmentRequest` nacen con todo NULL/0 ⇒ todos los CHECK se cumplen. Una fila con
-- `trackingNumber` y `labelSource` NULL es una guía manual anterior a v1.81 y la LEE `labelSourceOf` (§19.2); ⛔ ningún
-- UPDATE afirma lo que nadie capturó. ⛔ CERO DINERO movido: ninguna fila existente cambia de valor.
--
-- ⚠️ DOS CHECK de §19.2 se escriben con la forma que permite el propio algoritmo del contrato (preguntas al arquitecto
-- en BACKEND_NOTES §61.6): (1) «guía en proceso sin número» es `labelProcessingSince ⇒ trackingNumber IS NULL`, SIN
-- exigir `providerShipmentId` (el reclamo de §19.7 paso 7 escribe `labelProcessingSince` sin id: «compra en vuelo»,
-- §19.20.2, PS-104 fila D2a); (2) el CHECK «con id ⇒ datos de compra» NO exige `recommendedRateJson` (§19.7 paso 7 lo
-- escribe `?? null`). Ambos fallan del lado seguro: nunca impiden persistir el id de una guía PAGADA.
--
-- REVERSA (código revertido antes; ⛔ SOLO mientras `SELECT count(*) FROM "ShipmentRequest" WHERE "providerShipmentId" IS
-- NOT NULL` = 0 — con guías compradas NO se borra: registro de dinero gastado y de PII enviada; rollback de código
-- conservando columnas y `shipping_provider='off'` como kill switch, ARCHITECTURE §11):
--   DELETE FROM "ConfigSetting" WHERE key IN ('shipping_provider','shipping_label_purchase',
--     'skydropx_origin_address_template_id','skydropx_origin_snapshot','shipping_preferred_carriers',
--     'shipping_dropoff_points','shipping_consignment_note','shipping_package_rule_box_min_cards',
--     'skydropx_low_balance_cents','shipping_tracking_poll_minutes','shipping_insurance_tiers','shipping_label_format')
--     AND "updatedBy" = 'migration:m66-sdx-d';
--     -- solo las filas que ESTA migración escribió y nadie tocó (§11.0: no se destruye config de un operador); las que
--     -- el súper-admin editó quedan como claves inertes (el código revertido no las lee; la bitácora tiene el antes/después)
--   DROP TABLE IF EXISTS "ShippingPackage";
--   DROP TABLE IF EXISTS "ShipmentCostAdjustment";
--   DROP TABLE IF EXISTS "ShipmentCarrierEvent";
--   DROP TABLE IF EXISTS "ShipmentQuote";
--   ALTER TABLE "ShipmentRequest"
--     DROP CONSTRAINT IF EXISTS "shipment_label_source_iff_provider_id",
--     DROP CONSTRAINT IF EXISTS "shipment_provider_id_requires_purchase",
--     DROP CONSTRAINT IF EXISTS "shipment_rate_chosen_paired",
--     DROP CONSTRAINT IF EXISTS "shipment_label_processing_without_tracking",
--     DROP CONSTRAINT IF EXISTS "shipment_carrier_status_requires_provider",
--     DROP CONSTRAINT IF EXISTS "shipment_carrier_status_paired",
--     DROP CONSTRAINT IF EXISTS "shipment_insurance_cost_nonneg",
--     DROP CONSTRAINT IF EXISTS "shipment_declared_value_nonneg",
--     DROP CONSTRAINT IF EXISTS "shipment_insured_value_within_declared",
--     DROP CONSTRAINT IF EXISTS "shipment_delivered_notice_skydropx_only",
--     DROP CONSTRAINT IF EXISTS "shipment_provider_cancel_paired",
--     DROP CONSTRAINT IF EXISTS "shipment_provider_cancel_confirmed_requires_canceled";
--   DROP INDEX IF EXISTS "ShipmentRequest_providerShipmentId_key";
--   DROP INDEX IF EXISTS "ShipmentRequest_providerShipmentId_idx";
--   DROP INDEX IF EXISTS "ShipmentRequest_status_labelSource_carrierPolledAt_idx";
--   DROP INDEX IF EXISTS "ShipmentRequest_labelProcessingSince_idx";
--   ALTER TABLE "ShipmentRequest" DROP COLUMN IF EXISTS "labelSource", DROP COLUMN IF EXISTS "providerShipmentId",
--     DROP COLUMN IF EXISTS "providerQuotationId", DROP COLUMN IF EXISTS "providerRateId",
--     DROP COLUMN IF EXISTS "chosenRateJson", DROP COLUMN IF EXISTS "recommendedRateJson",
--     DROP COLUMN IF EXISTS "rateChosenByUserId", DROP COLUMN IF EXISTS "rateChosenAt",
--     DROP COLUMN IF EXISTS "labelPurchasedAt", DROP COLUMN IF EXISTS "labelUrl", DROP COLUMN IF EXISTS "trackingUrl",
--     DROP COLUMN IF EXISTS "packageCode", DROP COLUMN IF EXISTS "packageDimsJson",
--     DROP COLUMN IF EXISTS "declaredValueCents", DROP COLUMN IF EXISTS "insuredValueCents",
--     DROP COLUMN IF EXISTS "insuranceCostCents", DROP COLUMN IF EXISTS "shippingIvaSource",
--     DROP COLUMN IF EXISTS "carrierStatus", DROP COLUMN IF EXISTS "carrierStatusAt",
--     DROP COLUMN IF EXISTS "carrierPolledAt", DROP COLUMN IF EXISTS "labelProcessingSince",
--     DROP COLUMN IF EXISTS "branchNoticeSentAt", DROP COLUMN IF EXISTS "deliveredNoticeSentAt",
--     DROP COLUMN IF EXISTS "lastDeliveryAttemptAt", DROP COLUMN IF EXISTS "providerCanceledAt",
--     DROP COLUMN IF EXISTS "providerCancelReason", DROP COLUMN IF EXISTS "providerCancelConfirmedAt";
--   DROP TYPE IF EXISTS "ShipmentCostAdjustmentKind";
--   DROP TYPE IF EXISTS "ShippingIvaSource";
--   DROP TYPE IF EXISTS "CarrierStatus";
--   DROP TYPE IF EXISTS "ShipmentLabelSource";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261007120000_m66_sdx_d_skydropx';

-- =============================================== enums ===============================================
-- `CREATE TYPE` no admite IF NOT EXISTS: bloque con `duplicate_object` (aplicarla dos veces no falla ni cambia nada).
DO $$
BEGIN
  BEGIN
    CREATE TYPE "ShipmentLabelSource" AS ENUM ('manual', 'skydropx');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "CarrierStatus" AS ENUM ('created', 'picked_up', 'in_transit', 'last_mile', 'delivery_attempt', 'delivered_to_branch', 'delivered', 'exception', 'in_return', 'canceled', 'destroyed', 'retained');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "ShippingIvaSource" AS ENUM ('provider', 'computed', 'manual');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE TYPE "ShipmentCostAdjustmentKind" AS ENUM ('overweight', 'extended_zone', 'return', 'other');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- =============================================== ShipmentRequest ===============================================
ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "branchNoticeSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "carrierPolledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "carrierStatus" "CarrierStatus",
ADD COLUMN IF NOT EXISTS "carrierStatusAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "chosenRateJson" JSONB,
ADD COLUMN IF NOT EXISTS "declaredValueCents" INTEGER,
ADD COLUMN IF NOT EXISTS "deliveredNoticeSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "insuranceCostCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "insuredValueCents" INTEGER,
ADD COLUMN IF NOT EXISTS "labelProcessingSince" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "labelPurchasedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "labelSource" "ShipmentLabelSource",
ADD COLUMN IF NOT EXISTS "labelUrl" TEXT,
ADD COLUMN IF NOT EXISTS "lastDeliveryAttemptAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "packageCode" TEXT,
ADD COLUMN IF NOT EXISTS "packageDimsJson" JSONB,
ADD COLUMN IF NOT EXISTS "providerCancelConfirmedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerCancelReason" TEXT,
ADD COLUMN IF NOT EXISTS "providerCanceledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "providerQuotationId" TEXT,
ADD COLUMN IF NOT EXISTS "providerRateId" TEXT,
ADD COLUMN IF NOT EXISTS "providerShipmentId" TEXT,
ADD COLUMN IF NOT EXISTS "rateChosenAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "rateChosenByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "recommendedRateJson" JSONB,
ADD COLUMN IF NOT EXISTS "shippingIvaSource" "ShippingIvaSource",
ADD COLUMN IF NOT EXISTS "trackingUrl" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentRequest_providerShipmentId_key" ON "ShipmentRequest"("providerShipmentId");
CREATE INDEX IF NOT EXISTS "ShipmentRequest_providerShipmentId_idx" ON "ShipmentRequest"("providerShipmentId");
CREATE INDEX IF NOT EXISTS "ShipmentRequest_status_labelSource_carrierPolledAt_idx" ON "ShipmentRequest"("status", "labelSource", "carrierPolledAt");
CREATE INDEX IF NOT EXISTS "ShipmentRequest_labelProcessingSince_idx" ON "ShipmentRequest"("labelProcessingSince");

-- =============================================== tablas nuevas ===============================================
CREATE TABLE IF NOT EXISTS "ShipmentQuote" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "providerQuotationId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "packageCode" TEXT NOT NULL,
    "packageDimsJson" JSONB NOT NULL,
    "declaredValueCents" INTEGER NOT NULL,
    "insuredValueCents" INTEGER NOT NULL,
    "insuranceEchoOk" BOOLEAN NOT NULL,
    "addressVersion" INTEGER NOT NULL,
    "ratesJson" JSONB NOT NULL,
    "rawResponseJson" JSONB,
    "recommendedRateId" TEXT,

    CONSTRAINT "ShipmentQuote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShipmentCarrierEvent" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "providerShipmentId" TEXT NOT NULL,
    "status" "CarrierStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "branchName" TEXT,
    "providerEventKey" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentCarrierEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShipmentCostAdjustment" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "kind" "ShipmentCostAdjustmentKind" NOT NULL,
    "providerChargeId" TEXT NOT NULL,
    "providerChargeType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "ivaCents" INTEGER NOT NULL DEFAULT 0,
    "ivaSource" "ShippingIvaSource" NOT NULL,
    "chargedAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "ShipmentCostAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShippingPackage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lengthCm" INTEGER NOT NULL,
    "widthCm" INTEGER NOT NULL,
    "heightCm" INTEGER NOT NULL,
    "weightKg" INTEGER NOT NULL,
    "providerPackageType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingPackage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShipmentQuote_providerQuotationId_idx" ON "ShipmentQuote"("providerQuotationId");
CREATE INDEX IF NOT EXISTS "ShipmentQuote_shipmentRequestId_requestedAt_idx" ON "ShipmentQuote"("shipmentRequestId", "requestedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentQuote_shipmentRequestId_providerQuotationId_key" ON "ShipmentQuote"("shipmentRequestId", "providerQuotationId");
CREATE INDEX IF NOT EXISTS "ShipmentCarrierEvent_shipmentRequestId_occurredAt_idx" ON "ShipmentCarrierEvent"("shipmentRequestId", "occurredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentCarrierEvent_shipmentRequestId_providerShipmentId_p_key" ON "ShipmentCarrierEvent"("shipmentRequestId", "providerShipmentId", "providerEventKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentCostAdjustment_providerChargeId_key" ON "ShipmentCostAdjustment"("providerChargeId");
CREATE INDEX IF NOT EXISTS "ShipmentCostAdjustment_shipmentRequestId_idx" ON "ShipmentCostAdjustment"("shipmentRequestId");
CREATE INDEX IF NOT EXISTS "ShipmentCostAdjustment_chargedAt_idx" ON "ShipmentCostAdjustment"("chargedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingPackage_code_key" ON "ShippingPackage"("code");

-- =============================================== FK + CHECKs ===============================================
-- `ADD CONSTRAINT` no admite IF NOT EXISTS: bloque sobre `pg_constraint` (patrón M-64/M-65).
DO $$
BEGIN
  -- FKs (relaciones de §19.2: cotización y eventos en cascada con el envío; ajustes de costo RESTRICT — registro de dinero)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentQuote_shipmentRequestId_fkey') THEN
    ALTER TABLE "ShipmentQuote" ADD CONSTRAINT "ShipmentQuote_shipmentRequestId_fkey"
      FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentCarrierEvent_shipmentRequestId_fkey') THEN
    ALTER TABLE "ShipmentCarrierEvent" ADD CONSTRAINT "ShipmentCarrierEvent_shipmentRequestId_fkey"
      FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentCostAdjustment_shipmentRequestId_fkey') THEN
    ALTER TABLE "ShipmentCostAdjustment" ADD CONSTRAINT "ShipmentCostAdjustment_shipmentRequestId_fkey"
      FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- ShipmentRequest (§19.2 «CHECKs» + delta §19.19.14 + §19.20.2). ⚠️ `labelSource` nulo NO puede «pasar» un CHECK por
  -- NULL: se compara con IS NOT DISTINCT FROM (un `=` con NULL da NULL y el CHECK lo dejaría pasar).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_label_source_iff_provider_id') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_label_source_iff_provider_id"
      CHECK (("labelSource" IS NOT DISTINCT FROM 'skydropx'::"ShipmentLabelSource") = ("providerShipmentId" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_provider_id_requires_purchase') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_provider_id_requires_purchase"
      CHECK ("providerShipmentId" IS NULL OR (
        "providerRateId" IS NOT NULL AND "chosenRateJson" IS NOT NULL AND "rateChosenByUserId" IS NOT NULL
        AND "rateChosenAt" IS NOT NULL AND "labelPurchasedAt" IS NOT NULL AND "packageCode" IS NOT NULL
        AND "declaredValueCents" IS NOT NULL AND "insuredValueCents" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_rate_chosen_paired') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_rate_chosen_paired"
      CHECK (("rateChosenByUserId" IS NULL) = ("rateChosenAt" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_label_processing_without_tracking') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_label_processing_without_tracking"
      CHECK ("labelProcessingSince" IS NULL OR "trackingNumber" IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_carrier_status_requires_provider') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_carrier_status_requires_provider"
      CHECK ("carrierStatus" IS NULL OR "providerShipmentId" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_carrier_status_paired') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_carrier_status_paired"
      CHECK (("carrierStatus" IS NULL) = ("carrierStatusAt" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_insurance_cost_nonneg') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_insurance_cost_nonneg" CHECK ("insuranceCostCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_declared_value_nonneg') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_declared_value_nonneg"
      CHECK ("declaredValueCents" IS NULL OR "declaredValueCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_insured_value_within_declared') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_insured_value_within_declared"
      CHECK ("insuredValueCents" IS NULL OR ("declaredValueCents" IS NOT NULL AND "declaredValueCents" >= "insuredValueCents"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_delivered_notice_skydropx_only') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_delivered_notice_skydropx_only"
      CHECK ("deliveredNoticeSentAt" IS NULL OR "labelSource" IS NOT DISTINCT FROM 'skydropx'::"ShipmentLabelSource");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_provider_cancel_paired') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_provider_cancel_paired"
      CHECK (("providerCanceledAt" IS NULL) = ("providerCancelReason" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_provider_cancel_confirmed_requires_canceled') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_provider_cancel_confirmed_requires_canceled"
      CHECK ("providerCancelConfirmedAt" IS NULL OR "providerCanceledAt" IS NOT NULL);
  END IF;

  -- ShipmentQuote
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_quote_expires_after_requested') THEN
    ALTER TABLE "ShipmentQuote" ADD CONSTRAINT "shipment_quote_expires_after_requested" CHECK ("expiresAt" > "requestedAt");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_quote_declared_value_nonneg') THEN
    ALTER TABLE "ShipmentQuote" ADD CONSTRAINT "shipment_quote_declared_value_nonneg" CHECK ("declaredValueCents" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_quote_declared_covers_insured') THEN
    ALTER TABLE "ShipmentQuote" ADD CONSTRAINT "shipment_quote_declared_covers_insured"
      CHECK ("declaredValueCents" >= "insuredValueCents");
  END IF;

  -- ShipmentCostAdjustment
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_cost_adjustment_amount_positive') THEN
    ALTER TABLE "ShipmentCostAdjustment" ADD CONSTRAINT "shipment_cost_adjustment_amount_positive" CHECK ("amountCents" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_cost_adjustment_iva_within_amount') THEN
    ALTER TABLE "ShipmentCostAdjustment" ADD CONSTRAINT "shipment_cost_adjustment_iva_within_amount"
      CHECK ("ivaCents" >= 0 AND "ivaCents" <= "amountCents");
  END IF;

  -- ShippingPackage (⭐ v1.80.11: `weightKg` entero ≥ 1)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_package_dims_positive') THEN
    ALTER TABLE "ShippingPackage" ADD CONSTRAINT "shipping_package_dims_positive"
      CHECK ("lengthCm" > 0 AND "widthCm" > 0 AND "heightCm" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_package_weight_min_1kg') THEN
    ALTER TABLE "ShippingPackage" ADD CONSTRAINT "shipping_package_weight_min_1kg" CHECK ("weightKg" >= 1);
  END IF;
END $$;

-- =============================================== seeds (§11.0: ON CONFLICT DO NOTHING ≡ upsert update:{}) ===============
-- Empaques (§19.19.6; medidas «ESTIMADO» del plan del panel, el dueño las corrige en M10; códigos medidos PROD §5.2).
INSERT INTO "ShippingPackage" ("id", "code", "label", "lengthCm", "widthCm", "heightCm", "weightKg", "providerPackageType", "active", "sortOrder", "updatedAt")
VALUES (gen_random_uuid()::text, 'envelope', 'Sobre', 25, 18, 3, 1, '5H4', true, 0, CURRENT_TIMESTAMP),
       (gen_random_uuid()::text, 'box', 'Caja', 49, 23, 21, 5, '4G', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Diales (§19.19.12). Los valores son EXACTAMENTE `SETTING_DEFAULTS` (candado: `test/sdx-d.dials.spec.ts`).
-- `shipping_provider='off'` y `shipping_label_purchase='disabled'`: FAIL-CLOSED (`HECHOS.md:58`: «el interruptor arranca apagado y lo enciende el dueño»; antes `:49`: «dial
-- shipping_label_purchase, seed disabled»). Carta Porte '49101600' y la regla del seguro: `HECHOS.md:48`. Saldo bajo MX$1,000
-- (`HECHOS.md:62`, errata v1.80.12.9 §19.29.2: M-66 sin aplicar en producción ⇒ se corrige aquí, sin UPDATE en M-68).
-- ⛔ Los diales de control del gasto (§19.29.8) NO se siembran aquí: los siembra M-68 (D2g); hasta entonces rige su
-- default de código.
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('shipping_provider', '"off"'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_label_purchase', '"disabled"'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('skydropx_origin_address_template_id', 'null'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('skydropx_origin_snapshot', 'null'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_preferred_carriers', '["ninetynineminutes"]'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_dropoff_points', '{"ninetynineminutes":{"name":"Punto99 · Periférico Sur 4249","address":"Av. Periférico Sur 4249, Jardines de la Montaña, 14210 CDMX"}}'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_consignment_note', '"49101600"'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_package_rule_box_min_cards', '60'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('skydropx_low_balance_cents', '100000'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_tracking_poll_minutes', '60'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_insurance_tiers', '[{"coverageCents":250000,"costCents":2500,"measuredAt":"2026-10-04"},{"coverageCents":1000000,"costCents":17000,"measuredAt":"2026-10-04"}]'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP),
       ('shipping_label_format', '"standard"'::jsonb, 'migration:m66-sdx-d', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
