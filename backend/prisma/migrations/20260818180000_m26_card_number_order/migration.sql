-- M-26 (v1.22-variantes-orden, ARCHITECTURE §11 / §4.22b) — ORDEN NATURAL PERSISTIDO del número
-- de carta. Estrictamente ADITIVA: dos columnas NOT NULL con DEFAULT, un backfill y un índice.
-- No hay DROP, ni enums, ni cambios de nulabilidad, y NO toca `availableFinishes` (el arreglo de
-- variantes es solo código + re-sync, §4.22a/§4.22d). Segura con la app corriendo: hasta que el
-- nuevo código despliegue, nadie lee estas columnas.

ALTER TABLE "Card" ADD COLUMN "numberSort"   INTEGER NOT NULL DEFAULT 1000000;
ALTER TABLE "Card" ADD COLUMN "numberPrefix" TEXT    NOT NULL DEFAULT '';

-- Backfill: espejo 1:1 de `deriveNumberParts` (backend/src/common/card-order.ts), incluido el
-- clamp a 999999 vía `numeric` para no desbordar el INTEGER con un `number` de muchos dígitos.
UPDATE "Card" SET
  "numberSort" = CASE
    WHEN "number" ~ '^[0-9]+$'
      THEN LEAST(("number")::numeric, 999999)::int
      ELSE 1000000 + LEAST(
             COALESCE(NULLIF(regexp_replace("number", '\D', '', 'g'), '')::numeric, 0),
             999999)::int
  END,
  "numberPrefix" = CASE
    WHEN "number" ~ '^[0-9]+$' THEN ''
    ELSE regexp_replace("number", '[0-9]', '', 'g')
  END;

CREATE INDEX "Card_setId_numberPrefix_numberSort_idx"
  ON "Card" ("setId", "numberPrefix", "numberSort");
