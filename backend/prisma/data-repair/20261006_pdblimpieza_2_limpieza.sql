-- =====================================================================================
--  P-DB-LIMPIEZA · B · LA LIMPIEZA (guion principal) — v2: TAMBIÉN SE BORRA EL INVENTARIO
--  Fecha: 2026-10-06 · v2: 2026-10-07 · v2.2: 2026-10-08 · Lo escribió: backend · Lo ejecuta: EL DUEÑO (usuario ADMINISTRADOR de la base)
--  Diseño: docs/specs/LIMPIEZA_DB.md §14 (v2, manda sobre v1), §14.13 (v2.2), §2.4–§2.7, §6 · Notas: BACKEND_NOTES §79, §79.5 (v2) y §87 (v2.2)
-- =====================================================================================
--
--  QUÉ HACE ESTO, EN CASTELLANO
--  ----------------------------
--  Borra de la base TODO lo que dejaron las pruebas: pedidos, pagos y reembolsos, SPEI manuales, casos
--  «Por reponer», colocaciones de bóveda, envíos y todo lo de Skydropx, disputas, solicitudes de venta (buylist),
--  avisos de gasto, portafolios y la bitácora. Y como pediste, también BORRA TODO tu inventario: cartas sueltas,
--  gradeadas y sellado, las tuyas y las que estaban en custodia de clientes, con su historial de movimientos y
--  levantamientos, los lotes de alta y los «sin precio» de inventario. Después lo vuelves a subir en M1.
--  NO toca: usuarios, catálogo (cartas, sets, imágenes), precios (referencias de mercado y tus precios por variante),
--  el sellado del catálogo (con tu precio por producto y su imagen), tus cajones (vacíos) ni los diales.
--  Tampoco toca el catálogo de accesorios (nombre, precio, costo, foto, y las 8 energías), pero sus EXISTENCIAS
--  vuelven a 0: anótalas de la lista 2.7 del ensayo y vuelve a recibirlas en Accesorios. Ni tu lista de deseos ni los
--  correos que ya mandó (sí se borran sus avisos por pieza, porque las piezas se borran).
--  Al final deja UNA fila en la bitácora con lo que se hizo (sin correos ni folios).
--  ⚠️ Esta salida trae correos y nombres de tus clientes: no la pegues en chats, correos ni en el repositorio.
--
--  ANTES DE EMPEZAR: descarga el Excel de tu inventario (M1 → exportar) y guárdalo. Es tu lista para volver a subir.
--  Sus folios (INV-…) son los VIEJOS: después de esto el folio vuelve a empezar en INV-000001, así que úsalo como
--  lista de cartas, no de folios.
--
--  QUÉ NECESITAS
--  -------------
--  · El cliente `psql` de PostgreSQL (versión 13 o más nueva). Este fichero usa sus meta-comandos \set, \if y \gset,
--    así que NO sirve en un editor SQL web ni en otra herramienta: tiene que ser psql.
--  · Railway: si tienes instalado el CLI de Railway, `railway connect` (eligiendo el servicio de Postgres) abre psql
--    ya conectado a tu base. NO MEDIDO por el equipo: no lo hemos probado en tu cuenta.
--  · Este fichero, descargado del repositorio, en la carpeta desde la que corres psql.
--
--  CÓMO SE CORRE (siempre así; el primer paso no cambia nada)
--  ----------------------------------------------------------
--   1.º (recomendado) · `railway connect` (eligiendo el servicio de Postgres) abre psql ya conectado, SIN que
--       teclees la URL ni la contraseña. Dentro de psql escribe:
--         \i 20261006_pdblimpieza_2_limpieza.sql
--   2.º (sin el CLI de Railway) · psql a mano, SIN dejar la contraseña en el historial del shell ni a la vista en `ps`:
--       pon la URL SIN la contraseña (postgresql://USUARIO@HOST:PUERTO/BASE, de Railway → Postgres → Connect →
--       «Public Network») y psql te pide la contraseña sin mostrarla:
--         psql "postgresql://USUARIO@HOST:PUERTO/BASE" -v ON_ERROR_STOP=1 -f 20261006_pdblimpieza_2_limpieza.sql
--   ⛔ No escribas la URL con la contraseña dentro (ni `URL=…`, ni `psql "postgresql://usuario:CONTRASEÑA@…"`): se queda
--      en el historial del shell y la ve cualquiera que liste los procesos. Si ya la tecleaste o pegaste en la terminal
--      o en un chat, CAMBIA la contraseña de Postgres en Railway cuando termines.
--   ⛔ NUNCA lo pegues en la ventana de psql: si una guarda lo para, psql seguiría con las demás líneas y verías
--      decenas de errores que tapan el motivo real. Corriéndolo con -f o \i se para en el PRIMER error, y lo último
--      que ves es el motivo (G-n). Si se paró dentro de psql (\i), sal con \q: al salir se deshace todo.
--   SI AL FINAL VES ROLLBACK, NO SE APLICÓ NADA. Solo se aplicó si la última palabra que sale es COMMIT.
--
--   PASO 1 · Córrelo TAL CUAL. Termina en ROLLBACK («deshaz todo»): no escribe nada. Te enseña los pedidos,
--            envíos y solicitudes que se borran, la CUSTODIA DE CLIENTES por dueño (correo, nombre, piezas, pedidos)
--            y el RESUMEN del inventario que se borra (por tipo, estado y dueño). Al final se para con un mensaje que
--            dice qué falta decidir (las dos líneas ✏️ de abajo). Eso es lo esperado en el ensayo.
--   PASO 2 · Abre el fichero en un editor de texto y escribe tus respuestas en las DOS líneas «✏️» de abajo (entre
--            las comillas simples): el respaldo manual y cuentas_prueba (las cuentas de prueba que tienen cartas en
--            custodia, de la lista del paso 1). Guarda.
--   PASO 3 · Córrelo otra vez (sigue terminando en ROLLBACK). Esta vez debe llegar hasta el final sin error,
--            enseñarte la tabla «tabla · antes · después · esperado» y terminar con la palabra ROLLBACK.
--   PASO 4 · Si estás de acuerdo: cambia la ÚLTIMA línea del fichero, donde dice  ROLLBACK;  por  COMMIT;
--            guarda y córrelo otra vez. Debe terminar con la palabra COMMIT. **Copia el «PUNTO PITR» que sale al
--            principio**: es el instante al que restauras si hubiera que deshacerlo (Railway → Postgres → Backups).
--   PASO 5 · Corre el fichero 3 (folios) ANTES de volver a subir nada, y luego el 4 (verificación). Si el 4 dice AVISO
--            en el contador de inventario, es que subiste cartas antes del 3: no rompe nada, solo que tus folios no
--            empiezan en INV-000001.
--   PASO 6 · Vuelve a subir tu inventario en M1: la primera carta debe salir INV-000001.
--
--  ¿QUIERES CONSERVAR LA BITÁCORA? Este fichero la BORRA entera (queda solo en el respaldo de Railway). Si quieres una
--  copia en tu computadora, ANTES del COMMIT abre psql (como arriba) y escribe esta línea; deja el fichero
--  bitacora-antes-de-limpieza.csv en la carpeta desde la que abriste psql:
--      \copy (SELECT * FROM "AuditLog" ORDER BY "createdAt", id) TO 'bitacora-antes-de-limpieza.csv' WITH (FORMAT csv, HEADER)
--  Trae datos de tu operación y de clientes: guárdalo en un sitio privado, no lo subas al repositorio ni lo mandes
--  por chat.
--
--  SI ALGO NO CUADRA, SE PARA SOLO: cualquier cosa que el diseño no conoce (una carta de cliente que no vino de un
--  pedido, una tabla nueva que el diseño no clasificó…) aborta TODO con un mensaje G-n y no se escribe nada. No hay
--  estado a medias: o se hace entero o no se hace nada.
--
--  ⛔ Este fichero NO lleva ni host, ni usuario, ni contraseña. Te conectas con lo tuyo.
--  ⛔ No reinicia NINGÚN contador (un contador no se deshace con ROLLBACK). Los de pedidos (TCG-) e inventario (INV-)
--     los reinicia el fichero 3, DESPUÉS del COMMIT de éste. El de envíos (ENV-) NO se reinicia nunca (por qué:
--     LIMPIEZA_DB.md §5.2).
--  Correrlo dos veces no hace daño: la segunda no encuentra nada que cambiar y no cambia nada. Y si ya se hizo y
--  después apareció CUALQUIER fila nueva en lo que se borra (un pedido real, una carta que ya volviste a subir, un
--  portafolio del job diario…), se NIEGA a correr (G-7): eso ya es real.
-- =====================================================================================

