-- M-18 (v1.6-finish): Acabado/versión de carta (finish) en TODA la cadena.
-- ARCHITECTURE §3.7, §4.1, §4.2.1, §11 / API_CONTRACT changelog v1.6-finish.
-- Aditiva con default SEGURO (`normal` / `[normal]`): las filas históricas quedan operables
-- sin re-sync; el RE-SYNC del catálogo repuebla availableFinishes y las PriceReference por acabado.

-- CreateEnum
CREATE TYPE "Finish" AS ENUM ('normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil');

-- Card.availableFinishes: acabados en que existe la carta (derivados de tcgplayer.prices al importar).
-- Sigue siendo 1 fila por externalId; esto es un array en la MISMA fila. Default seguro [normal].
ALTER TABLE "Card" ADD COLUMN "availableFinishes" "Finish"[] DEFAULT ARRAY['normal']::"Finish"[];

-- PriceReference.finish: acabado ortogonal a gradeKey; referencia de precio POR acabado.
ALTER TABLE "PriceReference" ADD COLUMN "finish" "Finish" NOT NULL DEFAULT 'normal';

-- InventoryItem.finish: acabado de la copia física (afecta valuación y catálogo "Compra").
ALTER TABLE "InventoryItem" ADD COLUMN "finish" "Finish" NOT NULL DEFAULT 'normal';

-- SellRequestItem.finish: snapshot del acabado aplicado en la cotización/solicitud.
ALTER TABLE "SellRequestItem" ADD COLUMN "finish" "Finish" NOT NULL DEFAULT 'normal';

-- La clave única de PriceReference gana `finish`: `normal` y `reverse_holo` de la misma carta
-- tienen referencia distinta (una fila por día POR acabado).
DROP INDEX "PriceReference_cardId_productType_gradeKey_capturedDate_key";
CREATE UNIQUE INDEX "PriceReference_cardId_productType_gradeKey_finish_capturedD_key" ON "PriceReference"("cardId", "productType", "gradeKey", "finish", "capturedDate");
