-- M-43 — migración `v1.50.3-f-graded-estimate-kind` (ARCHITECTURE §11 / §4.38l.4.2).
-- LA NATURALEZA DE LA FILA DE PRECIO. Cierra **INV-D inverso** (GE-1 del pentester, ALTA, reproducido
-- en vivo: un slab PSA 10 que con referencia correcta lista a MX$9,200 quedó publicado a MX$460 —el 5%—
-- heredando la fila del «estimado si se gradea»; con el estimado rancio a −400 días siguió a MX$460).
-- Es la aplicación LITERAL del criterio 55 de `PROJECT.md` («La pieza real manda siempre»): el criterio
-- no tiene dirección, así que una cifra capturada como ESTIMADO no puede gobernar el precio de una
-- pieza real, se haya capturado antes o después.
--
-- ADITIVA PURA Y SEGURA CON LA APP CORRIENDO: un enum nuevo + dos columnas + un índice. SIN `DROP`, SIN
-- backfill obligatorio, SIN tocar la `@@unique`, SIN UPDATE de dinero.
-- `backend/prisma/` es ZONA COMPARTIDA → el orquestador SERIALIZA M-43.
--
-- POR QUÉ `@default('market')` HACE LA MIGRACIÓN SEGURA POR CONSTRUCCIÓN: toda fila existente conserva
-- exactamente el significado que ya tenía ⇒ **migrar no puede despublicar ni mover ningún precio**. El
-- efecto de M-43 lo produce el CÓDIGO (el predicado de exclusión `MONEY_REF_WHERE`), no el DDL.
--
-- POR QUÉ NO HAY BACKFILL: la vía de captura del estimado (`intent`) vive en esta rama y NUNCA se
-- desplegó ⇒ expectativa declarada en producción: **cero** filas de estimado. Es EXPECTATIVA, no
-- supuesto: el paso 1 del cut-over (§4.38l.4.7) la CUENTA antes de migrar y, si no da cero, se
-- clasifica con la lista de coexistencia (`/review?reason=SLAB_PUBLISHED`: con slab ⇒ `market`, sin
-- slab ⇒ `graded_estimate`) DESPUÉS de re-afirmar cada slab con `intent:"market"`. El procedimiento es
-- obligatorio y EN ESE ORDEN: sin el paso de re-afirmación, un slab puede apagarse en silencio.
--
-- ROLLBACK: revertir el CÓDIGO (el predicado) es suficiente. La columna es aditiva y **se queda**:
-- dejarla sin código que la lea es inocuo; quitarla con código vivo, no. NO se revierte en caliente.

-- PASO 1 (M-43.1) — enum PriceRefKind: NATURALEZA (qué afirma el número), ORTOGONAL a `PriceSource`
-- (procedencia: quién lo produjo). `PriceSource` NO cambia: ordenar no excluye (§4.38l.4.1).
CREATE TYPE "PriceRefKind" AS ENUM ('market', 'graded_estimate');

-- PASO 2 (M-43.2) — la columna. NO entra a la `@@unique`: para una carta+grado+día sigue habiendo UNA
-- sola fila, sea de la naturaleza que sea (las dos son mutuamente excluyentes por INV-D; la transición
-- cambia la naturaleza de la fila del día, no crea una segunda).
ALTER TABLE "PriceReference" ADD COLUMN "refKind" "PriceRefKind" NOT NULL DEFAULT 'market';

-- PASO 3 (M-43.3) — fecha de la EVIDENCIA de mercado (§4.38m.2), distinta de `capturedDate` (el día en
-- que jalamos el archivo). `null` en la vía manual. Empaquetada aquí para no pagar una segunda ventana:
-- hoy ningún escritor la puebla y ninguna lectura la consume.
ALTER TABLE "PriceReference" ADD COLUMN "evidenceDate" DATE;

-- PASO 4 — índice por naturaleza. `MONEY_REF_WHERE` entra por `AND` en lecturas que YA filtran por
-- `cardId` (índice existente); éste sirve a los censos/barridos por naturaleza del cut-over.
CREATE INDEX "PriceReference_refKind_idx" ON "PriceReference"("refKind");
