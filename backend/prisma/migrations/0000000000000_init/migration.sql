-- CreateEnum
CREATE TYPE "Role" AS ENUM ('customer', 'vault_operator', 'super_admin');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('es', 'en');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('graded', 'sealed', 'raw');

-- CreateEnum
CREATE TYPE "RawCondition" AS ENUM ('NM', 'LP', 'MP', 'HP', 'DMG');

-- CreateEnum
CREATE TYPE "GradingCompany" AS ENUM ('PSA', 'CGC');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('platform', 'customer');

-- CreateEnum
CREATE TYPE "OwnershipStatus" AS ENUM ('pending', 'settled');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('in_stock', 'listed', 'reserved', 'in_custody', 'picking', 'shipped', 'delivered', 'lost', 'damaged', 'withdrawn');

-- CreateEnum
CREATE TYPE "VaultZone" AS ENUM ('platform_stock', 'customer_custody');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'settled', 'failed', 'refunded', 'chargeback');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('solicitado', 'picking', 'guia', 'enviado', 'entregado', 'cancelado');

-- CreateEnum
CREATE TYPE "SellRequestStatus" AS ENUM ('cotizada', 'recibida', 'verificacion', 'aprobada', 'pagada', 'rechazada', 'abandonada');

-- CreateEnum
CREATE TYPE "SellItemStatus" AS ENUM ('cotizada', 'precio_pendiente', 'recibida', 'verificacion', 'aprobada', 'ajustada', 'rechazada', 'pagada', 'convertida_inventario');

