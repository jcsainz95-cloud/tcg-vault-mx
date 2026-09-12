-- =====================================================================================
--  DESHACER la reparación P-79(d)  ·  2026-09-12  ·  backend
--  (Es EXACTAMENTE el bloque «CÓMO DESHACER ESTO» del fichero
--   `20260912_p79d_llave_de_precio_del_sellado.sql`, ya listo para pegar sin tocar nada.)
-- =====================================================================================
--
--  CUÁNDO SE USA: solo si ya aplicaste la reparación (pusiste COMMIT) y te arrepientes.
--  QUÉ HACE: devuelve cada fila EXACTAMENTE a la etiqueta que tenía antes, leyéndola de
--  la tabla de respaldo `p79d_respaldo` que la reparación guardó ANTES de tocar nada.
--
--  ⚠️ Necesita el usuario ADMINISTRADOR (el de solo lectura no puede escribir).
--  ⚠️ Si `p79d_respaldo` no existe, es que la reparación nunca llegó a aplicarse: no hay
--     nada que deshacer y este fichero dará un error diciendo justo eso.
--
--  CORRERLO DOS VECES NO HACE DAÑO: la segunda vez no encuentra nada que restaurar.
--  Este fichero SÍ termina en COMMIT, porque deshacer es lo que quieres que pase.
-- =====================================================================================
\timing off
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

SELECT '=== ANTES de deshacer: lo que el respaldo dice que hay que restaurar ===' AS titulo;
SELECT tabla, fila_id, etiqueta_nueva AS etiqueta_ahora, etiqueta_anterior AS etiqueta_a_restaurar
FROM "p79d_respaldo"
ORDER BY tabla, fila_id;

UPDATE "PendingPriceEntry" p
SET    "gradeKey" = b.etiqueta_anterior
FROM   "p79d_respaldo" b
WHERE  b.tabla = 'PendingPriceEntry'
  AND  p.id = b.fila_id
  AND  p."gradeKey" = b.etiqueta_nueva;

UPDATE "PriceReference" r
SET    "gradeKey" = b.etiqueta_anterior
FROM   "p79d_respaldo" b
WHERE  b.tabla = 'PriceReference'
  AND  r.id = b.fila_id
  AND  r."gradeKey" = b.etiqueta_nueva;

SELECT '=== DESPUÉS de deshacer: cómo quedó cada fila ===' AS titulo;
SELECT b.tabla, b.fila_id, b.etiqueta_anterior AS etiqueta_esperada,
       COALESCE(p."gradeKey", r."gradeKey")    AS etiqueta_real
FROM "p79d_respaldo" b
LEFT JOIN "PendingPriceEntry" p ON b.tabla = 'PendingPriceEntry' AND p.id = b.fila_id
LEFT JOIN "PriceReference"   r ON b.tabla = 'PriceReference'   AND r.id = b.fila_id
ORDER BY b.tabla, b.fila_id;

COMMIT;

-- La tabla de respaldo se puede borrar cuando ya no la necesites (no antes de estar
-- seguro):   DROP TABLE "p79d_respaldo";
