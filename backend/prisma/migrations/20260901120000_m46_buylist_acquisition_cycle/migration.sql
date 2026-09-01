-- =============================================================================================
-- M-46 — «v1.51-buylist-acquisition-cycle»: CICLO DE ADQUISICIÓN DEL BUYLIST
-- ARCHITECTURE §11 (M-46) + §4.39 · API_CONTRACT v1.51.4 · PROJECT §P v2.1 (criterios 113–161)
--
-- ⚠️ M-46 SE ENMENDÓ EN EL SITIO CUATRO VECES (v1.51.1 D31/D32/D33 + cierre de (o.1); v1.51.2
-- D34/D35; v1.51.3 D36–D40; v1.51.4 D42/D43 + fricciones). NO existen M-47/M-48/M-49/M-50: el
-- arquitecto editó ESTA migración porque era PAPEL (nunca se ejecutó en ningún entorno). Este
-- archivo es la PRIMERA ejecución, y ya nace con las cuatro enmiendas aplicadas.
--   · v1.51.1 RETIRA `SellRequest.offerShippingPaidByUs` ⇒ NO SE CREA (con una sola banda no hay
--     `fee = 0` que desambiguar, y un booleano de un solo valor invita a resucitar la banda).
--     AÑADE `expiredReason` + `enum SellRequestExpiryReason` y `guideActualCostCents`.
--   · v1.51.2 NO añade DDL (D34 es un dial sin columna; D35 convierte el censo de bounties en el
--     BACKFILL del paso 4).
--   · v1.51.3 AÑADE `pickupAddressSnapshot`, `offerIssueClockStartedAt`, `declinedBy`.
--   · v1.51.4 AÑADE `offerReissueCount Int NOT NULL DEFAULT 0`.
--
-- ADITIVA PURA Y SEGURA CON LA APP CORRIENDO: cuatro valores de enum + tres enums nuevos + columnas
-- todas NULLABLE (o `NOT NULL` con default) + cinco índices + dos backfills IDEMPOTENTES.
-- CERO `DROP`, CERO cambios de tipo, CERO `UPDATE` que mueva un precio, un pago o un estado.
-- `backend/prisma/` es ZONA COMPARTIDA → el orquestador SERIALIZA M-46.
--
-- ORDEN OBLIGATORIO DEL DESPLIEGUE — SEIS PASOS (§11 M-46). Este archivo cubre 1, 3 y 4:
--   1) DDL de enums + columnas + índices .................. ESTE ARCHIVO (bloques 1–7)
--   2) Deploy del CÓDIGO, con el set único de estados de §4.39(c) ya reapuntado.
--      ⚠️ PRECEDENCIA DE RELEASE (BL-11): FRONTEND PRIMERO, backend después. `POST
--      /buylist/requests` gana un campo OBLIGATORIO (`addressId`) en un endpoint VIVO; el
--      `ValidationPipe` con whitelist descarta lo desconocido ⇒ front nuevo contra backend viejo
--      funciona, backend nuevo contra front viejo ROMPE TODAS LAS ALTAS.
--   3) Backfill de `InventoryItem.cardProductId` ........... ESTE ARCHIVO (bloque 8)
--   4) Backfill de `VariantPriceOverride.bountyTargetQty` .. ESTE ARCHIVO (bloque 9)
--   5) Seeds de los DIEZ diales ........................... `prisma/seed.ts` (upsert; §11.0 NO
--      aplica: son claves NUEVAS, no el cambio de un seed existente).
--   6) ⚠️ CENSO Y TRIAGE HUMANO de las `cotizada` vivas ANTES de habilitar la regla 7 del barrido
--      (BL-10 + BL-12). **NO ES OPCIONAL Y VA AL FINAL.** Es una DECISIÓN, no un `UPDATE`, y por eso
--      NO vive aquí: sin él, la primera corrida del barrido manda correos reales a vendedores con
--      solicitudes viejas. Consulta del censo al final de este archivo, comentada.
--
-- POR QUÉ LOS PASOS 3 Y 4 PUEDEN IR EN ESTE MISMO ARCHIVO (antes del paso 2): ninguno de los dos
-- necesita código nuevo —son SQL puro sobre columnas que este mismo archivo acaba de crear— y los
-- dos son IDEMPOTENTES (`WHERE … IS NULL`). El paso 4 lo declara §11 explícitamente
-- («independiente del paso 3 y del 2»). ⚠️ Ninguno USA un valor de enum recién añadido, que es la
-- única restricción real de Postgres aquí (`ALTER TYPE … ADD VALUE` no se puede USAR en la misma
-- transacción que lo agrega) — mismo cuidado que documentó M-39.
--
-- ROLLBACK: revertir el CÓDIGO. Las columnas quedan PRESENTES E INERTES y no se mueve un solo dato.
-- Los cuatro valores del enum NO se pueden quitar de Postgres sin recrear el tipo, y por eso el DDL
-- va ANTES que el código. Los `bountyTargetQty = 2` del paso 4 SE QUEDAN y siguen siendo correctos
-- bajo el código previo (lo lee como bounty bien formado ⇒ la sugerencia frena ANTES, nunca
-- después): borrarlos en un rollback REABRIRÍA el agujero de (o.2).
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 1 — `SellRequestStatus` += CUATRO valores (PROJECT §P.1 / criterio 113).
-- Ninguna fila existente cambia de valor. `IF NOT EXISTS` para que re-aplicar sea inocuo.
-- ⚠️ RADIO REAL = NUEVE sitios que codificaban subconjuntos a mano y NINGUNO falla en compilación.
-- Reapuntados por el paso 2 a `common/sell-request-states.ts` (§4.39c). El más grave era
-- `ine-retention.service.ts`: una `expirada` contaba ABIERTA para siempre ⇒ el INE NO SE PURGABA.
-- ---------------------------------------------------------------------------------------------
ALTER TYPE "SellRequestStatus" ADD VALUE IF NOT EXISTS 'ofertada';
ALTER TYPE "SellRequestStatus" ADD VALUE IF NOT EXISTS 'aceptada';
ALTER TYPE "SellRequestStatus" ADD VALUE IF NOT EXISTS 'en_transito';
ALTER TYPE "SellRequestStatus" ADD VALUE IF NOT EXISTS 'expirada';

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 2 — enums NUEVOS (usables de inmediato: no son valores añadidos a un tipo existente).
-- ---------------------------------------------------------------------------------------------
-- Segundo EJE del ciclo, ortogonal a `SellRequestStatus`. Admin-only: el cliente no debe enterarse
-- de que existe una oferta `pending_authorization` (le filtraría el orden de magnitud del tope).
CREATE TYPE "SellOfferState" AS ENUM ('pending_authorization', 'sent', 'cancelled');
-- D33 — POR QUÉ expiró. ATRIBUTO del terminal, no un quinto estado (los terminales siguen siendo 4).
CREATE TYPE "SellRequestExpiryReason" AS ENUM ('no_offer', 'not_shipped');
-- Cherry-pick al ofertar, por línea (§P.2).
CREATE TYPE "BuyDecision" AS ENUM ('buy', 'skip');

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 3 — `SellRequest`: la oferta (preparación, autorización, emisión) y sus TRES montos.
-- ⚠️ SEC-A1: ningún monto de aquí llega desde el DTO del cliente; los congela el servidor.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "SellRequest" ADD COLUMN "offerState"                "SellOfferState";
ALTER TABLE "SellRequest" ADD COLUMN "offerPreparedBy"           TEXT;
ALTER TABLE "SellRequest" ADD COLUMN "offerPreparedAt"           TIMESTAMP(3);
ALTER TABLE "SellRequest" ADD COLUMN "offerAuthorizedBy"         TEXT;
ALTER TABLE "SellRequest" ADD COLUMN "offerAuthorizedAt"         TIMESTAMP(3);
-- D2: desde aquí el precio es VINCULANTE. Es además el discriminador «va por el ciclo de oferta»
-- (§4.39i.6) y por eso NO se limpia al cancelar.
ALTER TABLE "SellRequest" ADD COLUMN "offerSentAt"               TIMESTAMP(3);
-- BRUTO congelado: base de los topes AML/KYC y del umbral de INE (criterios 136/155).
ALTER TABLE "SellRequest" ADD COLUMN "offerGrossCents"           INTEGER;
-- Tarifa congelada al ofertar (D25). SIEMPRE la vigente: con D31 hay UNA sola banda, no hay `0`.
-- DISTINTA de `shipping_fee_cents` (retiro al comprador, MX$175) — mover uno NO mueve el otro.
ALTER TABLE "SellRequest" ADD COLUMN "offerShippingFeeCents"     INTEGER;
-- NETO ANUNCIADO = max(0, bruto − envío). Cifra vinculante frente al vendedor (D16).
ALTER TABLE "SellRequest" ADD COLUMN "offerNetCents"             INTEGER;

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 4 — `SellRequest`: plazos congelados, recordatorios y el hecho de la aceptación.
-- ⚠️ NO se recicla `deadlineAt` (ancla el ajuste de verificación, que sigue vivo).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "SellRequest" ADD COLUMN "offerAcceptDeadlineAt"     TIMESTAMP(3);
-- Criterio 159: UN recordatorio por plazo, UNA sola vez. El guard es el timestamp, no un cálculo.
ALTER TABLE "SellRequest" ADD COLUMN "offerAcceptReminderSentAt" TIMESTAMP(3);
-- v1.51.1/D31: `acceptedAt` ya NO ancla ningún plazo; se conserva porque es el HECHO del «sí».
ALTER TABLE "SellRequest" ADD COLUMN "acceptedAt"                TIMESTAMP(3);

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 5 — `SellRequest`: caducidad, declinar a mano y cancelación de la oferta.
-- ---------------------------------------------------------------------------------------------
-- D33: `null` en toda fila que no esté `expirada`. La sella el barrido en la MISMA transacción que
-- la transición. NO es derivable: `offerSentAt` sobrevive a una cancelación.
ALTER TABLE "SellRequest" ADD COLUMN "expiredReason"             "SellRequestExpiryReason";
-- D39: quién declinó A MANO. `null` ⇒ la cerró el barrido. Sin `declinedAt` (duplicaría `closedAt`)
-- y sin columna de motivo (va a `AuditLog buylist.request.decline`). Admin-only.
ALTER TABLE "SellRequest" ADD COLUMN "declinedBy"                TEXT;
-- Criterio 145 (no se edita: se cancela y se emite otra). ⚠️ `offerCancelledAt` se sella en LAS DOS
-- ramas y también cuando el barrido anula la oferta ⇒ NO es el ancla del reloj de emisión.
ALTER TABLE "SellRequest" ADD COLUMN "offerCancelledAt"          TIMESTAMP(3);
ALTER TABLE "SellRequest" ADD COLUMN "offerCancelReason"         TEXT;
-- D38: el ancla RE-ANCLABLE de la regla 7 = `offerIssueClockStartedAt ?? createdAt`. `null` = nunca
-- se reinició (todas las filas existentes). SOLO la escribe la cancelación de una oferta `sent`.
ALTER TABLE "SellRequest" ADD COLUMN "offerIssueClockStartedAt"  TIMESTAMP(3);
-- v1.51.4: `NOT NULL` con default ⇒ CERO BACKFILL (el default puebla y `0` ES la verdad: el ciclo
-- no ha salido a producción y ninguna oferta se ha cancelado nunca). La ALERTA es DERIVADA
-- (`count >= dial 10`) y NO se persiste. Invariante verificable, escrito por el MISMO `if`:
--   `offerReissueCount > 0  ⇔  offerIssueClockStartedAt IS NOT NULL`
ALTER TABLE "SellRequest" ADD COLUMN "offerReissueCount"         INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 6 — `SellRequest`: el domicilio de ORIGEN congelado (D36/D37, §4.39q).
-- ⚠️ SNAPSHOT, NO FK, y NO se acompaña de `pickupAddressId`: alguien haría el join e imprimiría la
-- dirección VIVA, que es el bug que el snapshot existe para impedir. Mismo criterio que
-- `ShipmentRequest.addressSnapshot` y `Order.shippingAddressSnapshot` (ninguno lleva FK), y además
-- `Address` se PUEDE BORRAR: una referencia viva dejaría solicitudes en vuelo SIN ORIGEN.
-- `null` = fila LEGACY ⇒ no se puede ofertar (`422 PICKUP_ADDRESS_MISSING`, BL-12): se resuelve en
-- el paso 6 (triage humano), NUNCA rellenando la dirección por migración — copiarla de un pedido o
-- de la libreta viva sería ADIVINAR EL CONSENTIMIENTO del vendedor (criterio 160 aplicado a PII).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "SellRequest" ADD COLUMN "pickupAddressSnapshot"     JSONB;

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 7 — `SellRequest`: guía, tránsito, guía muerta y la caja.
-- ---------------------------------------------------------------------------------------------
-- D19: el sistema solo guarda y muestra (sin validar contra el transportista). Visible para LAS DOS
-- partes (criterio 122). ⚠️ NO se limpian al corregir la dirección tras la guía: son lo que hay que
-- CANCELAR, y la cola de guía muerta los muestra (§4.39t.2).
ALTER TABLE "SellRequest" ADD COLUMN "shipmentCarrier"           TEXT;
ALTER TABLE "SellRequest" ADD COLUMN "shipmentTrackingNumber"    TEXT;
-- UN solo timestamp de guía: capturar ES entregar (§4.39j). Ancla del plazo de envío, SIEMPRE.
ALTER TABLE "SellRequest" ADD COLUMN "guideSentAt"               TIMESTAMP(3);
-- ⚠️ `null` mientras no haya guía ⇒ la regla 2 del barrido NO la ve ⇒ NO expira. Es correcto por
-- §P.13: la etiqueta depende de NOSOTROS. Su visibilidad la da la cola `awaitingGuide`.
ALTER TABLE "SellRequest" ADD COLUMN "shipDeadlineAt"            TIMESTAMP(3);
ALTER TABLE "SellRequest" ADD COLUMN "shipReminderSentAt"        TIMESTAMP(3);
-- §P.13: lo fija el CLIENTE. DETIENE el reloj y NO mueve el estado ni el conteo de «en camino».
ALTER TABLE "SellRequest" ADD COLUMN "sellerShippedDeclaredAt"   TIMESTAMP(3);
-- D20: SOLO esto mueve a `en_transito` y SOLO esto suma a «en camino» (criterio 116).
ALTER TABLE "SellRequest" ADD COLUMN "shipmentConfirmedAt"       TIMESTAMP(3);
ALTER TABLE "SellRequest" ADD COLUMN "shipmentConfirmedBy"       TEXT;
-- D22/criterio 139: la tarea de cancelar una guía no usada NO desaparece sola.
ALTER TABLE "SellRequest" ADD COLUMN "guideCancellationPendingAt" TIMESTAMP(3);
ALTER TABLE "SellRequest" ADD COLUMN "guideCancellationDoneAt"   TIMESTAMP(3);
ALTER TABLE "SellRequest" ADD COLUMN "guideCancellationDoneBy"   TEXT;
-- Cierre de (o.1): costo REAL de la etiqueta, captura OPCIONAL. `null` ⇒ M7 usa la tarifa congelada
-- y lo DECLARA (`basis`). ⚠️ NO entra JAMÁS en `payoutNetCents`: al vendedor se le descuenta la
-- tarifa que ACEPTÓ (D25).
ALTER TABLE "SellRequest" ADD COLUMN "guideActualCostCents"      INTEGER;
-- Criterio 155: lo que SALIÓ por SPEI = max(0, brutoAprobado − envío), sellado en la MISMA
-- transacción que `pagada`. Fuente de la CAJA de M7, distinta del acumulado de COMPROMISO (brutos).
ALTER TABLE "SellRequest" ADD COLUMN "payoutNetCents"            INTEGER;

