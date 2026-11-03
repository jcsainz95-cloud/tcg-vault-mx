-- scripts/ids/ids-d1-q1.sql — Q1, Q1b y Q1c de D-IDS-1 (ARCHITECTURE §15, API_CONTRACT §IDS.9). UNA sola fuente para dos usos:   · devops
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

-- Q1c (API_CONTRACT §IDS.9 v1.116.4, D-IDS-S; H-Q1 del techlead sobre f2cd0e31): piezas de CLIENTES que el «falla cerrado»
-- de promo/deck_exclusive deja «Precio pendiente» en portafolio, valor de custodia y M de reposición. Universo (el del
-- portafolio, `VaultService.holdings`): `ownerType='customer'`, `status <> 'withdrawn'`, producto promo/deck_exclusive
-- por la misma regla que Q1 (`cardProductId` → `CardProduct.kind`). El universo va escrito igual en las dos consultas
-- (en solo lectura no hay vista temporal); el candado G-IDS-RO [Q] exige los tres filtros en ambas.
-- SOLO agregados: ni ids de pieza, ni de cliente, ni de orden; «clientes» es count(DISTINCT). Canario: medir-q1.test.mjs.
\echo '== Q1c (§IDS.9 v1.116.4): piezas de CLIENTES en bóveda con producto promo/deck_exclusive, por kind =='
SELECT cp.kind, count(*) AS piezas, count(DISTINCT i."ownerUserId") AS clientes,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ReplacementCase" rc
                                      WHERE rc."originalInventoryItemId" = i.id AND rc.status = 'open')) AS con_caso_por_reponer,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ShipmentItem" si JOIN "ShipmentRequest" sr ON sr.id = si."shipmentRequestId"
                                      WHERE si."inventoryItemId" = i.id AND sr.kind = 'outbound'
                                        AND sr.status IN ('solicitado', 'picking', 'guia', 'enviado'))) AS en_retiro_activo
FROM "InventoryItem" i
JOIN "CardProduct" cp ON cp."tcgplayerProductId" = i."cardProductId"
WHERE i."ownerType" = 'customer' AND i.status <> 'withdrawn'
  AND cp.kind IN ('promo', 'deck_exclusive')
GROUP BY 1 ORDER BY 1;

