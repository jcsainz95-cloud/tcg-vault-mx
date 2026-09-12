-- =====================================================================================
--  REPARACIÓN DE DATOS · P-79(d) — «el sellado se apuntó el precio en una llave
--  y se lee de otra»
--  Fecha: 2026-09-12 · Lo escribió: backend · Lo ejecuta: EL DUEÑO
--  Base de referencia: API_CONTRACT §M2-SK · BACKEND_NOTES «P-79 (d)»
-- =====================================================================================
--
--  QUÉ ARREGLA ESTO, EN CASTELLANO
--  -------------------------------
--  Cuando das de alta una caja/sobre sellado, el sistema le pone una ETIQUETA para
--  guardar y buscar su precio. Durante un tiempo hubo un error: en algunos casos el
--  precio se GUARDABA con la etiqueta genérica «sealed» y la tienda lo BUSCABA con la
--  etiqueta del producto concreto («sealed:tcg:12345»). Como no la encontraba, la pieza
--  volvía a la cola de «FIJAR PRECIO» aunque tú ya le hubieras puesto precio.
--
--  El código ya está arreglado: las altas NUEVAS nacen con la etiqueta correcta. Lo que
--  queda son las filas VIEJAS, las que se escribieron antes del arreglo. Eso es lo que
--  este guion repara.
--
--  DOS COSAS DISTINTAS, Y LA SEGUNDA ES DELICADA
--  ---------------------------------------------
--  (1) LA COLA (tabla PendingPriceEntry). Son avisos de «esta pieza espera precio».
--      No son dinero. Cada una sabe a qué producto pertenece, así que la etiqueta
--      correcta se deduce sin ninguna duda. Se reparan todas.
--
--  (2) LOS PRECIOS QUE TÚ TECLEASTE (tabla PriceReference). Esto SÍ es dinero. El
--      problema: esa tabla NO guarda a qué producto sellado pertenece la fila; solo
--      guarda la «carta ancla». Si dos sellados distintos cuelgan de la misma carta
--      ancla, la fila es AMBIGUA: no se puede saber si ese precio era el de la caja o
--      el del sobre, y moverla a ciegas le pondría a una caja el precio de un sobre.
--      ⛔ Por eso este guion NO toca las ambiguas. Las enseña, con el nombre del
--      producto y el importe, y decides tú.
--
--  CÓMO SE USA (tres pasos, y el primero no cambia nada)
--  -----------------------------------------------------
--   PASO 1 · Pega este fichero entero en psql TAL CUAL.
--            No escribe nada: termina en ROLLBACK, que significa «deshaz todo».
--            Lee las tablas que imprime. La columna «que_va_a_pasar» lo dice en
--            palabras, fila por fila.
--   PASO 2 · Si estás de acuerdo con lo que dice, cambia la ÚLTIMA línea del fichero,
--            donde dice   ROLLBACK;   y ponle   COMMIT;
--   PASO 3 · Vuelve a pegarlo entero. Ahora sí escribe. Vuelve a leer las tablas: la
--            última («DESPUÉS») te enseña cómo quedó cada fila.
--
--  ⚠️ CON QUÉ USUARIO
--  ------------------
--  Tu usuario de solo lectura (`tcg_readonly`) NO PUEDE escribir: con él el PASO 3
--  fallará con un error de permisos (y no habrá pasado nada malo, simplemente no se
--  aplica). Para el PASO 3 conéctate con el usuario ADMINISTRADOR de la base.
--  El PASO 1 (marcha en seco) sí se puede hacer con el de solo lectura… salvo la tabla
--  de respaldo, que necesita crear una tabla; si te da error de permisos en el PASO 1,
--  es por eso: usa el administrador también para el ensayo.
--
--  SI ALGO SALE MAL: hay un fichero hermano, `20260912_p79d_DESHACER.sql`, que devuelve
--  cada fila a como estaba. Se pega tal cual, sin tocar nada. Se apoya en la tabla de
--  respaldo que este mismo guion crea ANTES de tocar nada. (Al final de este fichero
--  está el mismo texto, por si prefieres tenerlo todo a la vista.)
--
--  CORRERLO DOS VECES NO HACE DAÑO: la segunda vez no encuentra nada que mover y no
--  duplica el respaldo. Está escrito para eso.
-- =====================================================================================

\timing off
\pset pager off

BEGIN;

-- Un candado de seguridad: si la sesión tarda más de la cuenta, suelta los bloqueos
-- en vez de dejar la tabla de precios trabada.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ------------------------------------------------------------------------------------
-- 0 · DÓNDE ESTOY (para que quede en la pantalla junto al resto)
-- ------------------------------------------------------------------------------------
SELECT current_database()                AS base_de_datos,
       current_user                      AS usuario,
       now()                             AS fecha_y_hora;

