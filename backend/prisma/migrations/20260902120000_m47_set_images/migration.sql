-- M-47 — migración `v1.52-set-logos` (ARCHITECTURE §11 / §4.39.3).
-- LAS IMÁGENES DE LA EXPANSIÓN. `CardSet` gana las dos URLs que pokemontcg.io ya publica en la MISMA
-- respuesta que el sync de metadata ya descarga: `images.logo` (el nombre del set dibujado — la teja de
-- selección de set que pidió el dueño) e `images.symbol` (el glifo cuadrado impreso en la carta).
--
-- ADITIVA PURA Y SEGURA CON LA APP CORRIENDO: dos columnas nullable. SIN `DROP`, SIN `NOT NULL`, SIN
-- default, SIN tocar índices ni la `@@unique(externalId)`, SIN reescribir una sola fila. El código
-- vigente las ignora porque no las selecciona.
--
-- MONEY-SAFE POR CONSTRUCCIÓN: `CardSet` NO participa en ningún cálculo de dinero (no hay precio, ni
-- referencia, ni regla, ni curva que lea metadata de set). Estas dos columnas son display-only, en la
-- misma categoría que `sealedImageUrl` (§4.34a). Ningún importe puede moverse por esta migración, ni
-- siquiera por un error de implementación: no hay ruta de código que lo permita.
--
-- SIN VENTANA, SIN CONGELACIÓN, SIN CUT-OVER (contrastar con M-43/M-45, que SÍ los exigían porque
-- tocaban la clasificación de una fila de precio; aquí no hay nada de eso, y se dice explícitamente
-- para que nadie prepare una ventana que no existe).
--
-- SIN BACKFILL DE DATOS: no hay `UPDATE`, no hay script, no hay endpoint y no lo habrá (§4.39.4). Las
-- columnas se pueblan RE-CORRIENDO el sync existente (`upsertSet()` es el escritor único de metadata de
-- set y ya es idempotente y auditado): `POST /admin/catalog/sync { setId }` por set — el botón por fila
-- que M2 ya tiene — basta para los sets que la retícula muestra. Los sets NUEVOS llegan poblados desde
-- el primer sync posterior al deploy, sin hacer nada. `sync-all { force:true }` los puebla también, pero
-- es el martillo (re-importa todo el catálogo y re-corre el resolver TCGCSV) y NO es un paso obligatorio
-- de este pase.
--
-- ROLLBACK: revertir el CÓDIGO es suficiente; las columnas pueden quedarse inertes. Se revierte sin
-- ceremonia y sin ventana.

-- PASO 1 (M-47.1) — `logoUrl`: `images.logo`. La teja de selección de set. `null` LEGÍTIMO Y PERMANENTE
-- (promos, colecciones raras, sets viejos que el proveedor no ilustra) e indistinguible —a propósito—
-- de «set aún no re-sincronizado». Se proyecta como `logoUrl: string | null` (clave SIEMPRE presente)
-- en `MasterSetSummaryDTO` y en `GET /buylist/sets` (§4.39.5).
ALTER TABLE "CardSet" ADD COLUMN "logoUrl" TEXT;

-- PASO 2 (M-47.2) — `symbolUrl`: `images.symbol`. SE PERSISTE Y NO SE EXPONE en ningún DTO de este pase
-- (§4.39.5). Se guarda ahora porque viene en la misma respuesta a coste cero; evitarlo obligaría a OTRA
-- migración + OTRO re-sync el día que exista el chip donde el logo no cabe (§4.39.2, razón 1).
ALTER TABLE "CardSet" ADD COLUMN "symbolUrl" TEXT;
