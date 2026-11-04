-- M-97 — `m97_auth_token_email_binding` (v1.117.2⟨cuenta-correo⟩). Contrato: API_CONTRACT §CTA.13. Diseño: ARCHITECTURE §16.1
-- D-CTA-11 y §16.4. Va DESPUÉS de M-96 (`20261113120000_m96_auth_token_account_setup`). Aditiva, un paso.
--
-- QUÉ HACE (PT-CTA-1, PT-CTA-4):
--  (1) `AuthToken.emailHash` = sha256hex del correo al que se mandó el enlace (ATADURA: el canje exige que case con el correo
--      actual de la cuenta);
--  (2) relleno de los VIVOS con el correo actual de su cuenta, en SQL bit a bit igual que Node (`convert_to(…, 'UTF8')`, sin
--      `lower()`: el correo se hashea tal como está guardado). Los enlaces vivos al desplegar siguen valiendo;
--  (3) anula (`usedAt = now()`) los vivos que no se pueden atar (cuenta sin correo) y los vivos DUPLICADOS por
--      ("userId", "type"), conservando el más nuevo ("createdAt" DESC, "id" DESC);
--  (4) índice único parcial: a lo sumo UNO vivo por cuenta y tipo;
--  (5) CHECK: todo vivo lleva `emailHash`.
-- Requiere Postgres ≥ 11 (`sha256()`): NO MEDIDO en Railway (API_CONTRACT §CTA.12, lo cierra devops con `SHOW server_version`).
--
-- REVERSA (hace falta si se revierte el CÓDIGO: el viejo rota sin candado y el índice le daría 5xx en una carrera). Documentada,
-- NO automática; CTA-B14m la ejecuta en las dos direcciones:
-- REVERSA:BEGIN
--   DROP INDEX IF EXISTS "AuthToken_one_live_per_user_type";
--   ALTER TABLE "AuthToken" DROP CONSTRAINT IF EXISTS "AuthToken_live_has_email_hash", DROP COLUMN IF EXISTS "emailHash";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261114120000_m97_auth_token_email_binding';
-- REVERSA:END

-- (1)
ALTER TABLE "AuthToken" ADD COLUMN "emailHash" TEXT;

-- (2)
UPDATE "AuthToken" t SET "emailHash" = encode(sha256(convert_to(u."email", 'UTF8')), 'hex') FROM "User" u WHERE t."userId" = u."id" AND t."usedAt" IS NULL AND u."email" IS NOT NULL;

-- (3) vivos sin atadura posible
UPDATE "AuthToken" SET "usedAt" = now() WHERE "usedAt" IS NULL AND "emailHash" IS NULL;

-- (3) vivos duplicados: se conserva el más nuevo por ("userId", "type")
UPDATE "AuthToken" t SET "usedAt" = now() FROM (SELECT "id", row_number() OVER (PARTITION BY "userId", "type" ORDER BY "createdAt" DESC, "id" DESC) AS rn FROM "AuthToken" WHERE "usedAt" IS NULL) d WHERE t."id" = d."id" AND d.rn > 1;

-- (4)
CREATE UNIQUE INDEX "AuthToken_one_live_per_user_type" ON "AuthToken"("userId", "type") WHERE "usedAt" IS NULL;

-- (5)
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_live_has_email_hash" CHECK ("usedAt" IS NOT NULL OR "emailHash" IS NOT NULL);
