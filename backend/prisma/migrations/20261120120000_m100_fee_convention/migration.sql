-- M-100 — `m100_fee_convention` (§D9, docs/specs/D9_COMISION.md §3). Comisión de plataforma DENTRO del precio.
-- ADITIVA. Mismo patrón que la convención de precio (M-50): añadir NULLABLE -> backfill EXPLÍCITO -> `SET NOT NULL`,
-- ⛔ SIN `DEFAULT` en ningún instante (un camino de escritura que olvide `feeConvention` debe REVENTAR, no archivar en silencio).
-- Ninguna sentencia toca un importe: solo escribe la convención que esas filas YA TENÍAN (FEE_ON_TOP: total = subtotal + envío + comisión).
-- `stripeFeeCents` es nullable y NO se backfillea (NULL = «aún no leído»; inventar un costo sería falsear el P&L).
-- Reversa (a mano; nada más depende de ellas):
--   ALTER TABLE "Order" DROP COLUMN "feeConvention", DROP COLUMN "stripeFeeCents";
--   ALTER TABLE "ShipmentRequest" DROP COLUMN "feeConvention", DROP COLUMN "stripeFeeCents";
--   DROP TYPE "FeeConvention";

CREATE TYPE "FeeConvention" AS ENUM ('FEE_ON_TOP', 'FEE_INCLUDED');

ALTER TABLE "Order" ADD COLUMN "feeConvention" "FeeConvention";
ALTER TABLE "Order" ADD COLUMN "stripeFeeCents" INTEGER;
ALTER TABLE "ShipmentRequest" ADD COLUMN "feeConvention" "FeeConvention";
ALTER TABLE "ShipmentRequest" ADD COLUMN "stripeFeeCents" INTEGER;

UPDATE "Order" SET "feeConvention" = 'FEE_ON_TOP' WHERE "feeConvention" IS NULL;
UPDATE "ShipmentRequest" SET "feeConvention" = 'FEE_ON_TOP' WHERE "feeConvention" IS NULL;

ALTER TABLE "Order" ALTER COLUMN "feeConvention" SET NOT NULL;
ALTER TABLE "ShipmentRequest" ALTER COLUMN "feeConvention" SET NOT NULL;
