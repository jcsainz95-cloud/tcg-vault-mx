-- M-59 — migración `v1.79.1` (bóveda: la COLOCACIÓN de una compra en el cajón del cliente ·
-- API_CONTRACT §M4-VAULT.2 · ARCHITECTURE §4.21q).
--
-- DDL ADITIVO: 3 enums nuevos, 2 tablas nuevas, sus índices y FKs, y 6 CHECKs sobre las tablas
-- NUEVAS. ⛔ Ningún enum existente cambia (ni `InventoryStatus`, ni `MovementReason`, ni
-- `ShipmentStatus`, ni `VaultZone`). ⛔ Ninguna tabla existente gana columna ni constraint
-- (`ShipmentRequest`/`ShipmentItem` intactas, §M4-VAULT.10.1). ⛔ Cero `UPDATE`/`DELETE`/`DROP`.
-- Segura con la app corriendo: tablas nuevas vacías; las FKs solo validan filas nuevas.
--
-- ⛔ SIN BACKFILL (HECHOS.md: la tienda nunca procesó una venta real ⇒ no hay órdenes `vault`
-- liquidadas que rellenar). Las filas nacen SOLO en la rama `vault` de
-- `PaymentsService.onPaymentSucceeded`, en la MISMA transacción que liquida la orden.
--
-- ⛔ CERO DINERO: ninguna columna aquí es un importe; nada de esto toca `Order.totalCents`,
-- `OrderItem.unitPriceCents`, Stripe ni `ShipmentRequest`.
--
-- LOS CHECKs (§M4-VAULT.2; precedente `M-25` / `M-25b`): «un sello a medias es INEXPRESABLE en la
-- BD, no solo prohibido en el código».
--   1. status='pending'   ⇒ los 3 sellos de colocación y los 3 de cancelación NULL.
--   2. status='placed'    ⇒ placedAt, placedByUserId, locationId NOT NULL; los 3 de cancelación NULL.
--   3. status='cancelled' ⇒ cancelledAt, cancelReason NOT NULL; los 3 de colocación NULL.
--   4. (preparedAt IS NULL) = (preparedByUserId IS NULL) — el sello de preparación va entero.
--   5. status='placed'    ⇒ preparedAt NOT NULL — «preparado precede a colocado» (CA #21 de §S).
--   6. VaultPlacementItem: prepStatus='pending' ⇔ (prepMarkedAt, prepMarkedByUserId) ambos NULL;
--      picked|missing ⇒ los dos NOT NULL.
--
-- REVERSA (en este orden; el artefacto anterior no conoce estas tablas y las ignora):
--   DROP TABLE "VaultPlacementItem";
--   DROP TABLE "VaultPlacement";
--   DROP TYPE "PreparationItemStatus";
--   DROP TYPE "VaultPlacementCancelReason";
--   DROP TYPE "VaultPlacementStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260925120000_m59_vault_placement';
-- ⚠️ La reversa PIERDE las colocaciones (quién/cuándo preparó y colocó, marcas de faltante). No
-- toca dinero ni el estado de ninguna pieza (la colocación solo escribe `InventoryItem.locationId`,
-- que sobrevive), pero el rastro de colocaciones se pierde. Detalle en docs/BACKEND_NOTES.md §M-59.

-- CreateEnum
CREATE TYPE "VaultPlacementStatus" AS ENUM ('pending', 'placed', 'cancelled');

-- CreateEnum
CREATE TYPE "VaultPlacementCancelReason" AS ENUM ('chargeback', 'nothing_to_place');

-- CreateEnum
CREATE TYPE "PreparationItemStatus" AS ENUM ('pending', 'picked', 'missing');

-- CreateTable
CREATE TABLE "VaultPlacement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "VaultPlacementStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "preparedByUserId" TEXT,
    "placedAt" TIMESTAMP(3),
    "placedByUserId" TEXT,
    "locationId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelReason" "VaultPlacementCancelReason",

    CONSTRAINT "VaultPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultPlacementItem" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "prepStatus" "PreparationItemStatus" NOT NULL DEFAULT 'pending',
    "prepMarkedAt" TIMESTAMP(3),
    "prepMarkedByUserId" TEXT,

    CONSTRAINT "VaultPlacementItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultPlacement_orderId_key" ON "VaultPlacement"("orderId");

-- CreateIndex
CREATE INDEX "VaultPlacement_status_createdAt_idx" ON "VaultPlacement"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultPlacementItem_orderItemId_key" ON "VaultPlacementItem"("orderItemId");

-- CreateIndex
CREATE INDEX "VaultPlacementItem_placementId_idx" ON "VaultPlacementItem"("placementId");

-- CreateIndex
CREATE INDEX "VaultPlacementItem_inventoryItemId_idx" ON "VaultPlacementItem"("inventoryItemId");

-- AddForeignKey
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "VaultLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPlacementItem" ADD CONSTRAINT "VaultPlacementItem_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "VaultPlacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPlacementItem" ADD CONSTRAINT "VaultPlacementItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultPlacementItem" ADD CONSTRAINT "VaultPlacementItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK 1 — pendiente: ningún sello de colocación ni de cancelación.
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_pending_seals_chk"
  CHECK ("status" <> 'pending' OR (
    "placedAt" IS NULL AND "placedByUserId" IS NULL AND "locationId" IS NULL
    AND "cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancelReason" IS NULL));

-- CHECK 2 — colocada: sello de colocación entero; ninguno de cancelación.
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_placed_seals_chk"
  CHECK ("status" <> 'placed' OR (
    "placedAt" IS NOT NULL AND "placedByUserId" IS NOT NULL AND "locationId" IS NOT NULL
    AND "cancelledAt" IS NULL AND "cancelledByUserId" IS NULL AND "cancelReason" IS NULL));

-- CHECK 3 — cancelada: cuándo y por qué; ningún sello de colocación. (`cancelledByUserId` NULL ⇔
-- la canceló el sistema, p. ej. el webhook de contracargo.)
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_cancelled_seals_chk"
  CHECK ("status" <> 'cancelled' OR (
    "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL
    AND "placedAt" IS NULL AND "placedByUserId" IS NULL AND "locationId" IS NULL));

-- CHECK 4 — el sello de preparación va entero o no va.
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_prepared_seal_chk"
  CHECK (("preparedAt" IS NULL) = ("preparedByUserId" IS NULL));

-- CHECK 5 — preparado precede a colocado (INV-VP-6).
ALTER TABLE "VaultPlacement" ADD CONSTRAINT "VaultPlacement_placed_requires_prepared_chk"
  CHECK ("status" <> 'placed' OR "preparedAt" IS NOT NULL);

-- CHECK 6 — la marca por carta va entera: pending ⇔ sin sello; picked|missing ⇒ sello completo.
ALTER TABLE "VaultPlacementItem" ADD CONSTRAINT "VaultPlacementItem_prep_mark_chk"
  CHECK (
    ("prepStatus" = 'pending' AND "prepMarkedAt" IS NULL AND "prepMarkedByUserId" IS NULL)
    OR ("prepStatus" <> 'pending' AND "prepMarkedAt" IS NOT NULL AND "prepMarkedByUserId" IS NOT NULL));
