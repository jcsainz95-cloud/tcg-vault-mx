-- =============================================================================
-- db-wal-tuning.sql — acotar el WAL de Postgres (P-53)                 · devops
-- =============================================================================
-- QUÉ ES ESTO
--   El parche de configuración que baja el techo del WAL de los valores de
--   FÁBRICA (dimensionados para un disco mucho mayor) a algo acorde al volumen
--   real de este proyecto. Medido en septiembre en producción (Railway):
--     · pgdata/pg_wal = ~145 MB (46% de lo usado)
--     · replication slots = 0  (verificado: pg_replication_slots devolvió 0
--       filas ⇒ NO hay fuga; es Postgres con `max_wal_size = 1GB` de fábrica).
--   Acotar `max_wal_size`/`min_wal_size` recupera del orden de ~100 MB.
--
-- QUIÉN LO APLICA Y CUÁNDO
--   Lo aplica EL DUEÑO en su ventana, contra la base de PRODUCCIÓN de Railway.
--   devops NO lo aplica: este entorno no alcanza la prod (egress bloqueado). El
--   runbook completo (respaldo, cómo conectarse, cómo verificar el ahorro, cómo
--   revertir) está en docs/DEVOPS_NOTES.md §"P-53 · Acotar el WAL (runbook)".
--
-- CÓMO SE APLICA (una línea, desde la consola de Railway o psql local con la
-- DATABASE_URL de producción):
--     psql "$DATABASE_URL" -f scripts/db-wal-tuning.sql
--
-- POR QUÉ ESTOS VALORES (y no menos)
--   · max_wal_size = 128MB  — techo del WAL entre checkpoints. De 1GB a 128MB.
--       El ingest diario de singles escribe ~13-20 MB de datos/día (≈30-60 MB
--       de WAL con full-page writes tras un checkpoint), holgadamente por debajo
--       de 128 MB ⇒ los checkpoints del día a día siguen siendo POR TIEMPO
--       (checkpoint_timeout, 5 min), no por tamaño. En el pico diario del ingest
--       puede caer 1 checkpoint extra por tamaño: es seguro, solo algo más de I/O.
--   · min_wal_size = 32MB   — de 80MB a 32MB. Deja que Postgres recicle hacia
--       abajo el pool de segmentos preasignados; es lo que permite que el WAL
--       ENCOJA de verdad tras el cambio en vez de quedarse en 80 MB.
--   · checkpoint_completion_target y wal_keep_size se dejan explícitos para que
--       queden AUDITABLES en postgresql.auto.conf (0.9 ya es el default de PG16;
--       wal_keep_size = 0 es correcto porque no hay slots ni réplicas).
--
-- CONTEXTO DE LOS PARÁMETROS (documentado, NO medido contra esta prod)
--   max_wal_size, min_wal_size, checkpoint_completion_target y wal_keep_size son
--   de contexto `sighup` (postgresql.org, pg_settings.context): CAMBIAN CON UN
--   RELOAD, sin reinicio. Por eso este script termina con `pg_reload_conf()` y un
--   `CHECKPOINT` manual para forzar el reciclado del WAL sobrante YA. Un reinicio
--   NO es estrictamente necesario para el cambio de parámetro; solo forzaría el
--   primer checkpoint de inmediato (lo hace igual el CHECKPOINT de abajo). Lo que
--   NO pude medir desde aquí (egress bloqueado) es si el mecanismo de Railway para
--   aplicar config exige un redeploy del servicio — eso lo confirma el dueño en la
--   ventana (runbook §"si Railway pide reinicio").
--
-- SEGURIDAD DE ESTE SCRIPT
--   · Idempotente: ALTER SYSTEM sobrescribe; correrlo dos veces deja lo mismo.
--   · NO borra datos, NO toca tablas de la aplicación, NO trae credencial alguna.
--   · Escribe en postgresql.auto.conf (persiste en el volumen tras reinicios).
--   · Reversible en una línea (ver el bloque REVERTIR al pie).
-- =============================================================================

\echo '== P-53 · Acotar el WAL — ANTES (valores efectivos) =='
SELECT name, setting, unit, source, pending_restart
  FROM pg_settings
 WHERE name IN ('max_wal_size','min_wal_size','checkpoint_completion_target',
                'checkpoint_timeout','wal_keep_size');

\echo '== Comprobación de seguridad: replication slots (P-53 esperaba 0) =='
SELECT count(*) AS replication_slots FROM pg_replication_slots;

\echo '== Aplicando el parche (ALTER SYSTEM, contexto sighup) =='
ALTER SYSTEM SET max_wal_size = '128MB';
ALTER SYSTEM SET min_wal_size = '32MB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_keep_size = '0';

\echo '== Recargando configuración (sin reinicio) =='
SELECT pg_reload_conf();

\echo '== Forzando un checkpoint para reciclar el WAL sobrante YA =='
CHECKPOINT;

\echo '== DESPUÉS (valores efectivos — deben mostrar los nuevos y source=configuration file) =='
SELECT name, setting, unit, source, pending_restart
  FROM pg_settings
 WHERE name IN ('max_wal_size','min_wal_size','checkpoint_completion_target',
                'checkpoint_timeout','wal_keep_size');

\echo '== Tamaño del WAL AHORA (repetir a los ~15-30 min: debe bajar hacia ~min_wal_size) =='
SELECT count(*) AS wal_files,
       pg_size_pretty(coalesce(sum(size),0)) AS wal_total
  FROM pg_ls_waldir();

-- =============================================================================
-- REVERTIR (si algo se ve raro tras el cambio):
--   ALTER SYSTEM RESET max_wal_size;
--   ALTER SYSTEM RESET min_wal_size;
--   ALTER SYSTEM RESET checkpoint_completion_target;
--   ALTER SYSTEM RESET wal_keep_size;
--   SELECT pg_reload_conf();
-- Vuelve a los valores de fábrica (max_wal_size = 1GB). El disco vuelve a crecer
-- como antes; no se pierde ni un dato. Verifica con el bloque DESPUÉS de arriba.
-- =============================================================================