-- Índices: sirven las CUATRO colas y las reglas del barrido sin barrer la tabla.
-- `SellRequest_status_idx` y `SellRequest_userId_idx` ya existen y NO se duplican.
CREATE INDEX "SellRequest_offerState_idx"                  ON "SellRequest"("offerState");
CREATE INDEX "SellRequest_status_offerAcceptDeadlineAt_idx" ON "SellRequest"("status", "offerAcceptDeadlineAt");
CREATE INDEX "SellRequest_status_shipDeadlineAt_idx"        ON "SellRequest"("status", "shipDeadlineAt");
CREATE INDEX "SellRequest_guideCancellationPendingAt_idx"   ON "SellRequest"("guideCancellationPendingAt");

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 7-bis — `SellRequestItem`: la oferta POR LÍNEA (cherry-pick + instrumentación §N.8).
-- ⚠️ SEC-A1: ninguno de estos montos viene del DTO del cliente.
-- ---------------------------------------------------------------------------------------------
-- `null` = línea previa al ciclo. Entra al `where` del reporte de brackets (§4.39c sitio 6).
ALTER TABLE "SellRequestItem" ADD COLUMN "offerDecision"          "BuyDecision";
-- FUENTE ÚNICA DEL COSTO DE ADQUISICIÓN. Congelado al ofertar; no se mueve JAMÁS (D2/D9).
ALTER TABLE "SellRequestItem" ADD COLUMN "offeredPriceCents"      INTEGER;
-- Lo que produjo `decideBuyLine` con la curva vigente AL OFERTAR: hace verificable el criterio
-- 148(b) sin leer la bitácora. `null` si la línea estaba en `precio_pendiente`.
ALTER TABLE "SellRequestItem" ADD COLUMN "offerDerivedPriceCents" INTEGER;
-- OBLIGATORIO ⇔ `offeredPriceCents <> offerDerivedPriceCents` (3–500). Criterio 148(a).
ALTER TABLE "SellRequestItem" ADD COLUMN "offerOverrideReason"    TEXT;
-- Enum EXISTENTE (`PriceBasis`), sin valores nuevos. Override / rescate ⇒ `override`.
ALTER TABLE "SellRequestItem" ADD COLUMN "offerPriceBasis"        "PriceBasis";
-- Instrumentación §N.8 DEL MOMENTO DE OFERTAR (no se reusa la del quote: son dos decisiones).
ALTER TABLE "SellRequestItem" ADD COLUMN "offerMarketMxnCents"    INTEGER;
ALTER TABLE "SellRequestItem" ADD COLUMN "offerMarketBracket"     "MarketBracket";

