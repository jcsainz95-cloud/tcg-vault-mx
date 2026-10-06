-- =====================================================================================
--  P-DB-LIMPIEZA · B · LA LIMPIEZA (guion principal)
--  Fecha: 2026-10-06 · Lo escribió: backend · Lo ejecuta: EL DUEÑO (usuario ADMINISTRADOR de la base)
--  Diseño: docs/specs/LIMPIEZA_DB.md (§2 tablas, §4 inventario, §6 bitácora, §7 orden) · Notas: BACKEND_NOTES «P-DB-LIMPIEZA»
-- =====================================================================================
--
--  QUÉ HACE ESTO, EN CASTELLANO
--  ----------------------------
--  Borra de la base TODO lo que dejaron las pruebas: pedidos, pagos y reembolsos, SPEI manuales, casos
--  «Por reponer», colocaciones de bóveda, envíos y todo lo de Skydropx, disputas, solicitudes de venta (buylist),
--  avisos de gasto, portafolios y la bitácora. NO toca usuarios, catálogo, precios, diales ni tu inventario real.
--  Las cartas que tocaron las pruebas VUELVEN a ser tuyas: sin dueño cliente, sin apartado, en estado
--  «en inventario» (in_stock). NO las publica: eso lo haces tú desde M1 «Listas para publicar» (así una carta sin
--  precio nunca sale a la venta). Al final deja UNA fila en la bitácora con lo que se hizo.
--
--  CÓMO SE USA (el primer paso no cambia nada)
--  --------------------------------------------
--   PASO 1 · Pega este fichero entero en psql TAL CUAL. Termina en ROLLBACK («deshaz todo»): no escribe nada.
--            Te enseña los pedidos, envíos, solicitudes, las cartas que vuelven (y a qué cajón) y las cartas que
--            nacieron de solicitudes de venta de prueba. Al final se para con un mensaje que te dice qué falta
--            decidir (las tres líneas de abajo). Eso es lo esperado en el ensayo.
--   PASO 2 · Escribe tus respuestas en las TRES líneas «✏️» de abajo (entre las comillas simples).
--   PASO 3 · Vuelve a pegarlo (sigue terminando en ROLLBACK). Esta vez debe llegar hasta el final sin error
--            y enseñarte la tabla «tabla · antes · después · esperado».
--   PASO 4 · Si estás de acuerdo: cambia la ÚLTIMA línea del fichero, donde dice  ROLLBACK;  por  COMMIT;
--            y pégalo otra vez. **Copia el «PUNTO PITR» que sale al principio**: es el instante al que
--            restauras si hubiera que deshacerlo (Railway → Postgres → Backups → restaurar a ese instante).
--   PASO 5 · Corre el fichero 3 (folio de pedidos) y luego el 4 (verificación).
--
--  SI ALGO NO CUADRA, SE PARA SOLO: cualquier cosa que el diseño no conoce (una carta de cliente que no vino de un
--  pedido, por ejemplo) aborta TODO con un mensaje G-n y no se escribe nada. No hay estado a medias: o se hace
--  entero o no se hace nada.
--
--  ⛔ Este fichero NO lleva ni host, ni usuario, ni contraseña. Te conectas con lo tuyo (Railway → Postgres → Connect).
--  ⛔ No reinicia NINGÚN contador. El de pedidos (TCG-) lo reinicia el fichero 3, DESPUÉS del COMMIT de éste.
--     El de envíos (ENV-) y el de inventario (INV-) NO se reinician nunca (por qué: LIMPIEZA_DB.md §5).
--  Correrlo dos veces no hace daño: la segunda no encuentra nada que cambiar y no cambia nada. Y si ya se hizo y
--  después hubo pedidos reales, se NIEGA a correr (G-7).
-- =====================================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off

