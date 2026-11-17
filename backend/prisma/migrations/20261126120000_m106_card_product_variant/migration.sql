-- §PRICE-PATTERN (m106, docs/DECISIONES.md): nuevo `CardProductKind = variant` — versión alterna de la MISMA carta
-- («X (Master Ball Pattern)», «(Poke Ball)», «(Energy Symbol Pattern)»), con precio propio y FUERA del precio base. ADITIVA (patrón de m95a:
-- `ADD VALUE` se apenda al final; ningún valor previo cambia). La reclasificación de las filas existentes NO va aquí: la hace el job
-- idempotente `pattern-reclassify` (con auditoría y freno de anomalía), no una migración a ciegas.
-- Reversa: Postgres no quita valores de un enum; tras reclasificar de vuelta (`UPDATE "CardProduct" SET kind='set_base' WHERE kind='variant'`)
-- el valor queda sin uso (inofensivo).
ALTER TYPE "CardProductKind" ADD VALUE IF NOT EXISTS 'variant';