-- ------------------------------------------------------------------------------------
-- 1 · EL PLAN DE LA COLA (PendingPriceEntry) — avisos, no dinero
-- ------------------------------------------------------------------------------------
-- Cada aviso de sellado que quedó con la etiqueta genérica «sealed» PERO que sí sabe a
-- qué producto pertenece (columna sealedProductId). La etiqueta correcta se construye
-- con el identificador de TCGplayer de ese producto, que nunca está vacío.
--
-- La única razón para NO mover uno: que ya exista OTRO aviso abierto idéntico con la
-- etiqueta correcta. Entonces moverlo crearía dos avisos para la misma pieza. Esos se
-- marcan como «YA EXISTE EL AVISO CORRECTO» y se dejan quietos (los decides tú).
CREATE TEMP TABLE plan_cola ON COMMIT DROP AS
SELECT p.id                                               AS aviso_id,
       sp.name                                            AS producto,
       p."gradeKey"                                       AS etiqueta_actual,
       'sealed:tcg:' || sp."tcgplayerProductId"::text     AS etiqueta_correcta,
       p.status                                           AS estado_del_aviso,
       p."createdAt"                                      AS creado,
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM "PendingPriceEntry" q
           WHERE q.id <> p.id
             AND q."cardId"          = p."cardId"
             AND q."productType"     = p."productType"
             AND q."gradeKey"        = 'sealed:tcg:' || sp."tcgplayerProductId"::text
             AND q.finish            = p.finish
             AND q.status            = p.status
             AND q."sealedProductId" IS NOT DISTINCT FROM p."sealedProductId"
         ) THEN 'NO SE TOCA · ya existe el aviso correcto (lo decides tú)'
         ELSE 'SE CORRIGE LA ETIQUETA'
       END                                                AS que_va_a_pasar
FROM "PendingPriceEntry" p
JOIN "SealedProduct" sp ON sp.id = p."sealedProductId"
WHERE p."productType"     = 'sealed'
  AND p."gradeKey"        = 'sealed'
  AND p."sealedProductId" IS NOT NULL;

SELECT '=== 1 · LA COLA: avisos de precio que hay que re-etiquetar ===' AS titulo;
SELECT producto, etiqueta_actual, etiqueta_correcta, estado_del_aviso, creado, que_va_a_pasar
FROM plan_cola
ORDER BY creado;

-- ------------------------------------------------------------------------------------
-- 2 · EL PLAN DE LOS PRECIOS (PriceReference) — ESTO ES DINERO
-- ------------------------------------------------------------------------------------
-- Paso 2.1 · ¿Qué productos sellados cuelgan de cada carta ancla?
--            Se mira el inventario: cada pieza sellada dice de qué carta cuelga y a qué
--            producto de TCGplayer corresponde (por dos vías, y se aceptan las dos).
CREATE TEMP TABLE candidatos ON COMMIT DROP AS
SELECT DISTINCT
       i."cardId"                                                         AS carta_ancla,
       COALESCE(sp."tcgplayerProductId", i."tcgplayerProductId")          AS producto_tcg,
       COALESCE(sp.name, i."sealedProductName", '(sin nombre guardado)')  AS nombre_producto
FROM "InventoryItem" i
LEFT JOIN "SealedProduct" sp ON sp.id = i."sealedProductId"
WHERE i."productType" = 'sealed'
  AND COALESCE(sp."tcgplayerProductId", i."tcgplayerProductId") IS NOT NULL;

