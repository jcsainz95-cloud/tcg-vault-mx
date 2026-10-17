-- M-81 — migración `v1.96⟨mkt-tienda⟩` (OLA 1, punto B1 · API_CONTRACT §MKT.C / ARCHITECTURE §13.1).
-- Número elegido como el siguiente libre tras M-80 (`20261102120000_m80_stripe_dashboard_refund`).
--
-- QUÉ HACE: añade a `Order` y a `SellRequest` las CINCO columnas de PRIMER-TOQUE UTM (atribución):
--   firstUtmSource / firstUtmMedium / firstUtmCampaign / firstUtmContent  (TEXT, NULLABLE)
--   firstUtmLandedAt                                                      (TIMESTAMP(3), NULLABLE)
-- y UN índice `Order_firstUtmMedium_idx` (el panel de «Origen» de OLA 2 agrupa por `utm_medium` sobre un
-- periodo acotado; los otros tres ejes se agrupan en memoria, patrón sales-analytics). `SellRequest` no se
-- indexa: §13.1 indexa solo `Order`.
--
-- DDL 100% ADITIVO, SIN BACKFILL, SEGURO CON LA APP CORRIENDO:
--   · Cinco columnas NULLABLE SIN default por tabla ⇒ `NULL` es la verdad de TODA fila previa (no se
--     inventa un primer-toque que no se midió). CERO `DROP`, CERO cambio de tipo, CERO enum, CERO dinero.
--   · Un índice sobre una columna nueva mayormente `NULL` ⇒ barato.
--
-- ⚠️ OLA 1 — ESTRUCTURA MUERTA A PROPÓSITO (dicho explícito, O-1 / §13.1): estas columnas se CREAN ahora
-- pero NINGÚN camino de escritura las puebla todavía. Poblarlas exige el consentimiento (banner + cookie
-- `th_first_utm` + Consent Mode v2), que es Fase 2 (v2 §D3). En OLA 1 quedan `NULL`, incluido el pedido de
-- invitado. La VALIDACIÓN de los valores (minúsculas, `^[a-z0-9._-]{1,64}$`, sin PII) vive en el helper
-- puro `backend/src/common/first-utm.ts` (`parseFirstUtm`), ya probado, PERO aún NO enganchado (Fase 2).
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ Se revierte DESPUÉS del código (nadie lee estas columnas en OLA 1). Como son NULLABLE y vacías, dropearlas
-- no pierde ningún dato de negocio mientras sigan NULL. Si en Fase 2 ya contienen atribución, la reversa de
-- CÓDIGO basta (dejar de leerlas) y las columnas se CONSERVAN (son el registro del primer-toque consentido).
-- REVERSA:BEGIN
--   DROP INDEX IF EXISTS "Order_firstUtmMedium_idx";
--   ALTER TABLE "Order"       DROP COLUMN IF EXISTS "firstUtmSource", DROP COLUMN IF EXISTS "firstUtmMedium",
--                             DROP COLUMN IF EXISTS "firstUtmCampaign", DROP COLUMN IF EXISTS "firstUtmContent",
--                             DROP COLUMN IF EXISTS "firstUtmLandedAt";
--   ALTER TABLE "SellRequest" DROP COLUMN IF EXISTS "firstUtmSource", DROP COLUMN IF EXISTS "firstUtmMedium",
--                             DROP COLUMN IF EXISTS "firstUtmCampaign", DROP COLUMN IF EXISTS "firstUtmContent",
--                             DROP COLUMN IF EXISTS "firstUtmLandedAt";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261103120000_m81_mkt_first_utm_attribution';
-- REVERSA:END

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "firstUtmCampaign" TEXT,
ADD COLUMN     "firstUtmContent" TEXT,
ADD COLUMN     "firstUtmLandedAt" TIMESTAMP(3),
ADD COLUMN     "firstUtmMedium" TEXT,
ADD COLUMN     "firstUtmSource" TEXT;

-- AlterTable
ALTER TABLE "SellRequest" ADD COLUMN     "firstUtmCampaign" TEXT,
ADD COLUMN     "firstUtmContent" TEXT,
ADD COLUMN     "firstUtmLandedAt" TIMESTAMP(3),
ADD COLUMN     "firstUtmMedium" TEXT,
ADD COLUMN     "firstUtmSource" TEXT;

-- CreateIndex
CREATE INDEX "Order_firstUtmMedium_idx" ON "Order"("firstUtmMedium");
