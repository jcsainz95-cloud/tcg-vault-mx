-- =====================================================================================
--  P-DB-LIMPIEZA · D · LA VERIFICACIÓN (SOLO LECTURA) — se corre DESPUÉS del fichero 2 (COMMIT) y del fichero 3
--  Fecha: 2026-10-06 · v2: 2026-10-07 · Lo escribió: backend · Lo ejecuta: EL DUEÑO, con el usuario ADMINISTRADOR
--  Diseño: docs/specs/LIMPIEZA_DB.md §14.7 (v2) y §8.3 · Notas: BACKEND_NOTES §79 y §79.5
-- =====================================================================================
--
--  QUÉ HACE: comprueba, una por una, que la base quedó como dice el diseño. Cada línea sale «OK» o «FALLA» (o
--  «INFO»: solo para que lo veas, no cuenta), y la última dice «VERIFICACION: TODO OK» o cuántas fallaron.
--  Compara contra el RASTRO que dejó el fichero 2 en la bitácora (los conteos de antes y los contadores), así que no
--  hace falta que copies a mano los números del censo.
--
--  POR QUÉ CON EL ADMINISTRADOR Y NO CON `tcg_readonly`: ese usuario solo puede leer seis tablas, y darle lectura de
--  todo le abriría también contraseñas cifradas, enlaces de acceso e INE. NO le des más permisos. Este fichero no
--  puede escribir aunque lo corras con el administrador: todo va dentro de una transacción de SOLO LECTURA
--  (BEGIN TRANSACTION READ ONLY), que Postgres rechaza si algo intenta escribir, y termina en ROLLBACK.
--
--  QUÉ NECESITAS: el cliente `psql` de PostgreSQL (este fichero usa sus meta-comandos \set, \if y \gset; no sirve
--  un editor SQL web). Con el CLI de Railway, `railway connect` (servicio de Postgres) abre psql conectado a tu base:
--  NO MEDIDO por el equipo en tu cuenta.
--
--  CÓMO SE CORRE (siempre así):
--   1.º (recomendado) · `railway connect` (eligiendo el servicio de Postgres) abre psql ya conectado, SIN que
--       teclees la URL ni la contraseña. Dentro de psql escribe:
--         \i 20261006_pdblimpieza_4_verificacion.sql
--   2.º (sin el CLI de Railway) · psql a mano, SIN dejar la contraseña en el historial del shell ni a la vista en `ps`:
--       pon la URL SIN la contraseña (postgresql://USUARIO@HOST:PUERTO/BASE, de Railway → Postgres → Connect →
--       «Public Network») y psql te pide la contraseña sin mostrarla:
--         psql "postgresql://USUARIO@HOST:PUERTO/BASE" -v ON_ERROR_STOP=1 -f 20261006_pdblimpieza_4_verificacion.sql
--   ⛔ No escribas la URL con la contraseña dentro (ni `URL=…`, ni `psql "postgresql://usuario:CONTRASEÑA@…"`): se queda
--      en el historial del shell y la ve cualquiera que liste los procesos. Si ya la tecleaste o pegaste en la terminal
--      o en un chat, CAMBIA la contraseña de Postgres en Railway cuando termines.
--   ⛔ NUNCA lo pegues en la ventana de psql: si algo falla, seguiría con las demás líneas y el motivo se pierde.
--
--  Lo que la app escribe entre la limpieza y esta verificación (un cliente que se registra, un precio nuevo, el
--  portafolio del job diario, las cartas que ya volviste a subir) es REAL y NO cuenta como falla: sale como INFO o
--  como «posteriores». Del inventario se exige que no quede NADA anterior a la limpieza, que el folio empiece en
--  INV-000001 y que ningún folio vaya por delante de su contador.
--  ⚠️ Córrelo ANTES de abrir la tienda a pedidos reales: un pedido nuevo haría fallar «0 filas en Order» (correcto:
--     la verificación es de la base recién limpiada).
-- =====================================================================================