-- Paso 2.2 · Para cada precio con la etiqueta genérica, cuántos candidatos hay.
--            UNO  → inequívoco, se puede reparar.
--            DOS o más → AMBIGUO: no se toca (sería adivinar de quién es el precio).
--            NINGUNO → esa carta ancla no tiene ninguna pieza sellada mapeada; no hay a
--            dónde moverlo.
CREATE TEMP TABLE plan_precios ON COMMIT DROP AS
WITH conteo AS (
  SELECT carta_ancla, count(*) AS cuantos, min(producto_tcg) AS unico_producto
  FROM candidatos
  GROUP BY carta_ancla
)
SELECT r.id                                                   AS precio_id,
       r."cardId"                                             AS carta_ancla,
       c.name                                                 AS carta_ancla_nombre,
       round(r."priceMxnCents"::numeric / 100, 2)             AS importe_pesos,
       r."capturedDate"                                       AS fecha_del_precio,
       r.finish                                               AS acabado,
       r."gradeKey"                                           AS etiqueta_actual,
       COALESCE(cnt.cuantos, 0)                               AS candidatos,
       cnt.unico_producto                                     AS producto_tcg_destino,
       (SELECT string_agg(DISTINCT k.nombre_producto, ' | ' ORDER BY k.nombre_producto)
          FROM candidatos k WHERE k.carta_ancla = r."cardId") AS productos_posibles,
       CASE WHEN COALESCE(cnt.cuantos, 0) = 1
            THEN 'sealed:tcg:' || cnt.unico_producto::text END AS etiqueta_correcta,
       CASE
         WHEN COALESCE(cnt.cuantos, 0) = 0 THEN
           'NO SE TOCA · esta carta ancla no tiene ninguna pieza sellada con mapeo: no hay a dónde moverlo'
         WHEN cnt.cuantos > 1 THEN
           'NO SE TOCA · AMBIGUO: ' || cnt.cuantos::text ||
           ' productos sellados cuelgan de la misma carta ancla. Moverlo sería adivinar de cuál es este precio'
         WHEN EXISTS (
           SELECT 1 FROM "PriceReference" r2
           WHERE r2.id <> r.id
             AND r2."cardId"        = r."cardId"
             AND r2."productType"   = r."productType"
             AND r2."gradeKey"      = 'sealed:tcg:' || cnt.unico_producto::text
             AND r2.finish          = r.finish
             AND r2."capturedDate"  = r."capturedDate"
             AND r2."cardProductId" IS NOT DISTINCT FROM r."cardProductId"
         ) THEN
           'NO SE TOCA · ya hay un precio con la etiqueta correcta para ese mismo día: mover éste crearía dos precios para lo mismo'
         -- ⚠️ El caso «dos precios genéricos de la MISMA carta, mismo día y mismo acabado, que
         -- irían los dos a la misma etiqueta» NO se comprueba aquí porque **la base no lo permite
         -- existir**: el índice único `PriceReference_variant_capturedDate_key` está declarado
         -- `NULLS NOT DISTINCT`, así que ya trata dos filas así como duplicadas.
         -- (Medido el 2026-09-12 en una base local con las migraciones aplicadas: intentar
         -- sembrar ese par falla con `duplicate key value violates unique constraint`.)
         ELSE 'SE CORRIGE LA ETIQUETA (inequívoco: un solo producto posible)'
       END                                                    AS que_va_a_pasar
FROM "PriceReference" r
JOIN "Card" c   ON c.id = r."cardId"
LEFT JOIN conteo cnt ON cnt.carta_ancla = r."cardId"
WHERE r."productType" = 'sealed'
  AND r."gradeKey"    = 'sealed'
  AND (r."isManualOverride" = true OR r.source = 'manual');

SELECT '=== 2 · LOS PRECIOS QUE TECLEASTE: uno por uno, y qué se hace con cada uno ===' AS titulo;
SELECT importe_pesos,
       fecha_del_precio,
       carta_ancla_nombre,
       productos_posibles,
       etiqueta_actual,
       etiqueta_correcta,
       que_va_a_pasar
FROM plan_precios
ORDER BY fecha_del_precio DESC, importe_pesos DESC;

SELECT '=== 2-bis · RESUMEN de los precios ===' AS titulo;
SELECT que_va_a_pasar, count(*) AS cuantos
FROM plan_precios
GROUP BY que_va_a_pasar
ORDER BY cuantos DESC;

-- ------------------------------------------------------------------------------------
-- 3 · RESPALDO — se guarda el «antes» ANTES de tocar nada
-- ------------------------------------------------------------------------------------
-- Esta tabla es la que permite deshacer. No se borra al terminar: queda en la base como
-- comprobante. Si el guion se corre dos veces, no duplica filas.
CREATE TABLE IF NOT EXISTS "p79d_respaldo" (
  tabla            text        NOT NULL,
  fila_id          text        NOT NULL,
  etiqueta_anterior text       NOT NULL,
  etiqueta_nueva   text        NOT NULL,
  respaldado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tabla, fila_id)
);

INSERT INTO "p79d_respaldo" (tabla, fila_id, etiqueta_anterior, etiqueta_nueva)
SELECT 'PendingPriceEntry', aviso_id, etiqueta_actual, etiqueta_correcta
FROM plan_cola
WHERE que_va_a_pasar = 'SE CORRIGE LA ETIQUETA'
ON CONFLICT (tabla, fila_id) DO NOTHING;

INSERT INTO "p79d_respaldo" (tabla, fila_id, etiqueta_anterior, etiqueta_nueva)
SELECT 'PriceReference', precio_id, etiqueta_actual, etiqueta_correcta
FROM plan_precios
WHERE que_va_a_pasar LIKE 'SE CORRIGE LA ETIQUETA%'
ON CONFLICT (tabla, fila_id) DO NOTHING;

