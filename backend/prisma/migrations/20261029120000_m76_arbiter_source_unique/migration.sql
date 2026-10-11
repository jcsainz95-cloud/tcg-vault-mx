-- M-76 (errata v1.91⟨precios⟩, BLOQ-1 de QA — API_CONTRACT §PRE.J / ARCHITECTURE §4.PRE (i))
--
-- `source` ENTRA a la unicidad de `PriceReference` (6 → 7 campos). Motivo medido por QA contra
-- Postgres: el índice de M-31/M-33 `PriceReference_variant_capturedDate_key` es sobre 6 columnas
-- `(cardId, productType, gradeKey, finish, capturedDate, cardProductId)` con NULLS NOT DISTINCT y SIN
-- `source`. Como `tcgdex` y `cardmarket` se persisten AMBOS con `cardProductId = NULL`, mismo
-- `productType/gradeKey/finish` y mismo día, el índice los trata como la MISMA clave ⇒ la 2ª fuente
-- lanza P2002 y sólo sobrevive una ⇒ el árbitro nunca ve `familyCount = 2` para singles raw sin
-- cobertura tcgcsv (Prismatic: Archaludon/Noctowl) ⇒ nunca consenso ⇒ el ~MX$1.84 automático NO se
-- cumple. Añadir `source` hace coexistir las fuentes el mismo día por variante.
--
-- ⛔ NO reescribe NI borra NINGUNA fila; NINGÚN precio se mueve (añadir una columna EXISTENTE a un
-- índice no toca datos). `source` es NOT NULL (enum `PriceSource`), así que NULLS NOT DISTINCT sigue
-- afectando SÓLO a `cardProductId` — comportamiento idéntico a hoy para graded/sealed/fallback (un
-- renglón por variante/día/source). Si el motor fuera < PG15, aplica la misma nota de M-31 (índice
-- normal + invariante de upsert por aplicación).
--
-- El runtime de Prisma usa la CLAVE COMPUESTA del `@@unique` (ahora
-- `..._cardProductId_source`), NO el nombre del índice; el nombre se mantiene corto (< 63 chars).

-- ============================================ REVERSA (documentada, NO automática) ============================================
-- ⚠️ Se revierte DESPUÉS del código. Vuelve al índice de 6 campos de M-31/M-33 (sin `source`). ⚠️ Si la
-- base ya tiene DOS filas que difieren SÓLO en `source` en la cubeta `cardProductId=null` (p. ej. tcgdex
-- + cardmarket del mismo día), recrear el índice de 6 campos FALLARÍA: hay que colapsarlas antes. La app
-- vieja no las produce, así que tras revertir el código el conjunto no crece.
-- REVERSA:BEGIN
-- DROP INDEX IF EXISTS "PriceReference_variant_src_capturedDate_key";
-- CREATE UNIQUE INDEX "PriceReference_variant_capturedDate_key" ON "PriceReference"("cardId","productType","gradeKey","finish","capturedDate","cardProductId") NULLS NOT DISTINCT;
-- DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029120000_m76_arbiter_source_unique';
-- REVERSA:END

DROP INDEX IF EXISTS "PriceReference_variant_capturedDate_key";

CREATE UNIQUE INDEX "PriceReference_variant_src_capturedDate_key"
  ON "PriceReference"("cardId", "productType", "gradeKey", "finish", "capturedDate", "cardProductId", "source")
  NULLS NOT DISTINCT;