-- ✏️ 1 · Nombre y hora del RESPALDO MANUAL que tomaste justo antes (Railway → Postgres → Backups → Create backup).
--        Obligatorio para el COMMIT. Ejemplo:  \set respaldo_manual 'manual 2026-10-08 09:15'
\set respaldo_manual ''
-- ✏️ 2 · (P-2) Cartas tocadas por las pruebas que YA NO están físicamente. Folios separados por coma; quedan fuera de
--        venta («withdrawn»). Añade «:damaged» si se dañó de verdad. Vacío = todas vuelven a la venta.
--        Ejemplo:  \set fuera_de_venta 'INV-000123, INV-000456:damaged'
\set fuera_de_venta ''
-- ✏️ 3 · (P-1) Cartas que entraron a tu inventario desde solicitudes de venta DE PRUEBA: escribe  borrar  (no existen
--        en tu estante) o  conservar  (sí existen: se quedan, sin el vínculo a la solicitud). Si no hay ninguna, déjalo
--        vacío. Ejemplo:  \set buylist_piezas 'conservar'
\set buylist_piezas ''

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Nadie escribe a la mitad: si un job o un webhook tiene estas tablas, en 5 s se rinde sin tocar nada.
LOCK TABLE "Order", "ShipmentRequest", "SellRequest", "InventoryItem", "PaymentRefund", "ManualRefund" IN SHARE ROW EXCLUSIVE MODE;

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
       btrim(:'fuera_de_venta')             AS fuera_de_venta,
       lower(btrim(:'buylist_piezas'))      AS buylist,
       to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha,
       now()                                AS punto_pitr;

-- Cuánto cambió cada paso (para la idempotencia: si todo da 0, no se escribe rastro nuevo).
CREATE TEMP TABLE lz_cambio (paso text NOT NULL, filas bigint NOT NULL) ON COMMIT DROP;

-- ------------------------------------------------------------------------------------
-- 1 · CONTEOS ANTES (todas las tablas de §2; las que no existan en esta versión salen vacías)
-- ------------------------------------------------------------------------------------
CREATE TEMP TABLE lz_conteo (tabla text PRIMARY KEY, grupo text NOT NULL, antes bigint, despues bigint, esperado bigint) ON COMMIT DROP;
INSERT INTO lz_conteo (tabla, grupo)
SELECT t, 'borrar' FROM unnest(ARRAY[
  'ManualRefund','PaymentRefund','ReplacementCase','Dispute','VaultPlacementItem','VaultPlacement',
  'ShipmentCostAdjustment','ShipmentPaidLabel','ShipmentLabelAttempt','ShipmentRequest','ShipmentItem','ShipmentQuote',
  'ShipmentCarrierEvent','ShipmentAddressRevision','Order','OrderItem','OrderAccessToken','SellRequest','SellRequestItem',
  'SpendAlert','PortfolioSnapshot','AuditLog']) AS t
UNION ALL
SELECT t, 'ajustar' FROM unnest(ARRAY['InventoryItem','InventoryMovement','InventoryAdjustment','VariantPriceOverride']) AS t
UNION ALL
SELECT t, 'conservar' FROM unnest(ARRAY[
  'User','KycProfile','KycUploadGrant','BillingProfile','Address','AuthToken','CardSet','SealedSetGroup','SealedProduct','Card',
  'CardProduct','PostalCode','ShippingPackage','PriceReference','FxRate','SetValueSnapshot','PendingPriceEntry','ConfigSetting',
  'VaultLocation','InventoryBatch','ProcessedStripeEvent','SpendDigestRun','SpendOwnerWatch','SealedRestockSubscription']) AS t;

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
-- 2 · EL CONJUNTO T (piezas tocadas por pruebas), SU DESTINO, LAS GUARDAS Y TODO LO QUE SE VA A HACER, A LA VISTA
-- ------------------------------------------------------------------------------------
-- T = piezas referidas por cualquier pedido, envío, colocación, caso o disputa, o apartadas por un pedido (§4.1).
-- corte = el instante más antiguo de lo que la toca (§4.4). Se calcula AHORA: después de borrar ya no se podría.
CREATE TEMP TABLE lz_t ON COMMIT DROP AS
WITH refs AS (
  SELECT oi."inventoryItemId" AS item_id, o."createdAt" AS t FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
  UNION ALL SELECT si."inventoryItemId", sr."requestedAt" FROM "ShipmentItem" si JOIN "ShipmentRequest" sr ON sr.id = si."shipmentRequestId"
  UNION ALL SELECT vpi."inventoryItemId", vp."createdAt" FROM "VaultPlacementItem" vpi JOIN "VaultPlacement" vp ON vp.id = vpi."placementId"
  UNION ALL SELECT rc."originalInventoryItemId", rc."openedAt" FROM "ReplacementCase" rc
  UNION ALL SELECT rc."replacementInventoryItemId", rc."openedAt" FROM "ReplacementCase" rc WHERE rc."replacementInventoryItemId" IS NOT NULL
  UNION ALL SELECT dp."inventoryItemId", dp."createdAt" FROM "Dispute" dp
  UNION ALL SELECT i.id, o."createdAt" FROM "InventoryItem" i JOIN "Order" o ON o.id = i."reservedByOrderId"
)
SELECT item_id, min(t) AS corte FROM refs GROUP BY item_id;
ALTER TABLE lz_t ADD PRIMARY KEY (item_id);

