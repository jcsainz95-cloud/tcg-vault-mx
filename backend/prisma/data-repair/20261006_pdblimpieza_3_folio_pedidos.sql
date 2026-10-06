-- =====================================================================================
--  P-DB-LIMPIEZA · C · EL NÚMERO DE PEDIDO VUELVE A TCG-000001
--  Fecha: 2026-10-06 · Lo escribió: backend · Lo ejecuta: EL DUEÑO (usuario ADMINISTRADOR), SOLO DESPUÉS del COMMIT
--  del fichero 2, y ANTES del primer pedido real. Diseño: docs/specs/LIMPIEZA_DB.md §5.4
-- =====================================================================================
--
--  POR QUÉ VA APARTE: un contador de Postgres NO se deshace con ROLLBACK. Si esto fuera dentro del fichero 2, el
--  ensayo en seco reiniciaría el contador DE VERDAD. Por eso es un paso propio, que solo se corre con la base ya
--  limpia.
--
--  QUÉ HACE: si NO queda ningún pedido, deja el contador para que el próximo pedido sea TCG-000001. Si queda aunque
--  sea uno, SE NIEGA (dos pedidos con el mismo número no pueden existir y el siguiente choque rompería el cobro).
--
--  SOLO toca el contador de PEDIDOS. Los de envíos (ENV-) e inventario (INV-) NO se reinician nunca:
--   · ENV-: el sistema confundiría la guía real ya cancelada ENV-000003 con un envío nuevo y te mandaría un aviso
--     de «guía cobrada sin explicación» (LIMPIEZA_DB.md §5.2);
--   · INV-: tus cartas se conservan con su folio; reiniciarlo haría chocar la siguiente alta (§5.3).
--
--  Se pega tal cual, sin editar nada. Si hubiera que deshacerlo, la restauración PITR al punto del fichero 2 lo
--  devuelve también (el contador vive en la base).
-- =====================================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;
LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE;

\echo '=== ANTES: contador de pedidos (last_value = último número que se dio) ==='
SELECT last_value, is_called FROM order_number_seq;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "Order";
  IF n > 0 THEN
    RAISE EXCEPTION 'Quedan % pedido(s) en la tabla Order: el número de pedido NO se reinicia. Corre primero la limpieza (fichero 2) con COMMIT.', n;
  END IF;
  -- setval(…, 1, false): el PRÓXIMO nextval devuelve 1 ⇒ TCG-000001.
  PERFORM setval('order_number_seq', 1, false);
END $$;

\echo '=== DESPUÉS: is_called = f y last_value = 1 ⇒ el próximo pedido es TCG-000001 ==='
SELECT last_value, is_called,
       'TCG-' || lpad((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text, 6, '0') AS proximo_pedido
FROM order_number_seq;

COMMIT;
