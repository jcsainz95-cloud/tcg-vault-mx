-- =====================================================================================
--  P-DB-LIMPIEZA · C · LOS FOLIOS VUELVEN A EMPEZAR: pedidos en TCG-000001 e inventario en INV-000001 (v2)
--  Fecha: 2026-10-06 · v2 y v2.1: 2026-10-07 · Lo escribió: backend · Lo ejecuta: EL DUEÑO (usuario ADMINISTRADOR), SOLO
--  DESPUÉS del COMMIT del fichero 2, y ANTES de volver a subir tu inventario y del primer pedido real.
--  Diseño: docs/specs/LIMPIEZA_DB.md §14.5 (v2), §14.12 (v2.1) y §5.4 · Notas: BACKEND_NOTES §79, §79.5 y §79.6
-- =====================================================================================
--
--  POR QUÉ VA APARTE: un contador de Postgres NO se deshace con ROLLBACK. Si esto fuera dentro del fichero 2, el
--  ensayo en seco reiniciaría los contadores DE VERDAD. Por eso es un paso propio, que solo se corre con la base ya
--  limpia.
--
--  QUÉ HACE (cada contador por su lado):
--   · PEDIDOS (TCG-): si NO queda ningún pedido, el próximo será TCG-000001. Si ya hay pedidos, NO se toca (dos pedidos
--     con el mismo número no pueden existir y el choque rompería el cobro) y te lo dice.
--   · INVENTARIO (INV-): si NO queda ninguna carta, la próxima que subas será INV-000001. Si ya subiste alguna, NO se
--     puede reiniciar (chocaría con ellas) y te lo dice: «NO se reinició INV-: ya había piezas cuando corriste C».
--     Tus folios siguen desde donde iban; no rompe nada (ningún folio va en etiquetas, guías ni pagos), pero no es lo
--     que pediste: la verificación (fichero 4) te lo enseña como AVISO. Por eso este paso va ANTES de subir cartas.
--   Si NINGUNO de los dos se puede reiniciar, se NIEGA entero y no cambia nada.
--
--  El de ENVÍOS (ENV-) NO se reinicia nunca: el sistema confundiría la guía real ya cancelada ENV-000003 con un envío
--  nuevo y te mandaría un aviso de «guía cobrada sin explicación» (LIMPIEZA_DB.md §5.2).
--
--  QUÉ NECESITAS: el cliente `psql` de PostgreSQL (estos ficheros usan sus meta-comandos \set, \if y \gset; no sirve
--  un editor SQL web). Con el CLI de Railway, `railway connect` (servicio de Postgres) abre psql conectado a tu base:
--  NO MEDIDO por el equipo en tu cuenta.
--
--  CÓMO SE CORRE (sin editar nada):
--   1.º (recomendado) · `railway connect` (eligiendo el servicio de Postgres) abre psql ya conectado, SIN que
--       teclees la URL ni la contraseña. Dentro de psql escribe:
--         \i 20261006_pdblimpieza_3_folios.sql
--   2.º (sin el CLI de Railway) · psql a mano, SIN dejar la contraseña en el historial del shell ni a la vista en `ps`:
--       pon la URL SIN la contraseña (postgresql://USUARIO@HOST:PUERTO/BASE, de Railway → Postgres → Connect →
--       «Public Network») y psql te pide la contraseña sin mostrarla:
--         psql "postgresql://USUARIO@HOST:PUERTO/BASE" -v ON_ERROR_STOP=1 -f 20261006_pdblimpieza_3_folios.sql
--   ⛔ No escribas la URL con la contraseña dentro (ni `URL=…`, ni `psql "postgresql://usuario:CONTRASEÑA@…"`): se queda
--      en el historial del shell y la ve cualquiera que liste los procesos. Si ya la tecleaste o pegaste en la terminal
--      o en un chat, CAMBIA la contraseña de Postgres en Railway cuando termines.
--   ⛔ NUNCA lo pegues en la ventana de psql: si se negara, seguiría con las demás líneas y el motivo se pierde.
--   Termina con la palabra COMMIT si se aplicó; si lo último que ves es un ERROR, no se cambió nada.
--
--  Si hubiera que deshacerlo, la restauración PITR al punto del fichero 2 lo devuelve también (los contadores viven
--  en la base).
-- =====================================================================================

\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
\pset pager off

BEGIN;
-- Nadie da de alta una carta ni crea un pedido mientras se comprueba y se reinicia (el candado frena el INSERT; un
-- `nextval` suelto no se frena: por eso este fichero va ANTES de volver a subir, y la verificación D lo comprueba).
LOCK TABLE "Order", "InventoryItem" IN SHARE ROW EXCLUSIVE MODE;