-- P-2: la lista de exclusión, ya leída (folio → withdrawn | damaged).
CREATE TEMP TABLE lz_excl ON COMMIT DROP AS
SELECT btrim(split_part(x, ':', 1)) AS folio,
       coalesce(nullif(lower(btrim(split_part(x, ':', 2))), ''), 'withdrawn') AS destino
FROM lz_param, unnest(string_to_array(fuera_de_venta, ',')) AS x
WHERE btrim(x) <> '';

-- El plan por pieza (§4.3). Cajón: si está en un cajón de CUSTODIA, vuelve al cajón de PLATAFORMA del que salió en su
-- colocación más antigua (el `move` más antiguo que la metió en custodia); si ese origen no es de plataforma, sin cajón.
CREATE TEMP TABLE lz_plan ON COMMIT DROP AS
SELECT i.id                       AS item_id,
       i.folio,
       c.name                     AS carta,
       i."ownerType"::text        AS dueno_antes,
       i.status                   AS status_antes,
       CASE WHEN e.folio IS NULL THEN 'in_stock' ELSE e.destino END AS status_destino,
       e.folio IS NOT NULL        AS excluida,
       i."locationId"             AS loc_antes,
       CASE
         WHEN la.zone::text = 'customer_custody' THEN
           (SELECT CASE WHEN fl.zone::text = 'platform_stock' THEN fl.id END
              FROM "InventoryMovement" m
              JOIN "VaultLocation" tl ON tl.id = m."toLocationId" AND tl.zone::text = 'customer_custody'
              LEFT JOIN "VaultLocation" fl ON fl.id = m."fromLocationId"
             WHERE m."itemId" = i.id AND m.reason::text = 'move'
             ORDER BY m."createdAt" ASC, m.id ASC
             LIMIT 1)
         ELSE i."locationId"
       END                        AS loc_destino,
       t.corte
FROM lz_t t
JOIN "InventoryItem" i ON i.id = t.item_id
JOIN "Card" c ON c.id = i."cardId"
LEFT JOIN "VaultLocation" la ON la.id = i."locationId"
LEFT JOIN lz_excl e ON e.folio = i.folio;

-- Movimientos que se van a borrar (§4.4): los de pedido/retiro/caso, y los lost/damaged/move desde el corte.
CREATE TEMP TABLE lz_mov_borrar ON COMMIT DROP AS
SELECT m.id, m."itemId", m.reason::text AS reason, m."createdAt", m.note
FROM "InventoryMovement" m
JOIN lz_t t ON t.item_id = m."itemId"
WHERE m.reason::text IN ('sale','settle','chargeback_return','withdrawal','refund_return','refund_release','replacement')
   OR (m.reason::text IN ('lost','damaged','move') AND m."createdAt" >= t.corte);

-- Piezas nacidas de solicitudes de venta (todas las solicitudes son de prueba ⇒ todas cuelgan de algo que se borra).
CREATE TEMP TABLE lz_buylist ON COMMIT DROP AS
SELECT i.id AS item_id, i.folio, c.name AS carta, i.status::text AS status, i."acquisitionCostCents",
       (i.id IN (SELECT item_id FROM lz_t)) AS en_t,
       (SELECT count(*) FROM "InventoryMovement" m WHERE m."itemId" = i.id) AS movimientos,
       (SELECT count(*) FROM "InventoryAdjustment" a WHERE a."inventoryItemId" = i.id) AS ajustes
FROM "InventoryItem" i JOIN "Card" c ON c.id = i."cardId"
WHERE i."sourceSellRequestItemId" IS NOT NULL;