-- ------------------------------------------------------------------------------------
-- 4 · LA REPARACIÓN
-- ------------------------------------------------------------------------------------
-- Solo toca las filas que el plan marcó como «SE CORRIGE». Nada más.
-- Es idempotente: después de correr, ninguna de estas filas tiene ya la etiqueta
-- genérica, así que una segunda pasada no encuentra nada.
UPDATE "PendingPriceEntry" p
SET    "gradeKey" = pl.etiqueta_correcta
FROM   plan_cola pl
WHERE  p.id = pl.aviso_id
  AND  pl.que_va_a_pasar = 'SE CORRIGE LA ETIQUETA'
  AND  p."gradeKey" = 'sealed';

UPDATE "PriceReference" r
SET    "gradeKey" = pl.etiqueta_correcta
FROM   plan_precios pl
WHERE  r.id = pl.precio_id
  AND  pl.que_va_a_pasar LIKE 'SE CORRIGE LA ETIQUETA%'
  AND  r."gradeKey" = 'sealed';

-- ------------------------------------------------------------------------------------
-- 5 · DESPUÉS — cómo quedó cada fila
-- ------------------------------------------------------------------------------------
SELECT '=== 5 · DESPUÉS · la cola ===' AS titulo;
SELECT pl.producto,
       pl.etiqueta_actual   AS etiqueta_antes,
       p."gradeKey"         AS etiqueta_ahora,
       pl.que_va_a_pasar
FROM plan_cola pl
JOIN "PendingPriceEntry" p ON p.id = pl.aviso_id
ORDER BY pl.creado;

SELECT '=== 5 · DESPUÉS · los precios ===' AS titulo;
SELECT pl.importe_pesos,
       pl.fecha_del_precio,
       pl.carta_ancla_nombre,
       pl.etiqueta_actual AS etiqueta_antes,
       r."gradeKey"       AS etiqueta_ahora,
       pl.que_va_a_pasar
FROM plan_precios pl
JOIN "PriceReference" r ON r.id = pl.precio_id
ORDER BY pl.fecha_del_precio DESC;

SELECT '=== 5 · LO QUE QUEDA SIN RESOLVER (lo decides tú, caso por caso) ===' AS titulo;
SELECT importe_pesos, fecha_del_precio, carta_ancla_nombre, productos_posibles, que_va_a_pasar
FROM plan_precios
WHERE que_va_a_pasar NOT LIKE 'SE CORRIGE%'
ORDER BY importe_pesos DESC;

SELECT '=== 5 · COMPROBANTE (respaldo para poder deshacer) ===' AS titulo;
SELECT tabla, count(*) AS filas_respaldadas FROM "p79d_respaldo" GROUP BY tabla;

-- ====================================================================================
--  ⬇⬇⬇  LA LÍNEA QUE DECIDE  ⬇⬇⬇
--  ROLLBACK = ensayo, no escribe nada (es como está ahora).
--  COMMIT   = aplica los cambios de verdad.
--  Cambia la palabra solo cuando hayas leído las tablas de arriba y estés de acuerdo.
-- ====================================================================================
ROLLBACK;

-- =====================================================================================
--  CÓMO DESHACER ESTO  (solo si ya hiciste COMMIT y te arrepientes)
-- =====================================================================================
--  ⭐ LO MÁS CÓMODO: pega el fichero hermano `20260912_p79d_DESHACER.sql`, que es esto
--  mismo ya listo (sin los guiones del principio de cada línea).
--
--  Devuelve cada fila EXACTAMENTE a la etiqueta que tenía, usando el respaldo que este
--  guion guardó. También es idempotente: correrlo dos veces no hace nada la segunda.
--  Termina en COMMIT porque deshacer es lo que quieres que pase.
--
--  BEGIN;
--    UPDATE "PendingPriceEntry" p
--    SET    "gradeKey" = b.etiqueta_anterior
--    FROM   "p79d_respaldo" b
--    WHERE  b.tabla = 'PendingPriceEntry'
--      AND  p.id = b.fila_id
--      AND  p."gradeKey" = b.etiqueta_nueva;
--
--    UPDATE "PriceReference" r
--    SET    "gradeKey" = b.etiqueta_anterior
--    FROM   "p79d_respaldo" b
--    WHERE  b.tabla = 'PriceReference'
--      AND  r.id = b.fila_id
--      AND  r."gradeKey" = b.etiqueta_nueva;
--
--    SELECT b.tabla, b.fila_id, b.etiqueta_anterior AS etiqueta_restaurada
--    FROM "p79d_respaldo" b ORDER BY b.tabla, b.fila_id;
--  COMMIT;
--
--  (La tabla "p79d_respaldo" se puede borrar cuando ya no la necesites:
--   DROP TABLE "p79d_respaldo";  — pero no la borres antes de estar seguro.)
-- =====================================================================================
