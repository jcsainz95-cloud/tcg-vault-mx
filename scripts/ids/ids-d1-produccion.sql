-- scripts/ids/ids-d1-produccion.sql — las cuentas de IDS-D1 (D-IDS-1) e IDS-D2 que solo da la BD de producción.   · devops
--
-- ⛔ NO la corre devops: no hay credencial de solo lectura de producción en la sesión (DB_READONLY_URL no existe).
--    La corre el DUEÑO (o un rol con acceso) con un usuario de SOLO LECTURA, como §104.4 de DEVOPS_NOTES:
--      psql "$DATABASE_URL_RO" -X -v ON_ERROR_STOP=1 -f scripts/ids/ids-d1-produccion.sql
--    y pega la salida (solo conteos, ids de catálogo y nombres de carta: sin datos personales) en la solicitud de fusión.
-- Todo dentro de una transacción READ ONLY con tope de tiempo: aunque el rol pudiera escribir, esto no escribe.
-- Fuente de las preguntas: API_CONTRACT §IDS.9 «Devops» y ARCHITECTURE §15.4 D-IDS-1. Resultados: DEVOPS_NOTES §108.
\set QUIET on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
\set QUIET off

\echo '== Q1 (D-IDS-1, literal del contrato): piezas de plataforma vendibles por kind de su producto =='
SELECT cp.kind, count(*) AS piezas
FROM "InventoryItem" i
JOIN "CardProduct" cp ON cp."tcgplayerProductId" = i."cardProductId"
WHERE i."ownerType" = 'platform' AND i.status IN ('listed', 'in_stock', 'reserved')
GROUP BY 1 ORDER BY 1;

\echo '== Q1b (D-IDS-1, la lista que el dueño ve si Q1 da > 0 en promo/deck_exclusive): por producto y acabado =='
SELECT cp.kind, cp."tcgplayerProductId", cp.name AS producto, c."externalId" AS carta, i.finish, i."productType",
       count(*) AS piezas, count(*) FILTER (WHERE i.status = 'listed') AS publicadas,
       min(lp."unitPriceCents") AS precio_min_cents, max(lp."unitPriceCents") AS precio_max_cents
FROM "InventoryItem" i
JOIN "CardProduct" cp ON cp."tcgplayerProductId" = i."cardProductId"
JOIN "Card" c ON c.id = i."cardId"
LEFT JOIN "ListingPrice" lp ON lp."inventoryItemId" = i.id
WHERE i."ownerType" = 'platform' AND i.status IN ('listed', 'in_stock', 'reserved')
  AND cp.kind IN ('promo', 'deck_exclusive')
GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 4, 2;

\echo '== Q2 (IDS-D2): sets de promos del catálogo, su grupo TCGCSV y cuántos productos tienen colgados =='
SELECT s."externalId", s.name, s."pptSetId", s."tcgcsvGroupId",
       count(DISTINCT c.id) AS cartas,
       count(cp.id) FILTER (WHERE cp.kind = 'set_base') AS prod_set_base,
       count(cp.id) FILTER (WHERE cp.kind = 'promo') AS prod_promo,
       count(cp.id) FILTER (WHERE cp.kind NOT IN ('set_base', 'promo')) AS prod_otros
FROM "CardSet" s
LEFT JOIN "Card" c ON c."setId" = s.id
LEFT JOIN "CardProduct" cp ON cp."cardId" = c.id
WHERE s."externalId" IN ('svp', 'swshp', 'smp', 'xyp', 'bwp', 'hsp', 'dpp', 'np', 'basep')
   OR s.name ILIKE '%promo%' OR s."pptSetId" IN ('22872', '24451')
GROUP BY 1, 2, 3, 4 ORDER BY 1;

\echo '== Q3 (IDS.3, «un producto colgado no se re-cuelga»): productos con sello que YA son CardProduct hoy, por kind =='
-- 22880 no se baja hoy (ARCHITECTURE §15.0), pero los nombres con Prerelease/Staff/League/Championship de los grupos
-- de set y de promos sí entran como `promo` o `set_base`. Si alguno de 22880/1539/22872/24451 ya existe, el paso
-- stamped lo encuentra ocupado por @unique: cuántos y de qué kind.
SELECT cp.kind, count(*) AS productos,
       count(*) FILTER (WHERE cp.name ~* '\((prerelease|staff)\)|\[staff\]') AS prerelease_o_staff,
       count(*) FILTER (WHERE cp.name ~* 'championship|regional|international|world') AS campeonato,
       count(*) FILTER (WHERE cp.name ~* 'league') AS liga
FROM "CardProduct" cp
WHERE cp.name ~* 'prerelease|staff|league|championship|regional|international|world'
GROUP BY 1 ORDER BY 1;

ROLLBACK;