-- Q1c-detalle: por producto y acabado. «ref_base_*» = la referencia de la carta BASE que hoy les da valor, elegida como
-- `isBetterRef` (pricing.service.ts: manual primero, frescura `evidenceDate ?? capturedDate`, rango de fuente, variante
-- resuelta primero, cardProductId) con la llave de `valuationKeyFor` (raw ⇒ `raw:<condición|NM>`, graded ⇒
-- `graded:<casa>:<grado>`; sellado ⇒ sin referencia aquí). ⚠️ APROXIMACIÓN: `priceMxnCents` almacenado, SIN la FX viva
-- de `liveMxnCents`; el dueño decide con el orden de magnitud. «Q_*» = `unitPriceCents` del origen de `resolveOriginsBatch`
-- (payments/refunds/origin.ts): el `OrderItem` cobrado más reciente (orden `vault` del mismo cliente, `settledAt` no nulo)
-- o el de un caso `replaced` que dio ESTA pieza; sin ninguno ⇒ «sin_origen». «clientes_con_ref»/«clientes_con_q» = clientes
-- DISTINTOS detrás de cada cifra: el botón (resumen PÚBLICO) no da mín/máx y oculta Σ con < 3 (PT-IDS-6, candado G-IDS-RO [K]);
-- la consola de Railway (`ids-d1-produccion.sql`, privada) ve la fila entera.
\echo '== Q1c-detalle (§IDS.9 v1.116.4): piezas de CLIENTES promo/deck_exclusive por producto y acabado (solo agregados) =='
WITH u AS (
  SELECT i.id, i."ownerUserId", i."cardId", i."productType", i.finish, i."rawCondition", i."gradingCompany", i."gradeValue",
         cp.kind, cp."tcgplayerProductId", cp.name AS producto
  FROM "InventoryItem" i
  JOIN "CardProduct" cp ON cp."tcgplayerProductId" = i."cardProductId"
  WHERE i."ownerType" = 'customer' AND i.status <> 'withdrawn'
    AND cp.kind IN ('promo', 'deck_exclusive')
), llave AS (
  SELECT u.*, CASE u."productType"
                WHEN 'raw' THEN 'raw:' || coalesce(u."rawCondition"::text, 'NM')
                WHEN 'graded' THEN CASE WHEN coalesce(u."gradingCompany"::text, '') <> '' AND coalesce(btrim(u."gradeValue"), '') <> ''
                                        THEN 'graded:' || u."gradingCompany"::text || ':' || u."gradeValue" END
              END AS grade_key
  FROM u
), ref AS (
  SELECT l.id, (SELECT pr."priceMxnCents" FROM "PriceReference" pr
                WHERE pr."cardId" = l."cardId" AND pr."productType" = l."productType" AND pr."gradeKey" = l.grade_key
                  AND pr.finish = l.finish
                ORDER BY (pr."isManualOverride" OR pr.source = 'manual') DESC,
                         coalesce(pr."evidenceDate", pr."capturedDate") DESC,
                         CASE WHEN pr."isManualOverride" OR pr.source = 'manual' THEN 0
                              WHEN pr.source IN ('tcgcsv_singles', 'tcgcsv') THEN 1
                              WHEN pr.source IN ('pokemonpricetracker', 'poketrace') THEN 2
                              WHEN pr.source = 'pokemontcg_io' THEN 3 ELSE 4 END,
                         pr."cardProductId" ASC NULLS LAST
                LIMIT 1) AS ref_cents
  FROM llave l
), origen AS (
  SELECT l.id, (SELECT o.q FROM (
                  SELECT oi."unitPriceCents" AS q, ord."settledAt" AS t, 0 AS via
                  FROM "OrderItem" oi JOIN "Order" ord ON ord.id = oi."orderId"
                  WHERE oi."inventoryItemId" = l.id AND ord."fulfillmentMode" = 'vault'
                    AND ord."userId" = l."ownerUserId" AND ord."settledAt" IS NOT NULL
                  UNION ALL
                  SELECT ooi."unitPriceCents", rc."resolvedAt", 1
                  FROM "ReplacementCase" rc JOIN "OrderItem" ooi ON ooi.id = rc."originOrderItemId"
                  WHERE rc."replacementInventoryItemId" = l.id AND rc.status = 'replaced'
                    AND rc."customerUserId" = l."ownerUserId" AND rc."resolvedAt" IS NOT NULL
                ) o ORDER BY o.t DESC, o.via ASC LIMIT 1) AS q_cents
  FROM llave l
)
SELECT l.kind, l."tcgplayerProductId", l.producto, l.finish, l."productType",
       count(*) AS piezas, count(DISTINCT l."ownerUserId") AS clientes,
       count(r.ref_cents) AS con_ref_base,
       count(DISTINCT l."ownerUserId") FILTER (WHERE r.ref_cents IS NOT NULL) AS clientes_con_ref,
       sum(r.ref_cents) AS ref_base_suma_cents,
       min(r.ref_cents) AS ref_base_min_cents, max(r.ref_cents) AS ref_base_max_cents,
       count(*) FILTER (WHERE o.q_cents IS NULL) AS sin_origen,
       count(DISTINCT l."ownerUserId") FILTER (WHERE o.q_cents IS NOT NULL) AS clientes_con_q,
       sum(o.q_cents) AS q_suma_cents,
       min(o.q_cents) AS q_min_cents, max(o.q_cents) AS q_max_cents
FROM llave l JOIN ref r ON r.id = l.id JOIN origen o ON o.id = l.id
GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 3, 4, 5;