CREATE INDEX "SellRequestItem_offerDecision_idx" ON "SellRequestItem"("offerDecision");

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 8 — PASO 3 DEL DESPLIEGUE · `InventoryItem.cardProductId` (D7, §4.39d).
--
-- LA COLUMNA. Es el `tcgplayerProductId` (mismo eje que `SellRequestItem.cardProductId` de M-32 y
-- `PriceReference.cardProductId` de M-31), NO el UUID interno. `null` = pieza de set_base.
-- Sin esto §P.8 no se sostiene y con ella se cae D6: los conteos de la mesa de decisión mezclarían
-- una promo con la del set base, y «una sugerencia basada en un conteo que mezcla identidades es
-- PEOR que no dar sugerencia, porque el operador la creería».
-- ⚠️ Cura además una contradicción documental de TRES sitios que afirmaban esta propagación cuando
-- la columna NO EXISTÍA (schema.prisma, dto/buylist.dto.ts, ARCHITECTURE §4.29d). Registrada como
-- INV-D7 en `docs/TECH_DEBT.md`, cierre = M-46.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "InventoryItem" ADD COLUMN "cardProductId" INTEGER;

-- EL BACKFILL. ⚠️ **NO VIOLA EL CRITERIO 160, y la distinción es la que lo hace legal.** Ese
-- criterio prohíbe INFERIR identidad («ninguna migración puede adivinar si aquella pieza era la
-- promo o la del set base»). Aquí no se infiere NADA: se COPIA, a través de una FK **`@unique`**
-- (`InventoryItem.sourceSellRequestItemId`), el valor que **el propio vendedor eligió** al cotizar.
-- Copiar por una llave única NO es adivinar por heurística.
-- Toda pieza SIN `sourceSellRequestItemId` (alta manual, aportación, compra) queda en `null` y se
-- reclasifica A MANO desde M1 (`PATCH /admin/inventory/items/:id`), tal cual pide el criterio 160.
-- IDEMPOTENTE (`WHERE "cardProductId" IS NULL`): la segunda corrida toca 0 filas.
UPDATE "InventoryItem" AS inv
   SET "cardProductId" = sri."cardProductId"
  FROM "SellRequestItem" AS sri
 WHERE inv."sourceSellRequestItemId" = sri."id"
   AND inv."cardProductId" IS NULL
   AND sri."cardProductId" IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- BLOQUE 9 — PASO 4 DEL DESPLIEGUE · BACKFILL de `VariantPriceOverride.bountyTargetQty` (D35).
