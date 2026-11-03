-- scripts/ids/ids-d1-q1.sql — Q1 y Q1b de D-IDS-1 (ARCHITECTURE §15, API_CONTRACT §IDS.9). UNA sola fuente para dos usos:   · devops
--   · `ids-d1-produccion.sql` (a mano, con psql) y
--   · `ids-q1-boton.sql` (el botón «Medir D-IDS-1 en producción», `.github/workflows/medir-ids-produccion.yml`).
-- ⛔ Este fichero NO abre ni cierra transacción: lo incluye (`\ir`) un envoltorio que ya abrió `BEGIN TRANSACTION READ ONLY`.
--    Un COMMIT/BEGIN aquí sacaría lo que sigue de la transacción de solo lectura (lo vigila scripts/check-ids-ro-workflow.sh [R]).
-- Salida sin datos personales: kind, ids de catálogo, nombre del producto/carta, acabado, conteos y precios. DEVOPS_NOTES §108.5.
\echo '== Q1 (D-IDS-1, literal del contrato): piezas de plataforma vendibles por kind de su producto =='
SELECT cp.kind, count(*) AS piezas
FROM "InventoryItem" i
JOIN "CardProduct" cp ON cp."tcgplayerProductId" = i."cardProductId"
WHERE i."ownerType" = 'platform' AND i.status IN ('listed', 'in_stock', 'reserved')
GROUP BY 1 ORDER BY 1;

\echo '== Q1b (D-IDS-1, la lista que el dueño ve si Q1 da > 0 en promo/deck_exclusive): por producto y acabado =='
SELECT cp.kind, cp."tcgplayerProductId", cp.name AS producto, c."externalId" AS carta, i.finish, i."productType",
       count(*) AS piezas, count(*) FILTER (WHERE i.status = 'listed') AS publicadas,
       count(*) FILTER (WHERE i."listPriceCents" IS NOT NULL) AS con_precio_por_pieza,
       min(lp."unitPriceCents") AS precio_min_cents, max(lp."unitPriceCents") AS precio_max_cents
FROM "InventoryItem" i
JOIN "CardProduct" cp ON cp."tcgplayerProductId" = i."cardProductId"
JOIN "Card" c ON c.id = i."cardId"
LEFT JOIN "ListingPrice" lp ON lp."inventoryItemId" = i.id
WHERE i."ownerType" = 'platform' AND i.status IN ('listed', 'in_stock', 'reserved')
  AND cp.kind IN ('promo', 'deck_exclusive')
GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 4, 2;
