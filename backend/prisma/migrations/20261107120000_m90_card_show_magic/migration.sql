-- M-90 — migración `v1.101⟨cardshow⟩` (API_CONTRACT §CARDSHOW.1a-quater). Siguiente libre tras M-89; carpeta
-- posterior a la última del árbol (`20261106120000_m86_mkt_measurement`).
--
-- QUÉ: añade el 5.º juego `magic` (Magic: The Gathering; dueño JC chat 2026-10-21) al enum `CardShowGame`.
-- PURAMENTE ADITIVO: no toca filas ni otras tablas. `magic` es LIGERA por la regla «pokemon=FORMAL / resto=LIGERA»
-- de §CARDSHOW.12 (sin playerId, sin cupo/waitlist) SIN código nuevo de servicio.
--
-- TÉCNICA (mismo molde que M-85): statement ÚNICO y el valor nuevo NO se usa en esta migración, así que
-- `ALTER TYPE … ADD VALUE` es seguro (Postgres ≥ 12 solo prohíbe USAR el valor en la misma transacción).
-- IDEMPOTENTE (`IF NOT EXISTS`). SIN BACKFILL. ⛔ CERO dinero, inventario o cuentas tocados.
--
-- REVERSA: dejar de aceptar/emitir `magic` desde la aplicación (el valor del enum puede quedarse; quitarlo exige
-- recrear el tipo, destructivo). ⛔ Con filas `magic` NO se borra nada.
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107120000_m90_card_show_magic';

-- AlterEnum
ALTER TYPE "CardShowGame" ADD VALUE IF NOT EXISTS 'magic';
