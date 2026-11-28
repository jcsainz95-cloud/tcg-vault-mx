-- §BUYLIST-ES F1. Migración ADITIVA y SOLA: un valor nuevo del enum "SellItemRejectionCode" (Postgres no deja usar un valor de enum en la misma transacción que lo crea).
-- Reversa: Postgres no permite quitar un valor de un enum; es inerte mientras ninguna fila lo use (F3 lo escribe). Para retirarlo: confirmar 0 filas con 'version_mismatch' y recrear el tipo.
ALTER TYPE "SellItemRejectionCode" ADD VALUE IF NOT EXISTS 'version_mismatch';