-- ---- Guardas que paran TODO de inmediato (el modelo no las conoce: no se adivina)
DO $$
DECLARE n bigint; ej text; p record;
BEGIN
  SELECT * INTO p FROM lz_param;

  -- G-7 · La limpieza ya se hizo y DESPUÉS hubo actividad de pedidos/envíos/solicitudes: eso ya es real.
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE action = 'maintenance.test_data_purge')
     AND (EXISTS (SELECT 1 FROM "Order") OR EXISTS (SELECT 1 FROM "ShipmentRequest") OR EXISTS (SELECT 1 FROM "SellRequest")) THEN
    RAISE EXCEPTION 'G-7 · La limpieza YA se hizo (hay rastro «maintenance.test_data_purge» en la bitácora) y después hubo pedidos, envíos o solicitudes. Eso ya no es de prueba: NO se borra. Si de verdad quieres otra limpieza, pregúntalo antes.';
  END IF;

  -- G-1 · Pieza de CLIENTE que no vino de ningún pedido/envío/caso/disputa.
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

  -- P-1 · respuesta mal escrita (un error tipográfico no puede decidir borrar cartas).
  IF p.buylist NOT IN ('', 'borrar', 'conservar') THEN
    RAISE EXCEPTION 'buylist_piezas · La respuesta a P-1 debe ser «borrar» o «conservar» (escribiste «%»). No se escribió nada.', p.buylist;
  END IF;

  -- P-2 · folios de exclusión: cada uno debe ser una pieza tocada por pruebas, y el destino withdrawn|damaged.
  SELECT count(*), string_agg(folio || ':' || destino, ', ') INTO n, ej FROM lz_excl
   WHERE destino NOT IN ('withdrawn','damaged') OR folio NOT IN (SELECT folio FROM lz_plan);
  IF n > 0 THEN
    RAISE EXCEPTION 'fuera_de_venta · % folio(s) no son cartas tocadas por pruebas o traen un destino que no es «damaged» (%). Revisa la lista del ensayo. No se escribió nada.', n, ej;
  END IF;
END $$;

\echo '=== 2.1 · PEDIDOS que se borran ==='
SELECT o."orderNumber" AS pedido, o.status::text AS estado, o."fulfillmentMode"::text AS modo, (o."totalCents" / 100.0)::numeric(14,2) AS total_mxn,
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

\echo '=== 2.4 · CARTAS QUE VUELVEN A TU INVENTARIO (y a qué cajón — mueve la carta física si el cajón cambia) ==='
SELECT p.folio, p.carta, p.dueno_antes AS era_de, p.status_antes::text || ' → ' || p.status_destino AS estado,
       coalesce(la.label, '(sin cajón)') || ' → ' || coalesce(ld.label, '(sin cajón)') AS cajon,
       CASE WHEN p.excluida THEN 'FUERA DE VENTA (P-2)' WHEN p.loc_antes IS DISTINCT FROM p.loc_destino THEN 'MUEVE LA CARTA' ELSE '' END AS ojo
FROM lz_plan p
LEFT JOIN "VaultLocation" la ON la.id = p.loc_antes
LEFT JOIN "VaultLocation" ld ON ld.id = p.loc_destino
ORDER BY p.folio;

\echo '=== 2.5 · (P-1) CARTAS QUE ENTRARON DESDE SOLICITUDES DE VENTA DE PRUEBA ==='
SELECT b.folio, b.carta, b.status AS estado, (b."acquisitionCostCents" / 100.0)::numeric(14,2) AS costo_mxn, b.en_t AS tocada_por_pedido,
       CASE (SELECT buylist FROM lz_param)
         WHEN 'borrar' THEN 'SE BORRA'
         WHEN 'conservar' THEN 'SE QUEDA (sin vínculo a la solicitud)'
         ELSE 'FALTA TU RESPUESTA (P-1)' END AS que_va_a_pasar
FROM lz_buylist b ORDER BY b.folio;

\echo '=== 2.6 · BOUNTIES: lo comprado por buylist de prueba vuelve a 0 (si alguno se apagó solo, queda apagado: lo re-enciendes en un clic) ==='
SELECT c.name AS carta, v."gradeKey", v.finish::text AS acabado, v."bountyEnabled" AS encendido, v."bountyAcquiredQty" AS comprado,
       v."bountyTargetQty" AS objetivo, v."bountyCompletedAt" AS completado
FROM "VariantPriceOverride" v JOIN "Card" c ON c.id = v."cardId"
WHERE v."bountyAcquiredQty" <> 0 OR v."bountyCompletedAt" IS NOT NULL
ORDER BY c.name;

