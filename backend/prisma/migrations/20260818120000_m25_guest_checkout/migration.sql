-- M-25 (v1.21-guest-checkout, WS «Órdenes y dinero»): comprar SIN cuenta.
-- Spec normativa: API_CONTRACT §4-G.10 (diff campo por campo) y ARCHITECTURE §11 (M-25) / §4.21.
--
-- Es la migración MENOS aditiva de las recientes: incluye dos DROP NOT NULL (Order.userId,
-- ShipmentRequest.userId). Aun así es COMPATIBLE HACIA ATRÁS: ninguna fila existente cambia de
-- valor, los defaults ('vault', 0) reproducen el comportamiento actual bit a bit y los índices
-- "*_userId_idx" SE CONSERVAN (un B-tree de Postgres indexa NULL y las consultas `WHERE userId = X`
-- lo siguen usando igual). Sin cambios en los enums InventoryStatus / ShipmentStatus.

-- CreateEnum: destino del pedido. `vault` = comportamiento actual; `direct_ship` = envío directo
-- (única ruta del invitado; la bóveda exige cuenta, PROJECT §J).
CREATE TYPE "FulfillmentMode" AS ENUM ('vault', 'direct_ship');

-- ============================ Order ============================

-- AlterColumn (DROP NOT NULL): un pedido de invitado no tiene User. NO relaja ninguna
-- autorización (la puerta sigue siendo `order.userId != :sessionUser`, y NULL nunca iguala a un uuid).
ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;

-- La FK `Order_userId_fkey` NO se toca: se conserva `ON DELETE RESTRICT` (declarado explícitamente
-- en el schema). Con `SET NULL` —el default de Prisma para una relación opcional— un borrado duro
-- de usuario huerfanaría sus pedidos y rompería el CHECK `claimedAt IS NOT NULL => userId IS NOT NULL`.

-- AddColumn
ALTER TABLE "Order" ADD COLUMN "guestEmail" TEXT;
ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'vault';
ALTER TABLE "Order" ADD COLUMN "shippingAddressSnapshot" JSONB;
ALTER TABLE "Order" ADD COLUMN "shippingFeeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "locale" "Locale";
ALTER TABLE "Order" ADD COLUMN "paymentMethodBrand" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentMethodLast4" TEXT;

-- CreateSequence + backfill de `orderNumber`: número legible TCG-000123. Mismo patrón que
-- `inventory_folio_seq` (PrismaService.nextFolio). La columna queda nullable SOLO para permitir
-- este backfill; la aplicación la escribe SIEMPRE en pedidos nuevos.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id" FROM "Order" ORDER BY "createdAt" ASC, "id" ASC LOOP
    UPDATE "Order"
       SET "orderNumber" = 'TCG-' || lpad(nextval('order_number_seq')::text, 6, '0')
     WHERE "id" = r."id";
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE INDEX "Order_guestEmail_idx" ON "Order"("guestEmail");

-- ============================ ShipmentRequest ============================

-- AlterColumn (DROP NOT NULL): `null` SOLO en el envío directo creado por el servidor al liquidar
-- un pedido de invitado. Riesgo #1 de esta migración: GET /shipments[...] debe filtrar por
-- `userId = :sessionUser` de forma POSITIVA (nunca "!= otro") para que estos envíos no aparezcan
-- en la lista de nadie.
ALTER TABLE "ShipmentRequest" ALTER COLUMN "userId" DROP NOT NULL;

-- La FK `ShipmentRequest_userId_fkey` tampoco se toca (sigue `ON DELETE RESTRICT`).

-- AddColumn: DISCRIMINADOR de las dos naturalezas de la cola de M4.
-- NULL = retiro de bóveda (todo lo existente); poblado = envío directo que fulfilla ese pedido.
ALTER TABLE "ShipmentRequest" ADD COLUMN "orderId" TEXT;

-- CreateIndex (NO unique: deja abierta la re-expedición por pérdida en tránsito sin migrar;
-- el invariante "a lo más un envío ACTIVO por orden" es de aplicación).
CREATE INDEX "ShipmentRequest_orderId_idx" ON "ShipmentRequest"("orderId");

-- AddForeignKey
ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "ShipmentRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================ OrderAccessToken ============================

-- CreateTable: enlace de seguimiento del invitado. SOLO el SHA-256 del claro (un dump de BD no
-- produce enlaces válidos). MULTI-USO: revocable (`revokedAt`), no consumible (no hay `usedAt`).
CREATE TABLE "OrderAccessToken" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAccessToken_tokenHash_key" ON "OrderAccessToken"("tokenHash");
CREATE INDEX "OrderAccessToken_orderId_idx" ON "OrderAccessToken"("orderId");
CREATE INDEX "OrderAccessToken_expiresAt_idx" ON "OrderAccessToken"("expiresAt");

-- AddForeignKey (onDelete: Cascade — borrar el pedido cierra sus puertas)
ALTER TABLE "OrderAccessToken" ADD CONSTRAINT "OrderAccessToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================ CHECKs de invariantes ============================
-- Prisma no los expresa; son baratos y atrapan bugs de aplicación (API_CONTRACT §4-G.10).
-- NOT VALID/VALIDATE no hace falta: el proyecto es greenfield y las filas existentes los cumplen
-- (userId NOT NULL, fulfillmentMode='vault', claimedAt NULL).

-- 1. Ningún pedido queda huérfano.
ALTER TABLE "Order" ADD CONSTRAINT "Order_owner_or_guest_chk"
  CHECK ("userId" IS NOT NULL OR "guestEmail" IS NOT NULL);

-- 2. No hay bóveda para invitados (v1.5): un pedido nacido de invitado es SIEMPRE direct_ship.
ALTER TABLE "Order" ADD CONSTRAINT "Order_guest_is_direct_ship_chk"
  CHECK ("guestEmail" IS NULL OR "fulfillmentMode" = 'direct_ship');

-- 3. Un envío directo SIEMPRE lleva snapshot de dirección (el invitado no tiene Address).
ALTER TABLE "Order" ADD CONSTRAINT "Order_direct_ship_has_address_chk"
  CHECK ("fulfillmentMode" <> 'direct_ship' OR "shippingAddressSnapshot" IS NOT NULL);

-- 4. Reclamar vincula una cuenta a un pedido que nació de invitado.
ALTER TABLE "Order" ADD CONSTRAINT "Order_claim_consistency_chk"
  CHECK ("claimedAt" IS NULL OR ("userId" IS NOT NULL AND "guestEmail" IS NOT NULL));
