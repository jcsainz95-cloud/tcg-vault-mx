-- M-74 — rev v1.87⟨wishlist⟩ (lista de deseos por cuenta · API_CONTRACT §WSH.1 · ARCHITECTURE §4.WSH y §11 «rev v1.87»).
-- Número y carpeta RESERVADOS por el orquestador (accesorios = M-73). Si al fusionar M-73 cae DESPUÉS de `20261027…`,
-- se re-fecha ÉSTA (ARCHITECTURE §11).
--
-- DDL ADITIVO: 1 enum + 3 tablas + 1 columna en `User` + 2 columnas y 1 índice en `SealedRestockSubscription` + 2 CHECK +
-- 8 filas de `ConfigSetting` (los diales de §WSH.2, sembrados como `upsert update:{}`: ON CONFLICT DO NOTHING).
-- ⛔ CERO dinero, inventario o correo movidos. ⛔ SIN relleno: `armedAt`/`matchedAt` NULL es la semántica correcta para las
-- suscripciones que ya existan (§WSH.7 (c)). Cuántas hay en producción: NO MEDIDO — lo cierra, en la ventana de despliegue,
--   SELECT count(*), count(*) FILTER (WHERE "notifiedAt" IS NULL) FROM "SealedRestockSubscription";
--
-- IDEMPOTENTE: `IF NOT EXISTS`, enum en bloque `duplicate_object`, constraints quitar-si-existe-y-poner, siembra ON CONFLICT.
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ PRIMERO se revierte el CÓDIGO, después esto. Se pierden deseos e historial de avisos; ningún dinero ni inventario depende
-- de ellos (API_CONTRACT §WSH.1 «Reversa»).
--   DROP TABLE IF EXISTS "WishlistNotice";
--   DROP TABLE IF EXISTS "WishlistMail";
--   DROP TABLE IF EXISTS "WishlistItem";
--   DROP TYPE IF EXISTS "WishlistNoticeStatus";
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "wishlistAlertsPausedAt";
--   DROP INDEX IF EXISTS "SealedRestockSubscription_email_notifiedAt_idx";
--   ALTER TABLE "SealedRestockSubscription" DROP COLUMN IF EXISTS "armedAt", DROP COLUMN IF EXISTS "matchedAt";
--   DELETE FROM "ConfigSetting" WHERE key IN ('wishlist_enabled','wishlist_max_per_account','wishlist_max_iva_mode',
--     'wishlist_daily_mail_cap','wishlist_mail_window_min','wishlist_target_margin_pct','wishlist_margin_basis',
--     'sealed_restock_max_pending_per_email') AND "updatedBy" = 'migration:m74-wishlist';  -- solo lo no tocado (§11.0)
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027120000_m74_wishlist';
-- ===============================================================================================================================

