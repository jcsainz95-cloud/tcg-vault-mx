-- M-20 (v1.9-set-chart): modelo NUEVO `SetValueSnapshot`, aditivo, SIN backfill.
-- Serie diaria del valor de mercado agregado por set (gráfica PÚBLICA del hero de la home).
-- Escrito por los jobs `set-price-sync` + `set-value-snapshot`. Idempotente por día (upsert).
-- API_CONTRACT changelog v1.9-set-chart / ARCHITECTURE §3.2, §4.12, §11 (M-20). SEC-A1 intacto
-- (totalValueMxnCents derivado siempre de PriceReference real). Sin enums nuevos.

-- CreateTable
CREATE TABLE "SetValueSnapshot" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "totalValueMxnCents" INTEGER NOT NULL,
    "pricedCardCount" INTEGER NOT NULL,
    "totalCardCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetValueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotente por día: re-correr el job hace upsert, no duplica)
CREATE UNIQUE INDEX "SetValueSnapshot_setId_asOfDate_key" ON "SetValueSnapshot"("setId", "asOfDate");

-- CreateIndex (consultas por rango de la gráfica)
CREATE INDEX "SetValueSnapshot_setId_asOfDate_idx" ON "SetValueSnapshot"("setId", "asOfDate");

-- AddForeignKey (onDelete: Cascade — al borrar el set se borra su serie)
ALTER TABLE "SetValueSnapshot" ADD CONSTRAINT "SetValueSnapshot_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CardSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
