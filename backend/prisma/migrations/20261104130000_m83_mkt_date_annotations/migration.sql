-- M-83 — migración `v1.96⟨mkt-tienda⟩` (OLA 2 · h1 Anotaciones de fecha del Panel, API_CONTRACT §MKT.E / ARCHITECTURE §13.4.6).
-- Número elegido como el siguiente libre tras M-82 (`20261104120000_m82_mkt_panel`); máximo actual en el árbol = m82.
--
-- QUÉ HACE (100% ADITIVO):
--   · enum `MarketingAnnotationKind` (promocion|despliegue|evento).
--   · `MarketingDateAnnotation` — el admin marca un día con una etiqueta (SIN PII) + `destino` (solo promocion);
--     FK `createdByUserId` → User con ON DELETE SET NULL (borrar al autor NO borra la anotación). @@index(date).
--   · Relación inversa `User.marketingAnnotations` (NO altera ninguna columna de `User`).
--
-- SEGURO CON LA APP CORRIENDO: solo `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ADD FOREIGN KEY` sobre una tabla
-- NUEVA. CERO `DROP`, CERO cambio de tipo en modelos ajenos, CERO backfill, CERO dinero.
--
-- ============================================ REVERSA (documentada, NO automática) ============================================
-- Tabla nueva y vacía ⇒ dropearla no pierde ningún dato de negocio. Se revierte DESPUÉS del código (nadie la lee).
-- REVERSA:BEGIN
--   ALTER TABLE "MarketingDateAnnotation" DROP CONSTRAINT IF EXISTS "MarketingDateAnnotation_createdByUserId_fkey";
--   DROP TABLE IF EXISTS "MarketingDateAnnotation";
--   DROP TYPE  IF EXISTS "MarketingAnnotationKind";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104130000_m83_mkt_date_annotations';
-- REVERSA:END

-- CreateEnum
CREATE TYPE "MarketingAnnotationKind" AS ENUM ('promocion', 'despliegue', 'evento');

-- CreateTable
CREATE TABLE "MarketingDateAnnotation" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "MarketingAnnotationKind" NOT NULL,
    "label" TEXT NOT NULL,
    "destino" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDateAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingDateAnnotation_date_idx" ON "MarketingDateAnnotation"("date");

-- AddForeignKey
ALTER TABLE "MarketingDateAnnotation" ADD CONSTRAINT "MarketingDateAnnotation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
