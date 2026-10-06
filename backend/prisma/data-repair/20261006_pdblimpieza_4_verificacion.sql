-- =====================================================================================
--  P-DB-LIMPIEZA · D · LA VERIFICACIÓN (SOLO LECTURA) — se corre DESPUÉS del fichero 2 (COMMIT) y del fichero 3
--  Fecha: 2026-10-06 · Lo escribió: backend · Lo ejecuta: EL DUEÑO, con el usuario de solo lectura (`tcg_readonly`)
--  Diseño: docs/specs/LIMPIEZA_DB.md §8.3
-- =====================================================================================
--
--  QUÉ HACE: comprueba, una por una, que la base quedó como dice el diseño. Cada línea sale «OK» o «FALLA», y la
--  última dice «VERIFICACION: TODO OK» o cuántas fallaron. NO ESCRIBE NADA (transacción de solo lectura + ROLLBACK).
--  Compara contra el RASTRO que dejó el fichero 2 en la bitácora (los conteos de antes y los contadores), así que
--  no hace falta que copies a mano los números del censo.
--
--  ⚠️ Si sale «SIN PERMISO», el usuario de solo lectura no puede leer esa tabla: ver el encabezado del fichero 1.
--  ⚠️ Córrelo ANTES de abrir la tienda a pedidos reales: un pedido nuevo haría fallar «0 filas en Order» (correcto:
--     la verificación es de la base recién limpiada).
-- =====================================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION READ ONLY;