\echo '=== 2.7 · MOVIMIENTOS lost/damaged/move POSTERIORES AL CORTE que se borran (si alguno fue un ajuste REAL tuyo de M1, aquí se ve) ==='
SELECT i.folio, b.reason AS motivo, b."createdAt" AS fecha, b.note AS nota
FROM lz_mov_borrar b JOIN "InventoryItem" i ON i.id = b."itemId"
WHERE b.reason IN ('lost','damaged','move')
ORDER BY i.folio, b."createdAt";

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

-- 4 · 5 · 6 · 7 — reembolsos de Stripe, casos, disputas, colocaciones
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
WITH x AS (DELETE FROM "ShipmentRequest" RETURNING 1) INSERT INTO lz_cambio SELECT '8 ShipmentRequest', count(*) FROM x;

-- ------------------------------------------------------------------------------------
-- 9 · Las piezas de T vuelven a la plataforma: sin dueño, sin apartado, in_stock (o lo que diga P-2), su cajón
--     ⛔ Nunca «listed» aquí: publicar exige resolver el precio, y eso lo hace la app (M1).
-- ------------------------------------------------------------------------------------
WITH x AS (
  UPDATE "InventoryItem" i
     SET "ownerType" = 'platform', "ownerUserId" = NULL, "ownershipStatus" = NULL,
         "reservedByOrderId" = NULL, "reservedUntil" = NULL,
         status = p.status_destino::"InventoryStatus", "locationId" = p.loc_destino, "updatedAt" = now()
    FROM lz_plan p
   WHERE p.item_id = i.id
  RETURNING 1)
INSERT INTO lz_cambio SELECT '9 InventoryItem restauradas', count(*) FROM x;

-- 10 · Movimientos: fuera los de prueba; UNO de cierre por pieza (sin fila de levantamiento: no lo es).
WITH x AS (DELETE FROM "InventoryMovement" m USING lz_mov_borrar b WHERE m.id = b.id RETURNING 1)
INSERT INTO lz_cambio SELECT '10 InventoryMovement borrados', count(*) FROM x;
WITH x AS (
  INSERT INTO "InventoryMovement" (id, "itemId", "fromLocationId", "toLocationId", "fromStatus", "toStatus", reason, "actorUserId", note, "createdAt")
  SELECT gen_random_uuid()::text, p.item_id,
         CASE WHEN p.loc_antes IS DISTINCT FROM p.loc_destino THEN p.loc_antes END,
         CASE WHEN p.loc_antes IS DISTINCT FROM p.loc_destino THEN p.loc_destino END,
         p.status_antes, p.status_destino::"InventoryStatus", 'adjustment', NULL,
         'P-DB-LIMPIEZA ' || (SELECT fecha FROM lz_param) || ': pruebas borradas; '
           || CASE WHEN p.excluida THEN 'fuera de venta (P-2)' ELSE 'vuelve a inventario' END,
         now()
  FROM lz_plan p
  RETURNING 1)
INSERT INTO lz_cambio SELECT '10 InventoryMovement de cierre', count(*) FROM x;

-- 11 · Pedidos (cascada: líneas y tokens de invitado).
WITH x AS (DELETE FROM "Order" RETURNING 1) INSERT INTO lz_cambio SELECT '11 Order', count(*) FROM x;

-- 12 · (P-1) Piezas nacidas del buylist de prueba. Sin respuesta, no se toca nada aquí y el paso 16 aborta.
WITH x AS (
  DELETE FROM "InventoryItem" i USING lz_buylist b, lz_param p
   WHERE i.id = b.item_id AND p.buylist = 'borrar'
  RETURNING 1)
INSERT INTO lz_cambio SELECT '12 InventoryItem buylist borradas', count(*) FROM x;
WITH x AS (
  UPDATE "InventoryItem" i SET "sourceSellRequestItemId" = NULL, "updatedAt" = now()
    FROM lz_buylist b, lz_param p
   WHERE i.id = b.item_id AND p.buylist = 'conservar'
  RETURNING 1)
INSERT INTO lz_cambio SELECT '12 InventoryItem buylist desligadas', count(*) FROM x;

-- 13 · Solicitudes de venta (cascada: sus líneas).
WITH x AS (DELETE FROM "SellRequest" RETURNING 1) INSERT INTO lz_cambio SELECT '13 SellRequest', count(*) FROM x;

