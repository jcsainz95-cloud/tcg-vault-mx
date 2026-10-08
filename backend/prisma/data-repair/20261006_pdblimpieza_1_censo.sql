-- =====================================================================================
--  P-DB-LIMPIEZA · A · EL CENSO (SOLO LECTURA) — se corre ANTES de todo
--  Fecha: 2026-10-06 · v2: 2026-10-07 · Lo escribió: backend · Lo ejecuta: EL DUEÑO, con el usuario ADMINISTRADOR
--  Diseño: docs/specs/LIMPIEZA_DB.md §14.8 paso 3 (v2) y §8.1 (A) · Notas: BACKEND_NOTES §79 y §79.5
-- =====================================================================================
--
--  QUÉ HACE: cuenta lo que hay en cada tabla, enseña las llaves (FK) reales de la base, avisa de lo que pararía la
--  limpieza (G-1…G-3), te enseña quién tiene cartas EN CUSTODIA (G-9: tendrás que declarar las cuentas de prueba) y
--  el inventario que se va a borrar, y apunta dónde están los tres contadores (TCG-, ENV-, INV-). NO ESCRIBE NADA.
--  ⚠️ Esta salida trae correos y nombres de tus clientes: no la pegues en chats, correos ni en el repositorio.
--
--  POR QUÉ CON EL ADMINISTRADOR Y NO CON `tcg_readonly`: ese usuario solo puede leer seis tablas, así que este censo
--  se pararía en la primera consulta que toca otra. Y darle lectura de todo le abriría también contraseñas cifradas,
--  enlaces de acceso e INE: NO le des más permisos. Este fichero no puede escribir aunque lo corras con el
--  administrador: todo va dentro de una transacción de SOLO LECTURA (BEGIN TRANSACTION READ ONLY), que Postgres
--  rechaza si algo intenta escribir, y termina en ROLLBACK.
--
--  QUÉ NECESITAS: el cliente `psql` de PostgreSQL (este fichero usa sus meta-comandos \set, \if y \gset; no sirve
--  un editor SQL web). Con el CLI de Railway, `railway connect` (servicio de Postgres) abre psql conectado a tu base:
--  NO MEDIDO por el equipo en tu cuenta.
--
--  CÓMO SE CORRE (siempre así):
--   1.º (recomendado) · `railway connect` (eligiendo el servicio de Postgres) abre psql ya conectado, SIN que
--       teclees la URL ni la contraseña. Dentro de psql escribe:
--         \i 20261006_pdblimpieza_1_censo.sql
--   2.º (sin el CLI de Railway) · psql a mano, SIN dejar la contraseña en el historial del shell ni a la vista en `ps`:
--       pon la URL SIN la contraseña (postgresql://USUARIO@HOST:PUERTO/BASE, de Railway → Postgres → Connect →
--       «Public Network») y psql te pide la contraseña sin mostrarla:
--         psql "postgresql://USUARIO@HOST:PUERTO/BASE" -v ON_ERROR_STOP=1 -f 20261006_pdblimpieza_1_censo.sql
--   ⛔ No escribas la URL con la contraseña dentro (ni `URL=…`, ni `psql "postgresql://usuario:CONTRASEÑA@…"`): se queda
--      en el historial del shell y la ve cualquiera que liste los procesos. Si ya la tecleaste o pegaste en la terminal
--      o en un chat, CAMBIA la contraseña de Postgres en Railway cuando termines.
--   ⛔ NUNCA lo pegues en la ventana de psql: si algo falla, seguiría con las demás líneas y el motivo se pierde.
--
--  Qué mirar: si las guardas G-1, G-2 o G-3 dan algo distinto de 0, PARA y pregunta antes de seguir.
--  La lista A.5 (custodia por dueño) es la que tendrás que declarar en la limpieza (✏️ 2, cuentas_prueba): si ves la
--  cuenta de un cliente REAL, PARA y pregunta.
-- =====================================================================================

\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
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

\echo '=== A.4 · GUARDAS EN MODO INFORME (G-1, G-2, G-3 deben dar 0; G-9 = cartas en custodia de clientes: lista A.5) ==='
WITH t AS (
  SELECT "inventoryItemId" AS item_id FROM "OrderItem"
  UNION SELECT "inventoryItemId" FROM "ShipmentItem"
  UNION SELECT "inventoryItemId" FROM "VaultPlacementItem"
  UNION SELECT "originalInventoryItemId" FROM "ReplacementCase"
  UNION SELECT "replacementInventoryItemId" FROM "ReplacementCase" WHERE "replacementInventoryItemId" IS NOT NULL
  UNION SELECT "inventoryItemId" FROM "Dispute"
  UNION SELECT id FROM "InventoryItem" WHERE "reservedByOrderId" IS NOT NULL
)
SELECT 'G-0 · piezas tocadas por pruebas' AS guarda, (SELECT count(*) FROM t) AS cuantas
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
SELECT 'G-9 · cartas EN CUSTODIA de clientes (se borran: declara las cuentas de prueba)',
       (SELECT count(*) FROM "InventoryItem" WHERE "ownerType"::text = 'customer')
UNION ALL
SELECT 'Inventario · cartas que se BORRAN (todas: tuyas, de clientes y sellado)',
       (SELECT count(*) FROM "InventoryItem")
UNION ALL
SELECT 'R-6 · expedientes con INE guardada (no bloquea; ver TECH_DEBT)',
       (SELECT count(*) FROM "KycProfile" WHERE "ineFrontKey" IS NOT NULL OR "ineBackKey" IS NOT NULL)
UNION ALL
SELECT 'Rastro · limpiezas ya hechas (maintenance.test_data_purge)',
       (SELECT count(*) FROM "AuditLog" WHERE action = 'maintenance.test_data_purge');

\echo '=== A.5 · (G-9) CUSTODIA DE CLIENTES por dueño — estas cuentas las declaras en la limpieza (✏️ 2) si son DE PRUEBA ==='
SELECT coalesce(u.email, '(sin correo)') AS correo, coalesce(u.name, '') AS nombre, coalesce(u.role::text, '(SIN DUEÑO)') AS rol,
       count(*) AS cartas, (SELECT count(*) FROM "Order" o WHERE o."userId" = i."ownerUserId") AS pedidos, i."ownerUserId" AS id_usuario
FROM "InventoryItem" i LEFT JOIN "User" u ON u.id = i."ownerUserId"
WHERE i."ownerType"::text = 'customer'
GROUP BY u.email, u.name, u.role, i."ownerUserId"
ORDER BY 1, i."ownerUserId";

\echo '=== A.6 · El inventario que se borra, por tipo, estado y de quién es (descarga antes tu Excel de M1) ==='
SELECT i."productType"::text AS tipo, i.status::text AS estado, i."ownerType"::text AS de, count(*) AS cartas
FROM "InventoryItem" i GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

ROLLBACK;
