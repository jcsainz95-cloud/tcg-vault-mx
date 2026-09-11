-- M-54 — migración `v1.69` (P-78 · ARCHITECTURE §4.49.3 · API_CONTRACT §M6-K.4).
-- DDL ADITIVO, nullable, SIN default, SIN backfill y SIN índices.
--
-- SERIALIZACIÓN: va DESPUÉS de M-53 (`20260911130000_m53_reservation_owner`, ya en `main`). Los
-- modelos son DISJUNTOS (`KycProfile` aquí; `InventoryItem`/`Order` allá), así que lo único que
-- había que ordenar era la secuencia de migraciones, no el contenido (§4.49.5).
--
-- QUÉ AÑADE, y por qué son TRES columnas y no dos reusadas:
--   · `rejectionReason` — el motivo que el `super_admin` escribe al rechazar. 3–500 tras `trim()`,
--     validado EN LA APLICACIÓN (igual que `SellRequestItem.rejectionReason`, M-22): la BD no
--     estrena una `CHECK` que la app ya impone y que tendría que migrarse para cambiar el rango.
--   · `reviewedAt` / `reviewedBy` — CUÁNDO y QUIÉN **decidió**, incluido el rechazo.
--     ⛔ `verifiedAt`/`verifiedBy` NO se reinterpretan: siguen siendo «cuándo/quién VERIFICÓ».
--     Dos hechos, dos columnas — sellar un rechazo en `verifiedAt` produce una columna que miente.
--
-- SIN BACKFILL, y es correcto: `rejectionReason IS NULL` significa «nunca se rechazó», que es
-- exactamente la verdad de toda fila anterior a esta migración. No hay nada que inventar.
--
-- REVERSA (no hace falta ejecutarla, y por eso se documenta aquí en vez de automatizarse): el
-- artefacto ANTERIOR ignora las tres columnas —no las lee ni las escribe—, así que un rollback de
-- código NO necesita rollback de esquema. Si aun así hubiera que deshacer el DDL:
--     ALTER TABLE "KycProfile" DROP COLUMN "rejectionReason";
--     ALTER TABLE "KycProfile" DROP COLUMN "reviewedAt";
--     ALTER TABLE "KycProfile" DROP COLUMN "reviewedBy";
-- ⚠️ Esa reversa es DESTRUCTIVA (borra los motivos de rechazo ya escritos, que son la evidencia de
-- por qué se rechazó una identidad). Por eso la recomendación es NO revertir M-54: tres columnas
-- nullable sin lectores no molestan a nadie (§4.49.4).
ALTER TABLE "KycProfile" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "KycProfile" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "KycProfile" ADD COLUMN "reviewedBy" TEXT;
