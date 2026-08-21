-- M-30 (v1.28, ARCHITECTURE §4.26a / §11) — `VariantPriceOverride`: controles de precio POR
-- (carta, variante[, grado]) para la consola de tres precios del Master Set (P-18) y Top Bounties
-- (P-22): override de VENTA (pisa el storefront para piezas sin `listPriceCents` manual), override
-- de COMPRA (pisa el cotizador público de buylist) y el bounty (precio premium explícito + objetivo
-- opcional con contador `bountyAcquiredQty`).
--
-- Estrictamente ADITIVA: UNA tabla nueva + FK a Card; CERO cambios a tablas existentes. La tabla
-- nace VACÍA ⇒ sin filas el comportamiento actual queda intacto (los resolvers tratan la ausencia
-- de fila como «sin override» y caen a la cadena de reglas de siempre). Segura con la app corriendo.
-- Clave única = la de PriceReference menos `capturedDate` (una fila VIGENTE por variante; upsert,
-- sin serie temporal — la auditoría del cambio va por AuditLog, no por filas históricas).

-- CreateTable
CREATE TABLE "VariantPriceOverride" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL DEFAULT 'raw',
    "gradeKey" TEXT NOT NULL DEFAULT 'raw:NM',
    "finish" "Finish" NOT NULL DEFAULT 'normal',
    "sellOverrideCents" INTEGER,
    "buyOverrideCents" INTEGER,
    "bountyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bountyPriceCents" INTEGER,
    "bountyTargetQty" INTEGER,
    "bountyAcquiredQty" INTEGER NOT NULL DEFAULT 0,
    "bountyCompletedAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantPriceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantPriceOverride_bountyEnabled_idx" ON "VariantPriceOverride"("bountyEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "VariantPriceOverride_cardId_productType_gradeKey_finish_key" ON "VariantPriceOverride"("cardId", "productType", "gradeKey", "finish");

-- AddForeignKey
ALTER TABLE "VariantPriceOverride" ADD CONSTRAINT "VariantPriceOverride_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
