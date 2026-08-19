-- M-27 (v1.22-1, ARCHITECTURE §11 / §4.22g) — SEÑALES DE ACABADO como DOS columnas de ENTRADA
-- persistidas, de las que `Card.availableFinishes` pasa a DERIVARSE:
--   availableFinishes := orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']
-- Estrictamente ADITIVA: dos columnas array NOT NULL con DEFAULT vacío y un backfill. No hay DROP,
-- ni cambios de nulabilidad, ni se toca la FORMA de `availableFinishes` (sigue igual para todos los
-- lectores). Segura con la app corriendo: hasta que el nuevo código despliegue, nadie lee estas
-- columnas; y el único escritor de `availableFinishes` (FinishReconciler) las recomputa determinista.

ALTER TABLE "Card" ADD COLUMN "catalogFinishes"        "Finish"[] NOT NULL DEFAULT ARRAY[]::"Finish"[];
ALTER TABLE "Card" ADD COLUMN "pricedFinishesSnapshot" "Finish"[] NOT NULL DEFAULT ARRAY[]::"Finish"[];

-- Backfill: siembra `catalogFinishes` con el valor de catálogo YA materializado en
-- `availableFinishes`, para NO perder lo que ya sabíamos si pokemontcg.io está caído (502). El
-- snapshot de PPT (`pricedFinishesSnapshot`) queda vacío; lo puebla `price-ingest` en la 1ª corrida.
UPDATE "Card" SET "catalogFinishes" = "availableFinishes";