--
-- SUSTITUYE al «censo (no backfill)» de v1.51.1: entonces NO se rellenaba porque inventar la meta
-- era inventar intención de negocio (D32). **El humano fijó el número (2)**, que era justo lo que
-- faltaba ⇒ la objeción no se ignora, SE SATISFACE.
-- ⚠️ NO adivina POR FILA (nada de deducir la meta desde `bountyAcquiredQty`): el número es **2 para
-- todas** porque es la POLÍTICA que fijó el dueño, no una inferencia — criterio 160 respetado.
-- ⚠️ NO toca bounties APAGADOS ni COMPLETADOS: su meta no la consulta nadie, y reactivarlos pasa por
-- el `PUT`, que ya tiene el default.
-- SIN DDL (la columna sigue `Int?`, D32). IDEMPOTENTE: la segunda corrida toca 0 filas.
-- SEGURO ANTE ROLLBACK: el código previo lo lee como un bounty bien formado ⇒ la sugerencia frena
-- ANTES, nunca después. Es la ÚNICA dirección aceptable para un dato que queda huérfano.
-- ---------------------------------------------------------------------------------------------
UPDATE "VariantPriceOverride"
   SET "bountyTargetQty" = 2
 WHERE "bountyEnabled" = true
   AND "bountyCompletedAt" IS NULL
   AND "bountyTargetQty" IS NULL;

