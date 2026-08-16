-- M-15 (v1.3.1): Gestión de usuarios por admin (M6) — reset de contraseña + borrado híbrido.
-- UserStatus gana `deleted` (soft-delete/anonimizado); User gana campos de gestión de cuenta
-- y `tokenVersion` para revocar sesiones (el JWT lleva la versión y el guard la compara).

-- Nuevo valor del enum de estado de cuenta (soft-deleted/anonimizada).
ALTER TYPE "UserStatus" ADD VALUE 'deleted';

-- Campos de gestión de cuenta. `tokenVersion` se incrementa en reset/soft-delete.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "anonymizedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
