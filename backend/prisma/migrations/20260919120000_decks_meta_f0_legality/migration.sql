-- DECKS-META §2 (Fase 0) — LEGALIDAD EN EL CATÁLOGO (DECKS_META_ARCH.md §2 / ARCHITECTURE §12.1).
-- El catálogo NO guarda legalidad hoy (medido, M1/M2). Sin esto no se puede afirmar «legal en
-- Standard». Se añade la PROCEDENCIA CRUDA del proveedor (marca de regulación + string de
-- legalidad) y se DERIVA la legalidad en lectura contra una ventana de config (§2.3). Así la
-- rotación anual es una EDICIÓN DE CONFIG, no un re-sync ni un backfill de cada carta.
--
-- ADITIVA PURA Y SEGURA CON LA APP CORRIENDO: dos columnas nullable. SIN `DROP`, SIN `NOT NULL`,
-- SIN `DEFAULT`, SIN tocar índices ni la `@@unique(externalId)`, SIN reescribir una sola fila.
-- `ADD COLUMN` nullable sin default es instantáneo en Postgres (solo metadata, no toca el heap).
-- El código vigente ignora las columnas porque no las selecciona.
--
-- MONEY-SAFE POR CONSTRUCCIÓN: la legalidad es DERIVADA (no hay booleano persistido) y ni el
-- precio ni las órdenes ni el binder leen estas columnas. Ningún importe puede moverse por esta
-- migración: no hay `UPDATE`/`DELETE`/`TRUNCATE`, y el único `INSERT` toca `ConfigSetting`
-- (config), nunca `Card` (datos). El seed es IDEMPOTENTE (`ON CONFLICT DO NOTHING`): nunca pisa
-- una ventana que el operador ya haya elegido.
--
-- BACKFILL: progresivo e idempotente vía el sync de catálogo (`catalog-metadata-sync`), que a
-- partir de ahora mapea estos campos con NO-DEGRADACIÓN (§2.2/§2.5). Hasta que una carta se
-- puebla, `isLegalStandardNow` la trata como NO legal (conservador, money-safe). Verificación del
-- payload en vivo: PRODUCCIÓN (egress a api.pokemontcg.io bloqueado en dev, M9); en dev/CI, fixture.
--
-- ROLLBACK (limpio, sin pérdida — la foto anterior no aplica, no se transforma ni borra nada):
--   DROP INDEX "Card_regulationMark_idx";
--   ALTER TABLE "Card" DROP COLUMN "regulationMark";
--   ALTER TABLE "Card" DROP COLUMN "legalStandardRaw";
--   DELETE FROM "ConfigSetting" WHERE "key" IN
--     ('standard.active_regulation_marks','standard.banlist_card_ids');

-- PASO 1 — `regulationMark`: `RemoteCard.regulationMark` ("F"/"G"/"H"/"I"…). PROCEDENCIA cruda.
-- Nullable: promos/sets viejos sin marca, o carta aún no re-sincronizada. `null` ⇒ NO legal (§2.3).
ALTER TABLE "Card" ADD COLUMN "regulationMark" TEXT;

-- PASO 2 — `legalStandardRaw`: `RemoteCard.legalities.standard` ("Legal"|"Banned"); ausente ⇒ null.
-- Banda de seguridad para bans explícitos del proveedor.
ALTER TABLE "Card" ADD COLUMN "legalStandardRaw" TEXT;

-- PASO 3 — índice de LECTURA (no UNIQUE): sirve la sustitución legal y la evaluación por lote (§2.1).
CREATE INDEX "Card_regulationMark_idx" ON "Card"("regulationMark");

-- PASO 4 — seed IDEMPOTENTE de la ventana de config de arranque (§2.3). La operación la ajusta
-- luego desde `PUT /admin/config/standard-legality` (Fase 1). `ON CONFLICT DO NOTHING` = nunca
-- pisa lo que el operador ya haya elegido.
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('standard.active_regulation_marks', '["G","H","I"]'::jsonb, 'migration:decks-meta-f0', NOW()),
       ('standard.banlist_card_ids', '[]'::jsonb, 'migration:decks-meta-f0', NOW())
ON CONFLICT ("key") DO NOTHING;
