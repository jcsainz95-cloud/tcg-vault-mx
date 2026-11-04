-- scripts/ids/foto-512.sql — FOTO del criterio 512 (IDS-D3): «lo existente no cambia».   · devops
-- Una línea JSON por fila: {"t": tabla, "k": clave, "r": {columnas de dinero/estado/identidad}}.
-- Solo columnas cuyo NOMBRE pasa el filtro de abajo (ids, estados, *Cents, acabado, variantKey, idioma/sello…):
-- sin nombres, correos, direcciones ni ids de Stripe ⇒ la foto no lleva datos personales. Aun así ⛔ no va al repo
-- ni a un artefacto de Actions: es la foto de una copia de producción (disco del dueño o del ensayo).
-- Se corre ANTES y DESPUÉS del despliegue sobre la MISMA copia; compara `foto-512.mjs compare`. Runbook: DEVOPS_NOTES §108.3.
-- Columnas nuevas de M-95 (language, stampType, stampLabel) solo existen en la foto «después»; el comparador exige su DEFAULT.
\set QUIET on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '300s';
\pset format unaligned
\pset tuples_only on
WITH keep AS (
  SELECT '^(id|inventoryItemId|orderId|sellRequestId|cardId|cardProductId|userId|asOfDate)$|[sS]tatus$|Cents$|^finish$|^variantKey$|^productType$|^gradeKey$|^quantity$|^ownerType$|^language$|^stamp(Type|Label)$|^priceBasis$|^pendingPriceCount$'::text AS re
),
rows AS (
  SELECT 'InventoryItem' AS t, to_jsonb(x) AS j FROM "InventoryItem" x
  UNION ALL SELECT 'ListingPrice', to_jsonb(x) FROM "ListingPrice" x
  UNION ALL SELECT 'Order', to_jsonb(x) FROM "Order" x
  UNION ALL SELECT 'OrderItem', to_jsonb(x) FROM "OrderItem" x
  UNION ALL SELECT 'SellRequest', to_jsonb(x) FROM "SellRequest" x
  UNION ALL SELECT 'SellRequestItem', to_jsonb(x) FROM "SellRequestItem" x
  UNION ALL SELECT 'PortfolioSnapshot', to_jsonb(x) FROM "PortfolioSnapshot" x
)
SELECT jsonb_build_object(
         't', r.t,
         'k', coalesce(r.j ->> 'id', r.j ->> 'inventoryItemId'),
         'r', (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
               FROM jsonb_each(r.j) e, keep WHERE e.key ~ keep.re))::text
FROM rows r
ORDER BY r.t, coalesce(r.j ->> 'id', r.j ->> 'inventoryItemId');
ROLLBACK;
