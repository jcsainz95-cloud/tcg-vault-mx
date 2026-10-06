-- =====================================================================================
--  P-DB-LIMPIEZA · C · EL NÚMERO DE PEDIDO VUELVE A TCG-000001
--  Fecha: 2026-10-06 · Lo escribió: backend · Lo ejecuta: EL DUEÑO (usuario ADMINISTRADOR), SOLO DESPUÉS del COMMIT
--  del fichero 2, y ANTES del primer pedido real. Diseño: docs/specs/LIMPIEZA_DB.md §5.4 · Notas: BACKEND_NOTES §79
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
--  QUÉ NECESITAS: el cliente `psql` de PostgreSQL (estos ficheros usan sus meta-comandos \set, \if y \gset; no sirve
--  un editor SQL web). Con el CLI de Railway, `railway connect` (servicio de Postgres) abre psql conectado a tu base:
--  NO MEDIDO por el equipo en tu cuenta.
--
--  CÓMO SE CORRE (sin editar nada):
--       psql "$URL" -v ON_ERROR_STOP=1 -f 20261006_pdblimpieza_3_folio_pedidos.sql
--   o, dentro de psql:   \i 20261006_pdblimpieza_3_folio_pedidos.sql
--   ⛔ NUNCA lo pegues en la ventana de psql: si se negara, seguiría con las demás líneas y el motivo se pierde.
--   Termina con la palabra COMMIT si se aplicó; si lo último que ves es un ERROR, no se cambió nada.
--
--  Si hubiera que deshacerlo, la restauración PITR al punto del fichero 2 lo devuelve también (el contador vive en la
--  base).
-- =====================================================================================

\set ON_ERROR_STOP on
\set QUIET on
\set VERBOSITY terse
\pset pager off

BEGIN;
LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE;

\echo '=== ANTES: contador de pedidos (last_value = último número que se dio) ==='
SELECT last_value, is_called FROM order_number_seq;

DO $$
DECLARE n bigint; primero text;
BEGIN
  SELECT count(*), min("orderNumber") INTO n, primero FROM "Order";
  IF n > 0 THEN
    -- QA-8: si la limpieza ya se hizo, esos pedidos son REALES (no hay que «correr primero la limpieza»).
    IF EXISTS (SELECT 1 FROM "AuditLog" WHERE action = 'maintenance.test_data_purge') THEN
      RAISE EXCEPTION 'La limpieza YA se hizo y ya hay % pedido(s) nuevo(s) (el primero, %): el número de pedido NO se reinicia (chocaría con ellos). No hay nada que hacer aquí.', n, primero;
    END IF;
    RAISE EXCEPTION 'Quedan % pedido(s) de prueba en la tabla Order: el número de pedido NO se reinicia. Corre primero la limpieza (fichero 2) con COMMIT.', n;
  END IF;
  -- setval(…, 1, false): el PRÓXIMO nextval devuelve 1 ⇒ TCG-000001.
  PERFORM setval('order_number_seq', 1, false);
END $$;

\echo '=== DESPUÉS: is_called = f y last_value = 1 ⇒ el próximo pedido es TCG-000001 ==='
SELECT last_value, is_called,
       'TCG-' || lpad((CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text, 6, '0') AS proximo_pedido
FROM order_number_seq;

\set QUIET off
COMMIT;
