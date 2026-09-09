-- M-50 — migración `v1.64-iva-inclusive` (ARCHITECTURE §11 «v1.64-iva-inclusive» / §4.44.e / §4.44.k).
-- EL SNAPSHOT DE CONVENCIÓN DE PRECIO POR FILA + LA FILA DEL DIAL DE TRASLACIÓN.
--
-- ⭐ VA ENTERA EN EL **DEPLOY 1**, cuando el código todavía escribe `IVA_EXCLUSIVE` y la aritmética
-- es la de hoy. EL DEPLOY 2 NO TRAE DDL (§4.44.k). La única ventana para probar contra producción
-- que el P&L quedó NEUTRO es ésta: antes de que ninguna cifra se mueva.
--
-- QUÉ RESUELVE. `Order.ivaRatePct` congela la TASA, jamás la CONVENCIÓN. La fila
-- `subtotal=10000, iva=1600` significa hoy «100 + 16» y bajo la regla del deploy 2 significaría
-- «100, de los cuales 13.79 son IVA». Sin una columna que diga cuál de las dos, **el pedido de ayer
-- cambia de significado solo**. Criterio 190.
--
-- ⛔⛔ PROHIBIDO `ADD COLUMN … NOT NULL DEFAULT …`, NI SIQUIERA TRANSITORIAMENTE (§4.44.e, §11 M-50.5).
-- El «sin default» ES la decisión, no el `NOT NULL`: un `DEFAULT 'IVA_EXCLUSIVE'` haría que un camino
-- de escritura que OLVIDE el campo cobre bajo una convención y archive bajo la otra, en silencio y
-- para siempre. Sin default, ese camino revienta con violación de `NOT NULL` la primera vez que corre,
-- en desarrollo, con nombre y apellido. **El fallo ruidoso es la funcionalidad.**
-- ⇒ El orden de abajo (añadir NULLABLE → backfill EXPLÍCITO → `SET NOT NULL`) es OBLIGATORIO, y no es
-- una preferencia de estilo: es la única secuencia que llega a `NOT NULL` sin que exista un `DEFAULT`
-- en ningún instante. Un `ADD … NOT NULL DEFAULT` + `DROP DEFAULT` produce el mismo DDL final pero
-- basta con que el `DROP` se caiga en un rebase para reintroducir el defecto entero.
-- Candado `IVA-3(c)`, que lo verifica POR LO NEGATIVO sobre `information_schema`.
--
-- ⛔ `ivaTransferPct` NO SE BACKFILLEA. No hay ningún `UPDATE … SET "ivaTransferPct" = 100` aquí y no
-- debe haberlo: esas órdenes se cobraron cuando el dial no existía y marcarlas `t=100` sería inventar
-- un hecho. `NULL` dice la verdad —«esta orden no tuvo dial»— y no le hace falta a nadie para
-- reproducir el dinero. Candado `IVA-3(d)`: `count(*) = 0`.
--
-- ⛔ NINGUNA SENTENCIA TOCA UN IMPORTE. No hay un solo `UPDATE` sobre `subtotalCents`, `ivaCents`,
-- `processingFeeCents`, `totalCents` ni `shippingFeeCents`. Esta migración solo AÑADE columnas y
-- ESCRIBE LA CONVENCIÓN QUE ESAS FILAS YA TENÍAN. Criterio 190.
--
-- ADITIVA Y REVERSIBLE SIN CEREMONIA: revertir el código del deploy 1 deja las cuatro columnas
-- INERTES, no rotas. **El `down` no borra nada** (mismo criterio que el resto de migraciones de
-- dinero). Sin ventana, sin congelación, sin cut-over.

-- =============================================================================
-- PASO 1 (M-50.1) — El enum.
-- =============================================================================
CREATE TYPE "PriceConvention" AS ENUM ('IVA_EXCLUSIVE', 'IVA_INCLUSIVE');

-- =============================================================================
-- PASO 2 (M-50.2) — `Order`: las dos columnas, NULLABLE y SIN DEFAULT.
-- =============================================================================
ALTER TABLE "Order" ADD COLUMN "priceConvention" "PriceConvention";
ALTER TABLE "Order" ADD COLUMN "ivaTransferPct"  INTEGER;

-- =============================================================================
-- PASO 3 (M-50.3) — `ShipmentRequest`: idem. El envío entra en la convención (§4.44.f).
-- =============================================================================
ALTER TABLE "ShipmentRequest" ADD COLUMN "priceConvention" "PriceConvention";
ALTER TABLE "ShipmentRequest" ADD COLUMN "ivaTransferPct"  INTEGER;

-- =============================================================================
-- PASO 4 (M-50.4) — BACKFILL EXPLÍCITO Y DETERMINISTA.
-- Dice la VERDAD: así se cobraron. Toda fila existente es `IVA_EXCLUSIVE` porque el concepto de
-- «IVA dentro del precio exhibido» no existía cuando se cobró.
-- El `WHERE … IS NULL` lo hace idempotente y, sobre todo, hace IMPOSIBLE que reescriba la convención
-- de una fila que ya la tenga (si esta migración se re-corriera en una base del deploy 2).
-- =============================================================================
UPDATE "Order"           SET "priceConvention" = 'IVA_EXCLUSIVE' WHERE "priceConvention" IS NULL;
UPDATE "ShipmentRequest" SET "priceConvention" = 'IVA_EXCLUSIVE' WHERE "priceConvention" IS NULL;

-- =============================================================================
-- PASO 5 (M-50.5) — RECIÉN AHORA, `NOT NULL`. Y SIN DEJAR `DEFAULT`.
-- A partir de aquí, un `INSERT` que omita `priceConvention` LANZA (candado `IVA-3(e)`).
-- =============================================================================
ALTER TABLE "Order"           ALTER COLUMN "priceConvention" SET NOT NULL;
ALTER TABLE "ShipmentRequest" ALTER COLUMN "priceConvention" SET NOT NULL;

-- =============================================================================
-- PASO 6 (M-50.6) — La fila del dial, sembrada en 100 (§11.0, regla de propagación de seeds).
--
-- `100 %` es EL NEUTRO: con el dial ahí, la fórmula del deploy 2 reproduce el cobro de hoy al
-- centavo (§4.44.a). Se siembra AQUÍ además de en `prisma/seed.ts` porque `seed.ts` hace `upsert`
-- con `update: {}` y NO llega a una base ya sembrada (§11.0): sin esta línea, producción se quedaría
-- sin la fila y el dial no sería visible ni auditable desde el minuto cero.
--
-- ⚠️ En el DEPLOY 1 esta fila NO LA LEE NADIE (no está en `SETTING_DTO_MAP`, no hay endpoint y la
-- aritmética es la de hoy): es inventario, no conducta. La puerta de escritura
-- (`PUT /admin/settings/iva-transfer`, `API_CONTRACT §M10-IVA.2`) abre en el DEPLOY 2.
--
-- `ON CONFLICT DO NOTHING` = misma semántica que el `update: {}` del seed: NUNCA pisa un valor que
-- el dueño ya haya elegido.
-- =============================================================================
INSERT INTO "ConfigSetting" ("key", "valueJson", "updatedBy", "updatedAt")
VALUES ('iva_transfer_pct', '100'::jsonb, 'migration:M-50', NOW())
ON CONFLICT ("key") DO NOTHING;