\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
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
    'ShipmentLabelAttempt','ShipmentPaidLabel','Dispute','SellRequest','SellRequestItem']) AS x
),
-- QA-7 · el portafolio y los avisos de gasto los escriben jobs DIARIOS, y el inventario lo vuelves a subir tú: lo
-- posterior a la limpieza es real. Se exige 0 solo en lo ANTERIOR al rastro, y lo posterior sale de dato (v2 §14.7).
jobs AS (
  SELECT 1 AS o, 'PortfolioSnapshot' AS tabla,
         (SELECT count(*) FROM "PortfolioSnapshot" x, rastro WHERE x."createdAt" < rastro.t) AS antes_del_rastro,
         (SELECT count(*) FROM "PortfolioSnapshot" x, rastro WHERE x."createdAt" >= rastro.t) AS despues
  UNION ALL
  SELECT 2, 'SpendAlert',
         (SELECT count(*) FROM "SpendAlert" x, rastro WHERE x."firstOccurredAt" < rastro.t),
         (SELECT count(*) FROM "SpendAlert" x, rastro WHERE x."firstOccurredAt" >= rastro.t)
  UNION ALL
  SELECT 3, 'InventoryItem',
         (SELECT count(*) FROM "InventoryItem" x, rastro WHERE x."createdAt" < rastro.t),
         (SELECT count(*) FROM "InventoryItem" x, rastro WHERE x."createdAt" >= rastro.t)
  UNION ALL
  SELECT 4, 'InventoryMovement',
         (SELECT count(*) FROM "InventoryMovement" x, rastro WHERE x."createdAt" < rastro.t),
         (SELECT count(*) FROM "InventoryMovement" x, rastro WHERE x."createdAt" >= rastro.t)
  UNION ALL
  SELECT 5, 'InventoryAdjustment',
         (SELECT count(*) FROM "InventoryAdjustment" x, rastro WHERE x."createdAt" < rastro.t),
         (SELECT count(*) FROM "InventoryAdjustment" x, rastro WHERE x."createdAt" >= rastro.t)
  UNION ALL
  SELECT 6, 'InventoryBatch',
         (SELECT count(*) FROM "InventoryBatch" x, rastro WHERE x."createdAt" < rastro.t),
         (SELECT count(*) FROM "InventoryBatch" x, rastro WHERE x."createdAt" >= rastro.t)
  UNION ALL
  SELECT 7, 'PendingPriceEntry (inventory/portfolio)',
         (SELECT count(*) FROM "PendingPriceEntry" x, rastro WHERE x.context::text IN ('inventory', 'portfolio') AND x."createdAt" < rastro.t),
         (SELECT count(*) FROM "PendingPriceEntry" x, rastro WHERE x.context::text IN ('inventory', 'portfolio') AND x."createdAt" >= rastro.t)
),
-- C-4 / QA-6 · Usuarios, cartas, precios, diales, cajones, sellado y overrides los sigue escribiendo la app: se
-- enseñan (INFO) y no cuentan como falla. (v2: ya no se exige «mismo conteo» de InventoryItem: lo vuelves a subir.)
info AS (
  SELECT x AS tabla, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', x), false, true, '')))[1]::text::bigint AS ahora,
         (SELECT (r -> 'conteosAntes' ->> x)::bigint FROM rastro) AS rastro
  FROM unnest(ARRAY['User','Card','PriceReference','ConfigSetting','VaultLocation','SealedProduct','VariantPriceOverride']) AS x
  UNION ALL
  SELECT 'PendingPriceEntry (catalog/buylist)', (SELECT count(*) FROM "PendingPriceEntry" WHERE context::text IN ('catalog', 'buylist')), NULL
),
sec AS (
  SELECT sequencename AS s, last_value
  FROM pg_sequences WHERE schemaname = current_schema()
),
-- El próximo número de cada contador, y el mayor número ya usado (folios con el formato de la app: PREFIJO-nnnnnn).
folios AS (
  SELECT 'INV-' AS pre,
         (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM inventory_folio_seq) AS proximo,
         (SELECT max(substring(folio FROM 5)::bigint) FROM "InventoryItem" WHERE folio ~ '^INV-[0-9]+$') AS mayor,
         (SELECT min(folio) FROM "InventoryItem") AS menor
  UNION ALL
  SELECT 'TCG-',
         (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq),
         (SELECT max(substring("orderNumber" FROM 5)::bigint) FROM "Order" WHERE "orderNumber" ~ '^TCG-[0-9]+$'),
         (SELECT min("orderNumber") FROM "Order")
),
c AS (
  SELECT 10 AS ord, '0 filas en ' || tabla AS comprobacion,
         CASE WHEN filas = '0' THEN 'OK' WHEN filas = 'SIN PERMISO' THEN 'SIN PERMISO' ELSE 'FALLA' END AS resultado,
         filas AS detalle
  FROM vacias
  UNION ALL
  SELECT 11, '0 filas anteriores a la limpieza en ' || tabla,
         CASE WHEN (SELECT count(*) FROM rastro) = 1 AND antes_del_rastro = 0 THEN 'OK' ELSE 'FALLA' END,
         coalesce(antes_del_rastro::text, 'sin rastro') || ' anteriores · ' || coalesce(despues::text, '?') || ' posteriores (reales)'
  FROM jobs
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
  SELECT 40, 'conteo (la app lo sigue escribiendo): ' || tabla, 'INFO',
         'ahora ' || coalesce(ahora::text, '?') || CASE WHEN rastro IS NULL THEN '' ELSE ' · antes de la limpieza ' || rastro END
  FROM info
  UNION ALL
  SELECT 50, 'contador de pedidos: el siguiente es TCG-000001',
         CASE WHEN (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq) = 1 THEN 'OK' ELSE 'FALLA' END,
         (SELECT 'siguiente ' || CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq)
  UNION ALL
  -- v2 (§14.7): INV- reinicia en C. Sin cartas, el siguiente es 1; si ya volviste a subir, la primera fue INV-000001.
  SELECT 51, 'contador de inventario: el siguiente es INV-000001, o la primera carta subida es INV-000001',
         CASE WHEN (SELECT count(*) FROM rastro) = 1 AND ((f.menor IS NULL AND f.proximo = 1) OR f.menor = 'INV-000001') THEN 'OK' ELSE 'FALLA' END,
         CASE WHEN f.menor IS NULL THEN 'sin cartas · siguiente INV-' || lpad(f.proximo::text, 6, '0')
              ELSE 'primera carta ' || f.menor || ' · siguiente INV-' || lpad(f.proximo::text, 6, '0') END
  FROM folios f WHERE f.pre = 'INV-'
  UNION ALL
  -- R-12 (§14.5): un alta que tomara número entre la guarda de C y su setval dejaría una pieza POR DELANTE del contador
  -- (el día que el contador la alcance, la siguiente alta choca). Ídem pedidos.
  SELECT 52, 'ningún folio por delante de su contador: ' || f.pre,
         CASE WHEN f.mayor IS NULL OR f.mayor < f.proximo THEN 'OK' ELSE 'FALLA' END,
         'mayor usado ' || coalesce(f.pre || lpad(f.mayor::text, 6, '0'), '(ninguno)') || ' · siguiente ' || f.pre || lpad(f.proximo::text, 6, '0')
  FROM folios f
  UNION ALL
  SELECT 53, 'contador ' || s || ' igual que en la limpieza (NO se reinicia)',
         CASE WHEN (SELECT (r -> 'secuencias' ->> s)::bigint FROM rastro) = sec.last_value THEN 'OK' ELSE 'FALLA' END,
         'ahora ' || coalesce(sec.last_value::text, '?') || ' · rastro ' || coalesce((SELECT r -> 'secuencias' ->> s FROM rastro), 'sin rastro')
  FROM sec WHERE s = 'shipment_folio_seq'
  UNION ALL
  SELECT 60, 'bounties: comprado = 0 en todas las filas',
         CASE WHEN n = 0 THEN 'OK' ELSE 'FALLA' END, n::text
  FROM (SELECT count(*) AS n FROM "VariantPriceOverride" WHERE "bountyAcquiredQty" <> 0) z
)
SELECT resultado, comprobacion, detalle FROM (
  SELECT ord, resultado, comprobacion, detalle FROM c
  UNION ALL
  SELECT 99,
         CASE WHEN count(*) FILTER (WHERE resultado NOT IN ('OK', 'INFO')) = 0 THEN 'VERIFICACION: TODO OK'
              ELSE 'VERIFICACION: HAY FALLAS (' || count(*) FILTER (WHERE resultado NOT IN ('OK', 'INFO')) || ')' END,
         '', ''
  FROM c
) z ORDER BY ord, comprobacion;

ROLLBACK;