\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
\pset pager off
\timing off

-- ✏️ 1 · Nombre y hora del RESPALDO MANUAL que tomaste justo antes (Railway → Postgres → Backups → Create backup).
--        Obligatorio para el COMMIT. Ejemplo:  \set respaldo_manual 'manual 2026-10-08 09:15'
\set respaldo_manual ''
-- ✏️ 2 · (G-9) Las cuentas DE PRUEBA que tienen cartas en custodia (lista «2.4 · CUSTODIA» del ensayo): sus correos,
--        o su id si la cuenta no tiene correo, separados por coma. Si una cuenta de esa lista es de un cliente REAL,
--        NO sigas: pregunta. Si la lista sale vacía, déjalo vacío.
--        Ejemplo:  \set cuentas_prueba 'yo+prueba1@gmail.com, yo+prueba2@gmail.com'
\set cuentas_prueba ''

-- v2.2 (§14.13 LZ-A1): ¿tiene tu base las tablas de accesorios (M-73) y de la lista de deseos (M-74)? Se mira AQUÍ,
-- ANTES del BEGIN: fuera de la transacción no se toma la foto de abajo (C-4). Todo lo de accesorios y deseos va dentro
-- de \if: sin esas tablas psql ni siquiera manda esas líneas a la base, y el resultado es el de siempre.
SELECT to_regclass(format('%I', 'Accessory')) IS NOT NULL AS lz_m73,
       to_regclass(format('%I', 'WishlistNotice')) IS NOT NULL AS lz_m74 \gset

-- C-4: REPEATABLE READ = una sola FOTO de la base para toda la transacción. Un alta de usuario o de precio que entre
-- MIENTRAS esto corre no cambia los conteos «antes/después» (sin G-5 falso). La foto se toma en la primera consulta,
-- DESPUÉS de los candados de abajo (por eso no hay ninguna consulta antes del LOCK dentro de la transacción).
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Nadie escribe a la mitad: si un job o un webhook tiene estas tablas, en 5 s se rinde sin tocar nada. (v2: también
-- los lotes de alta y la cola de precio, que el job de precios escribe leyendo piezas.)
LOCK TABLE "Order", "ShipmentRequest", "SellRequest", "InventoryItem", "PaymentRefund", "ManualRefund", "InventoryBatch", "PendingPriceEntry" IN SHARE ROW EXCLUSIVE MODE;
-- v2.2: las existencias de accesorios (una recepción a mitad dejaría piezas tras la limpieza) y los avisos de deseos.
\if :lz_m73
LOCK TABLE "Accessory", "OrderAccessoryLine" IN SHARE ROW EXCLUSIVE MODE;
\endif
\if :lz_m74
LOCK TABLE "WishlistNotice" IN SHARE ROW EXCLUSIVE MODE;
\endif