-- CreateEnum
CREATE TYPE "BuylistCategory" AS ENUM ('comun', 'reverse_holo', 'ex_plus');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('abierta', 'en_revision', 'resuelta_recompra', 'rechazada');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('pokemontcg_io', 'pokemonpricetracker', 'poketrace', 'manual');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('none', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "AcquisitionType" AS ENUM ('aportacion_en_especie', 'buylist', 'compra');

-- CreateEnum
CREATE TYPE "CfdiStatus" AS ENUM ('registrado', 'no_aplica');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('alta', 'move', 'sale', 'settle', 'chargeback_return', 'withdrawal', 'lost', 'damaged', 'buylist_convert');

-- CreateEnum
CREATE TYPE "PendingPriceContext" AS ENUM ('catalog', 'portfolio', 'buylist', 'inventory');

-- CreateEnum
CREATE TYPE "PendingPriceStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'customer',
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'es',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT,
    "rfc" TEXT,
    "clabe" TEXT,
    "ineFrontKey" TEXT,
    "ineBackKey" TEXT,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'none',
    "capPerRequestCentsOverride" INTEGER,
    "capPerMonthCentsOverride" INTEGER,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rfc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "regimenFiscal" TEXT NOT NULL,
    "usoCfdi" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'MX',
    "phone" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardSet" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "series" TEXT,
    "releaseDate" TEXT,
    "printedTotal" INTEGER,
    "ptcgoCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "rarity" TEXT,
    "supertype" TEXT,
    "subtypes" JSONB,
    "imageSmallUrl" TEXT,
    "imageLargeUrl" TEXT,
    "tcgplayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultLocation" (
    "id" TEXT NOT NULL,
    "zone" "VaultZone" NOT NULL,
    "box" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "rawCondition" "RawCondition",
    "gradingCompany" "GradingCompany",
    "gradeValue" TEXT,
    "frontPhotoKey" TEXT,
    "backPhotoKey" TEXT,
    "extraPhotoKeys" JSONB,
    "locationId" TEXT,
    "ownerType" "OwnerType" NOT NULL DEFAULT 'platform',
    "ownerUserId" TEXT,
    "ownershipStatus" "OwnershipStatus",
    "status" "InventoryStatus" NOT NULL DEFAULT 'in_stock',
    "listPriceCents" INTEGER,
    "acquisitionType" "AcquisitionType" NOT NULL,
    "acquisitionCostCents" INTEGER,
    "acquisitionPct" INTEGER,
    "sourceSellRequestItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "fromStatus" "InventoryStatus",
    "toStatus" "InventoryStatus",
    "reason" "MovementReason" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceReference" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "gradeKey" TEXT NOT NULL,
    "source" "PriceSource" NOT NULL,
    "priceUsdCents" INTEGER,
    "fxRate" DECIMAL(12,6),
    "fxBufferPct" DECIMAL(6,3),
    "priceMxnCents" INTEGER NOT NULL,
    "capturedDate" DATE NOT NULL,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingPriceEntry" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "gradeKey" TEXT NOT NULL,
    "context" "PendingPriceContext" NOT NULL,
    "refId" TEXT,
    "status" "PendingPriceStatus" NOT NULL DEFAULT 'open',
    "resolvedPriceRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PendingPriceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'USD',
    "quote" TEXT NOT NULL DEFAULT 'MXN',
    "rate" DECIMAL(12,6) NOT NULL,
    "bufferPct" DECIMAL(6,3) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "subtotalCents" INTEGER NOT NULL,
    "processingFeeCents" INTEGER NOT NULL,
    "ivaCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "ivaRatePct" INTEGER NOT NULL DEFAULT 16,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "billingSnapshot" JSONB,
    "cfdiStatus" "CfdiStatus" NOT NULL DEFAULT 'no_aplica',
    "invoiceRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "cardSnapshot" JSONB NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addressSnapshot" JSONB NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'solicitado',
    "shippingFeeCents" INTEGER NOT NULL,
    "ivaCents" INTEGER NOT NULL DEFAULT 0,
    "processingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "stripePaymentIntentId" TEXT,
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickingAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "ShipmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentRequestId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SellRequestStatus" NOT NULL DEFAULT 'cotizada',
    "quotedTotalCents" INTEGER NOT NULL DEFAULT 0,
    "approvedTotalCents" INTEGER,
    "clabeSnapshot" TEXT,
    "ineRequired" BOOLEAN NOT NULL DEFAULT false,
    "ineProvided" BOOLEAN NOT NULL DEFAULT false,
    "speiReference" TEXT,
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "adjustmentSentAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),

    CONSTRAINT "SellRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellRequestItem" (
    "id" TEXT NOT NULL,
    "sellRequestId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "rawCondition" "RawCondition",
    "category" "BuylistCategory" NOT NULL,
    "quotedPriceCents" INTEGER,
    "approvedPriceCents" INTEGER,
    "itemStatus" "SellItemStatus" NOT NULL DEFAULT 'cotizada',
    "inventoryItemId" TEXT,
    "photoKeys" JSONB,

    CONSTRAINT "SellRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'condition_raw',
    "status" "DisputeStatus" NOT NULL DEFAULT 'abierta',
    "ingressPhotoKeys" JSONB,
    "claimPhotoKeys" JSONB,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "repurchaseOrderId" TEXT,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigSetting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "KycProfile_userId_key" ON "KycProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProfile_userId_key" ON "BillingProfile"("userId");

-- CreateIndex
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CardSet_externalId_key" ON "CardSet"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_externalId_key" ON "Card"("externalId");

-- CreateIndex
CREATE INDEX "Card_setId_idx" ON "Card"("setId");

-- CreateIndex
CREATE INDEX "Card_name_idx" ON "Card"("name");

-- CreateIndex
CREATE INDEX "Card_rarity_idx" ON "Card"("rarity");

-- CreateIndex
CREATE UNIQUE INDEX "VaultLocation_zone_box_row_slot_key" ON "VaultLocation"("zone", "box", "row", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_folio_key" ON "InventoryItem"("folio");

-- CreateIndex
CREATE INDEX "InventoryItem_cardId_idx" ON "InventoryItem"("cardId");

-- CreateIndex
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_ownerUserId_idx" ON "InventoryItem"("ownerUserId");

-- CreateIndex
CREATE INDEX "InventoryItem_locationId_idx" ON "InventoryItem"("locationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId");

-- CreateIndex
CREATE INDEX "PriceReference_cardId_idx" ON "PriceReference"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceReference_cardId_productType_gradeKey_capturedDate_key" ON "PriceReference"("cardId", "productType", "gradeKey", "capturedDate");

-- CreateIndex
CREATE INDEX "PendingPriceEntry_status_idx" ON "PendingPriceEntry"("status");

-- CreateIndex
CREATE INDEX "FxRate_effectiveDate_idx" ON "FxRate"("effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripePaymentIntentId_key" ON "Order"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentRequest_stripePaymentIntentId_key" ON "ShipmentRequest"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "ShipmentRequest_userId_idx" ON "ShipmentRequest"("userId");

-- CreateIndex
CREATE INDEX "ShipmentRequest_status_idx" ON "ShipmentRequest"("status");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentRequestId_idx" ON "ShipmentItem"("shipmentRequestId");

-- CreateIndex
CREATE INDEX "SellRequest_userId_idx" ON "SellRequest"("userId");

-- CreateIndex
CREATE INDEX "SellRequest_status_idx" ON "SellRequest"("status");

-- CreateIndex
CREATE INDEX "SellRequestItem_sellRequestId_idx" ON "SellRequestItem"("sellRequestId");

-- CreateIndex
CREATE INDEX "Dispute_userId_idx" ON "Dispute"("userId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_idx" ON "AuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "KycProfile" ADD CONSTRAINT "KycProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CardSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "VaultLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceReference" ADD CONSTRAINT "PriceReference_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingPriceEntry" ADD CONSTRAINT "PendingPriceEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "ShipmentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentRequestId_fkey" FOREIGN KEY ("shipmentRequestId") REFERENCES "ShipmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellRequest" ADD CONSTRAINT "SellRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellRequestItem" ADD CONSTRAINT "SellRequestItem_sellRequestId_fkey" FOREIGN KEY ("sellRequestId") REFERENCES "SellRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellRequestItem" ADD CONSTRAINT "SellRequestItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Folio sequence for INV-000123 legible folios (ARCHITECTURE §4.6)
CREATE SEQUENCE IF NOT EXISTS inventory_folio_seq START 1;