-- =============================================================================================
-- PASO 6 (OPERATIVO, HUMANO) — NO SE EJECUTA AQUÍ, Y NO ES OPCIONAL.
--
-- CENSO Y TRIAGE de las `cotizada` VIVAS antes de habilitar la regla 7 del barrido (BL-10 + BL-12,
-- son LAS MISMAS FILAS ⇒ un solo triage). Sin él, la primera corrida de la regla 7 manda un correo
-- REAL de «no procederemos» a cada vendedor con una solicitud vieja.
-- Por cada fila: (a) OFERTARLA —para lo cual el vendedor tiene que capturar su dirección; se le pide
-- por teléfono, D11/D12— o (b) DECLINARLA A MANO (`POST /admin/buylist/:id/decline`, D39).
-- ⚠️ NO se falsifica `createdAt`, NO se inventa una fecha ancla y NO se rellena ninguna dirección
-- por migración.
--
--   SELECT id, "userId", "createdAt", "quotedTotalCents",
--          ("pickupAddressSnapshot" IS NULL) AS "sinDireccion",
--          COALESCE("offerIssueClockStartedAt", "createdAt") AS "anclaDelReloj"
--     FROM "SellRequest"
--    WHERE status = 'cotizada' AND "closedAt" IS NULL
--    ORDER BY COALESCE("offerIssueClockStartedAt", "createdAt") ASC;
-- =============================================================================================
