-- =====================================================================================
--  P-DB-LIMPIEZA · D · LA VERIFICACIÓN (SOLO LECTURA) — se corre DESPUÉS del fichero 2 (COMMIT) y del fichero 3
--  Fecha: 2026-10-06 · v2 y v2.1: 2026-10-07 · v2.2: 2026-10-08 · Lo escribió: backend · Lo ejecuta: EL DUEÑO, con el usuario ADMINISTRADOR
--  Diseño: docs/specs/LIMPIEZA_DB.md §14.7 (v2), §14.12 (v2.1), §14.13.3 (v2.2) y §8.3 · Notas: BACKEND_NOTES §79, §79.5, §79.6 y §87
-- =====================================================================================
--
--  QUÉ HACE: comprueba, una por una, que la base quedó como dice el diseño. Cada línea sale «OK» o «FALLA», o
--  «INFO» (solo para que lo veas, no cuenta) o «AVISO» (algo no salió como pediste pero no rompe nada; no cuenta como
--  falla). La última dice «VERIFICACION: TODO OK» (con «(con N aviso(s))» si hay avisos) o cuántas fallaron.
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
--  como «posteriores». Del inventario se exige que no quede NADA anterior a la limpieza, que el contador se haya
--  reiniciado en el fichero 3 y que ningún folio vaya por delante de su contador. Si subiste cartas ANTES del fichero 3,
--  el contador de inventario no se pudo reiniciar: sale AVISO («NO se reinició INV-: ya había piezas cuando corriste C»),
--  no rompe nada, solo que tus folios no empiezan en INV-000001.
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
  UNION ALL
  -- v2.2 (§14.13.3): las de accesorios (M-73), SOLO si existen: sin M-73 no salen.
  SELECT x, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', x), false, true, '')))[1]::text
  FROM unnest(ARRAY['OrderAccessoryLine','OrderEnergyBundleComponent','ShipmentAccessoryLine']) AS x
  WHERE to_regclass(format('%I', x)) IS NOT NULL
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
  UNION ALL
  -- v2.2 (§14.13.3): historial de existencias de accesorios (M-73) y avisos de deseos (M-74), SOLO si existen (conteo
  -- dinámico: sin la tabla, el SQL estático fallaría). Lo posterior es real: recepciones y avisos de cartas re-subidas.
  SELECT y.o, y.tabla,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I x WHERE x.%I < %L::timestamp', y.tabla, y.col, rastro.t), false, true, '')))[1]::text::bigint,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I x WHERE x.%I >= %L::timestamp', y.tabla, y.col, rastro.t), false, true, '')))[1]::text::bigint
  FROM (VALUES (8, 'AccessoryStockMovement', 'createdAt'), (9, 'WishlistNotice', 'detectedAt')) AS y(o, tabla, col)
  LEFT JOIN rastro ON true -- sin rastro: la línea sale igual (y es FALLA, como las de arriba)
  WHERE to_regclass(format('%I', y.tabla)) IS NOT NULL
),
-- C-4 / QA-6 · Usuarios, cartas, precios, diales, cajones, sellado y overrides los sigue escribiendo la app: se
-- enseñan (INFO) y no cuentan como falla. (v2: ya no se exige «mismo conteo» de InventoryItem: lo vuelves a subir.)
info AS (
  SELECT x AS tabla, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', x), false, true, '')))[1]::text::bigint AS ahora,
         (SELECT (r -> 'conteosAntes' ->> x)::bigint FROM rastro) AS rastro
  FROM unnest(ARRAY['User','Card','PriceReference','ConfigSetting','VaultLocation','SealedProduct','VariantPriceOverride']) AS x
  UNION ALL
  -- v2.2 (§14.13.3): catálogo de accesorios y lista de deseos, SOLO si existen.
  SELECT x, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', x), false, true, '')))[1]::text::bigint,
         (SELECT (r -> 'conteosAntes' ->> x)::bigint FROM rastro)
  FROM unnest(ARRAY['Accessory','AccessoryPhoto','WishlistItem','WishlistMail']) AS x
  WHERE to_regclass(format('%I', x)) IS NOT NULL
  UNION ALL
  SELECT 'PendingPriceEntry (catalog/buylist)', (SELECT count(*) FROM "PendingPriceEntry" WHERE context::text IN ('catalog', 'buylist')), NULL
),
-- El próximo número de cada contador, y el mayor número ya usado (folios con el formato de la app: PREFIJO-nnnnnn).
folios AS (
  SELECT 'INV-' AS pre,
         (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM inventory_folio_seq) AS proximo,
         (SELECT max(substring(folio FROM 5)::bigint) FROM "InventoryItem" WHERE folio ~ '^INV-[0-9]+$') AS mayor
  UNION ALL
  SELECT 'TCG-',
         (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq),
         (SELECT max(substring("orderNumber" FROM 5)::bigint) FROM "Order" WHERE "orderNumber" ~ '^TCG-[0-9]+$')
),
-- §14.12 · el contador de inventario. R = su valor en la limpieza (rastro); m = el folio MÁS BAJO, NUMÉRICO (MENOR-3:
-- como texto 'INV-1000000' < 'INV-999999'); p = el siguiente; t1 = «el siguiente pedido es TCG-000001» (solo el
-- fichero 3 reinicia ese contador, y tras la limpieza no hay pedidos: prueba que el fichero 3 SÍ corrió).
inv AS (
  SELECT (SELECT count(*) FROM rastro) AS n_rastro,
         (SELECT (r -> 'secuencias' ->> 'inventory_folio_seq')::bigint FROM rastro) AS r_inv,
         (SELECT count(*) FROM "InventoryItem") AS piezas,
         (SELECT min(substring(folio FROM 5)::bigint) FROM "InventoryItem" WHERE folio ~ '^INV-[0-9]+$') AS m,
         (SELECT proximo FROM folios WHERE pre = 'INV-') AS p,
         (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM order_number_seq) = 1 AS t1
),
inv_estado AS (
  SELECT inv.*,
         CASE WHEN n_rastro <> 1 THEN 'sin rastro'
              WHEN piezas = 0 AND p = 1 THEN 'reiniciado'
              WHEN piezas > 0 AND m <= r_inv THEN 'reiniciado'
              WHEN piezas > 0 AND m > r_inv AND t1 THEN 'aviso'
              ELSE 'no corrio' END AS estado
  FROM inv
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
  -- v2.1 (§14.12): INV- se reinicia en el fichero 3. OK si se reinició (sin cartas y el siguiente es 1, o la carta más
  -- baja es de después del reinicio: m <= R); AVISO si el fichero 3 corrió pero ya había cartas (la MISMA frase que
  -- dice el fichero 3; no cuenta como falla); FALLA si no hay rastro o si el fichero 3 no corrió.
  SELECT 51, 'contador de inventario: reiniciado en el fichero 3',
         CASE estado WHEN 'reiniciado' THEN 'OK' WHEN 'aviso' THEN 'AVISO' ELSE 'FALLA' END,
         CASE estado
           WHEN 'sin rastro' THEN 'sin rastro de la limpieza · siguiente INV-' || lpad(p::text, 6, '0')
           WHEN 'aviso' THEN 'NO se reinició INV-: ya había piezas cuando corriste C · primera INV-' || lpad(m::text, 6, '0')
                             || ' · siguiente INV-' || lpad(p::text, 6, '0') || ' · no rompe nada'
           WHEN 'no corrio' THEN 'el contador no se reinició y C no corrió (el de pedidos tampoco está en TCG-000001)'
                                 || coalesce(' · primera INV-' || lpad(m::text, 6, '0'), '') || ' · siguiente INV-' || lpad(p::text, 6, '0')
           WHEN 'reiniciado' THEN CASE WHEN piezas = 0 THEN 'sin cartas · siguiente INV-' || lpad(p::text, 6, '0')
                                       ELSE 'primera carta ' || coalesce('INV-' || lpad(m::text, 6, '0'), '?') || ' · siguiente INV-' || lpad(p::text, 6, '0') END
         END
  FROM inv_estado
  UNION ALL
  -- R-12 (§14.5): un alta que tomara número entre la guarda de C y su setval dejaría una pieza POR DELANTE del contador
  -- (el día que el contador la alcance, la siguiente alta choca). Ídem pedidos.
  SELECT 52, 'ningún folio por delante de su contador: ' || f.pre,
         CASE WHEN f.mayor IS NULL OR f.mayor < f.proximo THEN 'OK' ELSE 'FALLA' END,
         'mayor usado ' || coalesce(f.pre || lpad(f.mayor::text, 6, '0'), '(ninguno)') || ' · siguiente ' || f.pre || lpad(f.proximo::text, 6, '0')
  FROM folios f
  UNION ALL
  -- §14.12 MENOR-1: se lee de la secuencia misma, como la guardó el fichero 2 (pg_sequences.last_value es NULL si la
  -- secuencia nunca se usó, y daría una FALLA falsa).
  SELECT 53, 'contador shipment_folio_seq igual que en la limpieza (NO se reinicia)',
         CASE WHEN (SELECT (r -> 'secuencias' ->> 'shipment_folio_seq')::bigint FROM rastro) = s.last_value THEN 'OK' ELSE 'FALLA' END,
         'ahora ' || s.last_value::text || ' · rastro ' || coalesce((SELECT r -> 'secuencias' ->> 'shipment_folio_seq' FROM rastro), 'sin rastro')
  FROM shipment_folio_seq s
  UNION ALL
  SELECT 60, 'bounties: comprado = 0 en todas las filas',
         CASE WHEN n = 0 THEN 'OK' ELSE 'FALLA' END, n::text
  FROM (SELECT count(*) AS n FROM "VariantPriceOverride" WHERE "bountyAcquiredQty" <> 0) z
)
SELECT resultado, comprobacion, detalle FROM (
  SELECT ord, resultado, comprobacion, detalle FROM c
  UNION ALL
  SELECT 99,
         -- AVISO no cuenta como falla (§14.12), pero se dice cuántos hay.
         CASE WHEN count(*) FILTER (WHERE resultado NOT IN ('OK', 'INFO', 'AVISO')) = 0 THEN
                'VERIFICACION: TODO OK' || CASE WHEN count(*) FILTER (WHERE resultado = 'AVISO') > 0
                                                THEN ' (con ' || count(*) FILTER (WHERE resultado = 'AVISO') || ' aviso(s))' ELSE '' END
              ELSE 'VERIFICACION: HAY FALLAS (' || count(*) FILTER (WHERE resultado NOT IN ('OK', 'INFO', 'AVISO')) || ')' END,
         '', ''
  FROM c
) z ORDER BY ord, comprobacion;

ROLLBACK;
