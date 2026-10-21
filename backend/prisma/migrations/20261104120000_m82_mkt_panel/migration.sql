-- M-82 — migración `v1.96⟨mkt-tienda⟩` (OLA 2 · Panel de Marketing Fase 0, API_CONTRACT §MKT.D / ARCHITECTURE §13.4).
-- Número elegido como el siguiente libre tras M-81 (`20261103120000_m81_mkt_first_utm_attribution`).
--
-- QUÉ HACE (100% ADITIVO):
--   · enum `Permission` (hoy solo `marketing_read`) + enum `BannerResponse` (accept|necessary_only|no_response).
--   · `UserPermission`  — permiso fino por cuenta (@@unique userId+permission). `super_admin` NO necesita fila.
--   · `MarketingApiToken` — principal de servicio `marketing-reader` (SOLO el hash SHA-256; caduca 12m; revocable).
--   · `MarketingBannerConsentCounter` — f1/f2: contador por (semana × respuesta × utm_medium × device); SIN fila por visita.
--   · `BuylistQuoteDailyCount` — d4: conteo anónimo por (día × cardId) del cotizador; SIN usuario, SIN IP.
--   · `MarketingAccessLog` — registro de accesos (export/botón/endpoint); SIN contenido; FK a token con ON DELETE SET NULL.
--   · Relación inversa `User.marketingPermissions` (NO altera ninguna columna de `User`).
--
-- ⚠️ DIFERIDO (NO se crea aquí): `SearchNoResultDaily` (c6, términos de búsqueda) — necesita la pre-revisión de
--    seguridad de PM-M2 (puntos 1-4) antes de construir (Panel §7.5). Se añadirá en una migración posterior.
--
-- SEGURO CON LA APP CORRIENDO: solo `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ADD FOREIGN KEY` sobre tablas
-- NUEVAS. CERO `DROP`, CERO cambio de tipo en modelos ajenos, CERO backfill, CERO dinero.
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- Tablas nuevas y vacías ⇒ dropearlas no pierde ningún dato de negocio. Se revierte DESPUÉS del código (nadie las lee).
-- REVERSA:BEGIN
--   ALTER TABLE "MarketingAccessLog" DROP CONSTRAINT IF EXISTS "MarketingAccessLog_tokenId_fkey";
--   ALTER TABLE "UserPermission"     DROP CONSTRAINT IF EXISTS "UserPermission_userId_fkey";
--   DROP TABLE IF EXISTS "MarketingAccessLog";
--   DROP TABLE IF EXISTS "BuylistQuoteDailyCount";
--   DROP TABLE IF EXISTS "MarketingBannerConsentCounter";
--   DROP TABLE IF EXISTS "MarketingApiToken";
--   DROP TABLE IF EXISTS "UserPermission";
--   DROP TYPE  IF EXISTS "BannerResponse";
--   DROP TYPE  IF EXISTS "Permission";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104120000_m82_mkt_panel';
-- REVERSA:END

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('marketing_read');

-- CreateEnum
CREATE TYPE "BannerResponse" AS ENUM ('accept', 'necessary_only', 'no_response');

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "grantedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingApiToken" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBannerConsentCounter" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "response" "BannerResponse" NOT NULL,
    "utmMedium" TEXT,
    "device" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketingBannerConsentCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuylistQuoteDailyCount" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "cardId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BuylistQuoteDailyCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAccessLog" (
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "tokenId" TEXT,
    "screen" TEXT NOT NULL,
    "filters" JSONB,
    "format" TEXT,
    "rowCount" INTEGER,

    CONSTRAINT "MarketingAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPermission_userId_idx" ON "UserPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingApiToken_tokenHash_key" ON "MarketingApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MarketingApiToken_tokenHash_idx" ON "MarketingApiToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBannerConsentCounter_weekStart_response_utmMedium__key" ON "MarketingBannerConsentCounter"("weekStart", "response", "utmMedium", "device");

-- CreateIndex
CREATE INDEX "BuylistQuoteDailyCount_cardId_idx" ON "BuylistQuoteDailyCount"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "BuylistQuoteDailyCount_day_cardId_key" ON "BuylistQuoteDailyCount"("day", "cardId");

-- CreateIndex
CREATE INDEX "MarketingAccessLog_at_idx" ON "MarketingAccessLog"("at");

-- CreateIndex
CREATE INDEX "MarketingAccessLog_actorUserId_idx" ON "MarketingAccessLog"("actorUserId");

-- CreateIndex
CREATE INDEX "MarketingAccessLog_tokenId_idx" ON "MarketingAccessLog"("tokenId");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAccessLog" ADD CONSTRAINT "MarketingAccessLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MarketingApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
