-- M-67 = `M-SDX-E` — el FOLIO nuestro de cada envío (pieza D2c de Skydropx).
-- Norma: API_CONTRACT §M4-SHIP.19.28.1 (v1.80.12.8: folio `ENV-` + 6 dígitos, secuencia `shipment_folio_seq`, default de
-- BD ⇒ cero escritores en la aplicación, inmutable) con el arreglo de §19.29.1.1 (v1.80.12.9, C-18 / SDX-D-23):
-- ⛔ `lpad(x, 6, '0')` TRUNCA en Postgres un texto de más de 6 caracteres (`lpad('1000000', 6, '0') = '100000'`: el folio
-- 1 000 000 repetiría el 100 000 y chocaría con el `@unique`) ⇒ `lpad(s::text, greatest(6, length(s::text)), '0')`.
-- `HECHOS.md` fila «Skydropx: cada guía lleva NUESTRO FOLIO» (2026-10-04, «pedido 1 2 3 en adelante»).
-- Número asignado por el orquestador; confirmado contra `migrations/` (última previa: `20261007120000_m66_sdx_d_skydropx`).
-- Notas: BACKEND_NOTES §62.
--
-- Por qué una FUNCIÓN y no la expresión en el DEFAULT: la forma de §19.29.1.1 nombra `s` dos veces
-- (`lpad(s::text, greatest(6, length(s::text)), '0')`). Escrita en línea con `nextval(...)` en cada aparición, cada
-- fila consumiría DOS valores y el relleno se calcularía con la longitud del siguiente — un folio de 7 dígitos podría
-- salir mal relleno. `shipment_folio_next()` llama `nextval` UNA vez y formatea ese valor.
--
-- DDL ADITIVO E IDEMPOTENTE (aplicarla dos veces no cambia nada): `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
-- `ADD COLUMN IF NOT EXISTS`, el backfill solo toca filas con `folio IS NULL`, `SET DEFAULT`/`SET NOT NULL` son
-- idempotentes, el índice y el CHECK con `IF NOT EXISTS`.
-- BACKFILL (el único dato que esta migración escribe): las filas existentes reciben `ENV-000001…` en orden
-- `("requestedAt", id)` — el orden de §19.28.1 —, una por una (un bucle, no un `UPDATE … nextval` sobre un conjunto, cuyo
-- orden de evaluación Postgres no garantiza). ⛔ CERO DINERO: ningún importe, estado ni sello cambia.
--
-- REVERSA (código revertido antes; con guías compradas el folio ya viajó a Skydropx en `address_to.reference` y su
-- bitácora lo cita: ⚠️ revertir PIERDE el cruce de las guías existentes — solo mientras
-- `SELECT count(*) FROM "ShipmentLabelAttempt" WHERE "providerReference" IS NOT NULL` = 0, o tras M-68 revertida):
--   ALTER TABLE "ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_folio_format";
--   DROP INDEX IF EXISTS "ShipmentRequest_folio_key";
--   ALTER TABLE "ShipmentRequest" DROP COLUMN IF EXISTS "folio";
--   DROP FUNCTION IF EXISTS shipment_folio_next();
--   DROP SEQUENCE IF EXISTS shipment_folio_seq;
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261008120000_m67_sdx_e_folio';

CREATE SEQUENCE IF NOT EXISTS shipment_folio_seq START 1;

-- UN cuerpo de formato: `ENV-` + al menos 6 dígitos, sin truncar (§19.29.1.1).
CREATE OR REPLACE FUNCTION shipment_folio_next() RETURNS text
  LANGUAGE sql VOLATILE
AS $$
  SELECT 'ENV-' || lpad(s.n::text, greatest(6, length(s.n::text)), '0')
    FROM (SELECT nextval('shipment_folio_seq') AS n) s
$$;

ALTER TABLE "ShipmentRequest" ADD COLUMN IF NOT EXISTS "folio" TEXT;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT "id" FROM "ShipmentRequest" WHERE "folio" IS NULL ORDER BY "requestedAt" ASC, "id" ASC LOOP
    UPDATE "ShipmentRequest" SET "folio" = shipment_folio_next() WHERE "id" = r."id";
  END LOOP;
END $$;

ALTER TABLE "ShipmentRequest" ALTER COLUMN "folio" SET DEFAULT shipment_folio_next();
ALTER TABLE "ShipmentRequest" ALTER COLUMN "folio" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentRequest_folio_key" ON "ShipmentRequest"("folio");

DO $$
BEGIN
  -- Forma (respaldo del default): `ENV-` + 6 o más dígitos. ⛔ Ningún verbo escribe el folio (§19.28.1: inmutable).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipment_folio_format') THEN
    ALTER TABLE "ShipmentRequest" ADD CONSTRAINT "shipment_folio_format" CHECK ("folio" ~ '^ENV-[0-9]{6,}$');
  END IF;
END $$;