\echo '=== ANTES: contadores (last_value = último número que se dio; is_called = f ⇒ todavía no se ha dado) ==='
SELECT 'pedidos (TCG-)' AS contador, last_value, is_called FROM order_number_seq
UNION ALL SELECT 'inventario (INV-)', last_value, is_called FROM inventory_folio_seq
UNION ALL SELECT 'envíos (ENV-) — NO se toca', last_value, is_called FROM shipment_folio_seq;

CREATE TEMP TABLE lz_c (orden int, contador text, que_paso text) ON COMMIT DROP;

DO $$
DECLARE n_ord bigint; n_inv bigint; primero text; folio_min bigint; folio_max bigint; hecho boolean;
BEGIN
  SELECT count(*), min("orderNumber") INTO n_ord, primero FROM "Order";
  -- §14.12 MENOR-3: mínimo y máximo NUMÉRICOS (como texto, 'INV-1000000' < 'INV-999999').
  SELECT count(*) INTO n_inv FROM "InventoryItem";
  SELECT min(substring(folio FROM 5)::bigint), max(substring(folio FROM 5)::bigint) INTO folio_min, folio_max
  FROM "InventoryItem" WHERE folio ~ '^INV-[0-9]+$';
  hecho := EXISTS (SELECT 1 FROM "AuditLog" WHERE action = 'maintenance.test_data_purge');
  IF n_ord > 0 AND n_inv > 0 THEN
    -- QA-8: si la limpieza ya se hizo, esos pedidos y cartas son REALES (no hay que «correr primero la limpieza»).
    IF hecho THEN
      RAISE EXCEPTION 'La limpieza YA se hizo y ya hay % pedido(s) nuevo(s) (el primero, %) y % carta(s) subidas: ningún folio se reinicia (chocaría con ellos). No hay nada que hacer aquí.', n_ord, primero, n_inv;
    END IF;
    RAISE EXCEPTION 'Quedan % pedido(s) en la tabla Order y % carta(s) en el inventario: ningún folio se reinicia. Corre primero la limpieza (fichero 2) con COMMIT.', n_ord, n_inv;
  END IF;

  -- setval(…, 1, false): el PRÓXIMO nextval devuelve 1.
  IF n_ord = 0 THEN
    PERFORM setval('order_number_seq', 1, false);
    INSERT INTO lz_c VALUES (1, 'pedidos (TCG-)', 'reiniciado: el próximo pedido es TCG-000001');
  ELSE
    INSERT INTO lz_c VALUES (1, 'pedidos (TCG-)', format('NO se toca: ya hay %s pedido(s) (el primero, %s); los números siguen desde ahí', n_ord, primero));
  END IF;
  IF n_inv = 0 THEN
    PERFORM setval('inventory_folio_seq', 1, false);
    INSERT INTO lz_c VALUES (2, 'inventario (INV-)', 'reiniciado: la próxima carta que subas es INV-000001');
  ELSE
    -- §14.12 (QA N-1): la MISMA frase que dice la verificación D (AVISO). No es «no pasa nada»: pediste reiniciar y no se pudo.
    INSERT INTO lz_c VALUES (2, 'inventario (INV-)', format(
      'NO se reinició INV-: ya había piezas cuando corriste C (%s pieza(s), de %s a %s). Tus folios siguen desde ahí, no desde INV-000001. No rompe nada (ningún folio va en etiquetas, guías ni pagos). La próxima vez, este paso va ANTES de subir cartas.',
      n_inv,
      coalesce('INV-' || lpad(folio_min::text, 6, '0'), '?'),
      coalesce('INV-' || lpad(folio_max::text, 6, '0'), '?')));
  END IF;
  INSERT INTO lz_c VALUES (3, 'envíos (ENV-)', 'NO se toca nunca (LIMPIEZA_DB.md §5.2)');
END $$;

\echo '=== QUÉ PASÓ CON CADA CONTADOR ==='
SELECT contador, que_paso AS "qué pasó" FROM lz_c ORDER BY orden;

\echo '=== DESPUÉS: el próximo folio de cada contador ==='
SELECT 'pedidos (TCG-)' AS contador, last_value, is_called,
       'TCG-' || lpad((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text, 6, '0') AS proximo
FROM order_number_seq
UNION ALL
SELECT 'inventario (INV-)', last_value, is_called,
       'INV-' || lpad((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text, 6, '0')
FROM inventory_folio_seq
UNION ALL
SELECT 'envíos (ENV-)', last_value, is_called,
       'ENV-' || lpad((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text, 6, '0')
FROM shipment_folio_seq;

\set QUIET off
COMMIT;
