-- scripts/ids/ids-q1-boton.sql — lo que corre el botón «Medir D-IDS-1 en producción (solo lectura)».   · devops
--
-- Lo invoca SOLO scripts/ids/medir-q1-produccion.sh (psql --csv). Orden y porqué:
--   1. BEGIN TRANSACTION READ ONLY + statement_timeout: nada de lo que sigue puede escribir, sea cual sea el rol.
--   2. PRUEBA de que una escritura falla: un UPDATE que no toca filas (WHERE false) tiene que dar SQLSTATE 25006
--      (read_only_sql_transaction). Si NO falla, se aborta ANTES de leer nada y el botón queda en rojo.
--      Inofensivo aunque pasara: 0 filas y ROLLBACK al final.
--   3. ROL: si el secreto es de un rol que puede escribir (dueño completo) — solo informa, sin escribir.
--   4. Q1 y Q1b (ids-d1-q1.sql, la misma consulta que el `.sql` manual).
--   5. ROLLBACK. ⛔ Nunca COMMIT. Candado: scripts/check-ids-ro-workflow.sh [R]. DEVOPS_NOTES §108.5.
-- QUIET todo el fichero: en --csv las etiquetas de orden («ROLLBACK») se colarían como filas de la última tabla.
\set QUIET on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  UPDATE "InventoryItem" SET status = status WHERE false;
  RAISE EXCEPTION 'IDS-RO: la escritura NO fue rechazada; se aborta sin leer';
EXCEPTION WHEN read_only_sql_transaction THEN
  RAISE NOTICE 'IDS-RO: escritura rechazada (SQLSTATE 25006)';
END $$;

\echo '== ROL =='
SELECT current_setting('transaction_read_only') AS transaccion_solo_lectura,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario,
       count(*) FILTER (WHERE has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE')
                           OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE')) AS tablas_con_escritura,
       count(*) AS tablas,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS medido_en
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

\ir ids-d1-q1.sql

ROLLBACK;
