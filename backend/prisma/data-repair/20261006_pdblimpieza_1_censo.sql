-- =====================================================================================
--  P-DB-LIMPIEZA · A · EL CENSO (SOLO LECTURA) — se corre ANTES de todo
--  Fecha: 2026-10-06 · Lo escribió: backend · Lo ejecuta: EL DUEÑO, con el usuario de SOLO LECTURA (`tcg_readonly`)
--  Diseño: docs/specs/LIMPIEZA_DB.md §8.1 (A) y §8.2 paso 2
-- =====================================================================================
--
--  QUÉ HACE: cuenta lo que hay en cada tabla, enseña las llaves (FK) reales de la base, avisa de lo que pararía la
--  limpieza (G-1…G-4), y apunta dónde están los tres contadores (TCG-, ENV-, INV-). NO ESCRIBE NADA: abre una
--  transacción de SOLO LECTURA y termina en ROLLBACK.
--
--  ⚠️ PERMISOS: el usuario `tcg_readonly` que creaste el 2026-09-12 solo puede leer SEIS tablas (PENDIENTES,
--  «MEDICIÓN-PROD 2026-09-12»). Las tablas que no pueda leer salen con «SIN PERMISO» en vez de un número, y el resto
--  del censo sale igual. Para verlas todas, el ADMINISTRADOR le da lectura (solo lectura, nada más) con:
--      GRANT SELECT ON ALL TABLES IN SCHEMA public TO tcg_readonly;
--      GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO tcg_readonly;
--  Si alguna consulta de abajo falla por permisos, córrelo con el administrador: igual NO escribe (solo lectura).
--
--  Qué mirar: si las guardas G-1, G-2 o G-3 dan algo distinto de 0, PARA y pregunta antes de seguir.
--  G-4 dice cuántas cartas entraron desde solicitudes de venta de prueba: si es > 0 tienes que contestar P-1.
-- =====================================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION READ ONLY;

\echo '=== A.0 · DÓNDE ESTOY ==='
SELECT current_database() AS base_de_datos, current_user AS usuario, now() AS fecha_y_hora,
       (SELECT max(migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ultima_migracion;

\echo '=== A.0 · ¿Está M-72 (buylist con guía de entrada) aplicada? ==='
SELECT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name LIKE '%\_m72\_bsd\_inbound\_label'
                AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS m72_aplicada;
SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'ShipmentRequest' AND column_name = 'kind') AS tiene_kind \gset

\echo '=== A.1 · CONTEOS POR TABLA ==='
SELECT t.table_name AS tabla,
       CASE WHEN has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'SELECT')
            THEN (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text
            ELSE 'SIN PERMISO' END AS filas
FROM information_schema.tables t
WHERE t.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

\if :tiene_kind
\echo '=== A.1b · ENVÍOS por tipo (M-72): outbound = retiros y envíos de pedidos · buylist_inbound = entradas del buylist ==='
SELECT kind::text AS tipo, count(*) AS envios FROM "ShipmentRequest" GROUP BY 1 ORDER BY 1;
\endif

\echo '=== A.2 · LLAVES (FK) REALES de la base — el guion se escribió contra ESTO (del: r=RESTRICT c=CASCADE n=SET NULL a=NO ACTION) ==='
SELECT conrelid::regclass::text AS tabla, confrelid::regclass::text AS apunta_a, conname AS llave, confdeltype::text AS del
FROM pg_constraint
WHERE contype = 'f' AND connamespace = current_schema()::regnamespace
ORDER BY 2, 1, 3;

\echo '=== A.3 · LOS TRES CONTADORES (last_value = último número dado; vacío = sin permiso) ==='
SELECT sequencename AS secuencia, last_value
FROM pg_sequences WHERE schemaname = current_schema() AND sequencename IN ('order_number_seq', 'shipment_folio_seq', 'inventory_folio_seq')
ORDER BY 1;

\echo '=== A.3b · La referencia de guía más alta que viajó a Skydropx (ENV- sigue desde aquí, NO se reinicia) ==='
SELECT max("providerReference") AS max_referencia_skydropx FROM "ShipmentLabelAttempt";

\echo '=== A.4 · GUARDAS EN MODO INFORME (G-1, G-2, G-3 deben dar 0; G-4 > 0 ⇒ contesta P-1) ==='
WITH t AS (
  SELECT "inventoryItemId" AS item_id FROM "OrderItem"
  UNION SELECT "inventoryItemId" FROM "ShipmentItem"
  UNION SELECT "inventoryItemId" FROM "VaultPlacementItem"
  UNION SELECT "originalInventoryItemId" FROM "ReplacementCase"
  UNION SELECT "replacementInventoryItemId" FROM "ReplacementCase" WHERE "replacementInventoryItemId" IS NOT NULL
  UNION SELECT "inventoryItemId" FROM "Dispute"
  UNION SELECT id FROM "InventoryItem" WHERE "reservedByOrderId" IS NOT NULL
)
SELECT 'G-0 · piezas tocadas por pruebas (vuelven a inventario)' AS guarda, (SELECT count(*) FROM t) AS cuantas
UNION ALL
SELECT 'G-1 · piezas de CLIENTE que no vienen de ningún pedido',
       (SELECT count(*) FROM "InventoryItem" i WHERE i."ownerType"::text = 'customer' AND i.id NOT IN (SELECT item_id FROM t))
UNION ALL
SELECT 'G-2 · apartadas/en custodia/en camino fuera de pedidos',
       (SELECT count(*) FROM "InventoryItem" i WHERE i.status::text IN ('reserved','in_custody','picking','shipped','delivered') AND i.id NOT IN (SELECT item_id FROM t))
UNION ALL
SELECT 'G-3 · movimientos de venta/retiro/caso fuera de pedidos',
       (SELECT count(*) FROM "InventoryMovement" m WHERE m.reason::text IN ('sale','settle','chargeback_return','withdrawal','refund_return','refund_release','replacement')
          AND m."itemId" NOT IN (SELECT item_id FROM t))
UNION ALL
SELECT 'G-4 · cartas nacidas de solicitudes de venta (P-1)',
       (SELECT count(*) FROM "InventoryItem" WHERE "sourceSellRequestItemId" IS NOT NULL)
UNION ALL
SELECT 'R-6 · expedientes con INE guardada (no bloquea; ver TECH_DEBT)',
       (SELECT count(*) FROM "KycProfile" WHERE "ineFrontKey" IS NOT NULL OR "ineBackKey" IS NOT NULL)
UNION ALL
SELECT 'Rastro · limpiezas ya hechas (maintenance.test_data_purge)',
       (SELECT count(*) FROM "AuditLog" WHERE action = 'maintenance.test_data_purge');

\echo '=== A.5 · (P-1) Cartas nacidas de solicitudes de venta — ¿existen de verdad en tu estante? ==='
SELECT i.folio, c.name AS carta, i.status::text AS estado, (i."acquisitionCostCents" / 100.0)::numeric(14,2) AS costo_mxn, i."createdAt" AS alta
FROM "InventoryItem" i JOIN "Card" c ON c.id = i."cardId"
WHERE i."sourceSellRequestItemId" IS NOT NULL
ORDER BY i.folio;

ROLLBACK;
