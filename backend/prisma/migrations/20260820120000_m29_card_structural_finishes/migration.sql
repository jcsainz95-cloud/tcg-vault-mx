-- M-29 (v1.26, ARCHITECTURE §11 / §4.24a) — COMPOSICIÓN DE VARIANTES como afirmación ESTRUCTURAL
-- AUTORITATIVA, separada del precio. Nueva columna `Card.structuralFinishes` = «¿en qué impresiones
-- físicas se vende esta carta?» DETECTADA de TCGCSV (`subTypeName`), que ANCLA/REEMPLAZA a
-- `catalogFinishes` (un proxy de precio que el PO rechaza) como entrada del lado catálogo en la
-- unión del reconciliador:
--   availableFinishes := orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']
--
-- Estrictamente ADITIVA: una columna array NOT NULL con DEFAULT vacío + un backfill. No hay DROP,
-- ni cambios de nulabilidad, ni se toca la FORMA de `availableFinishes` (sigue igual para todos los
-- lectores). Segura con la app corriendo: hasta que el nuevo código despliegue, nadie lee esta
-- columna; y el único escritor de `availableFinishes` (FinishReconciler) la recomputa determinista.

ALTER TABLE "Card" ADD COLUMN "structuralFinishes" "Finish"[] NOT NULL DEFAULT ARRAY[]::"Finish"[];

-- Backfill: siembra `structuralFinishes` con el valor ya materializado en `availableFinishes`, para
-- NO perder la composición que ya conocíamos antes de que corra el resolver TCGCSV (first-import o
-- `--force`). El resolver REEMPLAZA este seed SOLO para las cartas que pueda joinear a TCGCSV.
UPDATE "Card" SET "structuralFinishes" = "availableFinishes";