-- 14 · Avisos de gasto, portafolios y bounties.
WITH x AS (DELETE FROM "SpendAlert" RETURNING 1) INSERT INTO lz_cambio SELECT '14 SpendAlert', count(*) FROM x;
WITH x AS (DELETE FROM "PortfolioSnapshot" RETURNING 1) INSERT INTO lz_cambio SELECT '14 PortfolioSnapshot', count(*) FROM x;
WITH x AS (
  UPDATE "VariantPriceOverride" SET "bountyAcquiredQty" = 0, "bountyCompletedAt" = NULL, "updatedAt" = now()
   WHERE "bountyAcquiredQty" <> 0 OR "bountyCompletedAt" IS NOT NULL
  RETURNING 1)
INSERT INTO lz_cambio SELECT '14 VariantPriceOverride bounties', count(*) FROM x;

-- 15 · Bitácora: fuera todo lo anterior a esta limpieza. Si ya hubo una limpieza, lo POSTERIOR a ella es real y se queda.
WITH x AS (
  DELETE FROM "AuditLog" a
   WHERE a.action <> 'maintenance.test_data_purge'
     AND a."createdAt" < coalesce((SELECT max(z."createdAt") FROM "AuditLog" z WHERE z.action = 'maintenance.test_data_purge'), 'infinity'::timestamp)
  RETURNING 1)
INSERT INTO lz_cambio SELECT '15 AuditLog', count(*) FROM x;

-- ------------------------------------------------------------------------------------
-- 16 · CONTEOS DESPUÉS, lo ESPERADO y las guardas de cierre (G-5, G-6) — luego el rastro
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

UPDATE lz_conteo SET esperado = 0 WHERE grupo = 'borrar' AND tabla <> 'AuditLog';
UPDATE lz_conteo SET esperado = antes WHERE grupo = 'conservar' OR tabla = 'VariantPriceOverride';
UPDATE lz_conteo SET esperado = antes - CASE WHEN (SELECT buylist FROM lz_param) = 'borrar' THEN (SELECT count(*) FROM lz_buylist) ELSE 0 END
 WHERE tabla = 'InventoryItem';
UPDATE lz_conteo SET esperado = antes - CASE WHEN (SELECT buylist FROM lz_param) = 'borrar' THEN (SELECT coalesce(sum(ajustes), 0) FROM lz_buylist) ELSE 0 END
 WHERE tabla = 'InventoryAdjustment';
UPDATE lz_conteo SET esperado = antes
       - (SELECT filas FROM lz_cambio WHERE paso = '10 InventoryMovement borrados')
       + (SELECT filas FROM lz_cambio WHERE paso = '10 InventoryMovement de cierre')
 WHERE tabla = 'InventoryMovement';
-- Movimientos que se fueron por cascada con las piezas de P-1 «borrar»: los que tenían antes, menos los que ya contó el paso 10, más su cierre.
UPDATE lz_conteo SET esperado = esperado - (
         SELECT coalesce(sum(b.movimientos), 0)
              - (SELECT count(*) FROM lz_mov_borrar mb WHERE mb."itemId" IN (SELECT item_id FROM lz_buylist))
              + (SELECT count(*) FROM lz_plan pl WHERE pl.item_id IN (SELECT item_id FROM lz_buylist))
           FROM lz_buylist b)
 WHERE tabla = 'InventoryMovement' AND (SELECT buylist FROM lz_param) = 'borrar';

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

  -- G-6 · Cada pieza restaurada tiene EXACTAMENTE la forma de §4.3.
  SELECT count(*), string_agg(p.folio, ', ') INTO n, ej
    FROM lz_plan p JOIN "InventoryItem" i ON i.id = p.item_id
   WHERE NOT (i."ownerType"::text = 'platform' AND i."ownerUserId" IS NULL AND i."ownershipStatus" IS NULL
              AND i."reservedByOrderId" IS NULL AND i."reservedUntil" IS NULL
              AND i.status::text = p.status_destino AND i."locationId" IS NOT DISTINCT FROM p.loc_destino);
  IF n > 0 THEN
    RAISE EXCEPTION 'G-6 · Piezas que no quedaron como debían: %. Se deshace TODO.', ej;
  END IF;
END $$;