-- Estados y tipos en castellano para las listas (función temporal: desaparece al cerrar la sesión).
CREATE FUNCTION pg_temp.lz_es(s text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE s
    WHEN 'in_stock' THEN 'en inventario'   WHEN 'listed' THEN 'a la venta'      WHEN 'reserved' THEN 'apartada'
    WHEN 'in_custody' THEN 'en custodia'   WHEN 'picking' THEN 'en preparación' WHEN 'shipped' THEN 'enviada'
    WHEN 'delivered' THEN 'entregada'      WHEN 'lost' THEN 'perdida'           WHEN 'damaged' THEN 'dañada'
    WHEN 'withdrawn' THEN 'retirada'
    WHEN 'pending' THEN 'pendiente'        WHEN 'settled' THEN 'pagado'         WHEN 'failed' THEN 'fallido'
    WHEN 'refunded' THEN 'reembolsado'     WHEN 'chargeback' THEN 'contracargo'
    WHEN 'vault' THEN 'bóveda'             WHEN 'direct_ship' THEN 'envío directo'
    WHEN 'raw' THEN 'suelta'               WHEN 'graded' THEN 'gradeada'        WHEN 'sealed' THEN 'sellado'
    WHEN 'platform' THEN 'tienda'          WHEN 'customer' THEN 'cliente'
    ELSE s END $f$;

-- ------------------------------------------------------------------------------------
-- 0 · DÓNDE ESTOY · el PUNTO PITR es now() al empezar la transacción: nada de esto existe antes de ese instante
-- ------------------------------------------------------------------------------------
\echo '=== 0 · DÓNDE ESTOY — copia el PUNTO PITR (si hubiera que deshacer, se restaura a ese instante) ==='
SELECT current_database() AS base_de_datos,
       current_user       AS usuario,
       now()              AS "PUNTO PITR",
       (SELECT max(migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ultima_migracion,
       EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name LIKE '%\_m72\_bsd\_inbound\_label' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS m72_aplicada;

CREATE TEMP TABLE lz_param ON COMMIT DROP AS
SELECT btrim(:'respaldo_manual')            AS respaldo,
       btrim(:'cuentas_prueba')             AS cuentas,
       to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha,
       now()                                AS punto_pitr;

-- G-9: la lista ✏️ 2 ya leída. Cada elemento se busca como correo (sin distinguir mayúsculas) o como id de usuario;
-- user_id NULL = no existe en la base (errata).
CREATE TEMP TABLE lz_cuentas ON COMMIT DROP AS
SELECT x.token, u.id AS user_id
FROM (SELECT DISTINCT btrim(t) AS token FROM lz_param, unnest(string_to_array(cuentas, ',')) AS t WHERE btrim(t) <> '') x
LEFT JOIN "User" u ON lower(u.email) = lower(x.token) OR u.id = x.token;

-- Cuánto cambió cada paso (para la idempotencia: si todo da 0, no se escribe rastro nuevo).
CREATE TEMP TABLE lz_cambio (paso text NOT NULL, filas bigint NOT NULL) ON COMMIT DROP;

-- ------------------------------------------------------------------------------------
-- 1 · CONTEOS ANTES (todas las tablas; las que no existan en esta versión salen vacías) — clasificación v2 (§14.2)
-- ------------------------------------------------------------------------------------
CREATE TEMP TABLE lz_conteo (tabla text PRIMARY KEY, grupo text NOT NULL, antes bigint, despues bigint, esperado bigint) ON COMMIT DROP;
INSERT INTO lz_conteo (tabla, grupo)
SELECT t, 'borrar' FROM unnest(ARRAY[
  'ManualRefund','PaymentRefund','ReplacementCase','Dispute','VaultPlacementItem','VaultPlacement',
  'ShipmentCostAdjustment','ShipmentPaidLabel','ShipmentLabelAttempt','ShipmentRequest','ShipmentItem','ShipmentQuote',
  'ShipmentCarrierEvent','ShipmentAddressRevision','Order','OrderItem','OrderAccessToken','SellRequest','SellRequestItem',
  'InventoryItem','InventoryMovement','InventoryAdjustment','InventoryBatch',
  'SpendAlert','PortfolioSnapshot','AuditLog',
  -- v2.2 (§14.13): M-73 (renglones de pedido y de envío, paquete de energías, historial de existencias) y M-74 (avisos)
  'OrderAccessoryLine','OrderEnergyBundleComponent','ShipmentAccessoryLine','AccessoryStockMovement','WishlistNotice']) AS t
UNION ALL
SELECT t, 'ajustar' FROM unnest(ARRAY['VariantPriceOverride','PendingPriceEntry',
  -- v2.2: el accesorio se queda (catálogo); sus existencias y apartados vuelven a 0
  'Accessory']) AS t
UNION ALL
SELECT t, 'conservar' FROM unnest(ARRAY[
  'User','KycProfile','KycUploadGrant','BillingProfile','Address','AuthToken','CardSet','SealedSetGroup','SealedProduct','Card',
  'CardProduct','PostalCode','ShippingPackage','PriceReference','FxRate','SetValueSnapshot','ConfigSetting',
  'VaultLocation','ProcessedStripeEvent','SpendDigestRun','SpendOwnerWatch','SealedRestockSubscription',
  'MetaDeck','MetaDeckList','MetaDeckCard','MetaFetchRun',
  -- v2.2: la foto del accesorio (catálogo), los deseos y los correos de deseos ya enviados
  'AccessoryPhoto','WishlistItem','WishlistMail']) AS t;

-- G-8 (C-3) · Toda tabla de la base tiene que estar clasificada arriba (borrar / ajustar / conservar). Una tabla que
-- el diseño no conoce (una migración posterior a este fichero) PARA todo: no se adivina si es de prueba o real.
DO $$
DECLARE ej text;
BEGIN
  SELECT string_agg(t.table_name, ', ' ORDER BY t.table_name) INTO ej
    FROM information_schema.tables t
   WHERE t.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
     AND t.table_name <> '_prisma_migrations'
     AND t.table_name NOT IN (SELECT tabla FROM lz_conteo);
  IF ej IS NOT NULL THEN
    RAISE EXCEPTION 'G-8 · La base tiene tabla(s) que el diseño de la limpieza no clasificó: %. Este fichero es más viejo que tu base: pide que lo actualicen. No se escribió nada.', ej;
  END IF;
END $$;

DO $$
DECLARE r record; c bigint;
BEGIN
  FOR r IN SELECT tabla FROM lz_conteo LOOP
    IF to_regclass(format('%I', r.tabla)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', r.tabla) INTO c;
      UPDATE lz_conteo SET antes = c WHERE tabla = r.tabla;
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------
-- 2 · LO QUE SE VA A BORRAR, LAS GUARDAS Y TODO A LA VISTA (se calcula AHORA: después de borrar ya no se podría)
-- ------------------------------------------------------------------------------------
-- T = piezas referidas por cualquier pedido, envío, colocación, caso o disputa, o apartadas por un pedido (§4.1).
-- En v2 ya no es un plan de restauración: solo sirve a G-1…G-3 (lo que el modelo no conoce, para).
CREATE TEMP TABLE lz_t ON COMMIT DROP AS
SELECT DISTINCT item_id FROM (
  SELECT oi."inventoryItemId" AS item_id FROM "OrderItem" oi
  UNION ALL SELECT si."inventoryItemId" FROM "ShipmentItem" si
  UNION ALL SELECT vpi."inventoryItemId" FROM "VaultPlacementItem" vpi
  UNION ALL SELECT rc."originalInventoryItemId" FROM "ReplacementCase" rc
  UNION ALL SELECT rc."replacementInventoryItemId" FROM "ReplacementCase" rc WHERE rc."replacementInventoryItemId" IS NOT NULL
  UNION ALL SELECT dp."inventoryItemId" FROM "Dispute" dp
  UNION ALL SELECT i.id FROM "InventoryItem" i WHERE i."reservedByOrderId" IS NOT NULL
) refs;
ALTER TABLE lz_t ADD PRIMARY KEY (item_id);

-- Custodia de clientes por dueño (G-9) y el inventario por tipo (para el rastro), ANTES de borrar.
CREATE TEMP TABLE lz_custodia ON COMMIT DROP AS
SELECT i."ownerUserId" AS user_id, count(*) AS piezas
FROM "InventoryItem" i WHERE i."ownerType"::text = 'customer' GROUP BY 1;
CREATE TEMP TABLE lz_inv_tipo ON COMMIT DROP AS
SELECT i."productType"::text AS tipo, count(*) AS piezas FROM "InventoryItem" i GROUP BY 1;
-- Huecos de precio que se van (§14.2: solo los de inventario/portafolio; los de catálogo y cotizador se quedan).
CREATE TEMP TABLE lz_cola ON COMMIT DROP AS
SELECT count(*) AS n FROM "PendingPriceEntry" WHERE context::text IN ('inventory', 'portfolio');
-- v2.2 (LZ-A4): accesorios con existencias o apartados ≠ 0, ANTES de ponerlos en 0 (lista 2.7 y rastro). Vacía sin M-73.
CREATE TEMP TABLE lz_acc (id text, name text, category text, active boolean, stock_qty integer, reserved_qty integer) ON COMMIT DROP;
\if :lz_m73
INSERT INTO lz_acc
SELECT a.id, a.name, a.category::text, a.active, a."stockQty", a."reservedQty"
FROM "Accessory" a WHERE a."stockQty" <> 0 OR a."reservedQty" <> 0;
\endif
-- v2.2 (LZ-A8): decisiones que faltan y que solo existen con M-74 (G-10). Vacía sin M-74; la lee el bloque del final.
CREATE TEMP TABLE lz_falta (msg text NOT NULL) ON COMMIT DROP;

-- ---- Guardas que paran TODO de inmediato (el modelo no las conoce: no se adivina)
DO $$
DECLARE n bigint; ej text;
BEGIN
  -- G-7 · La limpieza ya se hizo y DESPUÉS apareció cualquier fila en lo que se borra (un pedido real, una carta que
  -- ya volviste a subir, el portafolio o un aviso que escribe un job diario…): eso ya es real. Se niega ENTERO.
  SELECT string_agg(tabla || ' (' || antes || ')', ', ' ORDER BY tabla) INTO ej
    FROM lz_conteo WHERE grupo = 'borrar' AND tabla <> 'AuditLog' AND antes > 0;
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE action = 'maintenance.test_data_purge') AND ej IS NOT NULL THEN
    RAISE EXCEPTION 'G-7 · La limpieza YA se hizo (hay rastro «maintenance.test_data_purge» del %) y después aparecieron filas nuevas en: %. Eso ya es real: NO se borra nada. No hace falta volver a correr este fichero.',
      (SELECT to_char(max("createdAt"), 'YYYY-MM-DD HH24:MI') FROM "AuditLog" WHERE action = 'maintenance.test_data_purge'), ej;
  END IF;

  -- G-1 · Pieza de CLIENTE que no vino de ningún pedido/envío/caso/disputa: origen desconocido, no se borra a ciegas.
  SELECT count(*), string_agg(folio, ', ' ORDER BY folio) INTO n, ej FROM (
    SELECT i.folio FROM "InventoryItem" i WHERE i."ownerType"::text = 'customer' AND i.id NOT IN (SELECT item_id FROM lz_t) LIMIT 20) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'G-1 · Hay % pieza(s) de CLIENTE que no vienen de ningún pedido (p. ej. %). El diseño no las conoce: no se adivina. No se escribió nada.', n, ej;
  END IF;

  -- G-2 · Pieza apartada / en custodia / en camino fuera de T.
  SELECT count(*), string_agg(folio || ' (' || status || ')', ', ' ORDER BY folio) INTO n, ej FROM (
    SELECT i.folio, i.status::text AS status FROM "InventoryItem" i
     WHERE i.status::text IN ('reserved','in_custody','picking','shipped','delivered') AND i.id NOT IN (SELECT item_id FROM lz_t) LIMIT 20) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'G-2 · Hay % pieza(s) apartadas, en custodia o en camino que no vienen de ningún pedido (p. ej. %). No se escribió nada.', n, ej;
  END IF;

  -- G-3 · Movimiento de pedido/retiro/caso sobre una pieza fuera de T.
  SELECT count(*), string_agg(f || ' ' || r, ', ') INTO n, ej FROM (
    SELECT i.folio AS f, m.reason::text AS r FROM "InventoryMovement" m JOIN "InventoryItem" i ON i.id = m."itemId"
     WHERE m.reason::text IN ('sale','settle','chargeback_return','withdrawal','refund_return','refund_release','replacement')
       AND m."itemId" NOT IN (SELECT item_id FROM lz_t) LIMIT 20) x;
  IF n > 0 THEN
    RAISE EXCEPTION 'G-3 · Hay % movimiento(s) de venta/retiro/caso sobre piezas que no vienen de ningún pedido (p. ej. %). No se escribió nada.', n, ej;
  END IF;

  -- G-9 (errata) · un correo/id de ✏️ 2 que no es ninguna cuenta: un error al escribir no decide qué se borra.
  SELECT string_agg(token, ', ' ORDER BY token) INTO ej FROM lz_cuentas WHERE user_id IS NULL;
  IF ej IS NOT NULL THEN
    RAISE EXCEPTION 'G-9 · cuentas_prueba: «%» no es ninguna cuenta de la base (ni correo ni id). Revisa lo que escribiste en la línea ✏️ 2 contra la lista 2.4 del ensayo. No se escribió nada.', ej;
  END IF;
END $$;

\echo '=== 2.1 · PEDIDOS que se borran ==='
SELECT o."orderNumber" AS pedido, pg_temp.lz_es(o.status::text) AS estado, pg_temp.lz_es(o."fulfillmentMode"::text) AS modo, (o."totalCents" / 100.0)::numeric(14,2) AS total_mxn,
       o."paymentMethodLast4" AS tarjeta, o."createdAt" AS creado
FROM "Order" o ORDER BY o."createdAt", o.id;

\echo '=== 2.2 · ENVÍOS que se borran (las guías reales de Skydropx NO se tocan: viven allá) ==='
SELECT s.folio, s.status::text AS estado, s."labelSource"::text AS guia, s.carrier AS paqueteria, s."trackingNumber" AS rastreo,
       s."providerShipmentId" AS id_skydropx, s."requestedAt" AS creado
FROM "ShipmentRequest" s ORDER BY s.folio;

\echo '=== 2.3 · SOLICITUDES DE VENTA (buylist) que se borran ==='
SELECT r.id AS solicitud, r.status::text AS estado, r."createdAt" AS creada, (r."quotedTotalCents" / 100.0)::numeric(14,2) AS cotizado_mxn,
       (SELECT count(*) FROM "SellRequestItem" x WHERE x."sellRequestId" = r.id) AS lineas
FROM "SellRequest" r ORDER BY r."createdAt", r.id;

\echo '=== 2.4 · CUSTODIA DE CLIENTES por dueño — cartas de clientes que se BORRAN. Escribe en ✏️ 2 las cuentas DE PRUEBA; si alguna es REAL, NO sigas ==='
SELECT coalesce(u.email, '(sin correo)') AS correo, coalesce(u.name, '') AS nombre, coalesce(u.role::text, '(SIN DUEÑO)') AS rol,
       c.piezas, (SELECT count(*) FROM "Order" o WHERE o."userId" = c.user_id) AS pedidos,
       CASE WHEN c.user_id IS NOT NULL AND c.user_id IN (SELECT user_id FROM lz_cuentas WHERE user_id IS NOT NULL)
            THEN 'sí' ELSE 'NO — falta en ✏️ 2' END AS declarada_de_prueba,
       c.user_id AS id_usuario
FROM lz_custodia c LEFT JOIN "User" u ON u.id = c.user_id
ORDER BY 1, c.user_id;

\echo '=== 2.5 · RESUMEN DEL INVENTARIO QUE SE BORRA (por tipo, estado y de quién es; vuelves a subir el tuyo desde tu Excel) ==='
SELECT pg_temp.lz_es(i."productType"::text) AS tipo, pg_temp.lz_es(i.status::text) AS estado, pg_temp.lz_es(i."ownerType"::text) AS de,
       count(*) AS piezas
FROM "InventoryItem" i GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT (SELECT count(*) FROM "InventoryItem") AS total_cartas, (SELECT count(*) FROM "InventoryBatch") AS lotes_de_alta,
       (SELECT n FROM lz_cola) AS sin_precio_de_inventario;

\echo '=== 2.6 · BOUNTIES: lo comprado por buylist de prueba vuelve a 0 (si alguno se apagó solo, queda apagado: lo re-enciendes en un clic) ==='
SELECT c.name AS carta, v."gradeKey", v.finish::text AS acabado, v."bountyEnabled" AS encendido, v."bountyAcquiredQty" AS comprado,
       v."bountyTargetQty" AS objetivo, v."bountyCompletedAt" AS completado
FROM "VariantPriceOverride" v JOIN "Card" c ON c.id = v."cardId"
WHERE v."bountyAcquiredQty" <> 0 OR v."bountyCompletedAt" IS NOT NULL
ORDER BY c.name;

\if :lz_m73
\echo '=== 2.7 · ACCESORIOS: existencias que vuelven a 0 (anótalas: las vuelves a recibir en Accesorios) ==='
SELECT name AS accesorio, category AS categoria, CASE WHEN active THEN 'sí' ELSE 'no' END AS activo,
       stock_qty AS existencias, reserved_qty AS apartadas
FROM lz_acc ORDER BY name, id;
\endif
\if :lz_m74
\echo '=== 2.8 · AVISOS (diales; «Avísame cuando vuelva» de sellado y lista de deseos). Al re-subir una carta que alguien desea, si la lista está en on, le llega UN «ya la tenemos» ==='
SELECT coalesce((SELECT s."valueJson" #>> '{}' FROM "ConfigSetting" s WHERE s.key = 'sealed_restock_alerts'), 'off') AS aviso_sellado,
       (SELECT count(*) FROM "SealedRestockSubscription" x WHERE x."notifiedAt" IS NULL AND x."armedAt" IS NULL) AS sellado_pendientes_sin_armar,
       (SELECT count(*) FROM "SealedRestockSubscription" x WHERE x."notifiedAt" IS NULL AND x."armedAt" IS NOT NULL) AS sellado_pendientes_armadas,
       coalesce((SELECT s."valueJson" #>> '{}' FROM "ConfigSetting" s WHERE s.key = 'wishlist_enabled'), 'off') AS lista_de_deseos,
       (SELECT count(*) FROM "WishlistItem") AS deseos,
       (SELECT count(*) FROM "WishlistMail") AS correos_de_deseos;
\endif

-- ------------------------------------------------------------------------------------
-- 3 · SPEI manuales (ManualRefund), por HOJAS: primero los que nadie re-emite (la cadena «reissuedFrom» es RESTRICT)
-- ------------------------------------------------------------------------------------
DO $$
DECLARE k bigint; total bigint := 0; vueltas int := 0;
BEGIN
  LOOP
    DELETE FROM "ManualRefund" m WHERE NOT EXISTS (SELECT 1 FROM "ManualRefund" h WHERE h."reissuedFromId" = m.id);
    GET DIAGNOSTICS k = ROW_COUNT;
    EXIT WHEN k = 0;
    total := total + k;
    vueltas := vueltas + 1;
    IF vueltas > 10000 THEN RAISE EXCEPTION 'ManualRefund: la cadena de re-emisiones no termina (¿ciclo?). No se escribió nada.'; END IF;
  END LOOP;
  INSERT INTO lz_cambio VALUES ('3 ManualRefund', total);
END $$;

-- 4 · 5 · 6 · 7 — reembolsos de Stripe, casos, disputas, colocaciones (todos RESTRICT hacia las piezas: van antes)
WITH x AS (DELETE FROM "PaymentRefund" RETURNING 1) INSERT INTO lz_cambio SELECT '4 PaymentRefund', count(*) FROM x;
WITH x AS (DELETE FROM "ReplacementCase" RETURNING 1) INSERT INTO lz_cambio SELECT '5 ReplacementCase', count(*) FROM x;
WITH x AS (DELETE FROM "Dispute" RETURNING 1) INSERT INTO lz_cambio SELECT '6 Dispute', count(*) FROM x;
WITH x AS (DELETE FROM "VaultPlacementItem" RETURNING 1) INSERT INTO lz_cambio SELECT '7 VaultPlacementItem', count(*) FROM x;
WITH x AS (DELETE FROM "VaultPlacement" RETURNING 1) INSERT INTO lz_cambio SELECT '7 VaultPlacement', count(*) FROM x;

-- 8 · Skydropx y envíos (TODOS: retiros, envíos directos y entradas del buylist). Cascada: líneas, cotizaciones,
--     eventos de paquetería y correcciones de dirección.
WITH x AS (DELETE FROM "ShipmentCostAdjustment" RETURNING 1) INSERT INTO lz_cambio SELECT '8 ShipmentCostAdjustment', count(*) FROM x;
WITH x AS (DELETE FROM "ShipmentPaidLabel" RETURNING 1) INSERT INTO lz_cambio SELECT '8 ShipmentPaidLabel', count(*) FROM x;
WITH x AS (DELETE FROM "ShipmentLabelAttempt" RETURNING 1) INSERT INTO lz_cambio SELECT '8 ShipmentLabelAttempt', count(*) FROM x;
-- v2.2: la línea de preparación de accesorios apunta al envío con RESTRICT: va antes.
\if :lz_m73
WITH x AS (DELETE FROM "ShipmentAccessoryLine" RETURNING 1) INSERT INTO lz_cambio SELECT '8 ShipmentAccessoryLine', count(*) FROM x;
\endif
WITH x AS (DELETE FROM "ShipmentRequest" RETURNING 1) INSERT INTO lz_cambio SELECT '8 ShipmentRequest', count(*) FROM x;

-- 9 · Pedidos (cascada: líneas y tokens de invitado). Las líneas apuntan a las piezas con RESTRICT: van ANTES.
--     v2.2: los renglones de accesorio apuntan al pedido con RESTRICT, y los componentes del paquete al renglón: van antes.
\if :lz_m73
WITH x AS (DELETE FROM "OrderEnergyBundleComponent" RETURNING 1) INSERT INTO lz_cambio SELECT '9 OrderEnergyBundleComponent', count(*) FROM x;
WITH x AS (DELETE FROM "OrderAccessoryLine" RETURNING 1) INSERT INTO lz_cambio SELECT '9 OrderAccessoryLine', count(*) FROM x;
\endif
WITH x AS (DELETE FROM "Order" RETURNING 1) INSERT INTO lz_cambio SELECT '9 Order', count(*) FROM x;

-- 10 · Solicitudes de venta (cascada: sus líneas).
WITH x AS (DELETE FROM "SellRequest" RETURNING 1) INSERT INTO lz_cambio SELECT '10 SellRequest', count(*) FROM x;

-- 11 · EL INVENTARIO, ENTERO (plataforma, custodia y sellado). Cascada: movimientos y levantamientos.
--      El sellado del catálogo (SealedProduct) NO se toca: la pieza apunta a él con SET NULL.
WITH x AS (DELETE FROM "InventoryItem" RETURNING 1) INSERT INTO lz_cambio SELECT '11 InventoryItem', count(*) FROM x;
--      v2.2: con M-74, los avisos de deseos caen aquí por cascada con su pieza (sin DELETE propio).
--      v2.2: los accesorios. El historial de existencias se borra; el producto se QUEDA con existencias y apartados en 0
--      (las dos columnas en la MISMA sentencia: el CHECK pide 0 ≤ apartadas ≤ existencias). El WHERE deja intactos los
--      que ya están en 0 (las energías sin piezas, sin tocar ni su fecha) y hace que una 2.ª corrida no cambie nada.
\if :lz_m73
WITH x AS (DELETE FROM "AccessoryStockMovement" RETURNING 1) INSERT INTO lz_cambio SELECT '11 AccessoryStockMovement', count(*) FROM x;
WITH x AS (
  UPDATE "Accessory" SET "stockQty" = 0, "reservedQty" = 0, "updatedAt" = now()
   WHERE "stockQty" <> 0 OR "reservedQty" <> 0
  RETURNING 1)
INSERT INTO lz_cambio SELECT '11 Accessory existencias', count(*) FROM x;
\endif

-- 12 · Lotes de alta (guardan folios de piezas que ya no existen) y los «sin precio» de inventario/portafolio.
WITH x AS (DELETE FROM "InventoryBatch" RETURNING 1) INSERT INTO lz_cambio SELECT '12 InventoryBatch', count(*) FROM x;
WITH x AS (DELETE FROM "PendingPriceEntry" WHERE context::text IN ('inventory', 'portfolio') RETURNING 1)
INSERT INTO lz_cambio SELECT '12 PendingPriceEntry inventario', count(*) FROM x;

-- 13 · Avisos de gasto, portafolios y bounties.
WITH x AS (DELETE FROM "SpendAlert" RETURNING 1) INSERT INTO lz_cambio SELECT '13 SpendAlert', count(*) FROM x;
WITH x AS (DELETE FROM "PortfolioSnapshot" RETURNING 1) INSERT INTO lz_cambio SELECT '13 PortfolioSnapshot', count(*) FROM x;
WITH x AS (
  UPDATE "VariantPriceOverride" SET "bountyAcquiredQty" = 0, "bountyCompletedAt" = NULL, "updatedAt" = now()
   WHERE "bountyAcquiredQty" <> 0 OR "bountyCompletedAt" IS NOT NULL
  RETURNING 1)
INSERT INTO lz_cambio SELECT '13 VariantPriceOverride bounties', count(*) FROM x;

-- 14 · Bitácora: fuera todo lo anterior a esta limpieza. Si ya hubo una limpieza, lo POSTERIOR a ella es real y se queda.
WITH x AS (
  DELETE FROM "AuditLog" a
   WHERE a.action <> 'maintenance.test_data_purge'
     AND a."createdAt" < coalesce((SELECT max(z."createdAt") FROM "AuditLog" z WHERE z.action = 'maintenance.test_data_purge'), 'infinity'::timestamp)
  RETURNING 1)
INSERT INTO lz_cambio SELECT '14 AuditLog', count(*) FROM x;

-- ------------------------------------------------------------------------------------
-- 15 · CONTEOS DESPUÉS, lo ESPERADO y la guarda de cierre (G-5) — luego el rastro
-- ------------------------------------------------------------------------------------
DO $$
DECLARE r record; c bigint;
BEGIN
  FOR r IN SELECT tabla FROM lz_conteo LOOP
    IF to_regclass(format('%I', r.tabla)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', r.tabla) INTO c;
      UPDATE lz_conteo SET despues = c WHERE tabla = r.tabla;
    END IF;
  END LOOP;
END $$;

-- v2.2 (LZ-W2): solo las que EXISTEN (una tabla de M-73/M-74 en una base sin ella da NULL, no 0).
UPDATE lz_conteo SET esperado = 0 WHERE grupo = 'borrar' AND tabla <> 'AuditLog' AND antes IS NOT NULL;
UPDATE lz_conteo SET esperado = antes WHERE grupo = 'conservar' OR tabla IN ('VariantPriceOverride', 'Accessory');
-- La cola: antes − las de inventario/portafolio contadas ANTES de borrar (no lo que dijo el DELETE: así G-5 caza un
-- borrado que se pase de largo).
UPDATE lz_conteo SET esperado = antes - (SELECT n FROM lz_cola) WHERE tabla = 'PendingPriceEntry';

DO $$
DECLARE n bigint; ej text;
BEGIN
  -- G-5 · Nada sobrevive en las tablas que se vacían, y cada conteo es el esperado.
  SELECT count(*), string_agg(tabla || ' ' || despues || '≠' || esperado, ', ') INTO n, ej
    FROM lz_conteo WHERE esperado IS NOT NULL AND despues IS DISTINCT FROM esperado;
  IF n > 0 THEN
    RAISE EXCEPTION 'G-5 · Conteos que no cuadran tras la limpieza: %. Se deshace TODO.', ej;
  END IF;
  IF EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action <> 'maintenance.test_data_purge'
              AND a."createdAt" < coalesce((SELECT max(z."createdAt") FROM "AuditLog" z WHERE z.action = 'maintenance.test_data_purge'), 'infinity'::timestamp)) THEN
    RAISE EXCEPTION 'G-5 · Quedó bitácora anterior a la limpieza. Se deshace TODO.';
  END IF;
END $$;

-- v2.2 (LZ-A6) · G-5 de accesorios: ninguno se queda con existencias o apartados (que «no se pusieron en 0» no pase
-- en silencio).
\if :lz_m73
DO $$
DECLARE ej text;
BEGIN
  SELECT string_agg(x.name || ' (' || x."stockQty" || ' · ' || x."reservedQty" || ')', ', ' ORDER BY x.name) INTO ej
    FROM (SELECT a.name, a."stockQty", a."reservedQty" FROM "Accessory" a
           WHERE a."stockQty" <> 0 OR a."reservedQty" <> 0 ORDER BY a.name LIMIT 20) x;
  IF ej IS NOT NULL THEN
    RAISE EXCEPTION 'G-5 · Quedaron accesorios con existencias o apartados tras la limpieza: %. Se deshace TODO.', ej;
  END IF;
END $$;
\endif

-- El RASTRO (§6.3 + §14.3): una fila, sin datos personales (ids, ni correos ni folios). Solo si esta corrida cambió
-- algo (idempotencia).
INSERT INTO "AuditLog" (id, "actorUserId", "actorRole", action, "entityType", "entityId", "after", "createdAt")
SELECT gen_random_uuid()::text, NULL, NULL, 'maintenance.test_data_purge', 'Database', 'P-DB-LIMPIEZA',
       jsonb_build_object(
         'conteosAntes',   (SELECT jsonb_object_agg(tabla, antes) FROM lz_conteo WHERE antes IS NOT NULL),
         'conteosDespues', (SELECT jsonb_object_agg(tabla, CASE WHEN tabla = 'AuditLog' THEN despues + 1 ELSE despues END) FROM lz_conteo WHERE despues IS NOT NULL),
         'inventarioBorrado', jsonb_build_object(
            'total',   (SELECT coalesce(sum(piezas), 0) FROM lz_inv_tipo),
            'porTipo', jsonb_build_object(
               'raw',    (SELECT coalesce(sum(piezas), 0) FROM lz_inv_tipo WHERE tipo = 'raw'),
               'graded', (SELECT coalesce(sum(piezas), 0) FROM lz_inv_tipo WHERE tipo = 'graded'),
               'sealed', (SELECT coalesce(sum(piezas), 0) FROM lz_inv_tipo WHERE tipo = 'sealed')),
            'custodiaPorUsuario', coalesce((SELECT jsonb_object_agg(coalesce(user_id, '(sin dueño)'), piezas) FROM lz_custodia), '{}'::jsonb)),
         'cuentasPrueba', (SELECT count(DISTINCT user_id) FROM lz_cuentas WHERE user_id IS NOT NULL),
         'bountiesAjustados', (SELECT filas FROM lz_cambio WHERE paso = '13 VariantPriceOverride bounties'),
         'secuencias', jsonb_build_object(
            'order_number_seq',    (SELECT last_value FROM order_number_seq),
            'shipment_folio_seq',  (SELECT last_value FROM shipment_folio_seq),
            'inventory_folio_seq', (SELECT last_value FROM inventory_folio_seq)),
         'respaldoManual', (SELECT respaldo FROM lz_param),
         'puntoPitr', (SELECT to_char(punto_pitr AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM lz_param),
         'ejecutadoCon', current_user)
       -- v2.2 (LZ-A7): solo con M-73; sin ella el rastro es el de siempre.
       || CASE WHEN to_regclass(format('%I', 'Accessory')) IS NOT NULL
               THEN jsonb_build_object('accesorios', jsonb_build_object(
                      'conExistencias', (SELECT count(*) FROM lz_acc),
                      'existencias',    (SELECT coalesce(sum(stock_qty), 0) FROM lz_acc),
                      'apartadas',      (SELECT coalesce(sum(reserved_qty), 0) FROM lz_acc)))
               ELSE '{}'::jsonb END,
       now()
WHERE (SELECT coalesce(sum(filas), 0) FROM lz_cambio) > 0;

-- La bitácora se recuenta con el rastro ya dentro (1 fila si esta corrida cambió algo).
UPDATE lz_conteo SET despues = (SELECT count(*) FROM "AuditLog") WHERE tabla = 'AuditLog';

\echo '=== 15 · CONTEOS: tabla · antes · después · esperado ==='
SELECT tabla, grupo, antes, despues AS "después", esperado,
       CASE WHEN tabla = 'AuditLog' THEN 'queda el rastro'
            WHEN esperado IS NULL OR despues = esperado THEN '' ELSE '⚠️' END AS ojo
FROM lz_conteo
WHERE antes IS NOT NULL OR despues IS NOT NULL -- v2.2: sin las tablas de M-73/M-74 la tabla es la de siempre
ORDER BY CASE grupo WHEN 'borrar' THEN 1 WHEN 'ajustar' THEN 2 ELSE 3 END, tabla;

\echo '=== 15 · QUÉ CAMBIÓ ESTA CORRIDA (todo en 0 = ya estaba limpio; no se escribe rastro nuevo) ==='
SELECT paso, filas FROM lz_cambio ORDER BY split_part(paso, ' ', 1)::int, paso;

-- v2.2 (LZ-A8) · G-10, solo con M-74: el aviso «Avísame cuando vuelva» de sellado ENCENDIDO y clientes esperando que
-- su producto se agote (pendientes y SIN armar). Con el inventario borrado el aviso los daría por agotados y al re-subir
-- les llegaría un «¡Volvió!» falso. Las ya armadas y las ya avisadas no cambian. La lista de deseos no para nada.
\if :lz_m74
DO $$
DECLARE n bigint;
BEGIN
  IF coalesce((SELECT s."valueJson" #>> '{}' FROM "ConfigSetting" s WHERE s.key = 'sealed_restock_alerts'), 'off') = 'on' THEN
    SELECT count(*) INTO n FROM "SealedRestockSubscription" x WHERE x."notifiedAt" IS NULL AND x."armedAt" IS NULL;
    IF n > 0 THEN
      INSERT INTO lz_falta VALUES (format('G-10 · El aviso «Avísame cuando vuelva» de sellado está ENCENDIDO y hay %s suscripción(es) esperando que su producto se agote. Si borras el inventario así, el aviso las da por agotadas y al re-subir les llega «¡Volvió a existencia!» de productos que nunca se agotaron. Apágalo en Ajustes, corre esto, re-sube el sellado y vuelve a encenderlo.', n));
    END IF;
  END IF;
END $$;
\endif

-- Lo que falta DECIDIR se comprueba al final, para que el ensayo te enseñe todo antes de pedírtelo.
DO $$
DECLARE p record; faltan text := ''; sin_declarar text; f record;
BEGIN
  SELECT * INTO p FROM lz_param;
  IF p.respaldo = '' THEN
    faltan := faltan || E'\n  · respaldo_manual: escribe el nombre y la hora del respaldo manual que tomaste justo antes (línea ✏️ 1).';
  END IF;
  -- G-9 · cartas en custodia de una cuenta que NO declaraste de prueba (o de ninguna cuenta): no se borra a ciegas.
  SELECT string_agg(quien || ' (' || piezas || ' carta(s))', ', ' ORDER BY quien) INTO sin_declarar
    FROM (SELECT coalesce(u.email, c.user_id, '(cartas de cliente SIN dueño)') AS quien, c.piezas
            FROM lz_custodia c LEFT JOIN "User" u ON u.id = c.user_id
           WHERE c.user_id IS NULL OR c.user_id NOT IN (SELECT user_id FROM lz_cuentas WHERE user_id IS NOT NULL)) z;
  IF sin_declarar IS NOT NULL THEN
    faltan := faltan || format(E'\n  · G-9 / cuentas_prueba: hay cartas EN CUSTODIA de cuentas que no declaraste de prueba: %s. Si son tuyas de prueba, escribe su correo (o su id) en la línea ✏️ 2. Si alguna es de un cliente REAL, NO sigas: pregunta.', sin_declarar);
  END IF;
  FOR f IN SELECT msg FROM lz_falta ORDER BY msg LOOP
    faltan := faltan || E'\n  · ' || f.msg;
  END LOOP;
  IF faltan <> '' THEN
    RAISE EXCEPTION 'Falta tu decisión; no se escribió nada:%', faltan;
  END IF;
END $$;

\echo '=== FIN · Si esto era el ensayo, la línea de abajo deshace todo. Para aplicarlo, cámbiala por COMMIT; ==='
\echo '=== Recuerda el PUNTO PITR del paso 0. Después: fichero 3 (folios) ANTES de subir nada, y fichero 4 (verificación). ==='
\echo '=== La última palabra de abajo dice qué pasó: ROLLBACK = NO se aplicó nada · COMMIT = aplicado. ==='
\set QUIET off
ROLLBACK;
