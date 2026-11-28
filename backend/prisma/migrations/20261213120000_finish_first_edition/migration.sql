-- §AUTO-ENLACE fase 4 (Q1 = A, dueño 2026-11-27). Migración ADITIVA y SOLA: un valor nuevo del enum "Finish" para «1st Edition» no holográfica (WotC).
-- Va en su propia migración y ANTES de cualquier código/fila que lo use (Postgres no deja usar un valor de enum en la misma transacción que lo crea).
-- Reversa: Postgres no permite quitar un valor de un enum. Mientras ninguna fila lo use, es inerte (el código nuevo lo ignora si se retira);
-- si hiciera falta quitarlo: confirmar 0 filas con 'first_edition' (CardProduct.finishes, Card.availableFinishes, InventoryItem.finish,
-- PriceReference.finish, ListingPrice, ...) y recrear el tipo ("Finish_old") con los 4 valores originales.
ALTER TYPE "Finish" ADD VALUE IF NOT EXISTS 'first_edition';
