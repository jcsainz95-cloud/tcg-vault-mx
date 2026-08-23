-- M-40 (v1.42-sealed-identity-everywhere, BLOQ-2b, WS «Inventario y vault»): identidad de SELLADO en la
-- cola de precio pendiente (`PendingPriceEntry`). El operador de M2 ve «ETB …» en vez de «sealed» ambiguo, y
-- dos presentaciones del mismo set (ETB vs blíster) dejan de COLAPSAR bajo el gradeKey legacy 'sealed':
-- `sealedProductId` entra a la clave lógica de dedupe/escalada (misma mecánica que `finish` M-19 y
-- `cardProductId` M-32). ARCHITECTURE §11 (M-40) / API_CONTRACT changelog v1.42-sealed-identity-everywhere.
--
-- ADITIVA Y REVERSIBLE: una columna FK nullable + su índice + la constraint FK; SIN `DROP`, SIN backfill
-- destructivo, con la app corriendo. `backend/prisma/` es ZONA COMPARTIDA → el orquestador SERIALIZA M-40.
--
-- Money-safe: la columna NO fija precio. Un sellado sin `sealedProductId` (raw/graded, o sellado legacy que
-- el backfill P-38 no ligó) queda `null` y sigue el comportamiento previo (puede colapsar bajo 'sealed' hasta
-- curarse en M2): SIEMPRE pendiente, JAMÁS 0. Sin backfill obligatorio (las entradas `open` existentes
-- quedan con `sealedProductId=null`).
--
-- `onDelete: SET NULL` (NO cascade): si un `SealedProduct` se borrara en duro, el pendiente sobrevive con
-- identidad degradada a null (no se pierde la cola). En la práctica el catálogo hace SOFT-delete
-- (`active=false`), así que este SET NULL es defensa en profundidad.

-- PASO 1 — columna FK nullable (regla de aplicación: poblada solo para productType='sealed').
ALTER TABLE "PendingPriceEntry" ADD COLUMN "sealedProductId" TEXT;

-- PASO 2 — índice que sirve el `findFirst` de dedupe/escalada por identidad de sellado.
CREATE INDEX "PendingPriceEntry_sealedProductId_idx" ON "PendingPriceEntry"("sealedProductId");

-- PASO 3 — FK → SealedProduct, onDelete SET NULL (money-safe: no huerfana la cola).
ALTER TABLE "PendingPriceEntry"
    ADD CONSTRAINT "PendingPriceEntry_sealedProductId_fkey" FOREIGN KEY ("sealedProductId") REFERENCES "SealedProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
