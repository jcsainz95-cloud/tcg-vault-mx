-- M-28 (v1.23-sealed-sales, WS «Sellado / Producto cerrado»): venta de producto cerrado.
-- Aditiva y nullable, con backfill de `sealedCondition='mint'` para el sellado existente.
-- NO toca PriceReference/Order/OrderItem (el precio se congela en unitPriceCents, sin snapshot de
-- spread). Los cuatro diales (sealed_spread_pct_by_subtype, sealed_spread_fallback_pct,
-- sealed_value_trend, sealed_restock_alerts) son DATO del seed, no esquema.
-- ARCHITECTURE §4.23 / §11 (M-28) / API_CONTRACT §2-S/§3/§M2/§M10.

-- Enum nuevo: condición SIMPLE del sellado, visible al comprador.
CREATE TYPE "SealedCondition" AS ENUM ('mint', 'minor_box_damage');

-- Columna nueva (nullable): app-requerida para productType='sealed' (default mint); null en raw/graded.
ALTER TABLE "InventoryItem" ADD COLUMN "sealedCondition" "SealedCondition";

-- Backfill: todo el sellado existente queda `mint` (§4.23i). Raw/graded permanecen NULL.
UPDATE "InventoryItem" SET "sealedCondition" = 'mint'
  WHERE "productType" = 'sealed' AND "sealedCondition" IS NULL;

-- Índice nuevo: sirve el grid público del sellado (`sealed AND listed`) y la agregación de la
-- pestaña «Sellado» sin barrer la tabla. Complementa los índices existentes.
CREATE INDEX "InventoryItem_productType_status_idx" ON "InventoryItem"("productType", "status");

-- Tabla nueva (feature-flagged por el dial sealed_restock_alerts): «avísame cuando vuelva».
CREATE TABLE "SealedRestockSubscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "cardId" TEXT NOT NULL,
    "sealedSubtype" "SealedSubtype",
    "tcgplayerProductId" INTEGER,
    "sealedCondition" "SealedCondition" NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SealedRestockSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SealedRestockSubscription_tcgplayerProductId_sealedConditio_idx"
  ON "SealedRestockSubscription"("tcgplayerProductId", "sealedCondition", "notifiedAt");
CREATE INDEX "SealedRestockSubscription_email_idx" ON "SealedRestockSubscription"("email");
CREATE INDEX "SealedRestockSubscription_cardId_idx" ON "SealedRestockSubscription"("cardId");

ALTER TABLE "SealedRestockSubscription"
  ADD CONSTRAINT "SealedRestockSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SealedRestockSubscription"
  ADD CONSTRAINT "SealedRestockSubscription_cardId_fkey"
  FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
