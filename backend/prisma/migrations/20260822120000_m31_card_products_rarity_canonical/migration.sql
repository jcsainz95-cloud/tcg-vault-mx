-- M-31 (v1.29-tcgcsv-productos-por-variante, ARCHITECTURE §11 / §4.27 / §4.28) — «1 carta ↔ N
-- productos TCGplayer» por `productId` EXACTO + rareza CANÓNICA. ESTRICTAMENTE ADITIVA: enum nuevo,
-- tabla nueva, columnas nuevas nullable, un valor de enum nuevo y backfills UPDATE/INSERT. NO dropea
-- ninguna columna: `Card.structuralFinishes`/`catalogFinishes`/`pricedFinishesSnapshot` quedan MUERTAS
-- (dejan de leerse) pero se conservan para REVERSIBILIDAD (el resolver viejo aún las encuentra si hay
-- que revertir el deploy); se retiran en una migración POSTERIOR una vez validado en prod.
-- Segura con la app corriendo: hasta que el código nuevo despliegue, nadie lee lo nuevo; el resolver
-- por-set (`--force`) puebla CardProduct/precios de forma determinista y money-safe.

-- 1) Enum nuevo: naturaleza del producto TCGplayer bajo una carta de colección (§4.27b).
CREATE TYPE "CardProductKind" AS ENUM ('set_base', 'deck_exclusive', 'promo', 'other');

-- 2) Valor de enum nuevo: PRIMARIO de precio de SINGLES por variante (§4.27f). Distinto de `tcgcsv`
--    (sellado). NO se usa dentro de esta migración (evita el conflicto de "unsafe use of new value").
ALTER TYPE "PriceSource" ADD VALUE IF NOT EXISTS 'tcgcsv_singles';

-- 3) Columna nueva `Card.rarityCanonical` (nullable). Aquí se SIEMBRA con el `rarity` CRUDO como valor
--    money-safe transitorio (el lookup de reglas normaliza AMBOS lados en runtime, §4.28c) para que
--    ningún consumidor quede en null. NO existe data-migration aparte: el valor CANÓNICO real lo puebla
--    el RE-SYNC FORZADO por set (`sync {setId, force:true}` → `upsertCards` escribe
--    `rarityCanonical = normalizeRarity(rarity)`), que ADEMÁS es obligatorio para poblar `CardProduct`.
--    Consecuencia conocida hasta ese re-sync: el `groupBy(['rarityCanonical','rarity'])` del admin
--    agrupa las filas pre-M31 por el string CRUDO. El PRICING no se ve afectado (re-normaliza ambos
--    lados). Ver `docs/TECH_DEBT.md` (M-31: re-sync forzado total requerido para el release).
ALTER TABLE "Card" ADD COLUMN "rarityCanonical" TEXT;
UPDATE "Card" SET "rarityCanonical" = "rarity" WHERE "rarity" IS NOT NULL;

-- 4) Tabla nueva `CardProduct` (§4.27b). Un producto TCGplayer por `productId` bajo una carta.
CREATE TABLE "CardProduct" (
  "id"                 TEXT NOT NULL,
  "cardId"             TEXT NOT NULL,
  "tcgplayerProductId" INTEGER NOT NULL,
  "kind"               "CardProductKind" NOT NULL DEFAULT 'set_base',
  "name"               TEXT NOT NULL,
  "finishes"           "Finish"[] DEFAULT ARRAY[]::"Finish"[],
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CardProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CardProduct_tcgplayerProductId_key" ON "CardProduct"("tcgplayerProductId");
CREATE INDEX "CardProduct_cardId_idx" ON "CardProduct"("cardId");
CREATE INDEX "CardProduct_cardId_kind_idx" ON "CardProduct"("cardId", "kind");
ALTER TABLE "CardProduct"
  ADD CONSTRAINT "CardProduct_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) Backfill de `CardProduct` (§4.27g): por cada `Card` con `tcgplayerId` numérico, un `set_base`
--    con SU productId y los acabados ya materializados (structuralFinishes si existe, si no
--    availableFinishes). Preserva la composición que M-29 ya conocía como SEMILLA del set_base; el
--    `--force` por set la REEMPLAZA con la lectura EXACTA de la fuente. ON CONFLICT DO NOTHING: si dos
--    cartas comparten `tcgplayerId` (anomalía), gana la primera (money-safe; observabilidad posterior).
INSERT INTO "CardProduct" ("id", "cardId", "tcgplayerProductId", "kind", "name", "finishes", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c."id",
  c."tcgplayerId"::integer,
  'set_base'::"CardProductKind",
  c."name",
  CASE
    WHEN COALESCE(array_length(c."structuralFinishes", 1), 0) > 0 THEN c."structuralFinishes"
    ELSE c."availableFinishes"
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Card" c
WHERE c."tcgplayerId" ~ '^[0-9]+$'
ON CONFLICT ("tcgplayerProductId") DO NOTHING;

-- 6) `PriceReference.cardProductId` (nullable) + FK. Entra a la `@@unique` (§4.27b). Las filas
--    existentes quedan con `cardProductId = NULL` (graded/sealed y el fallback PPT/pokemontcg.io); el
--    re-sync por set re-emite las de SINGLES como `tcgcsv_singles` con su `cardProductId`. NINGUNA fila
--    se borra (money-safe: no se pierde precio). La `@@unique` vieja se REEMPLAZA por la de 6 columnas.
ALTER TABLE "PriceReference" ADD COLUMN "cardProductId" TEXT;
ALTER TABLE "PriceReference"
  ADD CONSTRAINT "PriceReference_cardProductId_fkey" FOREIGN KEY ("cardProductId") REFERENCES "CardProduct"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PriceReference_cardProductId_idx" ON "PriceReference"("cardProductId");

DROP INDEX IF EXISTS "PriceReference_cardId_productType_gradeKey_finish_capturedDa_key";
-- NULLS NOT DISTINCT (Postgres 15+): para `cardProductId = NULL` (graded/sealed/fallback) la clave se
-- comporta «como hoy» (un solo renglón por (carta, productType, gradeKey, finish, día)); para SINGLES
-- (cardProductId no-null) el productId es el ancla exacta. Si el motor es < PG15, ver BACKEND_NOTES
-- (M-31): sustituir por índice normal + invariante de upsert a nivel de aplicación.
-- Nombre acortado a propósito (< 63 chars, límite de identificador de Postgres); el runtime de Prisma
-- usa la CLAVE COMPUESTA del `@@unique`, no el nombre del índice, así que no depende de este nombre.
CREATE UNIQUE INDEX "PriceReference_variant_capturedDate_key"
  ON "PriceReference"("cardId", "productType", "gradeKey", "finish", "capturedDate", "cardProductId")
  NULLS NOT DISTINCT;