\echo '=== D · VERIFICACIÓN DE LA LIMPIEZA ==='
WITH
rastro AS (
  SELECT a."after" AS r, a."createdAt" AS t
  FROM "AuditLog" a WHERE a.action = 'maintenance.test_data_purge'
  ORDER BY a."createdAt" DESC LIMIT 1
),
vacias AS (
  SELECT x AS tabla,
         CASE WHEN to_regclass(format('%I', x)) IS NULL THEN '0'
              WHEN NOT has_table_privilege(format('%I', x), 'SELECT') THEN 'SIN PERMISO'
              ELSE (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', x), false, true, '')))[1]::text END AS filas
  FROM unnest(ARRAY[
    'Order','OrderItem','OrderAccessToken','PaymentRefund','ManualRefund','ReplacementCase','VaultPlacement','VaultPlacementItem',
    'ShipmentRequest','ShipmentItem','ShipmentQuote','ShipmentCarrierEvent','ShipmentAddressRevision','ShipmentCostAdjustment',
    'ShipmentLabelAttempt','ShipmentPaidLabel','Dispute','SellRequest','SellRequestItem','SpendAlert','PortfolioSnapshot']) AS x
),
iguales AS (
  SELECT x AS tabla,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', x), false, true, '')))[1]::text::bigint AS ahora,
         (SELECT (r -> CASE WHEN x = 'InventoryItem' THEN 'conteosDespues' ELSE 'conteosAntes' END ->> x)::bigint FROM rastro) AS rastro
  FROM unnest(ARRAY['User','Card','PriceReference','ConfigSetting','InventoryItem']) AS x
),
sec AS (
  SELECT sequencename AS s, last_value
  FROM pg_sequences WHERE schemaname = current_schema()
),
c AS (
  SELECT 10 AS ord, '0 filas en ' || tabla AS comprobacion,
         CASE WHEN filas = '0' THEN 'OK' WHEN filas = 'SIN PERMISO' THEN 'SIN PERMISO' ELSE 'FALLA' END AS resultado,
         filas AS detalle
  FROM vacias
  UNION ALL
  SELECT 20, 'AuditLog: exactamente 1 rastro maintenance.test_data_purge',
         CASE WHEN (SELECT count(*) FROM "AuditLog" WHERE action = 'maintenance.test_data_purge') = 1 THEN 'OK' ELSE 'FALLA' END,
         (SELECT count(*) FROM "AuditLog" WHERE action = 'maintenance.test_data_purge')::text
  UNION ALL
  SELECT 21, 'AuditLog: nada anterior al rastro',
         CASE WHEN (SELECT count(*) FROM rastro) = 1
               AND NOT EXISTS (SELECT 1 FROM "AuditLog" a, rastro WHERE a.action <> 'maintenance.test_data_purge' AND a."createdAt" < rastro.t)
              THEN 'OK' ELSE 'FALLA' END,
         (SELECT count(*) FROM "AuditLog" a, rastro WHERE a.action <> 'maintenance.test_data_purge' AND a."createdAt" < rastro.t)::text
  UNION ALL
  SELECT 30, '0 piezas de cliente / apartadas / en custodia o camino',
         CASE WHEN n = 0 THEN 'OK' ELSE 'FALLA' END, n::text
  FROM (SELECT count(*) AS n FROM "InventoryItem"
         WHERE "ownerType"::text = 'customer' OR "reservedByOrderId" IS NOT NULL
            OR status::text IN ('reserved','in_custody','picking','shipped','delivered')) z
  UNION ALL
  SELECT 31, '0 movimientos de venta/retiro/caso',
         CASE WHEN n = 0 THEN 'OK' ELSE 'FALLA' END, n::text
  FROM (SELECT count(*) AS n FROM "InventoryMovement"
         WHERE reason::text IN ('sale','settle','chargeback_return','withdrawal','refund_return','refund_release','replacement')) z
  UNION ALL
  SELECT 32, '0 piezas ligadas a solicitudes de venta',
         CASE WHEN n = 0 THEN 'OK' ELSE 'FALLA' END, n::text
  FROM (SELECT count(*) AS n FROM "InventoryItem" WHERE "sourceSellRequestItemId" IS NOT NULL) z
  UNION ALL
  SELECT 40, 'mismo conteo que antes de la limpieza: ' || tabla,
         CASE WHEN rastro IS NOT NULL AND ahora = rastro THEN 'OK' ELSE 'FALLA' END,
         'ahora ' || coalesce(ahora::text, '?') || ' · rastro ' || coalesce(rastro::text, 'sin rastro')
  FROM iguales
  UNION ALL
  SELECT 50, 'contador de pedidos: el siguiente es TCG-000001',
         CASE WHEN (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq) = 1 THEN 'OK' ELSE 'FALLA' END,
         (SELECT 'siguiente ' || CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq)
  UNION ALL
  SELECT 51, 'contador ' || s || ' igual que en la limpieza (NO se reinicia)',
         CASE WHEN (SELECT (r -> 'secuencias' ->> s)::bigint FROM rastro) = sec.last_value THEN 'OK' ELSE 'FALLA' END,
         'ahora ' || coalesce(sec.last_value::text, '?') || ' · rastro ' || coalesce((SELECT r -> 'secuencias' ->> s FROM rastro), 'sin rastro')
  FROM sec WHERE s IN ('shipment_folio_seq', 'inventory_folio_seq')
  UNION ALL
  SELECT 60, 'bounties: comprado = 0 en todas las filas',
         CASE WHEN n = 0 THEN 'OK' ELSE 'FALLA' END, n::text
  FROM (SELECT count(*) AS n FROM "VariantPriceOverride" WHERE "bountyAcquiredQty" <> 0) z
)
SELECT resultado, comprobacion, detalle FROM (
  SELECT ord, resultado, comprobacion, detalle FROM c
  UNION ALL
  SELECT 99,
         CASE WHEN count(*) FILTER (WHERE resultado <> 'OK') = 0 THEN 'VERIFICACION: TODO OK'
              ELSE 'VERIFICACION: HAY FALLAS (' || count(*) FILTER (WHERE resultado <> 'OK') || ')' END,
         '', ''
  FROM c
) z ORDER BY ord, comprobacion;

ROLLBACK;
