-- M-63 — migración `v1.80.9` (usuarios de back-office SIN correo: el staff entra con nombre de usuario; el correo
-- es solo para clientes · API_CONTRACT §M6-U.1 · ARCHITECTURE §4.58, §11 «v1.80.9-staff-sin-correo» (M-STF)).
--
-- DDL ADITIVO + `DROP NOT NULL`, SIN BACKFILL:
--   · `User.email` deja de ser NOT NULL (solo metadatos; el `UNIQUE` existente admite varios NULL);
--   · 2 columnas nuevas, nullable y sin default: `username` (TEXT, UNIQUE, canónico en minúsculas) y
--     `lockNoticeAt` (TIMESTAMP(3), aviso de candado pendiente en el panel);
--   · 1 índice único nuevo `User_username_key` (columna toda NULL al crearse ⇒ inmediato);
--   · 5 CHECK (SQL a mano, precedente M-62). Validan la tabla `User` entera.
--
-- SIN BACKFILL (criterio 266): toda fila existente tiene `email NOT NULL` (la columna lo era) y `username` nace NULL
-- ⇒ los cinco CHECK se cumplen tal cual. ⛔ Ninguna cuenta existente pierde su correo ni gana usuario.
--
-- ⛔ CERO DINERO movido: ninguna fila cambia.
--
-- REVERSA:
--   · Código: se revierte sin tocar la BD SOLO si no existe ninguna cuenta con `email IS NULL`
--     (`SELECT count(*) FROM "User" WHERE "email" IS NULL` ⇒ 0). Si existe, primero bloquearla o borrarla.
--   · BD (tras revertir el código):
--     ALTER TABLE "User" DROP CONSTRAINT "user_lock_notice_no_email";
--     ALTER TABLE "User" DROP CONSTRAINT "user_no_email_unverified";
--     ALTER TABLE "User" DROP CONSTRAINT "user_username_canonical";
--     ALTER TABLE "User" DROP CONSTRAINT "user_customer_has_email";
--     ALTER TABLE "User" DROP CONSTRAINT "user_login_identity_xor";
--     DROP INDEX "User_username_key";
--     ALTER TABLE "User" DROP COLUMN "lockNoticeAt", DROP COLUMN "username";
--     ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;   -- falla si hay NULL, que es lo correcto
--     DELETE FROM "_prisma_migrations" WHERE migration_name = '20261005120000_m63_staff_username';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN     "username" TEXT,
ADD COLUMN     "lockNoticeAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- ===================================== CHECKs (§M6-U.1) =====================================
-- (1) Exactamente UN identificador por cuenta: una cuenta, un cubo C7 (§4.58.1).
ALTER TABLE "User" ADD CONSTRAINT "user_login_identity_xor" CHECK (("email" IS NULL) <> ("username" IS NULL));
-- (2) Un cliente siempre tiene correo. Con (1) ⇒ un cliente nunca tiene usuario.
ALTER TABLE "User" ADD CONSTRAINT "user_customer_has_email" CHECK ("role" <> 'customer' OR "email" IS NOT NULL);
-- (3) Forma canónica del usuario (criterio 257): 3–30, minúsculas, empieza con letra, sin `@`/espacio/acento/ñ.
ALTER TABLE "User" ADD CONSTRAINT "user_username_canonical" CHECK ("username" IS NULL OR "username" ~ '^[a-z][a-z0-9._-]{2,29}$');
-- (4) Sin correo no hay correo verificado.
ALTER TABLE "User" ADD CONSTRAINT "user_no_email_unverified" CHECK ("email" IS NOT NULL OR NOT "emailVerified");
-- (5) El aviso de candado en el panel es solo para cuentas sin correo (con correo, el aviso va por correo).
ALTER TABLE "User" ADD CONSTRAINT "user_lock_notice_no_email" CHECK ("lockNoticeAt" IS NULL OR "email" IS NULL);
