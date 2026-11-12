-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "SupplyCondition" AS ENUM ('NM', 'LP', 'MP', 'HP', 'DMG');

-- CreateEnum
CREATE TYPE "SupplyRequestStatus" AS ENUM ('open', 'filled', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "SupplyOfferStatus" AS ENUM ('open', 'countered', 'accepted', 'rejected', 'withdrawn', 'expired');

-- CreateEnum
CREATE TYPE "SupplyPurchaseStatus" AS ENUM ('agreed', 'collected', 'verified', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "SupplyUnitResult" AS ENUM ('pending', 'ok', 'adjusted', 'returned');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'supplier';

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN     "supplyPurchaseId" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "phone" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'invited',
    "taxRef" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvite" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyRequest" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "finish" "Finish" NOT NULL DEFAULT 'normal',
    "minCondition" "SupplyCondition" NOT NULL DEFAULT 'NM',
    "qtyWanted" INTEGER NOT NULL,
    "qtyReserved" INTEGER NOT NULL DEFAULT 0,
    "qtyReceived" INTEGER NOT NULL DEFAULT 0,
    "pctBps" INTEGER,
    "fixedCents" INTEGER,
    "status" "SupplyRequestStatus" NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOffer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "condition" "SupplyCondition" NOT NULL,
    "unitCents" INTEGER NOT NULL,
    "status" "SupplyOfferStatus" NOT NULL DEFAULT 'open',
    "lastActor" TEXT NOT NULL DEFAULT 'supplier',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOfferEvent" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "qty" INTEGER,
    "unitCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyOfferEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyPurchase" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "finish" "Finish" NOT NULL,
    "qty" INTEGER NOT NULL,
    "agreedUnitCents" INTEGER NOT NULL,
    "pickupDueAt" TIMESTAMP(3) NOT NULL,
    "status" "SupplyPurchaseStatus" NOT NULL DEFAULT 'agreed',
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receiveKey" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifyKey" TEXT,
    "payableCents" INTEGER,
    "method" TEXT,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyPurchaseUnit" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "condition" "SupplyCondition" NOT NULL,
    "note" TEXT,
    "result" "SupplyUnitResult" NOT NULL DEFAULT 'pending',
    "adjustBps" INTEGER,
    "unitPayableCents" INTEGER,
    "inventoryItemId" TEXT,

    CONSTRAINT "SupplyPurchaseUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplySettings" (
    "id" TEXT NOT NULL,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "autoAccept" BOOLEAN NOT NULL DEFAULT false,
    "defaultPctBps" INTEGER NOT NULL DEFAULT 7000,
    "weeklyBudgetCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_userId_key" ON "Supplier"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_email_key" ON "Supplier"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvite_tokenHash_key" ON "SupplierInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SupplierInvite_supplierId_idx" ON "SupplierInvite"("supplierId");

-- CreateIndex
CREATE INDEX "SupplyRequest_status_expiresAt_idx" ON "SupplyRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SupplyRequest_cardId_idx" ON "SupplyRequest"("cardId");

-- CreateIndex
CREATE INDEX "SupplyOffer_requestId_status_idx" ON "SupplyOffer"("requestId", "status");

-- CreateIndex
CREATE INDEX "SupplyOffer_supplierId_idx" ON "SupplyOffer"("supplierId");

-- CreateIndex
CREATE INDEX "SupplyOffer_status_expiresAt_idx" ON "SupplyOffer"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOffer_supplierId_idempotencyKey_key" ON "SupplyOffer"("supplierId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplyOfferEvent_offerId_idx" ON "SupplyOfferEvent"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyPurchase_offerId_key" ON "SupplyPurchase"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyPurchase_idempotencyKey_key" ON "SupplyPurchase"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SupplyPurchase_supplierId_idx" ON "SupplyPurchase"("supplierId");

-- CreateIndex
CREATE INDEX "SupplyPurchase_status_pickupDueAt_idx" ON "SupplyPurchase"("status", "pickupDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyPurchaseUnit_purchaseId_n_key" ON "SupplyPurchaseUnit"("purchaseId", "n");

-- CreateIndex
CREATE INDEX "InventoryItem_supplyPurchaseId_idx" ON "InventoryItem"("supplyPurchaseId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplyPurchaseId_fkey" FOREIGN KEY ("supplyPurchaseId") REFERENCES "SupplyPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvite" ADD CONSTRAINT "SupplierInvite_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOffer" ADD CONSTRAINT "SupplyOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOffer" ADD CONSTRAINT "SupplyOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOfferEvent" ADD CONSTRAINT "SupplyOfferEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SupplyOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPurchase" ADD CONSTRAINT "SupplyPurchase_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "SupplyOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPurchase" ADD CONSTRAINT "SupplyPurchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyPurchaseUnit" ADD CONSTRAINT "SupplyPurchaseUnit_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "SupplyPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Singleton de interruptores (APAGADOS al arrancar, HECHOS 2026-11-12).
INSERT INTO "SupplySettings" ("id","autoPublish","autoAccept","defaultPctBps","weeklyBudgetCents","updatedAt")
VALUES ('singleton', false, false, 7000, 0, CURRENT_TIMESTAMP);

-- Cantidades y precio coherentes (cero sobreventa a nivel de BD).
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_qty_chk" CHECK ("qtyWanted" > 0 AND "qtyReserved" >= 0 AND "qtyReserved" <= "qtyWanted" AND "qtyReceived" >= 0);
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_price_chk" CHECK (("pctBps" IS NOT NULL AND "pctBps" BETWEEN 1 AND 10000) OR ("fixedCents" IS NOT NULL AND "fixedCents" > 0));
ALTER TABLE "SupplyOffer" ADD CONSTRAINT "SupplyOffer_qty_chk" CHECK ("qty" > 0 AND "unitCents" > 0);

-- Una oferta viva por solicitud y tienda (ALREADY_OFFERED a nivel de BD).
CREATE UNIQUE INDEX "SupplyOffer_one_live_per_request_supplier" ON "SupplyOffer"("requestId", "supplierId") WHERE "status" IN ('open', 'countered');
