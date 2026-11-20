-- m113 · §DEMANDA (API_CONTRACT_DEMANDA §3.4/§4, DM-1). ADITIVA: solo CREATE INDEX sobre una tabla nueva (m112, aún sin desplegar).
-- Sirve al tope «≤ 10 cardId distintos por persona (hash) y día» (cuenta de filas de `SearchDemandSeen` por (day, h)).
-- REVERSA (documentada, no automática):
--   DROP INDEX "SearchDemandSeen_day_h_idx";   (y retirar `@@index([day, h])` de `SearchDemandSeen` en schema.prisma)
--   Si se revierte m112 completa (DROP de las tres tablas) el índice cae con la tabla.

CREATE INDEX "SearchDemandSeen_day_h_idx" ON "SearchDemandSeen"("day", "h");
