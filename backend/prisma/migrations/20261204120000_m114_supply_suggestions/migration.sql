-- m114 · §PROV-F4 (DECISIONES §PROV-F4, API_CONTRACT_PROVEEDORES §5). Sin pérdida de datos: enum + tabla nueva + columnas nullable + RENAME COLUMN (weeklyBudgetCents → openBudgetCents, conserva el valor).
-- `SupplySettings.autoPublish` NO se toca (sigue false): se enciende en producción SOLO tras los gates, con
--   PATCH /admin/supply-settings {"autoPublish":true} (super_admin) o `UPDATE "SupplySettings" SET "autoPublish"=true WHERE id='singleton'`.
-- REVERSA (documentada, no automática): apagar el interruptor y
--   DROP TABLE "SupplySuggestion"; DROP TYPE "SupplySuggestionStatus"; ALTER TABLE "SupplySettings" DROP COLUMN "lastSuggestRunAt"; ALTER TABLE "SupplySettings" RENAME COLUMN "openBudgetCents" TO "weeklyBudgetCents"; ALTER TABLE "SupplySettings" ALTER COLUMN "weeklyBudgetCents" SET DEFAULT 0; UPDATE "SupplySettings" SET "weeklyBudgetCents"=0 WHERE "weeklyBudgetCents"=500000;
--   (y DELETE FROM "_prisma_migrations" WHERE migration_name='20261204120000_m114_supply_suggestions'); las solicitudes ya publicadas
--   (SupplyRequest.source='suggested') se cierran con PATCH status=closed.
CREATE TYPE "SupplySuggestionStatus" AS ENUM ('draft', 'published', 'skipped');

CREATE TABLE "SupplySuggestion" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "finish" "Finish" NOT NULL,
    "suggestedQty" INTEGER NOT NULL,
    "unitCents" INTEGER,
    "marketCents" INTEGER,
    "reasons" JSONB NOT NULL,
    "status" "SupplySuggestionStatus" NOT NULL DEFAULT 'draft',
    "skipReason" TEXT,
    "requestId" TEXT,
    -- Idempotency-Key del publish manual (DECISIONES §PROV-F4.6b): misma key + mismo cuerpo (hash) ⇒ la misma solicitud; otro cuerpo ⇒ 422.
    "publishKey" TEXT,
    "publishHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupplySuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplySuggestion_status_createdAt_idx" ON "SupplySuggestion"("status", "createdAt");
CREATE UNIQUE INDEX "SupplySuggestion_publishKey_key" ON "SupplySuggestion"("publishKey");
CREATE INDEX "SupplySuggestion_cardId_idx" ON "SupplySuggestion"("cardId");
-- Una sola fila VIVA (borrador u omitida) por (carta, acabado): el job la actualiza, no duplica. `published` es historial.
CREATE UNIQUE INDEX "SupplySuggestion_live_cardId_finish_key" ON "SupplySuggestion"("cardId", "finish") WHERE "status" IN ('draft', 'skipped');

ALTER TABLE "SupplySuggestion" ADD CONSTRAINT "SupplySuggestion_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplySettings" ADD COLUMN "lastSuggestRunAt" TIMESTAMP(3);

-- Tope de lo ABIERTO a la vez (HECHOS 2026-11-20; antes `weeklyBudgetCents`): RENAME conserva el valor que el dueño ya fijó.
-- Por defecto MX$5,000 = 500000 centavos; solo mueve la fila que sigue en 0. Inocuo con `autoPublish` apagado.
ALTER TABLE "SupplySettings" RENAME COLUMN "weeklyBudgetCents" TO "openBudgetCents";
ALTER TABLE "SupplySettings" ALTER COLUMN "openBudgetCents" SET DEFAULT 500000;
UPDATE "SupplySettings" SET "openBudgetCents" = 500000 WHERE "openBudgetCents" = 0;