-- El RASTRO (§6.3): una fila, sin datos personales. Solo si esta corrida cambió algo (idempotencia).
INSERT INTO "AuditLog" (id, "actorUserId", "actorRole", action, "entityType", "entityId", "after", "createdAt")
SELECT gen_random_uuid()::text, NULL, NULL, 'maintenance.test_data_purge', 'Database', 'P-DB-LIMPIEZA',
       jsonb_build_object(
         'conteosAntes',   (SELECT jsonb_object_agg(tabla, antes) FROM lz_conteo WHERE antes IS NOT NULL),
         'conteosDespues', (SELECT jsonb_object_agg(tabla, CASE WHEN tabla = 'AuditLog' THEN despues + 1 ELSE despues END) FROM lz_conteo WHERE despues IS NOT NULL),
         'piezasRestauradas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.item_id, 'folio', p.folio) ORDER BY p.folio)
                                          FROM lz_plan p WHERE NOT p.excluida AND p.item_id NOT IN (
                                            SELECT item_id FROM lz_buylist WHERE (SELECT buylist FROM lz_param) = 'borrar')), '[]'::jsonb),
         'piezasExcluidas', coalesce((SELECT jsonb_agg(p.folio ORDER BY p.folio) FROM lz_plan p WHERE p.excluida), '[]'::jsonb),
         CASE WHEN (SELECT buylist FROM lz_param) = 'borrar' THEN 'piezasBuylistBorradas' ELSE 'piezasBuylistConservadas' END,
                          coalesce((SELECT jsonb_agg(b.folio ORDER BY b.folio) FROM lz_buylist b), '[]'::jsonb),
         'bountiesAjustados', (SELECT filas FROM lz_cambio WHERE paso = '14 VariantPriceOverride bounties'),
         'secuencias', jsonb_build_object(
            'order_number_seq',    (SELECT last_value FROM order_number_seq),
            'shipment_folio_seq',  (SELECT last_value FROM shipment_folio_seq),
            'inventory_folio_seq', (SELECT last_value FROM inventory_folio_seq)),
         'respaldoManual', (SELECT respaldo FROM lz_param),
         'puntoPitr', (SELECT to_char(punto_pitr AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM lz_param),
         'ejecutadoCon', current_user),
       now()
WHERE (SELECT coalesce(sum(filas), 0) FROM lz_cambio) > 0;

-- La bitácora se recuenta con el rastro ya dentro (1 fila si esta corrida cambió algo).
UPDATE lz_conteo SET despues = (SELECT count(*) FROM "AuditLog") WHERE tabla = 'AuditLog';

\echo '=== 16 · CONTEOS: tabla · antes · después · esperado ==='
SELECT tabla, grupo, antes, despues AS "después", esperado,
       CASE WHEN tabla = 'AuditLog' THEN 'queda el rastro'
            WHEN esperado IS NULL OR despues = esperado THEN '' ELSE '⚠️' END AS ojo
FROM lz_conteo ORDER BY CASE grupo WHEN 'borrar' THEN 1 WHEN 'ajustar' THEN 2 ELSE 3 END, tabla;

\echo '=== 16 · QUÉ CAMBIÓ ESTA CORRIDA (todo en 0 = ya estaba limpio; no se escribe rastro nuevo) ==='
SELECT paso, filas FROM lz_cambio ORDER BY split_part(paso, ' ', 1)::int, paso;

-- Lo que falta DECIDIR se comprueba al final, para que el ensayo te enseñe todo antes de pedírtelo.
DO $$
DECLARE p record; faltan text := '';
BEGIN
  SELECT * INTO p FROM lz_param;
  IF p.respaldo = '' THEN
    faltan := faltan || E'\n  · respaldo_manual: escribe el nombre y la hora del respaldo manual que tomaste justo antes (línea ✏️ 1).';
  END IF;
  IF p.buylist = '' AND EXISTS (SELECT 1 FROM lz_buylist) THEN
    faltan := faltan || format(E'\n  · G-4 / P-1: hay %s carta(s) que entraron desde solicitudes de venta de prueba (lista 2.5). Escribe «borrar» o «conservar» (línea ✏️ 3).', (SELECT count(*) FROM lz_buylist));
  END IF;
  IF faltan <> '' THEN
    RAISE EXCEPTION 'Falta tu decisión; no se escribió nada:%', faltan;
  END IF;
END $$;

\echo '=== FIN · Si esto era el ensayo, la línea de abajo deshace todo. Para aplicarlo, cámbiala por COMMIT; ==='
\echo '=== Recuerda el PUNTO PITR del paso 0. Después: fichero 3 (folio de pedidos) y fichero 4 (verificación). ==='
ROLLBACK;