-- (1) Enum
DO $$ BEGIN
  CREATE TYPE "WishlistNoticeStatus" AS ENUM ('pending', 'sent', 'suppressed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- (2) Columnas nuevas (anulables, sin relleno)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "wishlistAlertsPausedAt" TIMESTAMP(3);
ALTER TABLE "SealedRestockSubscription" ADD COLUMN IF NOT EXISTS "armedAt" TIMESTAMP(3);
ALTER TABLE "SealedRestockSubscription" ADD COLUMN IF NOT EXISTS "matchedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "SealedRestockSubscription_email_notifiedAt_idx" ON "SealedRestockSubscription"("email", "notifiedAt");

-- (3) Tablas
CREATE TABLE IF NOT EXISTS "WishlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "finish" "Finish" NOT NULL,
    "maxPct" INTEGER NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WishlistMail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAt" TIMESTAMP(3),
    CONSTRAINT "WishlistMail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WishlistNotice" (
    "id" TEXT NOT NULL,
    "wishlistItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "status" "WishlistNoticeStatus" NOT NULL DEFAULT 'pending',
    "skipReason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mailId" TEXT,
    "priceDisplayCents" INTEGER,
    "marketCents" INTEGER,
    "maxDisplayCents" INTEGER,
    "fits" BOOLEAN,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "WishlistNotice_pkey" PRIMARY KEY ("id")
);

-- (4) Índices
CREATE UNIQUE INDEX IF NOT EXISTS "WishlistItem_userId_cardId_finish_key" ON "WishlistItem"("userId", "cardId", "finish");
CREATE INDEX IF NOT EXISTS "WishlistItem_cardId_finish_idx" ON "WishlistItem"("cardId", "finish");
-- ⭐ criterio 810: UNA vez por pieza y por cuenta.
CREATE UNIQUE INDEX IF NOT EXISTS "WishlistNotice_userId_inventoryItemId_key" ON "WishlistNotice"("userId", "inventoryItemId");
CREATE INDEX IF NOT EXISTS "WishlistNotice_status_detectedAt_idx" ON "WishlistNotice"("status", "detectedAt");
CREATE INDEX IF NOT EXISTS "WishlistNotice_inventoryItemId_idx" ON "WishlistNotice"("inventoryItemId");
CREATE INDEX IF NOT EXISTS "WishlistMail_userId_sentAt_idx" ON "WishlistMail"("userId", "sentAt");

-- (5) Llaves foráneas (quitar-si-existe-y-poner)
ALTER TABLE "WishlistItem" DROP CONSTRAINT IF EXISTS "WishlistItem_userId_fkey";
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem" DROP CONSTRAINT IF EXISTS "WishlistItem_cardId_fkey";
ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WishlistNotice" DROP CONSTRAINT IF EXISTS "WishlistNotice_wishlistItemId_fkey";
ALTER TABLE "WishlistNotice" ADD CONSTRAINT "WishlistNotice_wishlistItemId_fkey" FOREIGN KEY ("wishlistItemId") REFERENCES "WishlistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistNotice" DROP CONSTRAINT IF EXISTS "WishlistNotice_userId_fkey";
ALTER TABLE "WishlistNotice" ADD CONSTRAINT "WishlistNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- v1.87.2 (API_CONTRACT §WSH.11 (5), ARCHITECTURE §4.WSH (k)): CASCADE, no RESTRICT — un aviso es historia de la pieza;
-- borrar la pieza (limpieza P-DB) se lleva sus avisos. Editada EN SITIO (M-74 no publicada); quitar-y-poner ⇒ re-aplicable.
ALTER TABLE "WishlistNotice" DROP CONSTRAINT IF EXISTS "WishlistNotice_inventoryItemId_fkey";
ALTER TABLE "WishlistNotice" ADD CONSTRAINT "WishlistNotice_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistNotice" DROP CONSTRAINT IF EXISTS "WishlistNotice_mailId_fkey";
ALTER TABLE "WishlistNotice" ADD CONSTRAINT "WishlistNotice_mailId_fkey" FOREIGN KEY ("mailId") REFERENCES "WishlistMail"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WishlistMail" DROP CONSTRAINT IF EXISTS "WishlistMail_userId_fkey";
ALTER TABLE "WishlistMail" ADD CONSTRAINT "WishlistMail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (6) CHECKs (§WSH.1). Comparan `::text` como M-61/M-70/M-72.
ALTER TABLE "WishlistItem" DROP CONSTRAINT IF EXISTS "wishlist_max_pct_allowed";
ALTER TABLE "WishlistItem" ADD CONSTRAINT "wishlist_max_pct_allowed" CHECK ("maxPct" IN (5, 10, 16));
ALTER TABLE "WishlistNotice" DROP CONSTRAINT IF EXISTS "wishlist_notice_skip_reason";
ALTER TABLE "WishlistNotice" ADD CONSTRAINT "wishlist_notice_skip_reason" CHECK (
  ("status"::text = 'skipped' AND "skipReason" IN ('paused', 'unverified', 'inactive', 'unavailable'))
  OR ("status"::text <> 'skipped' AND "skipReason" IS NULL)
);

-- (7) Diales de §WSH.2 (valores EXACTAMENTE `SETTING_DEFAULTS`; candado: test/wishlist.settings.spec.ts). `wishlist_enabled`
-- nace `off`: se enciende DESPUÉS de publicar el aviso de privacidad (criterio 824). Regla §11.0 ≡ upsert update:{}.
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('wishlist_enabled', '"off"'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('wishlist_max_per_account', '20'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('wishlist_max_iva_mode', '"with_iva"'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('wishlist_daily_mail_cap', '3'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('wishlist_mail_window_min', '30'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('wishlist_target_margin_pct', '15'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('wishlist_margin_basis', '"cost"'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP),
       ('sealed_restock_max_pending_per_email', '5'::jsonb, 'migration:m74-wishlist', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
