-- M-39 (v1.39-sealed-product-module, P-38, WS «Inventario y vault»): entidad de CATÁLOGO
-- `SealedProduct` + tabla de enlace `SealedSetGroup` — CURA DE RAÍZ de SB-D5 (el alta de sellado
-- dejaba de anclar a un single → «Tropius sealed»). ARCHITECTURE §4.34 + §11 (M-39) / API_CONTRACT
-- changelog v1.39-sealed-product-module.
--
-- ADITIVA Y REVERSIBLE: dos tablas nuevas + una columna FK nullable + dos valores de enum + un enum
-- nuevo; SIN `DROP`, SIN backfill destructivo. Con la app corriendo. `backend/prisma/` es ZONA
-- COMPARTIDA → el orquestador SERIALIZA M-39.
--
-- Money-safe: ninguna de estas tablas/columnas fija precio. El BACKFILL DE DATOS (siembra de
-- `SealedSetGroup` desde items mapeados no derivable en SQL puro, derivación de `SealedProduct` desde
-- inventario mapeado, ligado de `InventoryItem.sealedProductId` y reporte de reconciliación) vive en
-- el script idempotente `prisma/backfill-m39-sealed-product.ts` (pasos §4.34e 7-8): un `ALTER TYPE
-- ADD VALUE` NO puede USARSE en la MISMA transacción que lo agrega, y la derivación necesita la
-- heurística `inferSealedSubtype` — por eso corre APARTE, tras aplicar esta migración. El PASO 6
-- (siembra de `SealedSetGroup(set_main)` desde `CardSet.tcgcsvGroupId`) SÍ va aquí: usa solo el enum
-- NUEVO `SealedGroupKind` (plenamente usable en su tx de creación), no un valor añadido a un enum previo.

-- PASO 1 — enum SealedSubtype += 'upc', 'collection' (aditivo; se APENDA; ningún valor previo cambia).
ALTER TYPE "SealedSubtype" ADD VALUE IF NOT EXISTS 'upc';
ALTER TYPE "SealedSubtype" ADD VALUE IF NOT EXISTS 'collection';

-- PASO 2 — enum nuevo SealedGroupKind.
CREATE TYPE "SealedGroupKind" AS ENUM ('set_main', 'promo_collection');

-- PASO 3 — tabla de enlace set → grupo TCGCSV (1 set → N grupos, §4.34b).
CREATE TABLE "SealedSetGroup" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "tcgplayerGroupId" INTEGER NOT NULL,
    "kind" "SealedGroupKind" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SealedSetGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SealedSetGroup_setId_tcgplayerGroupId_key" ON "SealedSetGroup"("setId", "tcgplayerGroupId");
CREATE INDEX "SealedSetGroup_setId_idx" ON "SealedSetGroup"("setId");
ALTER TABLE "SealedSetGroup"
    ADD CONSTRAINT "SealedSetGroup_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CardSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PASO 4 — entidad de catálogo `SealedProduct` (identidad propia por presentación; §4.34a).
CREATE TABLE "SealedProduct" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "tcgplayerProductId" INTEGER NOT NULL,
    "tcgplayerGroupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cleanName" TEXT,
    "subtype" "SealedSubtype" NOT NULL,
    "subtypeInferred" BOOLEAN NOT NULL DEFAULT true,
    "isPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "origin" "SealedGroupKind" NOT NULL DEFAULT 'set_main',
    "imageUrl" TEXT,
    "marketUsdCents" INTEGER,
    "marketUpdatedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SealedProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SealedProduct_tcgplayerProductId_key" ON "SealedProduct"("tcgplayerProductId");
CREATE INDEX "SealedProduct_setId_idx" ON "SealedProduct"("setId");
CREATE INDEX "SealedProduct_tcgplayerGroupId_idx" ON "SealedProduct"("tcgplayerGroupId");
ALTER TABLE "SealedProduct"
    ADD CONSTRAINT "SealedProduct_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CardSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PASO 5 — InventoryItem.sealedProductId (FK nullable, onDelete SET NULL; index).
ALTER TABLE "InventoryItem" ADD COLUMN "sealedProductId" TEXT;
CREATE INDEX "InventoryItem_sealedProductId_idx" ON "InventoryItem"("sealedProductId");
ALTER TABLE "InventoryItem"
    ADD CONSTRAINT "InventoryItem_sealedProductId_fkey" FOREIGN KEY ("sealedProductId") REFERENCES "SealedProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PASO 6 — BACKFILL de grupos: por cada CardSet con tcgcsvGroupId != null → una fila
-- SealedSetGroup(kind='set_main'). Money-safe (no toca precios). Idempotente vía el unique
-- (setId, tcgplayerGroupId): un ON CONFLICT DO NOTHING deja la corrida repetible. `SealedGroupKind`
-- se creó en el PASO 2 en ESTA misma tx: un enum recién creado es plenamente usable (a diferencia de
-- un valor AÑADIDO a un enum previo — por eso el subtype 'upc'/'collection' NO se usa aquí).
INSERT INTO "SealedSetGroup" ("id", "setId", "tcgplayerGroupId", "kind", "label", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", "tcgcsvGroupId", 'set_main', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CardSet"
WHERE "tcgcsvGroupId" IS NOT NULL
ON CONFLICT ("setId", "tcgplayerGroupId") DO NOTHING;
