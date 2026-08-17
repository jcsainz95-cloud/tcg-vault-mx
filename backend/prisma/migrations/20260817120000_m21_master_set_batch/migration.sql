-- M-21 (v1.16-master-set, WS-E): agregación de lectura + lote de escritura del inventario a escala.
-- Aditiva, SIN backfill. NO cambia el modelo por-pieza (InventoryItem sigue 1 fila por pieza física).
-- API_CONTRACT changelog v1.16-master-set / ARCHITECTURE §4.17, §11 (M-21). Sin enums ni diales nuevos.

-- CreateIndex: sirve la agregación countsByFinish del binder (GROUP BY cardId, finish filtrando
-- status on-hand) y el conteo por set del índice Master Set. Complementa (no reemplaza) los índices
-- existentes @@index([cardId]) / @@index([status]).
CREATE INDEX "InventoryItem_cardId_finish_status_idx" ON "InventoryItem"("cardId", "finish", "status");

-- CreateTable: idempotencia + auditoría del alta/publicación por LOTE. El id ES el batchKey
-- (idempotencia natural): un replay del mismo batchKey devuelve resultJson sin re-crear.
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "kind" TEXT NOT NULL,
    "requested" INTEGER NOT NULL,
    "createdItems" INTEGER NOT NULL,
    "failedLines" INTEGER NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);
