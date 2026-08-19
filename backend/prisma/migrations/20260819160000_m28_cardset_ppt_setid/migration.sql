-- M-28 (WS-A fix-ppt, 2026-08-19) — MAPEO de set al proveedor de PAGA PokemonPriceTracker (API v2).
-- Causa raíz del bug de producción "0 entradas crudas → 0 filas mapeadas en TODOS los sets": el
-- adapter enviaba `GET /api/v2/cards?setId=<externalId>` con el id de pokemontcg.io (`sv8`), que PPT
-- NO reconoce como set. La columna cachea el setId REAL de PPT (GroupId numérico de TCGplayer, p. ej.
-- "1407", o el slug `sv-prismatic-evolutions` como respaldo), resuelto una sola vez desde
-- `GET /api/v2/sets` por el `PptSetMapper` (empate por nombre normalizado + año de releaseDate).
--
-- Estrictamente ADITIVA y segura con la app corriendo: una columna nullable sin default y sin índice.
-- `null` = aún no mapeado; el mapper la puebla en la 1ª corrida y los sets sin match quedan `null`
-- (se loguean). Ningún lector previo la referencia. No hay DROP ni cambios de nulabilidad.

ALTER TABLE "CardSet" ADD COLUMN "pptSetId" TEXT;
