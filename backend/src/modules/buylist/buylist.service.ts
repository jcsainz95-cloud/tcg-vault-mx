import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  BuyDecision,
  Card,
  Finish,
  MovementReason,
  Prisma,
  ProductType,
  RawCondition,
  Role,
  SellItemStatus,
  SellOfferState,
  SellRequestExpiryReason,
  SellRequestStatus,
  VariantPriceOverride,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { cardProductRefKey, PricingService } from '../pricing/pricing.service';
import { bountyRemainingQty } from '../pricing/bounty-progress';
import { toCardDTO } from '../catalog/catalog.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { UsersService, isValidClabe } from '../users/users.service';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe } from '../../common/crypto/pii-mask';
// v2.0 (P-48, §4.36): la CURVA de compra sustituye a la tabla por rareza/acabado. UN solo cuerpo de
// precedencia (`quoteAcquisitionFromCurve`) para quote, batch, createRequest y la vitrina de bounties.
import { CurvePriceResult, PriceBasis, quoteAcquisitionFromCurve } from '../../common/money';
import {
  MarketBracket as MarketBracketType,
  PendingReason,
  PricingCurve,
  isBountyEffective,
  marketBracketOf,
  resolvePendingReason,
} from '../../common/pricing-curve';
// v1.53 (§4.40.3.1, MONEY): la lista blanca del buylist es una DECISIÓN DE PRODUCTO declarada
// literal (`PROJECT.md` §E/§K LOCKED/criterio 61), NO un espejo de `PRODUCT_TYPE_VALUES`.
import { BUYLIST_ACCEPTED_PRODUCT_TYPES } from '../../common/business-rules';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import {
  offerTermsCopy,
  sellItemRejectedTemplate,
  sellOfferCancelledTemplate,
  sellOfferTemplate,
  sellRequestNotPursuedTemplate,
  buylistPortalUrl,
} from './buylist-mail.templates';
// v1.51 (D14, criterio 154): los plazos del ciclo son DÍAS HÁBILES `America/Mexico_City`. El front
// NO los recalcula: dos implementaciones de «día hábil» dicen fechas distintas.
import { addBusinessDays, businessDaysSince } from '../../common/business-days';
import {
  deriveRejectedReason,
  rejectDeadlines,
  SELL_REQUEST_LIVE_ADJUSTMENT_STATES,
  SELL_REQUEST_TERMINAL_STATES,
} from './buylist-reject.constants';
// v1.51 (M-46, §4.39c) — la fuente ÚNICA de los subconjuntos de `SellRequestStatus`.
import {
  isPayableSellRequest,
  isPayableSellRequestWithItems,
  pendingBuyDecisionItemIds,
  isTerminalSellRequestStatus,
  SELL_REQUEST_COMMITTED_STATES,
  SELL_REQUEST_IN_TRANSIT_STATES,
  SELL_REQUEST_LIVE_STATES,
  SELL_REQUEST_PAYABLE_STATES,
  SELL_REQUEST_VERIFYING_STATES,
} from '../../common/sell-request-states';
// v1.51 (M-46, §4.39c sitios 2+3) — el acumulado mensual de compromiso, en un solo cuerpo.
// v1.51.5 (§4.39i.4-bis) — `brutoConsumado`: CON QUÉ columna se mide el compromiso ya CONSUMADO.
// ⚠️ Son DOS cascadas distintas a propósito (razonadas juntas en `buylist-aml.ts`): no se unifican.
import {
  brutoConsumado,
  monthCommittedGrossCents,
  // ⚠️ v1.58 · §M5-A (BL-38): la MISMA ventana del acumulado, para saber si la fila propia está en
  // ella antes de sustituir su bruto. Se importa el ancla existente en vez de recalcularla: *dos
  // formas de derivar el inicio de mes son dos meses.*
  monthStartUtc,
  SellRequestReader,
} from '../../common/buylist-aml';
// P-30 H2 (§4.39e) — la llave canónica de variante. NO se interpola a mano.
// M-46 (§4.39g) — `variantPositionKey` = la canónica + la identidad de producto (D7). La usan las
// CUATRO fuentes de la posición de la mesa de decisión.
import { variantKey, variantPositionKey } from '../../common/variant-key';
// v1.54 (§4.40.4 · B-3): el input ESTRICTO de `buildGradeKey` — la unión discriminada que hace
// INEXPRESABLE una graduada sin empresa y sin grado. `gradeKeyInputFor` lo PRODUCE; nadie lo escribe
// a mano en este módulo.
import { GradeKeyInput } from '../pricing/pricing.types';
// v1.51 (M-46, §4.39f) — el ÚNICO dato que `buylist` lee de `inventory`, por PUERTO inyectado: los
// dos módulos viven en streams distintos y tienen que poder mergear por separado.
// ⚠️ Este puerto NO es best-effort como `MAIL_PORT`: su ausencia/fallo ⇒ `positionUnavailable`,
// JAMÁS un `0` (§4.39f).
import {
  INVENTORY_PUBLISH_PORT,
  InventoryPublishPort,
} from '../inventory/inventory-publish.port';
import {
  INVENTORY_POSITION_PORT,
  InventoryPositionPort,
  VariantPositionRef,
} from '../inventory/inventory-position.port';

/**
 * v2.0 (§4.36.6) — caps de la vitrina pública de bounties. `SHOWCASE` es el del contrato (50, sin
 * paginación: es una vitrina, no un listado). `CANDIDATE` acota la lectura ANTES del filtro por
 * efectividad, para que el endpoint anónimo no haga una lectura sin cota.
 */
const BOUNTY_SHOWCASE_CAP = 50;
const BOUNTY_CANDIDATE_CAP = 500;

/**
 * S49-M1 — **la proyección de `SellRequest` hacia una respuesta HTTP, en UN solo sitio.**
 *
 * ### El fallo que cierra
 * `SellRequest.clabeSnapshotEnc` es el blob AES-256-GCM de la CLABE del vendedor, y el contrato
 * (§M5) es literal: «**nunca** el snapshot cifrado». `getMine`/`adminGet` ya lo sacaban a mano con un
 * destructuring, pero **el mismo archivo** devolvía la fila CRUDA en cinco rutas más — `respond`
 * (decline/accept, **al propio cliente**), `receive`, `verify` (alcanzables por `vault_operator`) y
 * `pay-spei`. El descarte a mano funciona hasta que alguien escribe el siguiente `return`: la regla
 * vivía en la memoria del que edita, no en el código.
 *
 * ### Por qué lista BLANCA y no `delete`/rest-destructuring
 * Una lista negra sólo protege de las columnas que existían el día que se escribió: la próxima
 * columna sensible del schema **se auto-publica**. Con lista blanca, una columna nueva **no sale**
 * hasta que alguien la añada aquí a propósito — y ese alguien está mirando este comentario.
 * `reveal-clabe` sigue siendo el ÚNICO punto autorizado para la CLABE (con `@MoneyOut()` + auditoría).
 */
/**
 * ⚠️ v1.57 · **BL-25 aplicado a la firma: «SOLO DENTRO DE UNA TRANSACCIÓN», comprobado por el compilador.**
 *
 * Un parámetro tipado `Prisma.TransactionClient` **NO** rechaza a `PrismaService`: ese alias es
 * `Omit<PrismaClient, ITXClientDenyList>` y, en tipado estructural, un supertipo con miembros **de
 * más** sigue siendo asignable a un `Omit`. **Medido con una sonda antes de escribir esto**, no
 * deducido. El añadido `$transaction?: never` es lo que discrimina: el cliente transaccional real
 * **carece** de `$transaction` (satisface el opcional) y `PrismaService` **lo tiene** (falla).
 *
 * Se declara **local al módulo** y no en `common/buylist-aml.ts` a propósito: `SellRequestReader` es
 * **zona compartida** y la restricción solo la necesita quien escribe **dentro** de un boundary
 * atómico. Mismo criterio que ya usa `throwItemDecisionConflict` al ampliar el lector localmente.
 *
 * **No sustituye a `SellRequestReader`**: aquél expresa *«esto solo LEE `sellRequest`»* y lo usan
 * helpers que corren con y sin transacción (`throwTerminalConflict`, los acumulados AML). Éste
 * expresa *«esto ESCRIBE y necesita el row lock del llamador»*. Son dos afirmaciones distintas.
 */
export type TransactionOnlyClient = Prisma.TransactionClient & { $transaction?: never };

type SellRequestBaseRow = {
  id: string;
  userId: string;
  status: SellRequestStatus;
  quotedTotalCents: number;
  approvedTotalCents: number | null;
  ineRequired: boolean;
  ineProvided: boolean;
  speiReference: string | null;
  paidBy: string | null;
  paidAt: Date | null;
  createdAt: Date;
  receivedAt: Date | null;
  verifiedAt: Date | null;
  approvedAt: Date | null;
  adjustmentSentAt: Date | null;
  deadlineAt: Date | null;
  closedAt: Date | null;
};

/**
 * ⚠️ v1.51.20 · **BL-29** — **LAS COLUMNAS DEL CICLO, TODAS OPCIONALES EN EL TIPO Y A PROPÓSITO.**
 *
 * Son opcionales porque esta proyección la alimentan **filas de Prisma completas** en producción
 * pero **objetos parciales** en los tests unitarios que construyen el servicio a mano. Un tipo
 * exigente aquí no compraría ninguna seguridad —la fila real siempre las trae— y a cambio obligaría
 * a rellenar veinte `null` en cada mock. **Cada campo se emite con `?? null` explícito**, así que la
 * salida es la misma con fila real y con mock: `null`, nunca `undefined` silencioso.
 */
type SellRequestCycleRow = Partial<{
  offerState: SellOfferState | null;
  offerSentAt: Date | null;
  offerGrossCents: number | null;
  offerShippingFeeCents: number | null;
  offerNetCents: number | null;
  offerAcceptDeadlineAt: Date | null;
  acceptedAt: Date | null;
  guideSentAt: Date | null;
  shipDeadlineAt: Date | null;
  shipmentCarrier: string | null;
  shipmentTrackingNumber: string | null;
  sellerShippedDeclaredAt: Date | null;
  shipmentConfirmedAt: Date | null;
  guideCancellationPendingAt: Date | null;
  guideCancellationDoneAt: Date | null;
  guideActualCostCents: number | null;
  expiredReason: SellRequestExpiryReason | null;
  declinedBy: string | null;
  offerReissueCount: number | null;
  offerCancelledAt: Date | null;
  // ⚠️ v1.55 · D44 (§4.39s.1-bis) — la ÚNICA fuente de `lastOfferCancelledAt`. Ver
  // `lastOfferCancelledAtOf`: `offerCancelledAt` sigue en el tipo porque la proyección ADMIN la
  // publica, pero **la de cliente ya no la mira**.
  offerSentCancelledAt: Date | null;
  payoutNetCents: number | null;
  offerIssueClockStartedAt: Date | null;
}>;

/**
 * ⚠️⚠️ v1.61 · **§M5-V.5 — LAS TRES COLUMNAS DE LÍNEA QUE LA PROYECCIÓN ADMIN NECESITA, Y NINGUNA MÁS.**
 *
 * `isPayable` deja de ser una propiedad escalar de la fila: **V-b mira las líneas.** Este `select` es
 * **el mínimo** que contesta la pregunta —`id` (para `pendingDecisionItemIds`), `offerDecision` (el
 * filtro `buy`) y `itemStatus` (el veredicto)— y se declara **una vez** para que las seis relecturas
 * de mutación lo pidan igual. *Traer la línea entera aquí arrastraría el snapshot de precios a rutas
 * que solo necesitan contar.*
 */
const VERDICT_ITEM_SELECT = { id: true, offerDecision: true, itemStatus: true } as const;

/**
 * ⚠️ v1.61 · §M5-V — **el contrato de entrada de `adminSellRequestDTO`: la fila TRAE sus líneas.**
 *
 * Es **obligatorio en el tipo, no opcional**, y ésa es toda la gracia: con un `items?` cualquier
 * relectura futura que se olvidara de incluirlas obtendría **el predicado débil en silencio** —el
 * botón de pagar volviendo a mentirle al súper-admin, que es el defecto que §M5-P clasificó ALTA—.
 * Con el campo requerido, **el compilador para la mutación antes de que llegue a producción.**
 */
type VerdictItemRow = { id: string; offerDecision: BuyDecision | null; itemStatus: SellItemStatus };
type VerdictItemsPayload = Prisma.SellRequestGetPayload<object> & { items: VerdictItemRow[] };

/**
 * S49-M1 — **la proyección de `SellRequest` hacia una respuesta HTTP, en UN solo sitio.**
 *
 * ### El fallo que cierra
 * `SellRequest.clabeSnapshotEnc` es el blob AES-256-GCM de la CLABE del vendedor, y el contrato
 * (§M5) es literal: «**nunca** el snapshot cifrado». `getMine`/`adminGet` ya lo sacaban a mano con un
 * destructuring, pero **el mismo archivo** devolvía la fila CRUDA en cinco rutas más — `respond`
 * (decline/accept, **al propio cliente**), `receive`, `verify` (alcanzables por `vault_operator`) y
 * `pay-spei`. El descarte a mano funciona hasta que alguien escribe el siguiente `return`: la regla
 * vivía en la memoria del que edita, no en el código.
 *
 * ### Por qué lista BLANCA y no `delete`/rest-destructuring
 * Una lista negra sólo protege de las columnas que existían el día que se escribió: la próxima
 * columna sensible del schema **se auto-publica**. Con lista blanca, una columna nueva **no sale**
 * hasta que alguien la añada aquí a propósito — y ese alguien está mirando este comentario.
 * `reveal-clabe` sigue siendo el ÚNICO punto autorizado para la CLABE (con `@MoneyOut()` + auditoría).
 *
 * ### ⚠️⚠️ v1.51.20 · **BL-29** — ESTA ES LA BASE **COMPARTIDA**, Y AHÍ ESTÁ EL CAMBIO DE FORMA
 * Hasta v1.51.19 la proyección de cliente se construía como *«la de admin **MENOS N campos**»*, con
 * su propio docblock avisando de la trampa: **todo campo nuevo del lado admin se publicaba al
 * VENDEDOR salvo que alguien se acordara de restarlo**. Eso aguantó mientras la resta eran tres
 * campos. El ciclo de adquisición añade **veintiuno**, y entre ellos `offerState` y los **tres
 * montos congelados** — datos cuya divulgación el contrato prohíbe explícitamente (una oferta
 * `pending_authorization` le filtraría al vendedor **la existencia y el orden de magnitud de nuestro
 * tope interno**, §6). *Una resta de veinticuatro términos no es una lista blanca: es una lista
 * negra con otro nombre.*
 *
 * **Se invierte la herencia.** Ahora hay una **BASE** (esta función) que las dos audiencias
 * comparten, y el bloque del ciclo es una **ADICIÓN admin-only** que la proyección de cliente **no
 * puede heredar por accidente porque no la toca**. Es exactamente la disciplina que ya aplica
 * `itemDTO` con los cinco campos admin de `AdminSellItemDTO`: *la regla se hace cumplir por
 * AUSENCIA — no se leen de la fila, luego no pueden escaparse.*
 */
function toSellRequestBaseDTO(r: SellRequestBaseRow) {
  return {
    id: r.id,
    userId: r.userId,
    status: r.status,
    // ⚠️ v1.51 (M-46, §4.39c **SITIO 9**) — `isTerminal` DERIVADO SERVER-SIDE.
    //
    // Existe para **BORRAR la quinta copia del set terminal**, que vivía en el FRONTEND
    // (`M5View.tsx`, `REQUEST_TERMINAL`) — la única de las cinco fuera del backend, y la que hacía
    // que la UI ofreciera acciones sobre una solicitud que el backend rechaza.
    // **El frontend NO lo sustituye por otra constante propia: el servidor le dice.** *La copia se
    // cura eliminando la NECESIDAD de la copia, no moviéndola de archivo.*
    // Viaja en las DOS proyecciones (admin y cliente): las dos pantallas hacen la misma pregunta.
    isTerminal: isTerminalSellRequestStatus(r.status),
    quotedTotalCents: r.quotedTotalCents,
    approvedTotalCents: r.approvedTotalCents,
    ineRequired: r.ineRequired,
    ineProvided: r.ineProvided,
    speiReference: r.speiReference,
    paidAt: r.paidAt,
    createdAt: r.createdAt,
    receivedAt: r.receivedAt,
    verifiedAt: r.verifiedAt,
    approvedAt: r.approvedAt,
    adjustmentSentAt: r.adjustmentSentAt,
    deadlineAt: r.deadlineAt,
  };
}

/**
 * ⚠️⚠️ v1.55 · **D44** (§4.39(s.1-bis), contrato §6/D42) — **`lastOfferCancelledAt`: UN SOLO TÉRMINO
 * DE OFERTA, y cuelga del MISMO `if` que el correo 5 y el reloj.**
 * ```
 * lastOfferCancelledAt = offerSentCancelledAt  ⇔  closedAt             IS NULL      // sigue VIVA
 *                                              ∧  status               = 'cotizada' // volvió a la fila
 *                                              ∧  offerSentCancelledAt IS NOT NULL  // ⚠️ ÚNICO término
 *                                            ;  null en cualquier otro caso
 * ```
 *
 * ### El defecto que cierra (BL-31, medido por QA en la corrida conjunta del criterio 176(d))
 * La regla de v1.51.4 discriminaba por **`offerSentAt IS NOT NULL`** y pintaba **`offerCancelledAt`**.
 * Las dos columnas contestan **otra pregunta**:
 * - **`offerSentAt` es marca permanente de la SOLICITUD** (BL-28: ninguna ruta lo limpia jamás) ⇒
 *   contesta *«¿esta solicitud entró al ciclo?»*, no *«¿la oferta que acabo de cancelar llegó a sus
 *   manos?»*. A partir de la **segunda** cancelación la puerta se abre cuando no debe.
 * - **`offerCancelledAt` se SOBRESCRIBE** en las tres ramas (`sent`, `pending_authorization` y la
 *   anulación del barrido) ⇒ *«la cancelación que él vio»* **deja de existir en la fila**.
 *
 * Medido: con una oferta **enviada-y-cancelada** previa, cancelar después una
 * **`pending_authorization`** dejaba el **correo bien** (no sale) ✔, el **reloj bien** (no se mueve) ✔
 * y **el portal pintando la fecha de la segunda cancelación** ✘ — una fecha **que el vendedor nunca
 * supo** y que **contradice su correo 5**, que es justo lo que D42 vino a cerrar.
 *
 * ⛔ **Por qué NO bastaba `offerReissueCount > 0`** (el arreglo que parece obvio): en ese caso vale
 * **1**, así que la puerta se abre correctamente **y el valor seguiría siendo la fecha equivocada**.
 * *Arregla cuándo se pinta, no qué se pinta.*
 *
 * ⚠️ **`offerCancelledAt` NO se toca:** su escritura incondicional es **correcta para lo que esa
 * columna significa** (*el hecho de la cancelación*, admin-only, lo que leen la bitácora y M10).
 * *No se arregla el escritor: se arregla el lector, y se le da la columna que sí contesta su
 * pregunta.* El DTO nombra **lo que el vendedor lee**; la columna nombra **el hecho** — lo que
 * faltaba era una columna que nombrara **ese** hecho.
 *
 * ⚠️ **El DTO no cambia**: mismo nombre, mismo tipo, misma superficie (solo el detalle), misma frase
 * habilitada y la misma tabla de minimización. **Frontend: cero.**
 */
function lastOfferCancelledAtOf(r: SellRequestBaseRow & SellRequestCycleRow): Date | null {
  // ⚠️ El ÚNICO término de oferta. `offerSentCancelledAt` solo lo escribe la rama `sent` de
  // `offer/cancel`, en la misma transacción y con el mismo `now()` que el reloj, el conteo y el
  // correo 5 ⇒ si está poblado, **hubo un correo 5 con esta fecha exacta en la bandeja del vendedor**.
  const sentCancelledAt = r.offerSentCancelledAt ?? null;
  if (sentCancelledAt == null) return null;
  if (r.closedAt != null) return null;
  if (r.status !== 'cotizada') return null;
  return sentCancelledAt;
}

/**
 * ⚠️ v1.51.4 (§6) — **CIERRE `no_offer`: LOS MONTOS DEJAN DE VIAJAR AL CLIENTE.**
 * ```
 * status = 'expirada' ∧ expiredReason = 'no_offer'  ⇒  quotedTotalCents             = null
 *                                                      SellItemDTO.quotedPriceCents = null
 * ```
 * **Por qué la regla vive en el SERVIDOR y no en el pintado:** *«MX$1,200» junto a «no procedimos»
 * se lee como **una deuda***. El **correo 4 tiene prohibido cualquier monto** —incluido el total
 * cotizado— y §23.5a exige que **la pantalla diga exactamente lo mismo que el correo**. Si el DTO los
 * sigue mandando, el espejo se sostiene **solo con la disciplina del frontend**, en una pantalla de
 * dinero, para todo consumidor presente y futuro. *La regla se pone donde no se puede olvidar.*
 *
 * ⚠️ **Alcance EXACTO: solo `no_offer`.** En `rechazada` y en `expirada ∧ not_shipped` **sí hubo una
 * oferta vinculante** y el vendedor tiene derecho al registro de lo que se le ofreció. **La
 * diferencia no es el estado: es que en `no_offer` NUNCA HUBO OFERTA**, y la única cifra que quedaba
 * era una cotización que jamás fue vinculante. Aplica igual con `declinedBy` poblado o `null`
 * (barrido o «declinar ahora»): para el vendedor es **el mismo hecho** (D39).
 *
 * ⚠️ **Las líneas SE SIGUEN LISTANDO** — lo que desaparece es **el dinero**. *No se le borra su
 * solicitud: se le quita una cifra que ya no significa nada.*
 * ⚠️ **La proyección ADMIN no cambia ni una letra:** el snapshot histórico lo necesitan M7, M9 y los
 * filtros `minCents`/`maxCents` de §M5. **El dato no se pierde; deja de salir por una puerta donde
 * solo puede hacer daño.**
 */
function isNoOfferClosure(r: { status: SellRequestStatus } & SellRequestCycleRow): boolean {
  return r.status === 'expirada' && (r.expiredReason ?? null) === SellRequestExpiryReason.no_offer;
}

/**
 * S49-M1 — proyección de `SellRequest` hacia el **CLIENTE** (`POST /buylist/requests/:id/respond`,
 * `GET /buylist/requests/:id`). Es **la BASE compartida** más lo que el contrato declara para el
 * vendedor, y **nada más**.
 *
 * ### ⚠️ v1.51.20 · BL-29 — LA TRAMPA DE ESTA FUNCIÓN YA NO EXISTE, y conviene saber cuál era
 * Antes se construía como «la de admin **menos N**» y **heredaba por omisión**: todo campo nuevo del
 * lado admin se publicaba al vendedor salvo que alguien lo restara. Con el ciclo eso pasó de ser una
 * trampa a ser una **fuga garantizada** (veintiún campos, entre ellos `offerState` y los tres montos
 * congelados). **Ahora hereda de la BASE**, que no contiene ninguno: lo admin-only **no está aquí
 * porque no se lee**, que es la única forma de que no se escape.
 *
 * **Lo que el cliente SÍ gana respecto de la base, y por qué cada uno:**
 * - **`expiredReason`** (D33) — es **SU** solicitud y es **el mismo hecho que ya le dijo el correo**:
 *   ocultarlo obligaría al front a adivinar qué mensaje pintar, y adivinar aquí significa **acusar de
 *   incumplimiento a alguien a quien nunca le ofertamos**.
 * - **la redacción `no_offer`** de `quotedTotalCents` (arriba).
 *
 * **Lo que NO gana, y es el punto:** `closedAt` (interno, SEC-D2), `paidBy` (uuid del staff),
 * `isPayable` (le anticiparía un depósito que aún puede no ocurrir), **`pendingDecisionItemCount`**
 * (v1.61 §M5-V.5: es **nuestro** trabajo pendiente de verificación, no el suyo — la lista de
 * exclusión pasa de **TRES** a **CUATRO**), **`offerState`** y **toda cifra
 * congelada de la oferta** —que viaja **solo** por `offer` y **solo** con `offerState='sent'`—,
 * `offerReissueCount`/`offerReissueAlert` (miden NUESTRA conducta), `declinedBy`, `payoutNetCents` y
 * `offerIssueDeadlineAt` (un SLA nuestro que a propósito no se comunica).
 */
function toCustomerSellRequestDTO(r: SellRequestBaseRow & SellRequestCycleRow) {
  const redactMoney = isNoOfferClosure(r);
  return {
    ...toSellRequestBaseDTO(r),
    // ⚠️ La redacción va DESPUÉS del spread: es la última palabra sobre esta cifra.
    quotedTotalCents: redactMoney ? null : r.quotedTotalCents,
    // D33 — `no_offer` | `not_shipped`; `null` si no está `expirada`. El front lo mapea a dos copys
    // distintos, y ésa es justamente la razón de que viaje.
    expiredReason: r.expiredReason ?? null,
  };
}

/**
 * ⚠️ v1.51.16 · **BL-24** — **qué le falta a una proyección de oferta para ser MOSTRABLE.**
 *
 * Recibe **la proyección REAL** (la que produce `offerPublicDTO`, la misma que sirve
 * `GET /buylist/requests/:id`) y devuelve **los nombres de lo que falta**, vacío si está completa.
 * Separarla de quien la construye es lo que la vuelve **verificable rama por rama** sin fabricar una
 * solicitud imposible: *un candado sin test propio es un candado que alguien borra en el siguiente
 * refactor*. **No es una checklist paralela**: no sabe leer la fila, solo mira la proyección — si el
 * portal exige un campo nuevo mañana, entra por `offerPublicDTO` y esta función lo ve.
 *
 * Lo exigido es literal del contrato (§M5, v1.51.16): **`terms` íntegro** —los tres textos, no
 * vacíos— y **TODA línea con su `offerDecision`**. Más el desglose **no vacío**: una oferta sin
 * líneas es inmostrable por la misma R2 del portal.
 *
 * ⚠️ **No mira montos ni plazos**: `acceptDeadlineAt` es `null` en el camino `202` **por diseño**
 * (lo congela `authorize`), y confundir *«incompleto para MOSTRAR»* con *«incompleto para PAGAR»*
 * convertiría un backstop en una segunda regla de negocio.
 */
export function offerProjectionGaps(
  projected: {
    terms: { perLineConditionLabel: string; consequence: string; rule: string };
    lines: { id: string; offerDecision: BuyDecision | null }[];
  } | null,
): string[] {
  // `null` = la proyección no existe ⇒ el portal no pinta NADA. Es el hueco más grande posible.
  if (projected == null) return ['offer'];
  const missing: string[] = [];
  for (const key of ['perLineConditionLabel', 'consequence', 'rule'] as const) {
    const v = projected.terms?.[key];
    if (typeof v !== 'string' || v.trim().length === 0) missing.push(`terms.${key}`);
  }
  if (projected.lines.length === 0) missing.push('lines');
  // El itemId, no el índice: `details` tiene que ser accionable para quien vaya a arreglar el bug.
  for (const line of projected.lines) {
    if (line.offerDecision == null) missing.push(`lines[${line.id}].offerDecision`);
  }
  return missing;
}

/**
 * S49-R4 — proyección de `SellRequestItem` para las respuestas de back-office
 * (`PATCH /admin/buylist/items/:itemId/decision`). Hoy el modelo no tiene columnas sensibles, así
 * que esta lista NO cambia lo que se ve: fija la forma ACTUAL para que la siguiente columna del
 * schema **no se publique sola**. Misma doctrina de lista blanca que `toAdminSellRequestDTO`.
 * (Las relaciones del `include` —`sellRequest`, `card`— quedan fuera por construcción: eran las que
 * antes se descartaban a mano en la rama idempotente.)
 */
function toAdminSellItemRow(i: {
  id: string;
  sellRequestId: string;
  cardId: string;
  productType: ProductType;
  rawCondition: RawCondition | null;
  finish: Finish;
  cardProductId: number | null;
  rarity: string | null;
  marketMxnCents: number | null;
  priceBasis: PriceBasis | null;
  marketBracket: MarketBracketType | null;
  quotedPriceCents: number | null;
  approvedPriceCents: number | null;
  itemStatus: SellItemStatus;
  inventoryItemId: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
}) {
  return {
    id: i.id,
    sellRequestId: i.sellRequestId,
    cardId: i.cardId,
    productType: i.productType,
    rawCondition: i.rawCondition,
    finish: i.finish,
    cardProductId: i.cardProductId,
    rarity: i.rarity,
    marketMxnCents: i.marketMxnCents,
    priceBasis: i.priceBasis,
    marketBracket: i.marketBracket,
    quotedPriceCents: i.quotedPriceCents,
    approvedPriceCents: i.approvedPriceCents,
    itemStatus: i.itemStatus,
    inventoryItemId: i.inventoryItemId,
    rejectedAt: i.rejectedAt,
    rejectionReason: i.rejectionReason,
    // `category`/`ruleMode`/`ruleValue`/`ruleSource` son columnas LEGACY (v2.0 P-48: nada nuevo las
    // escribe). Se dejan FUERA a propósito: proyectar es también dejar de publicar lo muerto.
  };
}

interface QuoteItemInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  // v1.6-finish: acabado del item (default normal), validado contra card.availableFinishes.
  finish?: Finish;
  // v1.30 (§4.29): productId TCGplayer OPCIONAL (== CardProduct.tcgplayerProductId, el de
  // `separateProducts`). Presente ⇒ la línea es ESE producto separado (deck_exclusive/promo): whitelist
  // de acabado = CardProduct.finishes, referencia por su cardProductId. Ausente ⇒ set_base (v1.29).
  productId?: number;
  // v1.3.1: el cliente ya NO envía `category`. La regla se deriva server-side de Card.rarity.
}

/**
 * Payload de una cotización por-carta = shape de la respuesta de `POST /buylist/quote`
 * (BuylistQuotePayload del contrato §DTOs base). Lo reusan el quote por-carta y el batch.
 */
export interface BuylistQuotePayload {
  rarity: string | null;
  finish: Finish;
  // v1.30 (§4.29a): eco del productId cotizado (snapshot). Ausente ⇒ línea de set_base. La rareza sigue
  // saliendo de la carta; solo el ancla de la línea cambia.
  productId?: number;
  // v2.0 (P-48, §4.36.7a) — `appliedRule` RETIRADO (ya no hay `{mode,value}`: no hay reglas, hay CURVA).
  // Lo reemplaza `priceBasis`: QUÉ determinó el monto. Valores alcanzables en el eje de COMPRA:
  // "bounty" | "override" | "market" | "floor" | "pending". `precio_pendiente` ⇔ `priceBasis="pending"`.
  priceBasis: PriceBasis;
  quote: { status: 'cotizada' | 'precio_pendiente'; quotedPriceCents: number | null; currency: 'MXN' };
  referencePrice: { status: 'priced'; priceMxnCents: number } | { status: 'pending' };
  paymentNotice: 'PAY_AFTER_RECEIPT';
}

/**
 * v1.15 (§4.16b) — resultado por-ítem del batch quote (BuylistBatchQuoteResultDTO). Una carta
 * inválida NO tumba el lote: `ok:false` acarrea su propio error; el HTTP global es 200. `index` =
 * posición 0-based en `items[]` (llave de correlación robusta ante cardId+finish repetidos).
 */
export type BuylistBatchQuoteResult =
  | ({ index: number; cardId: string; ok: true } & BuylistQuotePayload)
  | {
      index: number;
      cardId: string;
      ok: false;
      // v1.30 (§4.29c): `code` gana PRODUCT_NOT_FOUND (productId inexistente) y PRODUCT_CARD_MISMATCH
      // (productId que no cuelga del cardId) — errores POR-ÍTEM (no tumban el lote).
      error: {
        // v1.53 (§4.40.3.3, MONEY): `code` gana BUYLIST_RAW_ONLY (`productType` != 'raw'). Es un error
        // POR-ÍTEM a propósito: como `@IsIn` del pipe tumbaría el request entero con 400 y se llevaría
        // las otras 49 líneas raw legítimas del grid.
        code:
          | 'NOT_FOUND'
          | 'FINISH_NOT_AVAILABLE'
          | 'PRODUCT_NOT_FOUND'
          | 'PRODUCT_CARD_MISMATCH'
          | 'BUYLIST_RAW_ONLY';
        message: string;
      };
    };

/**
 * v2.0 (P-48, §4.36.5b) — LA DECISIÓN DE COMPRA de UNA línea: acabado resuelto, de qué variante se
 * leyó el mercado, monto **y** veredicto. Es lo que devuelve el cuerpo único `decideBuyLine`, y lo
 * consumen por igual la cotización pública (que solo lo pinta) y `createRequest` (que además lo
 * congela y lo escala). Mismo invariante que el eje de venta: `pendingReason != null` ⇒
 * `quotedPriceCents === null` y `priceBasis === 'pending'`.
 */
interface BuyLineDecision {
  /** Acabado VALIDADO server-side (SEC-A1), ya sea contra `Card.availableFinishes` o `CardProduct.finishes`. */
  finish: Finish;
  gradeKey: string;
  /** Valor de MERCADO que entró al cálculo (de la variante correcta: set_base o producto separado). */
  referenceMxnCents: number | null;
  /** Resultado crudo de la precedencia de compra (bounty > override > curva > pendiente). */
  quote: CurvePriceResult;
  /** `null` = se cotiza. No-null = bloqueada: `no_market` o el guardarraíl `premium_at_floor`. */
  pendingReason: PendingReason | null;
  /** Monto FINAL a pagar por la línea; `null` ⇔ bloqueada. */
  quotedPriceCents: number | null;
  priceBasis: PriceBasis;
}

/**
 * v1.51 (M-46, §4.39e) — lo que el caller EN LOTE le ahorra a `decideBuyLine`: los dos lookups que
 * ese cuerpo haría por línea. Es un objeto (no dos parámetros sueltos) **a propósito**: su presencia
 * es la señal de «vengo del lote», y así `reference: { status: 'pending' }` —una referencia leída que
 * no existe— no se puede confundir con «no me la pasaron».
 */
interface BuyLinePrefetch {
  /** `CardProduct` ya resuelto (solo rama `productId`); `null` = no existe ⇒ `PRODUCT_NOT_FOUND`. */
  cardProduct: { id: string; cardId: string; finishes: Finish[] } | null;
  /** Referencia de mercado YA leída de la variante CORRECTA (set_base o producto separado). */
  reference: { status: string; referenceMxnCents?: number | null };
}

/**
 * v1.51 (M-46, §4.39g) — el desglose de la posición de UNA variante, llaveado por
 * `variantPositionKey`. **Los cuatro sumandos son campos propios y `total` es su suma**: el tipo
 * mismo impide colapsarlos en una cifra.
 */
type PositionMap = Map<
  string,
  { stock: number; verifying: number; inTransit: number; committed: number; total: number }
>;

/** v1.51 (M-46) — una línea de la mesa con su llave canónica y su llave de posición ya resueltas. */
interface DecisionLine {
  it: {
    id: string;
    cardId: string;
    card: Card;
    productType: ProductType;
    rawCondition: RawCondition | null;
    finish: Finish | null;
    quotedPriceCents: number | null;
  };
  /**
   * La llave canónica de la variante, ya resuelta (`variantKey` la consume tal cual).
   *
   * ⚠️ v1.53 (§4.40.4b · B-3) — **`gradeKey: null` ⇒ esta línea NO tiene llave de variante.** Solo
   * le pasa a las filas LEGACY no-raw (ver `gradeKeyInputFor`): `SellRequestItem` no guarda identidad de
   * slab, así que una línea `graded` histórica no puede producir una llave que diga la verdad. El
   * `null` es el mismo contrato que el de `tryBuildGradeKey`: **no hay clave ⇒ no hay override, no
   * hay referencia, no hay conteo** — nunca un default.
   */
  variant: { cardId: string; productType: ProductType; gradeKey: string | null; finish: Finish };
  cardProductId: number | null;
}


@Injectable()
export class BuylistService implements OnModuleInit {
  private readonly logger = new Logger(BuylistService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly pii: PiiCryptoService,
    // v1.18-buylist-rejects (§4.18c): puerto global MAIL_PORT para el correo de rechazo. El módulo
    // `mail` (otro stream) NO se toca: solo se inyecta su token @Global. @Optional para que los
    // tests unitarios legacy que construyen el servicio a mano no truenen; el envío es best-effort
    // (sin puerto ⇒ se loggea y sigue, misma semántica que un fallo de envío).
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
    // v1.51 (M-46, §4.39f): puerto de POSICIÓN de inventario (solo lectura, en lote). `@Optional`
    // por el MISMO motivo que `MAIL_PORT` —que los tests unitarios legacy que construyen el servicio
    // a mano no truenen— y por NINGÚN otro: ⚠️ este puerto **NO es best-effort**. Su ausencia en
    // runtime es un DEFECTO DE ARRANQUE (se grita en `onModuleInit`) y su fallo se traduce en
    // `position: null` + `positionUnavailable: true`, **jamás en un 0**.
    @Optional() @Inject(INVENTORY_POSITION_PORT) private readonly inventoryPosition?: InventoryPositionPort,
    // ⚠️ v1.51.18 (BL-25, §4.39m.5): puerto de **DISPARO** de publicación. `@Optional` por los DOS
    // motivos esta vez: los tests unitarios legacy **y** porque este puerto **SÍ es best-effort** —
    // *la conversión NO puede fallar porque la publicación falle*. Sin puerto se loggea y se sigue, y
    // la pieza **queda en `pending-publish`**, que es la red. (Contraste deliberado con el de
    // posición, justo encima, que **NO** es best-effort porque allí **no hay red**.)
    @Optional() @Inject(INVENTORY_PUBLISH_PORT) private readonly inventoryPublish?: InventoryPublishPort,
  ) {}

  /**
   * v1.51 (M-46, §4.39f) — el puerto de posición **no es best-effort**: si no está cableado, la mesa
   * de decisión no puede contar y el operador compra a ciegas. Se grita en el log de IZADO (no en
   * cada request) para que el defecto se vea al arrancar y no se descubra en una compra.
   */
  onModuleInit(): void {
    if (!this.inventoryPosition) {
      this.logger.error(
        'INVENTORY_POSITION_PORT NO está provisto: la mesa de decisión responderá ' +
          'positionUnavailable en todas las líneas. Es un defecto de arranque (ARCHITECTURE §4.39f), ' +
          'no un modo degradado aceptable.',
      );
    }
    // ⚠️ v1.54 · B-3 — **LO QUE EL NEGOCIO AUTORIZA, LA DERIVACIÓN TIENE QUE SABER LLAVEARLO.**
    // La lista (`BUYLIST_ACCEPTED_PRODUCT_TYPES`) y el `switch` (`gradeKeyInputFor`) son piezas
    // distintas a propósito —una decide qué se compra, el otro con qué identidad se llavea—, y esa
    // separación abre un desajuste posible: ensanchar la lista **sin** escribir la rama. Es un
    // defecto de DESPLIEGUE, no de petición, así que se avisa **al izar** y no en cada request; en
    // request lo ataja `purchasableGradeKeyInput` con un 500 de código estable.
    //
    // ⚠️⚠️ **v1.55 — QUÉ ES Y QUÉ NO ES ESTE BLOQUE.** Es un **AVISO**: hace `logger.error` y **la app
    // arranca igual**. **NO es el mecanismo que frena el desajuste**, y varios comentarios lo vendían
    // como si lo fuera. Lo que de verdad lo frena es
    // **`test/buylist.grade-key-derivation.spec.ts`**, que **ensancha la lista viva** (helper
    // `withAcceptedProductTypes`, `test/helpers/widen-list.ts`) e itera la lista real ⇒ el desajuste
    // **rompe el build**. Si alguien quiere que esto ABORTE el arranque, es una decisión de
    // disponibilidad (tirar el servicio entero por una línea que hoy no existe) y hay que tomarla a
    // propósito, no heredarla de un comentario optimista.
    const underivable = BUYLIST_ACCEPTED_PRODUCT_TYPES.filter(
      (t) => BuylistService.identityGradeKeyInput({ productType: t }) == null,
    );
    if (underivable.length > 0) {
      this.logger.error(
        `BUYLIST_ACCEPTED_PRODUCT_TYPES autoriza [${underivable.join(', ')}] pero ` +
          'BuylistService.identityGradeKeyInput no sabe derivar su identidad de variante. El cotizador ' +
          'RECHAZARÁ esas líneas (500 BUYLIST_LINE_NOT_KEYABLE) y la mesa las pintará SIN PRECIO / ' +
          'SIN CONTEO. Escribe la rama del switch (M-49) o quita el tipo de la lista: NO se resuelve ' +
          'llaveándolas como raw.',
      );
    }
  }

  /**
   * v1.6-finish: valida que el `finish` pedido esté entre los acabados disponibles de la carta
   * (SEC-A1). Fuera de la lista → 422 FINISH_NOT_AVAILABLE. Default `normal` si se omite.
   */
  private assertFinishAvailable(card: Card, finish?: Finish): Finish {
    const f = finish ?? 'normal';
    const available = (card.availableFinishes ?? ['normal']) as Finish[];
    if (!available.includes(f)) {
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        `Finish '${f}' is not available for this card`,
        { finish: f, availableFinishes: available },
      );
    }
    return f;
  }

  /**
   * v1.30 (§4.29b) — Resuelve el `CardProduct` de una línea con `productId` y lo valida money-safe:
   *  - inexistente ⇒ `PRODUCT_NOT_FOUND` (422 / batch ok:false).
   *  - existe pero NO cuelga del `cardId` enviado ⇒ `PRODUCT_CARD_MISMATCH` — RECHAZO validado, NUNCA
   *    fusión silenciosa con la carta de set (un productId de otra carta no se reinterpreta).
   * El productId de entrada es el TCGplayer `tcgplayerProductId` (== CardProductDTO.productId), NO el
   * UUID interno.
   */
  private async resolveCardProductForCard(
    cardId: string,
    productId: number,
  ): Promise<{ id: string; finishes: Finish[] }> {
    const cp = await this.pricing.findCardProductByTcgId(productId);
    if (!cp) {
      throw BusinessException.validation('PRODUCT_NOT_FOUND', 'Product not found', { productId });
    }
    if (cp.cardId !== cardId) {
      throw BusinessException.validation(
        'PRODUCT_CARD_MISMATCH',
        'Product does not belong to the given card',
        { productId, cardId },
      );
    }
    return { id: cp.id, finishes: (cp.finishes ?? []) as Finish[] };
  }

  /**
   * v1.51 (M-46, §4.39e) — MISMAS dos guardas que `resolveCardProductForCard`, sobre una fila que el
   * LOTE ya trajo. Se repiten en vez de darse por buenas porque son las que impiden la **fusión
   * silenciosa de identidades**: un `productId` que no existe o que cuelga de OTRA carta no se
   * reinterpreta como la carta de set — se rechaza, igual que en la vía single.
   */
  private assertPrefetchedCardProduct(
    cardId: string,
    productId: number,
    cp: { id: string; cardId: string; finishes: Finish[] } | null,
  ): { id: string; finishes: Finish[] } {
    if (!cp) {
      throw BusinessException.validation('PRODUCT_NOT_FOUND', 'Product not found', { productId });
    }
    if (cp.cardId !== cardId) {
      throw BusinessException.validation(
        'PRODUCT_CARD_MISMATCH',
        'Product does not belong to the given card',
        { productId, cardId },
      );
    }
    return { id: cp.id, finishes: cp.finishes };
  }

  /**
   * v1.30 (§4.29b) — Whitelist de acabado de un producto SEPARADO (contra `CardProduct.finishes`, NO
   * `Card.availableFinishes`). Si se OMITE `finish` y el producto tiene un solo acabado ⇒ se default-ea;
   * con >1 acabado ⇒ `finish` es OBLIGATORIO. Falta o fuera de la lista ⇒ `FINISH_NOT_AVAILABLE`. El
   * producto ya define su(s) acabado(s); el cliente no puede inventar uno.
   */
  private assertFinishForProduct(finishes: Finish[], finish?: Finish): Finish {
    if (finish == null) {
      if (finishes.length === 1) return finishes[0];
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        'Finish is required for this product',
        { finish: null, availableFinishes: finishes },
      );
    }
    if (!finishes.includes(finish)) {
      throw BusinessException.validation(
        'FINISH_NOT_AVAILABLE',
        `Finish '${finish}' is not available for this product`,
        { finish, availableFinishes: finishes },
      );
    }
    return finish;
  }

  /**
   * v1.28 (P-18/P-22, §4.26b) — clave del control por variante (M-30) de un ítem de cotización.
   * MISMA derivación que la referencia (`gradeKeyFor` + finish default `normal`): paridad exacta
   * con la clave única de la tabla. Se usa para leer los overrides EN LOTE (una query por request,
   * patrón `getReferencesBatch` — sin N+1).
   */
  private overrideKeyOf(it: QuoteItemInput): {
    cardId: string;
    productType: ProductType;
    gradeKey: string;
    finish: Finish;
  } {
    return {
      cardId: it.cardId,
      productType: it.productType,
      gradeKey: this.pricing.gradeKeyFor(this.purchasableGradeKeyInput(it)),
      finish: it.finish ?? 'normal',
    };
  }

  /**
   * v1.53 (§4.40.3, **MONEY**) — **la guarda RAW-ONLY del buylist, server-side.**
   *
   * `PROJECT.md` §E («Buylist — compra de **raw** a usuarios»), §K **LOCKED** («el cotizador y el
   * pipeline de buylist siguen siendo **solo para raw**») y el **criterio 61** («no existe flujo de
   * buylist de sellado, **ni cotizador ni pipeline**»). La lista blanca es literal y vive en
   * `common/business-rules.ts`; aquí sólo se aplica.
   *
   * **Por qué está en el SERVICIO y no en un `@IsIn` del DTO** (§4.40.3.3): el `ValidationPipe`
   * devuelve **400 para el request entero**, y en `/quote/batch` eso se llevaría por delante **las
   * otras 49 líneas raw legítimas** del grid. Aquí es un `422` de negocio que el batch **degrada
   * por-ítem** (`ok:false`, HTTP 200) y que en `/quote` y `/requests` sí tumba el request.
   *
   * **Por qué está en el servidor y no en el front:** el selector del cotizador es cosmética; el
   * endpoint es público y anónimo, y un `curl` lo esquiva (SEC-A1).
   *
   * @param index posición 0-based en `items[]`; sólo en las rutas con lote, para que el front señale
   *              la línea (`details.index`).
   */
  private assertBuylistProductType(productType: ProductType, index?: number): void {
    if (BUYLIST_ACCEPTED_PRODUCT_TYPES.includes(productType)) return;
    throw BusinessException.validation(
      'BUYLIST_RAW_ONLY',
      `Buylist accepts raw cards only; productType '${productType}' is not purchasable`,
      { ...(index != null ? { index } : {}), productType },
    );
  }

  /**
   * v1.53 (§4.40.3 + §4.40.4, **MONEY**) — puente entre la línea de buylist y el input ESTRICTO de
   * `buildGradeKey`, **en el camino del DINERO** (cotizador, batch y creación de solicitud).
   *
   * Esto es exactamente lo que antes tapaba el default: con `productType='graded'` la clave salía
   * `graded:PSA:10` —**el grado más caro**— sobre una carta cuyo grado nunca se preguntó.
   *
   * ### ⚠️ v1.54 · B-3 — dos pasos, y el segundo ya no es un literal
   * 1. **La lista AUTORIZA** (`assertBuylistProductType` ⇒ `422 BUYLIST_RAW_ONLY`): decisión de
   *    producto, `PROJECT.md` §E/§K/criterio 61. Se re-aplica aquí a propósito —defensa en
   *    profundidad— para que ninguna ruta futura llegue al constructor de claves sin pasar por ella.
   * 2. **El `switch` DERIVA** (`gradeKeyInputFor`): antes este retorno era el literal
   *    `{ productType: 'raw', … }`, o sea la derivación **clavada** aunque el paso 1 se ensanchara.
   *
   * **Y aquí el `null` NO degrada: LANZA.** Es la otra mitad de *«el dinero lanza, la lectura
   * degrada»* (§4.40.4b): la lectura puede decir *«no sé contar esta línea»* y seguir pintando; una
   * cotización **no puede** decir *«no sé qué es»* y aun así poner un número. El caso solo existe si
   * alguien ensancha la lista de negocio **sin** escribir la derivación, así que es un **defecto
   * NUESTRO**, no del actor: `500` con código estable, nunca un `422` que le pida al cliente arreglar
   * nuestro bug.
   *
   * ### ⚠️ v1.55 — ATRIBUCIÓN CORREGIDA: quién detecta el desajuste, de verdad
   * Este docblock decía que la contradicción *«se grita al arrancar (`onModuleInit`)»* y se leía como
   * si eso la **atajara**. **No la ataja: `onModuleInit` hace `logger.error` y sigue arrancando** — un
   * despliegue con la lista ensanchada y la rama sin escribir **sube igual, en verde**, y el aviso
   * queda en una línea de log que nadie mira.
   * - **El detector REAL es el test**: `test/buylist.grade-key-derivation.spec.ts` **ensancha la lista
   *   de verdad** (con el helper `withAcceptedProductTypes`, `test/helpers/widen-list.ts`) e itera la
   *   lista viva ⇒ el desajuste **rompe el build antes del despliegue**, que es donde tiene arreglo.
   * - **`onModuleInit` es un AVISO en runtime**, valioso pero de segunda línea: cubre el caso de que
   *   alguien despliegue saltándose CI.
   * - **Y este `throw` es el atajo por-petición**: lo único que impide que una línea sin identidad
   *   derivable acabe con un precio. *Tres capas, y solo dos frenan algo.*
   */
  private purchasableGradeKeyInput(it: {
    productType: ProductType;
    rawCondition?: RawCondition | null;
  }): GradeKeyInput {
    this.assertBuylistProductType(it.productType); // PREGUNTA 1 (política) ⇒ 422 BUYLIST_RAW_ONLY
    const input = BuylistService.identityGradeKeyInput(it); // PREGUNTA 2 (técnica) ⇒ 500 si no
    if (input == null) {
      this.logger.error(
        `buylist: '${it.productType}' está en BUYLIST_ACCEPTED_PRODUCT_TYPES pero ` +
          'identityGradeKeyInput no sabe derivar su identidad. La cotización NO se emite: sin llave, ' +
          'el monto sería el de OTRA variante. Se arregla escribiendo la rama del switch (M-49 para ' +
          'graded), no relajando esto.',
      );
      throw BusinessException.internal(
        'BUYLIST_LINE_NOT_KEYABLE',
        'This buylist line cannot be priced: its variant identity is not derivable',
        { productType: it.productType },
      );
    }
    return input;
  }

  /** Cotizador público (stateless). API_CONTRACT §6 (v1.6-finish: por RAREZA + ACABADO). */
  async publicQuote(
    cardId: string,
    productType: ProductType,
    rawCondition?: RawCondition,
    finish?: Finish,
    // v1.30 (§4.29): productId TCGplayer OPCIONAL. Presente ⇒ la línea es ESE CardProduct separado.
    productId?: number,
  ): Promise<BuylistQuotePayload> {
    // v1.53 (§4.40.3, MONEY) — RAW-ONLY, y ANTES de tocar nada: `overrideKeyOf` ya construye la clave
    // de precio, y con `graded` esa clave era `graded:PSA:10` (el grado MÁS CARO). 422 de request
    // completo: en el quote por-carta no hay nada que degradar por-ítem.
    this.assertBuylistProductType(productType);
    // v2.0 (P-48, §4.36.2): iza la CURVA UNA vez y delega en el núcleo compartido (el mismo del batch).
    const curve = await this.pricing.loadPricingCurve();
    // v1.28 (P-18): control por variante (bounty/override pisan la regla, §4.26b). Un solo ítem ⇒
    // lectura single (misma vía batch de una clave). v1.30: el override (M-30, clave sin cardProductId)
    // aplica SOLO a la línea de set_base; en la rama `productId` se IGNORA (ver quoteCardForFinish).
    const key = this.overrideKeyOf({ cardId, productType, rawCondition, finish });
    const override = await this.pricing.getVariantOverride(
      key.cardId,
      key.productType,
      key.gradeKey,
      key.finish,
    );
    return this.quoteCardForFinish(cardId, productType, rawCondition, finish, curve, override, productId);
  }

  /**
   * v1.15 (§4.16b) — cotización en LOTE (`POST /buylist/quote/batch`, public, READ-ONLY). Mata el
   * fan-out FE-12: cotiza N cartas en 1 request. Es un `map` de la MISMA lógica por-carta
   * (`quoteCardForFinish`) compartiendo la curva izada UNA vez (`PricingService.loadPricingCurve()`,
   * v2.0 §4.36.2) → misma matemática y mismos guardarraíles (gate premium-en-el-piso, referencia por
   * acabado, FX ya bakeada en PriceReference). SEC-A1 intacto.
   *
   * ERRORES POR-ÍTEM: una carta inválida (NOT_FOUND / FINISH_NOT_AVAILABLE) NO tumba las demás — su
   * resultado sale `ok:false` con el `error` de ESE ítem; el HTTP global es 200. Correlación por
   * `index` + eco de `cardId`. READ-ONLY estricto: NO crea solicitud, NO mueve dinero, NO persiste y
   * NO escala a PendingPriceEntry (endpoint anónimo; la escalada sigue solo en `createRequest`).
   */
  async batchQuote(items: QuoteItemInput[]): Promise<{ results: BuylistBatchQuoteResult[] }> {
    const curve = await this.pricing.loadPricingCurve();
    // v1.28 (P-18): overrides por variante leídos EN LOTE (UNA query por request, §4.26b — sin N+1).
    // v1.53 (§4.40.3.3, MONEY): el lote se arma SOLO con las líneas aceptadas. Un ítem `graded`/`sealed`
    // no tiene clave de variante que buscar (su gradeKey no existe sin identidad de grado) y, sobre
    // todo, no puede reventar aquí: eso tumbaría el request entero y con él las demás líneas raw.
    const overrides = await this.pricing.getVariantOverridesBatch(
      items
        .filter((it) => BUYLIST_ACCEPTED_PRODUCT_TYPES.includes(it.productType))
        .map((it) => this.overrideKeyOf(it)),
    );
    const results: BuylistBatchQuoteResult[] = [];
    for (let index = 0; index < items.length; index++) {
      const it = items[index];
      try {
        // v1.53 (§4.40.3.3, MONEY): DENTRO del try ⇒ degrada a `ok:false` POR-ÍTEM. Las otras 49
        // líneas raw del grid se cotizan normalmente y el HTTP global sigue siendo 200.
        this.assertBuylistProductType(it.productType, index);
        const k = this.overrideKeyOf(it);
        const payload = await this.quoteCardForFinish(
          it.cardId,
          it.productType,
          it.rawCondition,
          it.finish,
          curve,
          // P-30 H2 (§4.39e): `variantKey()`, NO una interpolación a mano. Ver la nota del import.
          overrides.get(variantKey(k)) ?? null,
          it.productId,
        );
        results.push({ index, cardId: it.cardId, ok: true, ...payload });
      } catch (e) {
        // Solo los errores por-ítem esperados (los mismos que el endpoint por-carta devolvería como
        // 404/422) se degradan a `ok:false`; cualquier otro error (p. ej. fallo de infra) se propaga.
        if (
          e instanceof BusinessException &&
          (e.code === 'NOT_FOUND' ||
            e.code === 'FINISH_NOT_AVAILABLE' ||
            // v1.30 (§4.29c): errores del producto separado también degradan a ok:false por-ítem.
            e.code === 'PRODUCT_NOT_FOUND' ||
            e.code === 'PRODUCT_CARD_MISMATCH' ||
            // v1.53 (§4.40.3.3, MONEY): la guarda raw-only entra al allowlist POR-ÍTEM. Es la razón
            // por la que es un 422 de negocio y no el 400 de un `@IsIn`.
            e.code === 'BUYLIST_RAW_ONLY')
        ) {
          const body = e.getResponse() as { message?: string };
          results.push({
            index,
            cardId: it.cardId,
            ok: false,
            error: {
              code: e.code as
                | 'NOT_FOUND'
                | 'FINISH_NOT_AVAILABLE'
                | 'PRODUCT_NOT_FOUND'
                | 'PRODUCT_CARD_MISMATCH'
                | 'BUYLIST_RAW_ONLY',
              message: typeof body?.message === 'string' ? body.message : e.code,
            },
          });
        } else {
          throw e;
        }
      }
    }
    return { results };
  }

  /**
   * Núcleo de cotización por-carta+acabado (READ-ONLY). Lo comparten `publicQuote` (por-carta) y
   * `batchQuote` (lote) — recibe `rules`/`fallbackPct` ya cargados para no re-leer config por ítem.
   * SEC-A1: rareza + acabado se derivan SIEMPRE server-side (Card.rarity + finish validado contra
   * card.availableFinishes), nunca del cliente. Lanza `NOT_FOUND` (carta inexistente) o
   * `FINISH_NOT_AVAILABLE` (acabado fuera de availableFinishes) — el batch los captura por-ítem.
   *
   * v1.12-catalog-pricing (§4.13b) — READ-ONLY: NO escala a `PendingPriceEntry` aunque el resultado
   * sea `precio_pendiente`. Con el catálogo ya priceado (§4.13a) este `getReference` casi siempre
   * encuentra precio; un endpoint público/anónimo NO debe escribir en la cola del dueño (superficie
   * de abuso). La escalada queda SOLO en el flujo autenticado `createRequest`.
   */
  private async quoteCardForFinish(
    cardId: string,
    productType: ProductType,
    rawCondition: RawCondition | undefined,
    finish: Finish | undefined,
    // v2.0 (P-48, §4.36.2): la CURVA izada por el caller (una lectura por request, BE-25).
    curve: PricingCurve,
    // v1.28 (P-18/P-22, §4.26b): fila M-30 de la variante, pre-cargada por el caller (single o en
    // lote). `null`/omitida = sin control ⇒ solo la curva.
    override?: VariantPriceOverride | null,
    // v1.30 (§4.29): productId TCGplayer. Presente ⇒ la línea es ESE CardProduct separado.
    productId?: number,
  ): Promise<BuylistQuotePayload> {
    const card = await this.prisma.card.findUnique({ where: { id: cardId } });
    if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
    // TODO el dinero de esta respuesta sale del cuerpo compartido; aquí solo se arma el DTO.
    const line = await this.decideBuyLine({ card, productType, rawCondition, finish, curve, override, productId });
    return this.toQuotePayload(card, line, productId);
  }

  /**
   * v2.0 (P-48, §4.36.5b / gate techlead) — **CUERPO ÚNICO de la DECISIÓN DE COMPRA de UNA línea**:
   * resuelve el acabado válido, DE QUÉ variante se lee el mercado, el override EFECTIVO, aplica la
   * precedencia de compra y devuelve el veredicto del guardarraíl. Lo consumen las TRES superficies:
   * `POST /buylist/quote` y `/quote/batch` (vía `quoteCardForFinish`) y `POST /buylist/requests`
   * (`createRequest`).
   *
   * **Por qué un solo cuerpo y no dos que hoy coinciden.** `createRequest` reimplementaba esta misma
   * secuencia —rama `productId`, rama `set_base`, `quoteAcquisitionFromCurve`, `resolvePendingReason`
   * y la derivación de `quotedPriceCents`/`priceBasis`— y aunque los dos cuerpos daban EXACTAMENTE el
   * mismo número, la spec exige uno solo por una razón concreta: la cotización pública y la solicitud
   * que se paga no pueden divergir. **El vendedor ve un número y firma otro.** Cualquier matiz futuro
   * (un tope, una condición, un segundo control por variante) entraría en uno de los dos y la
   * divergencia solo se descubriría por una queja. Lo ÚNICO propio de `createRequest` es lo que no es
   * decisión de precio: la instrumentación que se congela y el `settlePendingForVariant`.
   *
   * `card` llega YA cargada (single o en lote) para que el caller controle el N+1.
   * READ-ONLY: no escribe en la cola ni en ningún lado — quien escala sigue siendo `createRequest`.
   */
  private async decideBuyLine(input: {
    card: Card;
    productType: ProductType;
    rawCondition?: RawCondition;
    finish?: Finish;
    curve: PricingCurve;
    override?: VariantPriceOverride | null;
    productId?: number;
    /**
     * v1.51 (M-46, §4.39e) — **LOTE.** Los DOS lookups que este cuerpo haría POR LÍNEA (resolver el
     * `CardProduct` y leer su referencia de mercado), ya resueltos por el caller en UNA query para
     * las N líneas. **No cambia ni una decisión de dinero**: es exactamente el mismo dato, leído
     * antes — la secuencia curva/override/bounty/pendiente sigue viviendo aquí y solo aquí.
     * Ausente (`undefined`) ⇒ este cuerpo resuelve por sí mismo, comportamiento previo INTACTO.
     */
    prefetched?: BuyLinePrefetch;
  }): Promise<BuyLineDecision> {
    const { card, productType, rawCondition, finish, curve, productId, prefetched } = input;
    // v1.53 (§4.40.3/§4.40.4, MONEY): cuerpo COMPARTIDO por las tres superficies ⇒ la guarda raw-only
    // se re-aplica aquí dentro. Antes, con `graded`, esta línea producía `graded:PSA:10` — el grado
    // más caro — para una carta cuyo grado nunca se preguntó.
    const gradeKey = this.pricing.gradeKeyFor(this.purchasableGradeKeyInput({ productType, rawCondition }));

    let f: Finish;
    let referenceMxnCents: number | null;
    let effectiveOverride: VariantPriceOverride | null | undefined = input.override;
    if (productId != null) {
      // v1.30 (§4.29b): rama PRODUCTO SEPARADO. La identidad de la línea es ESE CardProduct: whitelist de
      // acabado = CardProduct.finishes (NO Card.availableFinishes); la referencia se lee filtrada por su
      // cardProductId (precio propio del producto). El override M-30 (clave sin cardProductId) NO aplica
      // aquí: mapea a la variante set_base, no a este producto — aplicarlo sería fusión de precios
      // (money-safe: se IGNORA). La rareza NO cambia de fuente (sale de la carta).
      // M-46: en lote, el `CardProduct` y su referencia llegan YA resueltos (mismas validaciones, mismos
      // errores: el lote los aplicó al resolver).
      const cp = prefetched
        ? this.assertPrefetchedCardProduct(card.id, productId, prefetched.cardProduct)
        : await this.resolveCardProductForCard(card.id, productId);
      f = this.assertFinishForProduct(cp.finishes, finish);
      const ref = prefetched
        ? prefetched.reference
        : await this.pricing.getReferenceByCardProduct(cp.id, productType, gradeKey, f);
      referenceMxnCents =
        ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
      effectiveOverride = null;
    } else {
      // Rama SET_BASE (comportamiento v1.29 idéntico).
      // SEC-A1: el acabado se valida contra los acabados REALES de la carta antes de cotizar.
      f = this.assertFinishAvailable(card, finish);
      // v1.6-finish: la referencia es la del ACABADO cotizado.
      const ref = prefetched
        ? prefetched.reference
        : await this.pricing.getReference(card.id, productType, gradeKey, f);
      referenceMxnCents =
        ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
    }
    // v2.0 (P-48, §4.36.1): el monto sale SOLO del valor de mercado — NO de la rareza ni del acabado
    // (criterio 84). El acabado ya hizo su único trabajo: elegir DE QUÉ VARIANTE se lee el mercado.
    // Precedencia NORMATIVA bounty VÁLIDO > override > curva > pendiente (un solo cuerpo, money.ts);
    // el bounty se revalida AQUÍ contra la curva vigente, no solo al crearlo (§4.36.6).
    // SEC-A1: mercado y acabado derivados server-side, jamás del DTO del cliente.
    const quote = quoteAcquisitionFromCurve(referenceMxnCents, curve, effectiveOverride);
    // v2.0 (P-48, §4.36.5b) — GUARDARRAÍL del eje de COMPRA: una rareza PREMIUM que aterriza en el BIN
    // NO se cotiza. Pagar de menos es la MISMA pérdida irreversible que vender de menos (§N.0), y que
    // una chase resuelva al bin solo puede significar que su dato de mercado está mal. NO dispara con
    // override ni bounty (decisiones deliberadas del admin).
    const pendingReason = resolvePendingReason(quote.basis, card.rarityCanonical ?? card.rarity);
    const quotedPriceCents = pendingReason == null ? quote.priceCents : null;
    return {
      finish: f,
      gradeKey,
      referenceMxnCents,
      quote,
      pendingReason,
      quotedPriceCents,
      // MISMO invariante que el eje de venta: monto en `null` ⇔ basis `pending`.
      priceBasis: pendingReason == null ? quote.basis : 'pending',
    };
  }

  /**
   * DTO de cotización a partir de la decisión compartida. Presentación pura: NO decide dinero.
   * READ-ONLY (doctrina v1.12 de endpoints anónimos): reporta `precio_pendiente` SIN escribir en la
   * cola; quien escala sigue siendo `createRequest`.
   */
  private toQuotePayload(card: Card, line: BuyLineDecision, productId?: number): BuylistQuotePayload {
    return {
      // `rarity` se conserva como dato INFORMATIVO/de display del catálogo: el monto NO depende de ella.
      rarity: card.rarity ?? null,
      finish: line.finish,
      // v1.30: eco del productId cotizado (ausente en la rama set_base).
      ...(productId != null ? { productId } : {}),
      priceBasis: line.priceBasis,
      quote: {
        status: line.quotedPriceCents != null ? ('cotizada' as const) : ('precio_pendiente' as const),
        quotedPriceCents: line.quotedPriceCents,
        currency: 'MXN' as const,
      },
      referencePrice:
        line.referenceMxnCents != null
          ? { status: 'priced' as const, priceMxnCents: line.referenceMxnCents }
          : { status: 'pending' as const },
      paymentNotice: 'PAY_AFTER_RECEIPT' as const,
    };
  }

  // v2.0 (P-48, §4.36.2) — `buylistRules()` RETIRADO. Era el segundo lector de configuración de dinero
  // del backend (no delegaba en `PricingService`), así que compra y venta podían ver tablas distintas.
  // Ahora hay UN SOLO lector de la curva en todo el backend: `PricingService.loadPricingCurve()`.

  /**
   * v1.51.4 (D43, API_CONTRACT §6 / ARCHITECTURE §4.39r) — **`GET /buylist/quote-policy`: LA ÚNICA
   * CIFRA DE DINERO QUE EL COTIZADOR PÚBLICO CONOCE.**
   *
   * READ-ONLY ESTRICTO (doctrina v1.12 de endpoints anónimos: **no persiste, no escala pendientes, no
   * mueve dinero**). Sin query params, sin body, sin variante autenticada.
   *
   * ### Por qué existe — el criterio 132 son DOS frentes y el `422` solo cubre uno
   * El criterio **132(a)** exige que *«desde el cotizador, el botón **no procede** y la pantalla dice
   * **cuánto falta** («te faltan $120», **con el número correcto**)»*. El **132(b)** —el
   * `422 BUYLIST_MINIMUM_NOT_MET` de `POST /buylist/requests`— **no lo cubre**: si el botón no
   * procede **no se manda nada al servidor** y el `422` **nunca se dispara**, así que no puede
   * alimentar esa pantalla. Y **hardcodear el mínimo está prohibido** (R4 de `DESIGN_SYSTEM.md` §23:
   * *una constante en el front se desincroniza en silencio la primera vez que alguien mueve el
   * dial*) **y lo desmiente el propio criterio**, que pide *«con el número correcto»*.
   * ⇒ Hace falta **superficie pública**, y de **un solo dato**.
   *
   * ### ⚠️ LO QUE ESTE MÉTODO NO DEVUELVE, Y ES EL PUNTO ENTERO DEL DISEÑO
   * **`buylistShippingFeeCents` NO viaja.** No es que el front «no deba pintarlo»: **no lo recibe**.
   * Bajo D43 el cotizador dice el envío **en palabras** —*«nosotros nos encargamos de la guía de envío
   * y su costo se descuenta del pago»*—, así que **ninguna pantalla pública lo consume**. *Un valor
   * que no llega al navegador no se puede pintar por accidente* ⇒ **D43 deja de depender de la
   * disciplina del frontend y pasa a ser una propiedad del contrato.** La tarifa se comunica **con
   * cifra** en el correo de oferta y en `offer.terms`, con `offerShippingFeeCents` **congelado**.
   *
   * **La lista de exclusiones es CERRADA (§4.39r.2) y `seguridad` debe tratar cualquier dial
   * adicional en esta ruta como un DEFECTO, no como una mejora.** Resultado: **1 de 10 diales**.
   * - ⛔ Los **tres plazos** (1/2/4): la pantalla no habla de plazos, y los diales 1 y 2 **se
   *   congelan por solicitud** (criterio 157) ⇒ el dial vigente puede diferir del que un vendedor
   *   tiene **por escrito**; el 4 es un **SLA nuestro** que a propósito no se comunica.
   * - ⛔ `buylistOperatorOfferCapCents` (5): dice **a partir de qué monto interviene una persona** ⇒
   *   invita a armar la solicitud **justo por debajo** de la revisión humana.
   * - ⛔ `buylistVariantPositionCap` (6): dice **cuándo dejamos de comprar** una variante.
   * - ⛔ `buylistShipmentConfirmAlertBusinessDays` (8): reloj de **nuestra** cola interna.
   * - ⛔ `buylistMinimumOfferNetCents` (9): se evalúa sobre el **neto OFERTADO** (post cherry-pick),
   *   **al emitir**, sobre algo que **el visitante no controla ni conoce**.
   * - ⛔ `buylistOfferReissueAlertCount` (10): mide **nuestra** conducta.
   * - ⛔⛔ **VETO DURO PERMANENTE — topes AML (`buylistCapPerRequestCents`/`PerMonthCents`) y
   *   `ineThresholdCents`:** publicar el umbral de INE y los topes AML **es publicar el manual de
   *   cómo estructurar por debajo de ellos**; un control de cumplimiento **pierde eficacia al ser
   *   conocido**. Ningún cambio futuro los mueve aquí **sin decisión explícita del humano y revisión
   *   de `seguridad`**.
   * - ⛔ `binding:false` / `isIndicative` / `disclaimer`: **booleano de un solo valor** — justo lo que
   *   D31 retiró de `SellOfferPublicDTO`. ⛔ `currency`: todo monto es entero en centavos MXN (§0).
   *   ⛔ `shortfallCents`: **depende del carrito, que es estado del cliente**; el faltante
   *   **autoritativo** lo da el `422`.
   *
   * ### El valor sale del DIAL, nunca de una constante
   * Se lee `buylist_minimum_request_cents` (M10) en cada llamada, con el mismo `getNumber` que usa
   * cualquier otro consumidor de diales. **No hay caché en memoria**: el contrato la permite pero no
   * la exige, la lectura es un `findUnique` por clave única, y un TTL propio **sumaría una segunda
   * ventana de rancidez** encima de los 300 s del `Cache-Control` — justo en el número que gatea un
   * botón. *Si el humano mueve el dial, el único retraso debe ser el que está publicado.*
   *
   * ### Las dos superficies del mínimo NO se pisan (§4.39r.4)
   * **132(a)** es **preventivo** (el front resta, con el mínimo del servidor: evita el viaje);
   * **132(b)** es **AUTORITATIVO** (el `422`, con `details.shortfallCents`: decide). Si difieren
   * —caché, o dial movido entre medias— **manda el `422`**. *La pantalla informa; la puerta decide.*
   */
  async quotePolicy(): Promise<{ minimumRequestCents: number }> {
    return {
      minimumRequestCents: await this.settings.getNumber(SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS),
    };
  }

  /**
   * v1.28 (P-22, §4.26e / API_CONTRACT §6) — GET /buylist/bounties: vitrina pública «Top
   * Bounties» de la página Vender. READ-ONLY ESTRICTO (doctrina v1.12 de endpoints anónimos: no
   * persiste, no escala pendientes, no mueve dinero). Solo bounties ACTIVOS
   * (`bountyEnabled=true` + `bountyPriceCents>0` — la regla de presencia money-safe H-1) y solo
   * `productType=raw` (defensa en profundidad: el write ya lo impone; la vitrina es de sueltas).
   * Orden `bountyPriceCents desc`, cap 50, sin paginación ni query params. Un bounty
   * completado/apagado DESAPARECE de la lista (quien ya cotizó conserva su monto snapshoteado).
   */
  async publicBounties(): Promise<{
    data: {
      cardId: string;
      name: string;
      number: string;
      setName: string;
      imageSmallUrl?: string;
      rarity?: string;
      finish: Finish;
      bountyPriceCents: number;
      targetQty: number | null;
      remainingQty: number | null;
    }[];
  }> {
    // v2.0 (P-48, §4.36.6, criterios 90/91) — SEAM «PUBLICAR» de la revalidación del bounty.
    // ORDEN DE OPERACIONES NORMATIVO (importa): seleccionar candidatos activos → resolver el mercado
    // en LOTE → FILTRAR los no efectivos → ordenar `bountyPriceCents desc` → tomar el TOP 50.
    // Filtrar DESPUÉS del cap dejaría huecos silenciosos en la vitrina.
    // Efecto garantizado: para TODO bounty visible aquí, `/buylist/quote` cotiza EXACTAMENTE ese monto
    // y es ESTRICTAMENTE mayor que la tarifa estándar de esa variante.
    const candidates = await this.prisma.variantPriceOverride.findMany({
      where: { bountyEnabled: true, bountyPriceCents: { gt: 0 }, productType: 'raw' },
      // Desempate estable por edición más reciente (el contrato solo norma el precio desc).
      orderBy: [{ bountyPriceCents: 'desc' }, { updatedAt: 'desc' }],
      // Cap de CANDIDATOS (no de la vitrina): el endpoint es público/anónimo y una lectura sin cota
      // es superficie de abuso. Muy por encima del cap 50 de la vitrina, así que el filtro por
      // efectividad no se queda sin material salvo en un escenario que no existe (>500 bounties
      // activos, todos rebasados por la curva).
      take: BOUNTY_CANDIDATE_CAP,
      include: { card: { include: { set: true } } },
    });
    const curve = await this.pricing.loadPricingCurve();
    // Mercado EN LOTE (una query), mismo lote que usa el resto del eje de compra.
    const refs = await this.pricing.getReferencesBatch(
      candidates.map((r) => ({
        cardId: r.cardId,
        productType: r.productType,
        gradeKey: r.gradeKey,
        finish: r.finish,
      })),
    );
    const rows = candidates.filter((r) => {
      // P-30 H2 (§4.39e): misma fuente que el PRODUCTOR del map (`getReferencesBatch`).
      const ref = refs.get(
        variantKey({
          cardId: r.cardId,
          productType: r.productType,
          gradeKey: r.gradeKey,
          finish: r.finish,
        }),
      );
      const referenceMxnCents = ref && ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
      // MISMO cuerpo de precedencia que la cotización ⇒ el número publicado ES el que se paga.
      const curveQuoteCents = quoteAcquisitionFromCurve(referenceMxnCents, curve).curveQuoteCents;
      return isBountyEffective(r.bountyPriceCents, curveQuoteCents);
    })
      // Re-orden explícito tras el filtro (el `orderBy` del query ya lo daba; se conserva por claridad
      // de que el ORDEN es parte del contrato de la vitrina) y CAP de la vitrina.
      .sort((a, b) => (b.bountyPriceCents as number) - (a.bountyPriceCents as number))
      .slice(0, BOUNTY_SHOWCASE_CAP);
    const data = rows.map((r) => ({
      cardId: r.cardId,
      name: r.card.name,
      number: r.card.number,
      setName: r.card.set.name,
      ...(r.card.imageSmallUrl ? { imageSmallUrl: r.card.imageSmallUrl } : {}),
      ...(r.card.rarity ? { rarity: r.card.rarity } : {}),
      finish: r.finish,
      bountyPriceCents: r.bountyPriceCents as number,
      targetQty: r.bountyTargetQty,
      // Dato motivacional, no compromiso contractual: target − acquired con PISO 0; null sin objetivo.
      // v1.62 (§M2-B.1): el CUERPO es compartido con el `progress` de la consola de bounties — el
      // contrato exige que esta resta **no se teclee dos veces**. Sin cambio de conducta.
      remainingQty: bountyRemainingQty(r.bountyTargetQty, r.bountyAcquiredQty),
    }));
    return { data };
  }

  /**
   * Crea la solicitud de venta. Valida topes (solicitud/mes), INE sobre tope y
   * CLABE a nombre propio. API_CONTRACT §6, PROJECT criterio 14.
   *
   * ### ⚠️⚠️ v1.51.20 · **BL-26** — LA PUERTA DEL CICLO. Tres requisitos que faltaban ENTEROS.
   * Este endpoint es el **primer paso** del ciclo de adquisición, y hasta este pase **no comprobaba
   * ninguna de las tres condiciones que el ciclo necesita para poder cerrarse**:
   * - **`addressId`** (D36/D37) ni siquiera estaba **en el DTO**: el `ValidationPipe` con whitelist
   *   lo **descartaba en silencio** ⇒ *toda solicitud creada por la app nacía inofertable*
   *   (`422 PICKUP_ADDRESS_MISSING` al ofertar, con la mesa marcando `pickupAddressMissing: true`).
   * - **`buylistMinimumRequestCents`** (D18, criterio 132(b)) solo se **leía** en `quotePolicy()` —
   *   superficie de **cliente**, que se puede saltar. Una solicitud de MX$16.67 se creaba.
   * - **`User.phone`** (D11, criterio 128(c)) no se leía: la columna es **nullable** y las cuentas de
   *   **Google** y las **viejas** la tienen vacía ⇒ vendedores incontactables dentro del ciclo.
   *
   * ### El ORDEN de las tres puertas, y por qué es ése
   * **Lo más barato y lo más independiente del carrito primero** — misma disciplina que la secuencia
   * de `POST …/offer` (§4.39h): *si va a fallar, que falle antes de cotizar N cartas.*
   * ```
   * 1. PHONE_REQUIRED             ← una columna del usuario; no depende de nada más
   * 2. PICKUP_ADDRESS_REQUIRED    ← ausencia de un campo del body
   * 3. PICKUP_ADDRESS_NOT_FOUND   ← una lectura de la libreta del propio usuario
   *    ... (CLABE: formato / nombre propio / fallback — conducta v1.15, intacta)
   *    ... cotización server-side de las N líneas ...
   * 4. BUYLIST_MINIMUM_NOT_MET    ← ⚠️ necesita el TOTAL, así que NO puede ir antes
   * 5. BUYLIST_LIMIT_EXCEEDED (per_request) · INE_REQUIRED · per_month
   * ```
   * ⚠️ **El mínimo va ANTES de los topes AML** a propósito: *«te faltan $120»* es un mensaje
   * accionable para el vendedor; *«superaste el tope»* es una condición nuestra. Cuando las dos son
   * ciertas, la que se le dice es la que puede resolver. **Y el mínimo se juzga sobre el total
   * cotizado BRUTO** — el descuento de envío **no** se resta antes de comparar (mezclarlos rechazaría
   * solicitudes legítimas de exactamente MX$500). **Borde INCLUSIVO** (criterio 158(a)).
   */
  async createRequest(
    userId: string,
    items: QuoteItemInput[],
    // v1.15 (§4.16a, PII): `clabe` OPCIONAL. Ver resolución/fallback abajo.
    clabe?: string,
    ineUploadKeys?: { front: string; back: string },
    // v1.51.3 (D36/D37): la dirección de ORIGEN. OBLIGATORIA — el `422` lo emite este cuerpo, no el
    // pipe (ver `CreateRequestDto.addressId`). Opcional en la FIRMA para que la ausencia llegue aquí
    // y se conteste con el código que el contrato nombra.
    addressId?: string,
  ) {
    // v1.53 (§4.40.3, MONEY) — RAW-ONLY, y lo PRIMERO de todo: `createRequest` es TODO-O-NADA (congela
    // dinero en una transacción), así que aquí NO hay degradación por-ítem — un solo ítem `graded`/
    // `sealed` aborta la solicitud entera con 422 y **la solicitud no se crea**. Va antes de leer la
    // KYC/CLABE para no tocar PII por una petición que no puede prosperar.
    // Sin esta guarda, `SellRequestItem` congelaba un `quotedPriceCents` derivado de `graded:PSA:10`
    // sobre una carta cuyo grado nunca se preguntó — y con la oferta vinculante desde el correo eso
    // deja de ser un error corregible y pasa a ser un compromiso firmado.
    items.forEach((it, index) => this.assertBuylistProductType(it.productType, index));

    // SEC/PII: la KYC se lee SIEMPRE por el `userId` autenticado (nunca la de otro usuario).
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId } });

    // ---- PUERTA 1: el CELULAR (D11, criterio 128(c)) ----
    // `User.phone` es nullable en el schema aunque `POST /auth/register` ya lo exija: las cuentas
    // creadas con **Google** y las **viejas** lo tienen vacío. El remedio es del front
    // (`PATCH /users/me`) y el vendedor reintenta; hasta capturarlo, la solicitud NO avanza.
    const seller = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });
    if (seller == null || seller.phone == null || seller.phone.trim() === '') {
      throw BusinessException.validation(
        'PHONE_REQUIRED',
        'A mobile phone is required on the account to create a sell request',
        { field: 'phone' },
      );
    }

    // ---- PUERTA 2+3: la DIRECCIÓN DE ORIGEN (D36/D37, §4.39q) ----
    // ⚠️ SIN FALLBACK a la dirección `isDefault`, y ésta es la diferencia deliberada con la CLABE: en
    // archivo hay **exactamente una** CLABE y es del propio usuario verificado, así que elegir por él
    // no puede equivocarse de destinatario. La libreta tiene **N filas**, y elegir por el vendedor es
    // elegir **de dónde salen sus cartas**. *Un `isDefault` puesto hace ocho meses en otra ciudad no
    // es un consentimiento para esta operación.* **El servidor no adivina domicilios.**
    if (addressId == null || addressId.trim() === '') {
      throw BusinessException.validation(
        'PICKUP_ADDRESS_REQUIRED',
        'A pickup address is required: none provided',
        { field: 'addressId' },
      );
    }
    // Inexistente o de OTRO usuario ⇒ MISMA respuesta (`422 PICKUP_ADDRESS_NOT_FOUND`, anti-IDOR).
    // Se resuelve con el MISMO cuerpo que usan la ruta de cliente y la de admin: una sola definición
    // de «esta dirección es suya» y un solo sitio donde se decide qué se copia al snapshot.
    const pickupAddressSnapshot = await this.resolvePickupAddressSnapshot(userId, addressId.trim());

    // v1.15 (§4.16a) — Resolución de la CLABE efectiva:
    //  - `clabe` presente → comportamiento actual: valida formato (CLABE_INVALID) y nombre propio
    //    por BLIND INDEX (HMAC, SIN descifrar) contra la de archivo (CLABE_NOT_OWN_NAME); se persiste
    //    en KYC (clabeEnc + clabeHmac).
    //  - `clabe` omitida → FALLBACK server-side a la CLABE del PROPIO usuario en archivo
    //    (KycProfile.clabeEnc, desencriptada — MISMA fuente que revealClabe). NUNCA la de otro.
    //    Sin CLABE en archivo → 422 CLABE_REQUIRED. La CLABE en claro NUNCA se loguea ni se devuelve.
    let effectiveClabe: string;
    // Solo cuando `clabe` viene en el body se (re)persiste en la KYC; el fallback ya está en archivo.
    let kycClabeFields: { clabeEnc: string; clabeHmac: string } | null = null;
    if (clabe != null && clabe !== '') {
      if (!isValidClabe(clabe)) {
        throw BusinessException.validation('CLABE_INVALID', 'CLABE must be 18 digits');
      }
      const incomingHmac = this.pii.clabeBlindIndex(clabe);
      if (kyc?.clabeHmac && !this.pii.blindIndexEquals(kyc.clabeHmac, incomingHmac)) {
        throw BusinessException.validation(
          'CLABE_NOT_OWN_NAME',
          'CLABE must match the one on file (own name)',
        );
      }
      effectiveClabe = clabe;
      kycClabeFields = { clabeEnc: this.pii.encrypt(clabe), clabeHmac: incomingHmac };
    } else {
      // FALLBACK: CLABE del propio usuario en archivo (misma vía que revealClabe, buylist.service.ts).
      const onFile = this.pii.decryptOptional(kyc?.clabeEnc);
      if (!onFile) {
        throw BusinessException.validation(
          'CLABE_REQUIRED',
          'A CLABE is required: none provided and none on file',
        );
      }
      effectiveClabe = onFile;
    }

    // Cotiza cada item. SEC-A1: el monto a pagar NO se toma del DTO del cliente; se DERIVA server-side
    // del VALOR DE MERCADO REAL de la variante (§4.36.1). Así un DTO malicioso no puede inflar
    // `quotedTotalCents`.
    // v2.0 (P-48, §4.36.7c): se snapshotea `priceBasis` (QUÉ determinó el precio) en la MISMA
    // transacción que congela `quotedPriceCents`. Los `ruleMode`/`ruleValue`/`ruleSource` quedan LEGACY:
    // nada nuevo los escribe (no hay reglas que snapshotear).
    const curve = await this.pricing.loadPricingCurve();
    // v1.28 (P-18/P-22, §4.26b): overrides por variante EN LOTE (una query por request). El snapshot
    // `priceBasis="bounty"` es el que habilita el conteo de bounty al pagar (P-22).
    const overrides = await this.pricing.getVariantOverridesBatch(items.map((it) => this.overrideKeyOf(it)));
    const itemsData: {
      cardId: string;
      productType: ProductType;
      rawCondition?: RawCondition;
      finish: Finish;
      // v1.30 (§4.29d): snapshot del productId TCGplayer cuando la línea es un producto separado.
      cardProductId?: number;
      rarity: string | null;
      // v2.0 (P-48, §4.36.7c / §N.8): INSTRUMENTACIÓN DE COMPRA — los cinco datos se congelan en la
      // MISMA transacción que `quotedPriceCents` (que es el precio final) y con el `finish` que ya
      // tenía. Un AJUSTE posterior del admin (`approvedPriceCents`) NO los reescribe: la serie mide
      // LA DECISIÓN DE LA CURVA, y el monto realmente pagado se lee de `approvedPriceCents ?? quoted`.
      priceBasis: PriceBasis;
      marketMxnCents: number | null;
      marketBracket: MarketBracketType | null;
      quotedPriceCents: number | null;
      itemStatus: 'cotizada' | 'precio_pendiente';
    }[] = [];
    let quotedTotalCents = 0;
    /**
     * v2.1.6 (fase de seguridad) — INTENCIONES de cola, a aplicar SOLO si la solicitud se crea.
     *
     * Antes, el bucle escribía en `PendingPriceEntry` **antes** de los topes y del umbral de INE y
     * **fuera** de la transacción: una solicitud RECHAZADA por tope dejaba igualmente su rastro en la
     * cola del dueño — y, peor, podía **CERRAR** entradas (`reason=null`) por una solicitud que nunca
     * existió. Es la misma clase que S48-M1 (un cliente moviendo la cola del dueño) por otra puerta.
     */
    const pendingSettlements: Array<{
      reason: PendingReason | null;
      key: { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; cardProductId: number | null };
    }> = [];
    // Cartas EN LOTE (una query por request): antes se hacía un `findUnique` POR ÍTEM dentro del
    // bucle mientras el override sí venía en lote — N+1 que este refactor cierra de paso.
    const cardsById = new Map(
      (
        await this.prisma.card.findMany({ where: { id: { in: [...new Set(items.map((it) => it.cardId))] } } })
      ).map((c) => [c.id, c]),
    );
    for (const it of items) {
      const card = cardsById.get(it.cardId);
      if (!card) throw BusinessException.notFound('NOT_FOUND', 'Card not found');
      // v2.0 (P-48, §4.36.5b / gate techlead) — MISMO cuerpo que `POST /buylist/quote` y `/quote/batch`:
      // el vendedor firma EXACTAMENTE el número que le cotizamos. Aquí no se re-deriva nada de dinero;
      // lo único propio de `createRequest` es lo de abajo (instrumentación + escalada a la cola).
      const line = await this.decideBuyLine({
        card,
        productType: it.productType,
        rawCondition: it.rawCondition,
        finish: it.finish,
        curve,
        // v1.28 (P-18): el override de la variante viene del LOTE. La rama `productId` lo ignora
        // dentro del cuerpo compartido (money-safe: no se fusionan precios de dos identidades).
        override:
          overrides.get(
            // P-30 H2 (§4.39e): la llave se CONSTRUYE con el helper, nunca con un template. Esta era
            // la peor de las cuatro: cuatro componentes interpolados en una sola línea de 190
            // caracteres, con el `gradeKey` resuelto EN MEDIO de la expresión.
            // v1.53 (§4.40.3/§4.40.4, MONEY): el `gradeKey` pasa por `purchasableGradeKeyInput`
            // —la guarda raw-only re-aplicada **y** la derivación del `switch` (v1.54 · B-3)— en vez
            // de ir directo al constructor de claves.
            variantKey({
              cardId: it.cardId,
              productType: it.productType,
              gradeKey: this.pricing.gradeKeyFor(this.purchasableGradeKeyInput(it)),
              finish: (it.finish ?? 'normal') as Finish,
            }),
          ) ?? null,
        productId: it.productId,
      });
      // v2.1.6 (fase de seguridad) — la escritura en la cola se DIFIERE hasta después de que la
      // solicitud exista de verdad (ver abajo). Aquí solo se ACUMULA la intención.
      pendingSettlements.push({
        reason: line.pendingReason,
        key: {
          cardId: it.cardId,
          productType: it.productType,
          gradeKey: line.gradeKey,
          finish: line.finish,
          cardProductId: it.productId ?? null,
        },
      });
      quotedTotalCents += line.quotedPriceCents ?? 0;
      itemsData.push({
        cardId: it.cardId,
        productType: it.productType,
        rawCondition: it.rawCondition,
        finish: line.finish,
        ...(it.productId != null ? { cardProductId: it.productId } : {}),
        // Dato de display del catálogo; el monto NO depende de él (criterio 84).
        rarity: card.rarity ?? null,
        priceBasis: line.priceBasis,
        // Sin mercado (override/bounty sin referencia, o pendiente) van en `null`: honesto, jamás un
        // 0 inventado. El BRACKET es un índice de conveniencia; el dato real es el monto crudo.
        marketMxnCents: line.quote.marketMxnCents,
        marketBracket: marketBracketOf(line.quote.marketMxnCents),
        quotedPriceCents: line.quotedPriceCents,
        itemStatus: line.quotedPriceCents != null ? 'cotizada' : 'precio_pendiente',
      });
    }

    // ---- PUERTA 4: EL MÍNIMO DE COMPRA (D18, criterio 132(b)) ----
    // ⚠️ Va **después** del bucle porque necesita el TOTAL, y **antes** de los topes AML porque
    // *«te faltan $120»* es accionable para el vendedor y *«superaste el tope»* no lo es.
    // **Borde INCLUSIVO** (criterio 158(a)): exactamente el mínimo SÍ se crea, así que la
    // comparación es `<` y nunca `<=`.
    // **Se juzga sobre el TOTAL, no por carta ni por línea** (una carta de $600 pasa; mil que suman
    // $400, no) y **sobre el BRUTO cotizado**: la tarifa de envío NO se resta antes de comparar.
    // ⚠️ SUPUESTO EXPLÍCITO (§4.39o.8): una línea `precio_pendiente` aporta **0** — no tiene
    // `quotedPriceCents`, y contarla exigiría inventarle una cifra, que es lo que §N.2 prohíbe.
    // ⚠️ El mínimo **NO se re-aplica a la oferta** (criterio 158(c)): cotizados $600 y cherry-pick a
    // $200, la oferta sale igual. **Un solo umbral, en un solo momento.**
    const minimumRequestCents = await this.settings.getNumber(
      SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS,
    );
    if (quotedTotalCents < minimumRequestCents) {
      throw BusinessException.validation(
        'BUYLIST_MINIMUM_NOT_MET',
        'The quoted total is below the minimum purchase amount',
        {
          minimumCents: minimumRequestCents,
          totalCents: quotedTotalCents,
          // ⚠️ Lo calcula EL SERVIDOR y no es un adorno: el criterio 132(a) exige que la pantalla
          // diga **cuánto falta**. El front lo RENDERIZA, no lo calcula.
          shortfallCents: minimumRequestCents - quotedTotalCents,
        },
      );
    }

    // Topes.
    const capPerRequest =
      kyc?.capPerRequestCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS));
    const capPerMonth =
      kyc?.capPerMonthCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS));
    const ineThreshold = await this.settings.getNumber(SettingKey.INE_THRESHOLD_CENTS);

    // El tope por-solicitud no depende de concurrencia (es sobre el total de ESTA
    // solicitud), se valida fuera de la transacción.
    if (quotedTotalCents > capPerRequest) {
      throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-request cap exceeded', {
        scope: 'per_request',
        capCents: capPerRequest,
        wouldBeCents: quotedTotalCents,
      });
    }

    // INE sobre el tope configurado.
    const ineProvided = Boolean(
      (ineUploadKeys?.front && ineUploadKeys?.back) || (kyc?.ineFrontKey && kyc?.ineBackKey),
    );
    // Fase 0.3 (compliance) — cierre del bypass del umbral INE / topes AML vía "precio pendiente".
    // Un ítem `precio_pendiente` suma 0 a `quotedTotalCents` (base del tope por solicitud, tope
    // mensual y umbral INE). Sin este control, un cliente podía enviar una carta CARA sin referencia
    // → suma $0 → no se le exigía INE ni topaba contra los caps AML.
    // DECISIÓN CONSERVADORA (para validación de seguridad): si la solicitud contiene ≥1 línea
    // `precio_pendiente`, se EXIGE INE. La incertidumbre del monto se trata como potencialmente por
    // encima del umbral (el monto real se conocerá al resolver el pendiente, ya con la carta física
    // y posiblemente por encima del tope). No debilita ningún control existente: solo endurece.
    const hasPendingLine = itemsData.some((i) => i.itemStatus === 'precio_pendiente');
    const ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine;
    if (ineRequired && !ineProvided) {
      throw BusinessException.validation('INE_REQUIRED', 'INE required above threshold', {
        thresholdCents: ineThreshold,
      });
    }

    // Snapshot CIFRADO de la CLABE resuelta (de request o fallback) para el pago SPEI: usa la CLABE
    // vigente al crear la solicitud aunque el usuario cambie luego su KYC. NUNCA en claro/logueada.
    const clabeEnc = this.pii.encrypt(effectiveClabe);
    // Persiste CLABE/INE en KYC. La CLABE solo se (re)escribe cuando vino en el body (`kycClabeFields`);
    // en el fallback ya está en archivo. El INE se actualiza si vienen keys nuevas.
    await this.prisma.kycProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...(kycClabeFields ?? {}),
        ineFrontKey: ineUploadKeys?.front,
        ineBackKey: ineUploadKeys?.back,
        kycStatus: 'pending',
      },
      update: {
        ...(kycClabeFields ?? {}),
        ...(ineUploadKeys?.front ? { ineFrontKey: ineUploadKeys.front } : {}),
        ...(ineUploadKeys?.back ? { ineBackKey: ineUploadKeys.back } : {}),
      },
    });

    // SEC-A2: el tope MENSUAL sufre TOCTOU si se lee `monthUsed` y luego se crea sin
    // atomicidad (N solicitudes concurrentes leen el mismo acumulado y todas pasan).
    // Se lee el acumulado y se crea la solicitud DENTRO de una transacción SERIALIZABLE:
    // dos solicitudes concurrentes cerca del tope entran en conflicto de serialización y
    // solo una prospera, cerrando el bypass del límite AML/mensual.
    const request = await this.prisma.$transaction(
      async (tx) => {
        const monthUsed = await this.monthUsedCentsTx(tx, userId);
        if (monthUsed + quotedTotalCents > capPerMonth) {
          throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month cap exceeded', {
            scope: 'per_month',
            capCents: capPerMonth,
            wouldBeCents: monthUsed + quotedTotalCents,
          });
        }
        // PROJECTION-EXEMPT: return DENTRO de la `$transaction`; el caller (`createRequest`)
        // proyecta a `{ sellRequestId, status, quotedTotalCents, ineRequired, items }` (contrato §6).
        return tx.sellRequest.create({
          data: {
            userId,
            status: 'cotizada',
            quotedTotalCents,
            clabeSnapshotEnc: clabeEnc,
            ineRequired,
            ineProvided,
            // ⚠️ v1.51.3 (D36/D37) — SE SNAPSHOTEA, NO SE REFERENCIA, y en la MISMA transacción que
            // crea la solicitud. La guía es **un documento con una dirección IMPRESA**: si editar la
            // libreta reescribiera la fila, la solicitud diría una cosa y el papel otra — y el
            // paquete sigue al papel. Además `Address` **se puede borrar**, y una FK viva dejaría
            // solicitudes en vuelo sin origen. Mismo criterio, ya tomado dos veces en este repo:
            // `ShipmentRequest.addressSnapshot` y `Order.shippingAddressSnapshot`.
            pickupAddressSnapshot,
            items: { create: itemsData },
          },
          include: { items: { include: { card: true } } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // v2.1.6 — AHORA sí: la solicitud EXISTE, así que la cola refleja un hecho real. Va DESPUÉS del
    // commit y no dentro de la transacción serializable a propósito: meter N escrituras de cola en
    // la tx del tope mensual alargaría su ventana de conflicto sin ganar nada — el seam es idempotente
    // y simétrico, así que si el proceso muriera entre el commit y esto, la siguiente cotización o el
    // siguiente `publish-all` vuelven a escalar. Perder una escalada es recuperable; escribir la cola
    // por una solicitud que NO se creó, no.
    for (const s of pendingSettlements) {
      // v1.8-ronda-c: la cola es POR acabado (M-19). v1.30 (§4.29d): con productId, la entrada lleva
      // su cardProductId a la clave lógica. §4.36.5c: el MISMO seam CIERRA (salida simétrica).
      await this.pricing.settlePendingForVariant(s.reason, s.key, 'buylist');
    }

    return {
      sellRequestId: request.id,
      status: request.status,
      quotedTotalCents,
      ineRequired,
      items: request.items.map((i) => this.itemDTO(i)),
    };
  }

  /**
   * SEC-A2: acumulado del mes en curso leído sobre el cliente transaccional (`tx`), para que el
   * chequeo del tope mensual y la creación de la solicitud sean atómicos bajo aislamiento
   * serializable.
   *
   * v1.51 (M-46, §4.39c **SITIO 3**): el cuerpo era un **duplicado literal** del de
   * `UsersService.monthUsedCents` (sitio 2) —su JSDoc previo lo reconocía— y cada copia llevaba su
   * propio literal de estados. **Los dos colapsan en `common/buylist-aml.ts`**: aquí solo queda el
   * paso del `tx`. *La variante transaccional no es otra función: es la misma con otro cliente.*
   */
  private async monthUsedCentsTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    return monthCommittedGrossCents(tx, userId);
  }

  /**
   * v2.1.6 (AML-1, §4.36.6a) — acumulado **de COMPROMISO YA CONSUMADO** del mes del vendedor.
   *
   * ### ⚠️ v1.51 (M-46, §4.39c **SITIO 4** / §4.39i.4) — CAMBIA EL NOMBRE Y CAMBIA EL DOC, NO LA CIFRA
   * Se llamaba `monthPaidOutCentsTx` y su docblock decía *«el dinero que SALIÓ»*. **El nombre
   * mentía**, y con M-46 la mentira empieza a costar: bajo el criterio 155 esto es un acumulado de
   * **COMPROMISO (brutos)** —la misma base que AML—, **no** de caja. **La caja la lee M7 desde
   * `SellRequest.payoutNetCents`** (`max(0, brutoAprobado − envío)`, sellado en la misma transacción
   * que `pagada`), y **son dos medidas que conviven y NO se mezclan**: si el tope sumara netos, un
   * envío caro **bajaría** el acumulado y alguien pasaría el tope sin que se note; si la caja sumara
   * brutos, **M7 reportaría una salida de dinero que nunca ocurrió**. *Los nombres deben decirlo.*
   *
   * ### ⚠️ v1.57 — ESTE PÁRRAFO DESCRIBÍA LA CONDUCTA **PRE-P1**, Y LLEVABA UN COMMIT SIENDO FALSO
   * Decía: *«el `where` **conserva `status:'pagada'`** … así que **no se reapunta a ninguna
   * constante**»*. **Dejó de ser cierto en el mismo commit que cerró P1** (v1.56, §M5-T): el `where`
   * de abajo es hoy `{ userId, paidAt: { gte: start } }` — **el término de estado CAYÓ** y el
   * acumulado se ancla **solo en `paidAt`** (el porqué, con su demostración de equivalencia, está en
   * el propio `where`). *Un comentario que afirma lo contrario de lo que hay, en el predicado del
   * tope AML, es peor que ninguno: quien audite el tope dentro de seis meses concluiría que la fila
   * reactivada sigue saliendo del acumulado — que es exactamente el agujero que P1 explotó.*
   * ⚠️ **La cifra no cambió en ninguno de los dos pases**; lo que cambió es de qué hecho cuelga.
   *
   * **Por qué no basta el acumulado de intake** (`monthUsedCentsTx`): el
   * tope se evaluaba sobre la COTIZACIÓN de entrada, pero el dinero sale en la APROBACIÓN. Una línea
   * `precio_pendiente` entra al mes consumiendo **$0**; si después el dueño le fija precio y la
   * aprueba, ese monto **sí es dinero que sale** y hasta v2.1.5 **nada lo medía**. Con suficientes
   * líneas pendientes, el pago mensual real podía superar el tope sin que ningún control lo notara.
   *
   * Y este cambio **amplió la población de líneas en `$0`**: la curva trajo dos vías nuevas hacia
   * `precio_pendiente` (sin mercado —el bin NO gana— y el guardarraíl `premium_at_floor`). Por eso el
   * hueco es responsabilidad de este pase aunque el remedio viva en el seam de M5.
   *
   * Se suma en memoria porque el monto es un **COALESCE de tres columnas** (`brutoConsumado`) que
   * `_sum` de Prisma no expresa, y sumar el campo equivocado sería exactamente el error que este
   * control viene a cerrar. El conjunto está acotado por el propio tope (las solicitudes PAGADAS de
   * UN vendedor en UN mes).
   *
   * ### ⚠️ v1.51.5 (§4.39i.4-bis) — CAMBIA EL CAMPO, y esto SÍ mueve la cifra
   * Leía `approvedTotalCents ?? quotedTotalCents` y **se saltaba `offerGrossCents`**: una solicitud
   * **ofertada** pagada sin decisión por-ítem acumulaba por **la COTIZACIÓN**. Con **override al alza
   * (D26)** el cotizado es **MENOR** que el ofertado ⇒ el acumulado se quedaba **corto** y el
   * vendedor podía **rebasar el tope mensual sin que ningún control lo notara**. Ahora usa
   * **`brutoConsumado`**, el mismo cuerpo que el término de la solicitud en curso — **son los dos
   * lados de la misma desigualdad, y medirlos distinto es comparar dos cosas**.
   */
  private async monthCommittedGrossPaidCentsTx(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const rows = await tx.sellRequest.findMany({
      // Ancla en `paidAt` (cuándo salió el dinero), no en `createdAt` (cuándo entró la solicitud):
      // una solicitud de diciembre que se paga en enero consume tope de ENERO, que es el mes en que
      // el dinero sale.
      //
      // ⚠️⚠️ v1.56 · **§M5-T / BL-35 — CAE EL TÉRMINO `status: 'pagada'`. EL ACUMULADO SE ANCLA
      // SOLO EN `paidAt`.** (§M5 `pay-spei` → «Los TRES sitios», sitio 1.)
      //
      // **Segundo impacto de la CRÍTICA P1:** durante una reactivación la fila **no está `pagada`**,
      // así que **salía del acumulado** y cada re-pago se medía contra una cifra **que no incluía el
      // dinero ya entregado** ⇒ se podía pagar muy por encima de `buylist_cap_per_month_cents`.
      //
      // **Conducta IDÉNTICA en toda fila sana, y es demostrable, no una apuesta:** `paidAt >= start`
      // **ya excluye los `null`**, así que el predicado nuevo es un **superconjunto estricto** del
      // viejo. La diferencia son **exactamente** las filas con `paidAt` poblado y `status` distinto
      // de `pagada` — que en un sistema sano no existen: **medido, `paidAt` tiene UN solo escritor en
      // todo el backend** (el `data` de la transición de abajo, en el mismo objeto que
      // `status: 'pagada'`), sin default en el schema y sin SQL crudo que lo toque.
      //
      // **Falla CERRADO en la fila defectuosa:** cuenta **el dinero que de verdad salió** en vez de
      // olvidarlo. *Un tope que se olvida de lo que ya pagó no es un tope.*
      //
      // ⚠️ **NO se toca el acumulado de COMPROMISO VIVO** (`monthCommittedGrossCents`, ancla
      // `createdAt` sobre estados no terminales): ése mide **promesa**, no caja, y su ancla correcta
      // **sí** es el estado. Dos preguntas distintas, dos predicados distintos.
      where: { userId, paidAt: { gte: start } },
      // v1.51.5: el término CENTRAL (`offerGrossCents`) entra al `select` — sin leerlo, la cascada
      // no puede aplicarse aunque esté escrita.
      select: { approvedTotalCents: true, offerGrossCents: true, quotedTotalCents: true },
    });
    return rows.reduce((acc, r) => acc + brutoConsumado(r), 0);
  }

  private itemDTO(i: {
    id: string;
    card: { id: string; name: string; number: string } | null;
    cardId: string;
    productType: ProductType;
    rawCondition: RawCondition | null;
    finish?: Finish | null;
    // v1.30 (§4.29): snapshot del productId TCGplayer (null = línea de set_base).
    cardProductId?: number | null;
    rarity?: string | null;
    // v2.0 (P-48, §4.36.7a/c): `priceBasis` reemplaza al trío legacy `ruleMode`/`ruleValue`/`ruleSource`
    // (que sobrevive en BD por retención de filas históricas, pero nada nuevo lo escribe ni lo expone).
    priceBasis?: PriceBasis | null;
    marketMxnCents?: number | null;
    marketBracket?: MarketBracketType | null;
    quotedPriceCents: number | null;
    approvedPriceCents: number | null;
    itemStatus: string;
    inventoryItemId: string | null;
    rejectedAt?: Date | null;
    rejectionReason?: string | null;
    // v1.51.15 (§11): el BLOQUE DE OFERTA que viaja a las DOS audiencias (`buy`|`skip` y el monto
    // congelado). Los cinco campos ADMIN-ONLY de `AdminSellItemDTO` NO entran aquí a propósito.
    offerDecision?: BuyDecision | null;
    offeredPriceCents?: number | null;
  }, opts?: { conditionLabel?: string; redactQuotedPrice?: boolean }) {
    // v1.18-buylist-rejects (§11): campos de RECHAZO — poblados SOLO si itemStatus='rechazada';
    // en cualquier otro status se OMITEN. Los plazos returnDeadlineAt/abandonDeadlineAt se DERIVAN
    // server-side de rejectedAt (fuente única; NO son columnas). Ítems legacy (rechazados pre-M-22,
    // sin rejectedAt) exponen los cuatro campos null.
    const rejection =
      i.itemStatus === 'rechazada'
        ? {
            rejectedAt: i.rejectedAt ?? null,
            rejectionReason: i.rejectionReason ?? null,
            ...rejectDeadlines(i.rejectedAt),
          }
        : {};
    // ⚠️ v1.51.15 (§11 `SellItemDTO`, criterios 118/161(d)) — **EL BLOQUE DE OFERTA, PARTIDO POR
    // AUDIENCIA.** §11 lo declara desde v1.51 y esta proyección **no emitía ninguno de los tres**, así
    // que el portal del vendedor recibía una oferta sin desglose: sin `offerDecision` no puede decir
    // *qué* compramos, sin `offeredPriceCents` no puede decir *a cuánto*, y sin `condition` no puede
    // mostrar lo que el vendedor está aceptando.
    //
    // ### Qué entra aquí y qué NO, y por qué la frontera es la forma de la función
    // Entra **lo declarado para CLIENTE**: `offerDecision`, `offeredPriceCents` y `condition`.
    // **NO entran** los CINCO admin-only de `AdminSellItemDTO` (`offerDerivedPriceCents`,
    // `offerOverrideReason`, `offerPriceBasis`, `offerMarketMxnCents`, `offerMarketBracket`): los dos
    // primeros son **deliberación interna** —*el vendedor ve EL NÚMERO QUE LE OFERTAMOS, no cómo se
    // fabricó*— y los tres restantes son instrumentación §N.8 del mismo régimen. Esta función es
    // COMPARTIDA por las dos audiencias, así que la regla se hace cumplir por **ausencia**: no se
    // leen de la fila, luego no pueden escaparse. Es la dirección segura del contrato
    // (`AdminSellItemDTO = SellItemDTO & {…}`: admin **añade**, cliente **no resta**) y **lo contrario
    // de la trampa de `toCustomerSellRequestDTO`**, que hereda por omisión y por eso necesitó la
    // resta explícita de `isPayable` (BL-20).
    //
    // ### `null` explícito, nunca `0` ni omisión
    // `offerDecision: null` = **línea pre-ciclo** (el contrato le da ese significado). `null` en
    // `offeredPriceCents` = **línea `skip`**: el criterio 118 exige que el desglose diga qué NO
    // compramos, y el correo lo lista **sin monto** — *cero es un precio*.
    //
    // ### `condition` — SOLO en la proyección de CLIENTE, y solo si el llamador trae la etiqueta
    // §11: *«la CONDICIÓN NM de esa línea, YA RENDERIZADA por el backend en el `locale` del usuario,
    // y **es el MISMO string que usó el correo**»* (criterio 161(d): la pantalla de aceptación la
    // muestra *palabra por palabra*). Por eso **no se renderiza aquí**: se **recibe** ya renderizada
    // desde `offerTermsCopy(locale-del-vendedor)`, la MISMA llamada que llena `offer.terms`. El valor
    // que se pinta pegado al monto y el del bloque legal **son el mismo, por construcción**.
    // - Sin `conditionLabel` ⇒ la clave **no existe**. Ésa es la superficie de ADMIN (que además no
    //   tiene el locale del vendedor a mano: renderizarla en el del operador sería mostrarle al
    //   vendedor un texto que él nunca leyó) y la LISTA del cliente, que **no lleva oferta**.
    // - Con `conditionLabel` y línea `buy` ⇒ el string.
    // - Con `conditionLabel` y línea `skip`/pre-ciclo ⇒ `null`. **Poner la condición de compra junto a
    //   una carta que NO compramos sería una promesa que no hicimos**, y el correo tampoco la pone.
    const offer = {
      offerDecision: i.offerDecision ?? null,
      offeredPriceCents: i.offeredPriceCents ?? null,
      ...(opts?.conditionLabel != null
        ? { condition: i.offerDecision === 'buy' ? opts.conditionLabel : null }
        : {}),
    };
    // v1.3.1: `category` reemplazado por `rarity`; v2.0 (P-48): `appliedRule` → `priceBasis`.
    return {
      id: i.id,
      cardId: i.cardId,
      card: i.card,
      productType: i.productType,
      rawCondition: i.rawCondition ?? undefined,
      // v1.6-finish: acabado snapshoteado en la cotización/solicitud.
      finish: i.finish ?? 'normal',
      // v1.30 (§4.29): eco del productId cotizado (omitido si la línea es de set_base).
      ...(i.cardProductId != null ? { productId: i.cardProductId } : {}),
      rarity: i.rarity ?? undefined,
      // v2.0 (P-48): `appliedRule` RETIRADO del DTO (no hay `{mode,value}`). Lo reemplaza `priceBasis`
      // (§4.36.7a); `null` en filas históricas anteriores a M-41, que se omiten.
      ...(i.priceBasis != null ? { priceBasis: i.priceBasis } : {}),
      // v2.0 (§N.8): instrumentación de COMPRA. `null` en filas anteriores a M-41 (se omiten).
      ...(i.marketMxnCents !== undefined ? { marketMxnCents: i.marketMxnCents } : {}),
      ...(i.marketBracket !== undefined ? { marketBracket: i.marketBracket } : {}),
      // ⚠️ v1.51.4 (§6) — CIERRE `no_offer`: la cifra sale **`null` EXPLÍCITO**, no omitida. `null`
      // dice *«esta línea no tiene precio que enseñarte»*; omitir la clave dice *«no sé nada de este
      // campo»*, y el front distingue. La línea SE SIGUE LISTANDO: desaparece el dinero, no la carta.
      quotedPriceCents: opts?.redactQuotedPrice === true ? null : (i.quotedPriceCents ?? undefined),
      approvedPriceCents: i.approvedPriceCents ?? undefined,
      itemStatus: i.itemStatus,
      inventoryItemId: i.inventoryItemId ?? undefined,
      ...rejection,
      ...offer,
    };
  }

  async listMine(userId: string) {
    // QA-BUG: sin `include` las filas Prisma crudas no traían `items`/`card` y el
    // frontend (BuylistView) crasheaba al iterar `r.items`. Se devuelve el shape
    // `SellRequestDTO` del contrato (sellRequestId + items[] con card), coherente con
    // el que ya emite `createRequest`.
    const rows = await this.prisma.sellRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { card: true } } },
    });
    const data = rows.map((r) => {
      // ⚠️ v1.51.4 (§6) — la redacción `no_offer` aplica **también en la LISTA**: las dos son
      // proyección de cliente, y dejar la cifra aquí reproduciría el daño **una pantalla antes**.
      const redactMoney = isNoOfferClosure(r);
      return {
        sellRequestId: r.id,
        status: r.status,
        // v1.51 (M-46, §4.39c sitio 9): `isTerminal` DERIVADO SERVER-SIDE, también en el listado.
        // Si viajara solo en el detalle, la lista tendría que volver a codificar el set para saber
        // qué fila sigue viva — y volveríamos a tener la copia que esto vino a borrar.
        isTerminal: isTerminalSellRequestStatus(r.status),
        quotedTotalCents: redactMoney ? null : r.quotedTotalCents,
        ineRequired: r.ineRequired,
        createdAt: r.createdAt,
        // ⚠️ La LISTA no lleva `offer`, ni `expiredReason`, ni `pickupAddress`, ni
        // `lastOfferCancelledAt` (§6, tabla de alcance de v1.51.8): pertenecen a la ficha de UNA
        // solicitud. La lista muestra ESTADOS y dice qué fila sigue viva. Por eso `itemDTO` va aquí
        // sin `conditionLabel` — el desglose de la oferta es del detalle.
        items: r.items.map((i) => this.itemDTO(i, { redactQuotedPrice: redactMoney })),
      };
    });
    return { data };
  }

  async getMine(userId: string, id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      // v1.51 (§6): el `locale` del dueño alimenta `offer.terms`, que **renderiza el backend** con
      // la MISMA fuente que el correo — para que la pantalla y el correo no puedan decir cosas
      // distintas.
      include: { items: { include: { card: true } }, user: { select: { locale: true } } },
    });
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    // v1.18-buylist-rejects (§6): los items del detalle del PROPIO cliente se proyectan como
    // SellItemDTO — cuando itemStatus='rechazada' exponen rejectionReason/rejectedAt y los plazos
    // derivados (la misma información del correo de rechazo).
    // S49-M1: la CABECERA pasa por la MISMA lista blanca de cliente que `respond`. Antes se
    // descartaba `clabeSnapshotEnc` a mano y el resto se esparcía crudo — así se colaba `closedAt`
    // (interno, SEC-D2) y se colaría cualquier columna sensible futura del schema.
    // v1.51.15 (§11): el detalle del CLIENTE lleva `condition` **también en `items[]`**, no solo en
    // `offer.lines[]`. Es el mismo desglose visto por la misma persona, y el mismo `locale`: dos
    // arreglos de la misma respuesta que dijeran cosas distintas sobre la misma línea serían
    // exactamente el defecto que el criterio 161(d) prohíbe.
    // Se lee SOLO `perLineConditionLabel`, que no depende de montos — por eso esta llamada va sin
    // ellos. `terms.rule` (el único que sí los necesita) sale de `offerPublicDTO`, que los tiene
    // congelados en la fila: *no se interpola dinero donde no hay dinero que interpolar.*
    const conditionLabel = offerTermsCopy(req.user?.locale ?? null).perLineConditionLabel;
    const redactMoney = isNoOfferClosure(req);
    return {
      ...toCustomerSellRequestDTO(req),
      sellRequestId: req.id,
      // ⚠️ v1.51.3 (D36/D37) — **la dirección de ORIGEN, y se le muestra DESDE EL PRINCIPIO**, no
      // desde la aceptación, por dos razones: **(1) es SU dato** —lo capturó él— y **(2) es lo que
      // vamos a IMPRIMIR**, así que tiene que poder verificarlo **antes** de que compremos la
      // etiqueta. `null` solo en filas legacy (pre-M-46), y ahí es precisamente la señal que lo
      // empuja a capturarla (`PATCH …/pickup-address`).
      // ⚠️ **Esto NO contradice el criterio 114:** el que oculta «guía, instrucciones y dirección»
      // habla de **LA NUESTRA** —a dónde mandar las cartas—, que sigue oculta sin cambios. Ésta es
      // **la del propio vendedor**. *No decirle a alguien a dónde mandar sus cartas antes de que haya
      // trato protege la operación; ocultarle su propia dirección es un bug.*
      // ⚠️ Viaja el **SNAPSHOT**, que puede diferir de la libreta si la editó después. **Es la
      // propiedad, no un defecto.** Y NO existe `pickupAddressId`, ni en el DTO ni en el schema.
      pickupAddress: req.pickupAddressSnapshot ?? null,
      // ⚠️ v1.51.4 (D42) + **v1.55 (D44)** — regla de proyección, no la columna (ver
      // `lastOfferCancelledAtOf`). Desde D44 su ÚNICA fuente es `offerSentCancelledAt`, escrita por
      // el mismo `if` que manda el correo 5: *la pantalla no puede pintar una fecha que el vendedor
      // no tenga en su bandeja.*
      // Cierra el defecto de que `offer/cancel` limpiaba los campos congelados y el vendedor **que
      // acababa de recibir el correo de cancelación** entraba al portal y **no veía rastro**: la
      // pantalla contradecía al correo, que es justo lo que §23.5a prohíbe.
      // **Viaja EL CUÁNDO Y NADA MÁS**: ni el motivo (interno), ni los montos de la oferta cancelada
      // (una cifra junto a «la cancelamos» se lee como una promesa retirada), ni cuántas veces.
      // **SOLO el DETALLE**: en la lista se muestran estados, y `COTIZADA` es cierto.
      lastOfferCancelledAt: lastOfferCancelledAtOf(req),
      // ⚠️ v1.51.15 · **BL-23(3)** — POR QUÉ quedó `rechazada`. **Derivado, CERO DDL** (la regla y su
      // orden de evaluación viven en `deriveRejectedReason`). **Solo en el DETALLE**, por la misma
      // razón que `expiredReason`: pertenece a la ficha de UNA solicitud, y la lista solo necesita
      // identificarla y decir si sigue viva (§6, tabla de alcance de v1.51.8).
      rejectedReason: deriveRejectedReason(req, req.items),
      items: req.items.map((i) => this.itemDTO(i, { conditionLabel, redactQuotedPrice: redactMoney })),
      // v1.51 (§6) — LA OFERTA COMO LA VE EL VENDEDOR. `null` salvo con `offerState='sent'`: una
      // oferta que espera autorización **no existe para él** (D13/D24), y una cancelada se limpió.
      // ⚠️ NUNCA lleva `offerState` ni ninguna cifra interna de la mesa.
      offer: this.offerPublicDTO({ ...req, locale: req.user?.locale ?? null }, req.items),
    };
  }

  /**
   * Responde a un ajuste del admin (accept/decline). API_CONTRACT §6.
   *
   * ### v1.51 · BL-2 — GUARDA DE ESTADO. Esto es DINERO SALIENTE, no cosmética.
   * Hasta v1.50 este método hacía `findUnique` **sólo para autorizar propiedad** y NUNCA leía
   * `req.status`: `accept` fijaba `status:'aprobada'` **incondicionalmente**. Consecuencia real y
   * explotable: el dueño de una solicitud `pagada` / `rechazada` / `abandonada` podía re-postear
   * `accept` y **revivirla a `aprobada`** — que junto con `verifiedAt` es exactamente el estado
   * pagable de `paySpei`. O sea: un cliente devolvía a la cola de «listas para pagar SPEI» una
   * solicitud ya cerrada, o ya pagada una vez. `decline` tenía el hueco simétrico: reescribía una
   * `pagada` a `rechazada`, borrando el rastro del pago.
   *
   * Precondición NORMATIVA (API_CONTRACT §6 v1.51, ARCHITECTURE §4.39(b.2)) — para AMBAS ramas,
   * **las CUATRO condiciones, ya cableadas** (v1.51.5):
   * ```
   * legal ⇔ closedAt IS NULL
   *       ∧ adjustmentSentAt IS NOT NULL          // hay un ajuste VIVO que responder
   *       ∧ status ∈ { verificacion, aprobada }   // los únicos que el barrido de 7d reconoce
   *       ∧ offerSentAt IS NULL                   // criterio 150: en el ciclo NO se ajusta
   * ```
   * **La guarda vive en el `where` del `updateMany` y se verifica con `count === 1`**, no en un `if`
   * de aplicación: un read-then-write sufre TOCTOU y dos `accept` concurrentes pasarían los dos.
   * Mismo patrón atómico que `paySpei` y `rejectRequest`.
   *
   * Fuera de la precondición → **`409 NO_LIVE_ADJUSTMENT`** (`details.status`). Cubre `pagada`
   * (**el dinero ya salió**), `rechazada`, `abandonada`, y el **re-`accept`** sobre un ajuste ya
   * consumido (`adjustmentSentAt = null`, que la propia rama `accept` deja al transicionar).
   * **La idempotencia aquí NO es «200 con el estado actual»** (a diferencia de `itemDecision(reject)`):
   * este verbo mueve dinero, y un `200` silencioso en la segunda llamada esconde justo lo que hay que
   * ver.
   *
   * ### ✅ v1.51.5 — la CUARTA condición ya está cableada (cierre de los dos `TODO(M-46)`)
   * Este bloque decía que `offerSentAt IS NULL` *«NO se puede cablear hoy sin inventar la columna»*.
   * **Esa premisa dejó de sostenerse en cuanto M-46 aterrizó: la columna existe.** Un TODO cuyo
   * bloqueo desapareció y se queda escrito **es documentación que miente**, así que se cierra aquí:
   * `offerSentAt: null` entra al `where` de la guarda, y la rama de error **discrimina**
   * (ARCHITECTURE §4.39(b.3)).
   *
   * **Por qué la 409 se parte en dos códigos y no es cosmética.** `NO_LIVE_ADJUSTMENT` dice *«no hay
   * ajuste que responder»*; `ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` dice *«esta solicitud es del ciclo y
   * aquí no se ajusta NUNCA»* (criterio 150, por lo negativo). **Son dos hechos distintos y llevan a
   * dos conductas distintas**: el primero puede resolverse esperando a que el admin mande un ajuste;
   * el segundo, jamás. *Un código que miente sobre la causa manda a alguien a esperar algo que no va
   * a pasar.*
   *
   * **La ruta de ajuste NO muere con el ciclo (§4.39b.3):** para toda solicitud nueva es
   * **inalcanzable por construcción** (`recibida` solo se llega vía `en_transito ← aceptada ←
   * ofertada` ⇒ nunca sin `offerSentAt`), pero la **cohorte legacy en vuelo** al cut-over **la
   * necesita** — apagar la salida el día que se apaga la entrada dejaría a un vendedor con un ajuste
   * vivo y **sin forma de aceptar un dinero que ya le propusimos**. Por eso aquí **no se retira
   * nada**: se cierra la entrada del ciclo y se deja la salida de la cohorte.
   */
  async respond(userId: string, id: string, decision: 'accept' | 'decline') {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    // Anti-IDOR: solicitud ajena o inexistente ⇒ MISMA respuesta 404 (no se confirma existencia).
    if (!req || req.userId !== userId) throw BusinessException.notFound();

    // Efecto por rama, escrito EN el mismo `updateMany` que hace de guarda — la transición y su
    // precondición son una sola operación del motor, no dos pasos que una carrera pueda separar.
    //  - `decline` es TERMINAL → sella `closedAt` (SEC-D2, ancla la retención de INE al cierre real).
    //  - `accept` CONSUME el ajuste (`adjustmentSentAt: null`), que es lo que hace que un segundo
    //    `accept` caiga en la 409 en vez de re-aprobar.
    const data: Prisma.SellRequestUpdateManyMutationInput =
      decision === 'decline'
        ? { status: 'rechazada', closedAt: new Date() }
        : { adjustmentSentAt: null, status: 'aprobada', approvedAt: new Date() };

    // Guarda + movimiento de ítems + relectura en UN SOLO boundary atómico, para que «solicitud
    // transicionada» e «ítems transicionados» no puedan divergir tras un commit (mismo criterio que
    // §4.18g). NO se pide Serializable a propósito: aquí no hay lectura-y-luego-decido que proteger
    // (a diferencia del tope mensual de `paySpei`), la exclusión mutua la da entera el `where` del
    // `updateMany`; subir el aislamiento sólo añadiría fallos de serialización espurios.
    const row = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.sellRequest.updateMany({
        where: {
          id,
          // `userId` va TAMBIÉN aquí, no sólo en el 404 de arriba: la autorización no puede quedarse
          // colgada de una lectura previa que una carrera pueda invalidar.
          userId,
          closedAt: null,
          adjustmentSentAt: { not: null },
          status: { in: [...SELL_REQUEST_LIVE_ADJUSTMENT_STATES] },
          // ✅ v1.51.5 (§4.39b.3, criterio 150): la CUARTA condición. En el ciclo de oferta el precio
          // es vinculante desde el correo y NO se ajusta después (D2/D9) — ni por esta puerta.
          offerSentAt: null,
        },
        data,
      });
      if (guard.count !== 1) {
        // Se re-lee DENTRO de la tx para que `details.status` sea el estado REAL contra el que se
        // chocó: el `req` de arriba ya puede estar viejo si otra llamada ganó la carrera.
        const current = await tx.sellRequest.findUnique({
          where: { id },
          select: { status: true, offerSentAt: true },
        });
        // ✅ v1.51.5: la rama de error DISCRIMINA. Una solicitud del ciclo no es «sin ajuste vivo»:
        // es «aquí no se ajusta, y no lo hará nunca» (criterio 150 por lo negativo).
        if (current?.offerSentAt != null) {
          throw BusinessException.conflict(
            'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
            'Price adjustments do not exist in the offer cycle: the offered price is binding',
            { status: current.status },
          );
        }
        throw BusinessException.conflict(
          'NO_LIVE_ADJUSTMENT',
          'No live price adjustment to respond to on this sell request',
          { status: current?.status },
        );
      }
      if (decision === 'accept') {
        // accept: los ítems ajustados pasan a aprobados. Va DESPUÉS de la guarda a propósito — una
        // respuesta ilegítima no debe mover ni un ítem.
        await tx.sellRequestItem.updateMany({
          where: { sellRequestId: id, itemStatus: 'ajustada' },
          data: { itemStatus: 'aprobada' },
        });
      }
      // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; el caller la proyecta con
      // `toCustomerSellRequestDTO` antes de devolverla (abajo). `updateMany` no devuelve filas, así
      // que la relectura es la única forma de responder el estado ya transicionado.
      return tx.sellRequest.findUnique({ where: { id } });
    });
    if (!row) throw BusinessException.notFound();
    // S49-M1: se PROYECTA — la fila cruda arrastra `clabeSnapshotEnc` y `closedAt` (interno, y en la
    // rama `decline` se acaba de escribir aquí mismo) hasta el cuerpo de la respuesta al VENDEDOR.
    return toCustomerSellRequestDTO(row);
  }

  // ---------------- Admin M5 ----------------

  async adminList(
    status: string | undefined,
    page: number,
    pageSize: number,
    userId?: string,
    // v1.25-buylist-orders-pagination (§M5): filtros ya validados por el controller
    // (parseAdminListFilters → 400 VALIDATION_ERROR). Omitidos = listado como HOY.
    filters?: {
      q?: string;
      dateRange?: { gte?: Date; lte?: Date };
      centsRange?: { gte?: number; lte?: number };
      /**
       * v1.51.8 · **BL-18** (§M5, D12/criterio 129) — `true` = todo lo que **NO** es terminal;
       * `false` = los terminales. `undefined` = sin filtro (comportamiento de hoy, intacto).
       */
      live?: boolean;
      /**
       * v1.51.1 · **D31** (§M5) — `true` ⇒ `status='aceptada' ∧ guideSentAt IS NULL`, orden
       * `acceptedAt` **asc**. Es un **FILTRO sobre la cola que ya existe**, no una cola nueva.
       */
      awaitingGuide?: boolean;
      /**
       * ⚠️ v1.51.20 · **I1** (§M5, v1.51.9) — `true` ⇒ solo las filas **en alerta de re-emisión**
       * (`offerReissueCount >= buylistOfferReissueAlertCount`). **Sin este filtro la alerta sería
       * decorativa:** obligaría a paginar la cola entera para encontrar las tres filas que importan
       * (lección de **P-5**). Estaba **declarado en el contrato y ausente del código**: el parámetro
       * se aceptaba y devolvía **el superconjunto**, que es peor que un 400 — parece que filtró.
       * Combinable con el resto (se **intersecta**), igual que `awaitingGuide`.
       */
      offerReissueAlert?: boolean;
    },
  ) {
    const where: Prisma.SellRequestWhereInput = {};
    const live = filters?.live;
    const awaitingGuide = filters?.awaitingGuide;
    // Los diales se izan UNA vez por request: alimentan la proyección Y —`reissueAlertCount`— el
    // `where` de esta cola. **El umbral es editable sin redeploy**, así que el filtro tiene que
    // leerlo, nunca compararlo contra una constante compilada.
    const dials = await this.adminCycleDials();
    // v1.25-buylist-orders-pagination (§M5): `status` pasa a aceptar CSV → `status IN (...)`
    // (la pestaña «Cerradas» = `pagada,rechazada,abandonada` en UNA llamada). Compat TOTAL: un solo
    // token se comporta IDÉNTICO a hoy (escalar `where.status = token`, no `{ in: [...] }`); omitirlo
    // = sin filtro de estado. Cada token debe ser `SellRequestStatus` válido; desconocido → 400
    // VALIDATION_ERROR con `details.invalidStatus` (nunca SQL crudo — Prisma parametrizado).
    if (status) {
      const tokens = status
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (tokens.length > 0) {
        const valid = Object.values(SellRequestStatus) as string[];
        const invalidStatus = tokens.filter((t) => !valid.includes(t));
        if (invalidStatus.length > 0) {
          throw BusinessException.badRequest(
            'VALIDATION_ERROR',
            'Invalid status token',
            { invalidStatus },
          );
        }
        where.status =
          tokens.length === 1
            ? (tokens[0] as SellRequestStatus)
            : { in: tokens as SellRequestStatus[] };
      }
    }
    // ⚠️ v1.51.8 · **BL-18** — `live?` POR EXCLUSIÓN, nunca como lista de estados vivos.
    //
    // Estaba **declarado en el contrato desde v1.51 y ausente del código**; mientras tanto la pestaña
    // «Cerradas» mandaba un CSV que **enumeraba los cuatro terminales** — la forma exacta que este
    // ciclo retiró de los otros cinco sitios. Se implementa (no se retira) porque `live?` **es** la
    // contraparte server-side de `isTerminal`: quitarlo del contrato **bendeciría** la enumeración en
    // el cliente justo después de haberla borrado de todas partes.
    //
    // **Por EXCLUSIÓN** sobre `SELL_REQUEST_TERMINAL_STATES` (criterio 129): así un estado nuevo del
    // enum entra a la vista de «vivas» **solo**, sin que nadie tenga que acordarse de nada. Es la
    // única de las dos direcciones en la que olvidarse falla hacia el lado seguro.
    //
    // **Combinable con `status`:** los dos predicados caen sobre el MISMO campo, así que se
    // **intersectan** con `AND` (no se pisan — asignar `where.status` dos veces dejaría ganar al
    // último y el filtro del usuario desaparecería en silencio). Una combinación contradictoria
    // —`status=pagada` con `live=true`— da **conjunto vacío, no un error**: pedir la intersección de
    // dos filtros legítimos es legítimo, y un 4xx obligaría al cliente a razonar sobre qué estados
    // son terminales… que es exactamente lo que este parámetro existe para evitar.
    if (live !== undefined) {
      const liveStatus: Prisma.EnumSellRequestStatusFilter = live
        ? { notIn: [...SELL_REQUEST_TERMINAL_STATES] }
        : { in: [...SELL_REQUEST_TERMINAL_STATES] };
      if (where.status !== undefined) {
        where.AND = [{ status: where.status }, { status: liveStatus }];
        delete where.status;
      } else {
        where.status = liveStatus;
      }
    }
    // ⚠️ v1.51.1 · **D31 — `awaitingGuide`: el pendiente NUESTRO que podía quedarse quieto para
    // siempre.** Con una sola banda la guía es un paso de TODA compra, y `shipDeadlineAt` solo se
    // congela al capturarla ⇒ **una `aceptada` sin guía no corre reloj y no expira nunca**. Eso es
    // **correcto** (§P.13: un plazo del vendedor solo puede vencer por algo que dependa del
    // vendedor, y la etiqueta depende de NOSOTROS), **pero sin esta vista el pendiente es
    // invisible** y la aceptación se queda quieta para siempre. *Un paso que ya no es opcional
    // necesita una cola que lo vigile.*
    //
    // Es un **FILTRO sobre la cola que ya existe**, no una cola nueva: el dato ya viaja en
    // `AdminBuylistDTO` y la lección de **P-5** prohíbe que el front lo derive paginando.
    //
    // Se combina con los demás por `AND` (mismo criterio que `live`: no se reasigna `status`, que
    // haría desaparecer en silencio el filtro que pidió el usuario).
    if (awaitingGuide === true) {
      where.AND = [
        ...((where.AND as Prisma.SellRequestWhereInput[]) ?? []),
        { status: 'aceptada' },
        { guideSentAt: null },
      ];
      if (where.status !== undefined) {
        where.AND.push({ status: where.status });
        delete where.status;
      }
    }
    // ⚠️ v1.51.20 · **I1** — la ALERTA DE RE-EMISIÓN como FILTRO, no como adorno.
    // Se compara contra el **dial vivo** (`buylistOfferReissueAlertCount`), la misma cifra con la que
    // la proyección deriva `offerReissueAlert`: **un solo umbral para el `where` y para el DTO**, o
    // la cola diría «tres filas en alerta» y devolvería otras.
    // Solo `true` filtra (el contrato solo declara ese valor); `false` y la ausencia dejan la cola
    // **exactamente** como estaba — mismo criterio tri-estado que `live`, `awaitingGuide`,
    // `guest` y `needsManual`: *un query param mal escrito no puede convertir una cola de trabajo en
    // un 400, y el modo seguro de un filtro ausente es «no filtrar».*
    // ⚠️ **NO BLOQUEA NADA**: es una vista. No expira, no cancela, no mueve estados y no gatea
    // `POST …/offer` — un tope automático dispararía sobre el VENDEDOR (§4.39o.19).
    if (filters?.offerReissueAlert === true) {
      where.AND = [
        ...((where.AND as Prisma.SellRequestWhereInput[]) ?? []),
        { offerReissueCount: { gte: dials.reissueAlertCount } },
      ];
    }
    // v1.7-admin-users: filtro opcional por SellRequest.userId (simetría con /admin/orders).
    if (userId) where.userId = userId;
    // v1.25-buylist-orders-pagination (§M5): `q` contains case-insensitive OR sobre folio
    // (`SellRequest.id`) + vendedor (`User.name`/`User.email` vía el join `user` ya existente).
    // NUNCA busca sobre CLABE/RFC/INE ni datos de pago (evita oráculo de enumeración de PII).
    if (filters?.q) {
      where.OR = [
        { id: { contains: filters.q, mode: 'insensitive' } },
        { user: { name: { contains: filters.q, mode: 'insensitive' } } },
        { user: { email: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }
    // Rango `createdAt` (gte/lte) y rango de MONTO sobre `quotedTotalCents` (gte/lte) — snapshot
    // histórico SIEMPRE presente (Int @default(0)); NO `approvedTotalCents` (nullable, excluiría las
    // rechazadas/abandonadas que dominan «Cerradas»). Ya validados/normalizados por el controller.
    if (filters?.dateRange) where.createdAt = filters.dateRange;
    if (filters?.centsRange) where.quotedTotalCents = filters.centsRange;
    // QA-BUG: `include: { items: true }` no traía `card`, y M5View crasheaba al leer
    // `it.card.name`. AdminBuylistDTO.items exige `card: CardDTO`; se incluye y mapea.
    // v1.18-buylist-rejects: orden NORMATIVO `createdAt desc` (más reciente primero; antes `asc`,
    // desviación anotada en BL-1) + `seller: AdminSellerRef` (join a User). El correo del vendedor
    // es dato de contacto operativo de back-office por rol — NO es la CLABE: sin enmascarado ni
    // reveal auditado (§4.18d). `userId` se conserva por compat (seller.id === userId).
    const [rows, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        // v1.51.1 (D31): en la vista `awaitingGuide` el orden es `acceptedAt` **asc** — lo más viejo
        // primero, porque ahí es una **cola de trabajo**, no un histórico.
        orderBy: awaitingGuide === true ? { acceptedAt: 'asc' } : { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: { include: { card: true } },
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    // Los diales se izan UNA vez por request (no por fila): son los mismos para todas.
    const data = rows.map((r) => ({
      // ⚠️ v1.51.20 · **BL-29** — la fila del listado sale de **LA MISMA proyección** que el detalle
      // y que las respuestas de mutación. Antes esta cola construía **su propio literal** con doce
      // claves, y por eso arrastraba el mismo agujero que `adminGet`: **ninguno de los veintiún
      // campos del ciclo salía**. *Dos proyecciones de la misma entidad divergen; la pregunta no es
      // si, es cuándo* — es literalmente la forma que tomó S49-M2 en `AdminOrderSummaryDTO`.
      ...this.adminSellRequestDTO(r, dials),
      seller: this.sellerRef(r.user),
      items: r.items.map((i) => this.itemDTO(i)),
      // ⚠️ **LO QUE ESTA COLA NO GANA, y es deliberado: `pickupAddress`.** Un LISTADO paginado de
      // domicilios es **cosecha masiva de PII** (N filas por request) — misma decisión y mismo
      // argumento que `AdminOrderSummaryDTO`, que ya excluye `shippingAddressSnapshot`. La dirección
      // va en el DETALLE, que es donde se compra la etiqueta.
    }));
    return { data, page, pageSize, total };
  }

  /**
   * ⚠️ v1.51.20 · **BL-29** — **los DOS diales que la proyección admin necesita, izados UNA vez.**
   *
   * `getNumber` es **una query por llamada** (no hay caché de diales), así que leerlos por fila sería
   * un N+1 sobre una cola paginada. Se leen **por request** y se pasan a la proyección. En un listado
   * es el mismo dial para todas las filas por definición: *un umbral que cambiara entre la fila 3 y
   * la 4 de la misma pantalla sería un bug, no una feature.*
   */
  private async adminCycleDials(): Promise<{ offerIssueDays: number; reissueAlertCount: number }> {
    const [offerIssueDays, reissueAlertCount] = await Promise.all([
      this.settings.getNumber(SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS),
      this.settings.getNumber(SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT),
    ]);
    return { offerIssueDays, reissueAlertCount };
  }

  /**
   * ⚠️⚠️ v1.51.20 · **BL-29** — **LA PROYECCIÓN ADMIN COMPLETA: base compartida + EL CICLO.**
   *
   * ### El defecto que cierra, y su tamaño
   * `AdminBuylistDTO` (§11, v1.51 → v1.51.8) declara **veinticuatro** campos del ciclo de
   * adquisición. La proyección emitía **dos** (`isTerminal`, `isPayable`) y **las columnas
   * pre-ciclo**: todo lo demás —`offerState`, los **tres montos congelados**, los plazos, la guía, el
   * cierre por caducidad, `payoutNetCents`— **se quedaba en la fila**. **Los datos SÍ estaban en la
   * BD**: era un fallo de **PROYECCIÓN**, no de persistencia, y por eso ninguna prueba de escritura
   * lo veía. Consecuencia medida por QA: código de frontend **ya escrito** quedaba muerto —el número
   * de guía siempre vacío, el motivo de cierre `undefined`— y la respuesta de `POST …/decline`
   * omitía **`expiredReason` y `declinedBy`**, que el contrato exige sellados en la respuesta de una
   * **mutación terminal**.
   *
   * ### Los DOS derivados, y por qué no se persisten
   * - **`offerIssueDeadlineAt`** (D33/D38) — `addBusinessDays(offerIssueClockStartedAt ?? createdAt,
   *   dial)`, `null` salvo en `cotizada`. **No se persiste porque NO se le comunica al vendedor**: es
   *   un SLA NUESTRO, y el criterio 157 congela lo que ya prometimos, no lo que no dijimos. Su `null`
   *   es **ambiguo por diseño** («no es `cotizada`»), así que la indisponibilidad de calendario lleva
   *   **bandera propia** (`offerIssueDeadlineUnavailable`, BL-22): sin ella, un fallo de la tabla de
   *   festivos se leería como *«esta fila no caduca»*.
   * - **`offerReissueAlert`** — `offerReissueCount >= buylistOfferReissueAlertCount`. **El servidor
   *   manda el NÚMERO y el VEREDICTO**; la UI no compara contra una constante propia, porque el
   *   umbral es **editable sin redeploy**. ⚠️ **NO BLOQUEA NADA**: no expira, no cancela, no mueve
   *   estados y no gatea `POST …/offer` — un tope automático dispararía **sobre el VENDEDOR**, que no
   *   causó las re-emisiones (§4.39o.19).
   *
   * ⚠️ **TODO lo de este bloque es ADMIN-ONLY** y por eso vive **aquí y no en la base**: la
   * proyección de cliente no lee esta función, así que no puede heredar nada de esto por descuido.
   */
  private adminSellRequestDTO(
    r: SellRequestBaseRow &
      SellRequestCycleRow & { createdAt: Date } & {
        items: readonly { id: string; offerDecision?: BuyDecision | null; itemStatus: SellItemStatus }[];
      },
    dials: { offerIssueDays: number; reissueAlertCount: number },
  ) {
    const reissueCount = r.offerReissueCount ?? 0;
    // ⚠️ v1.61 · §M5-V — el `?? []` es **solo por los mocks de las suites unitarias**, que construyen
    // filas a mano y no pasan por el compilador. En producción `items` es OBLIGATORIO en el tipo:
    // ninguna ruta real puede llegar aquí sin ellas.
    const pendingDecisionItemIds = pendingBuyDecisionItemIds(r, r.items ?? []);
    return {
      ...toSellRequestBaseDTO(r),
      // ⚠️ v1.51.11 · **BL-20** (§4.39c **SITIO 10**) — `isPayable` DERIVADO, en la proyección
      // COMPARTIDA de admin y no en cada shape: así las CUATRO respuestas de mutación (`receive`,
      // `verify`, `reject`, `pay-spei`) lo heredan y **ninguna mutación futura puede olvidarlo**.
      // ⚠️ **ADMIN-ONLY**: al vendedor le anticiparía un depósito que aún puede no ocurrir.
      // ⚠️⚠️ v1.61 · **§M5-V.5** — los DOS términos nuevos. Si `isPayable` se quedara con los tres de
      // v1.57, la pantalla del `super_admin` diría «lista para pagar» sobre una solicitud que el
      // servidor va a rechazar con `422 ITEMS_NOT_DECIDED` (o con la genérica de V-a): **la
      // repetición exacta del defecto ALTA de §M5-P** (*«un control activo que desinforma al que
      // autoriza el dinero es peor que no tener control»*). La propiedad es normativa:
      // `isPayable === true ⇒ pay-spei no falla por precondición`.
      isPayable: isPayableSellRequestWithItems(r, r.items ?? []),
      // ⚠️ v1.61 · §M5-V.5 — **ADITIVO y ADMIN-ONLY**: cuántas líneas COMPRADAS siguen sin veredicto.
      // Es lo que deja a la UI decir **por qué** el botón está apagado y **a dónde ir**. ⛔ El front
      // NO lo cuenta él mismo aunque tenga `items[]`: serían DOS reglas transcritas al cliente (el
      // set de estados «sin veredicto» **y** el filtro `buy`), y este proyecto ya borró cinco copias
      // de sets de estado por esa vía. **El servidor manda el número.**
      pendingDecisionItemCount: pendingDecisionItemIds.length,
      // Identidad del súper-admin que liquidó: back-office legítimo, NUNCA en la vista del cliente.
      paidBy: r.paidBy,
      // SEC-D2: dato INTERNO de cumplimiento (ancla la retención de INE). Solo vista admin.
      closedAt: r.closedAt,

      // ---------------- v1.51 (M-46) — EL CICLO DE ADQUISICIÓN, admin-only ----------------
      // ⚠️ `offerState` JAMÁS en un DTO de cliente: una oferta `pending_authorization` le filtraría al
      // vendedor la existencia y el orden de magnitud de nuestro TOPE INTERNO.
      offerState: r.offerState ?? null,
      offerSentAt: r.offerSentAt ?? null,
      // Los TRES montos congelados al ofertar. `offerGrossCents` es la base de los topes AML/KYC y del
      // umbral de INE (criterios 136/155); `offerNetCents` es la cifra vinculante frente al vendedor.
      offerGrossCents: r.offerGrossCents ?? null,
      offerShippingFeeCents: r.offerShippingFeeCents ?? null,
      offerNetCents: r.offerNetCents ?? null,
      offerAcceptDeadlineAt: r.offerAcceptDeadlineAt ?? null,
      ...this.offerIssueDeadlineFields(
        {
          status: r.status,
          createdAt: r.createdAt,
          offerIssueClockStartedAt: r.offerIssueClockStartedAt ?? null,
        },
        dials.offerIssueDays,
      ),
      acceptedAt: r.acceptedAt ?? null,
      // Guía y tránsito (D19/D20/D22, criterios 122/123/139). ⚠️ `guideSentAt` NO es derivable de
      // `shipmentCarrier != null`: al corregir la dirección tras la guía se LIMPIA `guideSentAt` y se
      // CONSERVAN carrier/tracking (son lo que hay que cancelar).
      guideSentAt: r.guideSentAt ?? null,
      shipDeadlineAt: r.shipDeadlineAt ?? null,
      shipmentCarrier: r.shipmentCarrier ?? null,
      shipmentTrackingNumber: r.shipmentTrackingNumber ?? null,
      // «Ya lo mandé» del vendedor: DETIENE el reloj y NO mueve el estado ni «en camino» (crit. 138/156).
      sellerShippedDeclaredAt: r.sellerShippedDeclaredAt ?? null,
      // D20: SOLO esto mueve a `en_transito` y SOLO esto suma a «en camino» (criterio 116).
      shipmentConfirmedAt: r.shipmentConfirmedAt ?? null,
      guideCancellationPendingAt: r.guideCancellationPendingAt ?? null,
      guideCancellationDoneAt: r.guideCancellationDoneAt ?? null,
      // Costo REAL de la etiqueta muerta. ⚠️ NO participa en `payoutNetCents`: es insumo de REPORTE.
      guideActualCostCents: r.guideActualCostCents ?? null,
      // D33 — por qué expiró; `null` si no está `expirada`. Lo persiste el barrido.
      expiredReason: r.expiredReason ?? null,
      // D39 — `null` ⇒ la cerró el BARRIDO; poblado ⇒ la declinó UNA PERSONA. Es el ÚNICO
      // discriminador entre «decidimos» y «dejamos vencer», y por eso `expiredReason` NO gana un
      // tercer valor: ese enum viaja al CLIENTE y gobierna su copy.
      declinedBy: r.declinedBy ?? null,
      offerReissueCount: reissueCount,
      offerReissueAlert: reissueCount >= dials.reissueAlertCount,
      // Lo que SALIÓ por SPEI, sellado en la MISMA transacción que `pagada`. Fuente de la caja de M7,
      // distinta del acumulado de COMPROMISO que gobierna el tope mensual (que se mide en BRUTOS).
      payoutNetCents: r.payoutNetCents ?? null,
    };
  }

  /** v1.18-buylist-rejects: AdminSellerRef = { id, name, email } (§11). Tolerante a mocks sin join. */
  private sellerRef(
    user: { id: string; name: string; email: string; phone?: string | null } | null | undefined,
  ): { id: string; name: string; email: string; phone: string | null } | undefined {
    return user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          // ⚠️ v1.51 · **BL-15** (D12, criterios 129/130) — **el teléfono viaja EN LA FILA**, para que
          // el operador **pueda llamar desde la solicitud sin ir a buscar al usuario**. Ése es el
          // requisito: *«que sepamos qué usuarios tienen cotizaciones abiertas»* y poder contactarlos.
          //
          // **Régimen PII: el MISMO que el correo del vendedor** (§4.18d) — dato de contacto
          // operativo de back-office **tras el guard de rol**, **sin enmascarado y sin reveal
          // auditado**. **No es la CLABE**, cuyo régimen no cambia en nada.
          // ⛔ **PROHIBIDO en toda superficie pública** (criterio 130) y **PROHIBIDO en el buscador
          // `q`**: buscar por teléfono convertiría el listado en un **oráculo de enumeración** —
          // quien probara números sabría cuáles tienen cuenta aquí. Hay guard de test.
          // `null` en cuentas de Google y en cuentas viejas sin capturar.
          phone: user.phone ?? null,
        }
      : undefined;
  }

  async adminGet(id: string) {
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: {
        items: { include: { card: true } },
        // v1.18-buylist-rejects: mismo `seller: AdminSellerRef` que el listado (§M5).
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!req) throw BusinessException.notFound();
    // La CLABE cifrada NUNCA se expone en la vista de detalle; solo por el reveal dedicado.
    // El join de User tampoco se propaga crudo: se proyecta SOLO el AdminSellerRef.
    // S49-M1: la cabecera pasa por la MISMA lista blanca que `receive`/`verify`/`pay-spei` — antes
    // era un rest-destructuring (lista NEGRA de un solo campo).
    return {
      ...this.adminSellRequestDTO(req, await this.adminCycleDials()),
      seller: this.sellerRef(req.user),
      // ⚠️ v1.51.3 (D36/D37) — **la dirección de ORIGEN, en el DETALLE y NO en el listado.** Es la
      // que el operador teclea a mano en el portal de la paquetería para comprar la etiqueta (D19).
      // **Sin este campo el paso operativo de `POST …/guide` no existe.** Un listado paginado de
      // domicilios sería cosecha masiva de PII — misma decisión que `AdminOrderSummaryDTO`.
      // `null` ⇒ fila LEGACY (pre-M-46) ⇒ **no se puede ofertar** (`422 PICKUP_ADDRESS_MISSING`):
      // se le pide al vendedor por teléfono que la capture, o se declina. ⚠️ **Nunca se rellena
      // leyendo la libreta viva.**
      pickupAddress: req.pickupAddressSnapshot ?? null,
      // v1.18-buylist-rejects: items como SellItemDTO (incluye campos de rechazo + plazos derivados).
      items: (req.items ?? []).map((i) => this.itemDTO(i)),
      clabeMasked: maskClabe(this.pii.decryptOptional(req.clabeSnapshotEnc)),
    };
  }

  /**
   * v1.51 (M-46, D6 · API_CONTRACT §M5 · ARCHITECTURE §4.39f/g · criterios 115/116/117/144/153) —
   * **`GET /admin/buylist/:id/decision-table`: LA MESA DE DECISIÓN.**
   *
   * > *«El admin no debería decidir una compra sin saber cuánto de eso ya tiene. Ocho copias en la
   * > caja y tres más en camino es una razón perfectamente buena para no comprar la novena — y hoy esa
   * > información no está en la pantalla donde se decide.»* (`PROJECT.md` §P.2)
   *
   * Por línea: qué pidió vender y **cuánto se le cotizó**, el **precio derivado por la curva VIGENTE
   * AHORA** (no se hereda de la cotización: entre cotizar y ofertar el mercado se movió), la
   * **posición con sus CUATRO sumandos** y una **sugerencia** que dice **qué regla se disparó**.
   *
   * ### Las cuatro reglas que no se negocian
   * 1. **⚠️ Puerto de posición caído ⇒ `position: null` + `positionUnavailable: true`. JAMÁS `0`.**
   *    Este puerto **NO es best-effort como `MAIL_PORT`** (§4.39f). Un `0` es una mentira accionable:
   *    dice «no tenemos ninguna, compra» cuando la verdad es «no sé», y el operador compraría contra
   *    un dato inventado. Con el puerto caído `suggestion.verdict = 'none'` y el front pinta
   *    «SIN CONTEO» (DESIGN_SYSTEM §23.7).
   * 2. **Los cuatro sumandos NUNCA se colapsan en una cifra.** `stock + verifying + inTransit +
   *    committed` viajan por separado **porque tienen confianza distinta**: el stock es físico, lo
   *    comprometido es una promesa. Esa distinción es exactamente lo que pidió `PROJECT.md` §P.2.
   * 3. **«En camino» que se pinta = `position.inTransit` y nada más** (criterio 116). Una solicitud
   *    `aceptada` **no** suma: *es una promesa, no un paquete*. Solo cuenta lo que el operador ya
   *    confirmó como enviado (D20) — ni la guía emitida, ni el «ya lo mandé» del vendedor.
   * 4. **La sugerencia NUNCA bloquea** (D6) y **dice qué regla la disparó** (criterios 115/144/153).
   *    El backend **no** valida la oferta contra ella: el admin compra una línea con `do_not_buy` y
   *    descarta una con `buy`, sin fricción ni permiso extra. Está escrito aquí para que nadie lo
   *    «endurezca» por parecer prudente: endurecerlo **contradice `PROJECT.md`**.
   *
   * ### Money-safe y sin N+1
   * Es una pantalla de back-office que se abre **por cada solicitud**, así que el coste se paga en
   * cada apertura: todas las lecturas van **en lote** y su número **no crece con el número de
   * líneas** (curva, overrides, referencias set_base, productos separados y sus referencias, la
   * posición on-hand y los tres sumandos de `SellRequestItem`).
   *
   * **NO se audita** (§4.39, tabla de auditoría): *la mesa decide qué comprar, no cómo nos hemos
   * portado*. Es una lectura; lo que se audita es la **emisión** de la oferta.
   *
   * **Nada de aquí se filtra al vendedor** (API_CONTRACT §6): posición, sugerencia, «en camino» y el
   * tope del operador son cifras internas. `GET /buylist/requests/:id` no las gana.
   */
  async adminDecisionTable(id: string, actor: { id: string; role: Role }) {
    // (1) LA SOLICITUD — una query con sus líneas, su carta (con el set, que `CardDTO` necesita para
    // el rótulo de identidad de la línea) y el vendedor.
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: {
        items: { include: { card: { include: { set: true } } } },
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!req) throw BusinessException.notFound();
    const items = req.items ?? [];
    // ⚠️ v1.58 · §M5-A.8 (BL-38) — el archivo de INE del VENDEDOR, para el aviso de la mesa. Se lee
    // del `KycProfile` (la fuente autoritativa que usa la guarda de `POST …/offer`) y **no** de
    // `SellRequest.ineProvided`, que es un snapshot del intake: el vendedor pudo subirlo después.
    // *La mesa y la emisión miran el mismo archivo o el aviso miente.*
    const kycIne = await this.prisma.kycProfile.findUnique({
      where: { userId: req.userId },
      select: { ineFrontKey: true, ineBackKey: true },
    });

    // (2)+(3) LAS LLAVES Y EL DINERO EN LOTE — **el MISMO seam que usa la emisión de la oferta**
    // (§4.39e). La mesa previsualiza exactamente el número que `POST …/offer` va a congelar: si la
    // previsualización y la emisión leyeran por caminos distintos, el operador decidiría con una
    // cifra y firmaría otra.
    const { lines, decisions, overrides } = await this.deriveOfferLinesBatch(items);

    // (4) LA POSICIÓN — cuatro sumandos, cuatro fuentes, UNA llave.
    // ⚠️ B-3: **solo las líneas cuya identidad la llave puede expresar**. Las demás no reciben bucket
    // y salen por el camino honesto que ya existe (`positionUnavailable`). Ver `gradeKeyInputFor`.
    // v1.53: el filtro es sobre la llave YA resuelta —`gradeKey != null` es el mismo predicado, pero
    // el compilador lo estrecha— en vez de re-preguntar por el `productType`.
    const position = await this.positionFor(
      lines.flatMap((l) => {
        const gradeKey = l.variant.gradeKey;
        return gradeKey == null ? [] : [{ ...l.variant, gradeKey, cardProductId: l.cardProductId }];
      }),
      req.id,
    );

    // (5) LOS DIALES vigentes. Se leen AHORA porque la mesa es una PREVISUALIZACIÓN: lo vinculante se
    // congela al EMITIR, no aquí.
    const [shippingFeeCents, minimumOfferNetCents, operatorCapCents, variantPositionCap] =
      await Promise.all([
        this.settings.getNumber(SettingKey.BUYLIST_SHIPPING_FEE_CENTS),
        this.settings.getNumber(SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS),
        this.settings.getNumber(SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS),
        this.settings.getNumber(SettingKey.BUYLIST_VARIANT_POSITION_CAP),
      ]);

    const dtoLines = [];
    let buyableGrossCents = 0;
    for (const l of lines) {
      const { it } = l;
      // El override M-30 se llavea SIN `cardProductId`, así que mapea a la variante de SET_BASE. En
      // una línea de producto separado se IGNORA —igual que en el precio (§4.29b)—: aplicarlo sería
      // fusionar dos identidades, que es el error que §P.8 llama «peor que no mostrar nada».
      // v1.53 (§4.40.4b): una línea LEGACY sin llave de variante no tiene override que mirar.
      const override =
        l.cardProductId == null && l.variant.gradeKey != null
          ? (overrides.get(variantKey({ ...l.variant, gradeKey: l.variant.gradeKey })) ?? null)
          : null;

      const decision = decisions.get(it.id) ?? null;
      const derivedPriceCents = decision?.quotedPriceCents ?? null;
      if (derivedPriceCents != null) buyableGrossCents += derivedPriceCents;

      dtoLines.push({
        itemId: it.id,
        card: toCardDTO(it.card),
        productType: it.productType,
        finish: (it.finish ?? 'normal') as Finish,
        // D7: la identidad REAL de la pieza viaja, y es la que entró a la llave del conteo.
        cardProductId: l.cardProductId,
        // (a) lo que se le cotizó — el snapshot congelado al crear la solicitud.
        quotedPriceCents: it.quotedPriceCents ?? null,
        // El derivado por la curva VIGENTE. `null` ⇒ el front pinta `SIN PRECIO`, JAMÁS `MX$ 0.00`.
        derivedPriceCents,
        priceBasis: decision?.priceBasis ?? ('pending' as PriceBasis),
        pendingReason: decision?.pendingReason ?? null,
        ...this.positionAndSuggestion(
          position,
          l.positionKey,
          override,
          decision,
          variantPositionCap,
        ),
      });
    }

    // (6) TOTALES — PREVISUALIZACIÓN de la selección POR DEFECTO (DESIGN_SYSTEM §23.6g: toda línea
    // con precio resoluble nace marcada como «comprar»; la que no tiene precio nace desmarcada,
    // porque no se puede ofertar sin monto). El operador quita líneas y la UI recalcula la suma; el
    // UMBRAL y el VEREDICTO los sigue mandando el servidor (los diales se editan sin redeploy, así
    // que una constante en el front quedaría desincronizada en silencio).
    const netCents = Math.max(0, buyableGrossCents - shippingFeeCents);
    return {
      sellRequestId: req.id,
      status: req.status,
      seller: this.sellerRef(req.user),
      quotedTotalCents: req.quotedTotalCents,
      lines: dtoLines,
      totals: {
        buyableGrossCents,
        shippingFeeCents,
        netCents,
        minimumOfferNetCents,
        requiredGrossCents: minimumOfferNetCents + shippingFeeCents,
        netBelowMinimum: netCents < minimumOfferNetCents,
      },
      operatorCapCents,
      // AVISO, no bloqueo (D24): el operador PUEDE preparar la oferta; lo que no puede es que salga
      // sola. El súper-admin oferta sin tope.
      requiresAuthorization:
        actor.role === Role.vault_operator && buyableGrossCents > operatorCapCents,
      // v1.51.3 (D36) — AVISO, no bloqueo: quien bloquea es `POST …/offer` con
      // `422 PICKUP_ADDRESS_MISSING`. Es un BOOLEANO y no la dirección: la mesa es una pantalla de
      // decisión de compra, no de datos personales (la dirección vive en el detalle).
      pickupAddressMissing: req.pickupAddressSnapshot == null,
      // ⚠️ v1.58 · §M5-A.8 (BL-38) — AVISO, no bloqueo: quien bloquea es `POST …/offer` con
      // `422 INE_REQUIRED`. Existe por la MISMA razón que `pickupAddressMissing`: *el operador tiene
      // que poder verlo ANTES de armar la oferta entera*; sin él monta el cherry-pick línea por línea
      // y se lleva el `422` al final **por un motivo que no tiene nada que ver con las líneas**, y
      // encima el remedio es una llamada telefónica —lo más lento del ciclo— que podría haber
      // empezado media hora antes.
      // ⛔ **NO lleva el umbral de INE, ni los topes AML, ni el acumulado del mes: la lista es
      // CERRADA** (§M5-A.7). El operador **no es el sujeto** de la regla y el número no acota su
      // acción. *Un cajón donde ya viaja un booleano de cumplimiento es exactamente donde alguien echa
      // el umbral «porque ya había campo».*
      // ⚠️ Va en la RAÍZ y **no en `totals`**: `totals` son montos de ESTA previsualización;
      // `sellerIneOnFile` es un hecho del VENDEDOR, igual que `pickupAddressMissing` lo es de la
      // SOLICITUD. **Clase de información ya existente**: `AdminKycProfileDTO.ineOnFile` expone este
      // mismo booleano a admin.
      sellerIneOnFile: kycIne?.ineFrontKey != null && kycIne?.ineBackKey != null,
    };
  }

  /**
   * v1.51 (M-46, §4.39e) — **LAS LLAVES Y EL DINERO DE LAS N LÍNEAS, EN LOTE. UN solo seam para la
   * MESA y para la EMISIÓN.**
   *
   * Existe porque la mesa **previsualiza exactamente el número que la emisión va a congelar**: si las
   * dos leyeran por caminos distintos, el operador decidiría con una cifra y firmaría otra — la misma
   * clase de divergencia que `decideBuyLine` vino a cerrar entre el cotizador público y la solicitud.
   *
   * **Sin N+1:** una lectura de curva, un batch de `VariantPriceOverride`, un batch de `PriceReference`
   * de set_base, un batch de `CardProduct` y un batch de referencias por producto. **Cinco lecturas,
   * no crecen con el número de líneas.**
   *
   * ⚠️ La secuencia curva/override/bounty/pendiente **NO se reimplementa aquí**: sigue viviendo en
   * `decideBuyLine` y solo en él. Esto es carga de datos, no decisión de dinero.
   */
  private async deriveOfferLinesBatch(
    items: (DecisionLine['it'] & { cardProductId: number | null })[],
  ): Promise<{
    lines: (DecisionLine & { positionKey: string | null })[];
    decisions: Map<string, BuyLineDecision | null>;
    overrides: Map<string, VariantPriceOverride>;
  }> {
    // Las llaves se construyen UNA vez por línea y las consumen las CUATRO fuentes de la posición +
    // los dos mapas de dinero. `variantKey()` / `variantPositionKey()`, NUNCA una interpolación a
    // mano: si una fuente llaveara distinto, las cifras se desalinearían EN SILENCIO.
    const lines = items.map((it) => {
      // ⚠️ v1.53 (§4.40.4b, doctrina «el dinero LANZA, la lectura DEGRADA») — este seam lo comparten
      // la MESA (previsualización) y la EMISIÓN, y lee filas **históricas**: la guarda raw-only cerró
      // la puerta de entrada (§4.40.3), **no la tabla**. Una solicitud `graded` creada antes de v1.53
      // sigue en BD y el operador tiene que poder ABRIRLA. Por eso aquí no se llama al constructor
      // que lanza: se le pide a `gradeKeyInputFor` el input de ESTA línea y, si no lo hay, la llave
      // vale `null` — sin override, sin referencia y sin bucket de posición.
      // ⚠️ v1.54 · B-3: el `{ productType: 'raw' }` que iba escrito aquí a mano **ya no existe**. La
      // identidad la produce el `switch`, así que esta línea **no puede** llavear una graduada como
      // raw ni aunque la lista de negocio se ensanche.
      const input = BuylistService.gradeKeyInputFor(it);
      const gradeKey = input == null ? null : this.pricing.gradeKeyFor(input);
      const finish = (it.finish ?? 'normal') as Finish;
      const variant = { cardId: it.cardId, productType: it.productType, gradeKey, finish };
      return {
        it,
        variant,
        cardProductId: it.cardProductId ?? null,
        // Sin llave de variante no hay llave de posición: el `null` viaja hasta
        // `positionAndSuggestion`, que lo traduce a `positionUnavailable` (jamás a un 0).
        positionKey:
          gradeKey == null
            ? null
            : variantPositionKey({ ...variant, gradeKey, cardProductId: it.cardProductId ?? null }),
      };
    });

    const curve = await this.pricing.loadPricingCurve();
    // v1.53 (§4.40.4b): las líneas SIN llave no entran a ningún lote. No es una optimización — es que
    // no hay nada que buscar: preguntarle a los mapas por una clave inventada devolvería el precio de
    // OTRA variante. Es el mismo filtro que `batchQuote` aplica a los overrides (§4.40.3.3).
    // `flatMap` y no `filter`, porque además del filtro hace el ESTRECHAMIENTO: lo que sale ya tiene
    // `gradeKey: string` por tipo, sin un `!` que un refactor futuro pueda dejar mintiendo.
    const keyed = lines.flatMap((l) => {
      const gradeKey = l.variant.gradeKey;
      return gradeKey == null ? [] : [{ ...l, variant: { ...l.variant, gradeKey } }];
    });
    const overrides = await this.pricing.getVariantOverridesBatch(keyed.map((l) => l.variant));
    const baseRefs = await this.pricing.getReferencesBatch(
      keyed.filter((l) => l.cardProductId == null).map((l) => l.variant),
    );
    const products = await this.pricing.findCardProductsByTcgIds(
      keyed.filter((l) => l.cardProductId != null).map((l) => l.cardProductId as number),
    );
    const productRefs = await this.pricing.getReferencesByCardProductBatch(
      keyed
        .filter((l) => l.cardProductId != null)
        .map((l) => {
          const cp = products.get(l.cardProductId as number);
          return cp
            ? {
                cardProductId: cp.id,
                productType: l.variant.productType,
                gradeKey: l.variant.gradeKey,
                finish: l.variant.finish,
              }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x != null),
    );

    const decisions = new Map<string, BuyLineDecision | null>();
    for (const l of lines) {
      // El override M-30 se llavea SIN `cardProductId` ⇒ describe la variante de SET_BASE. En una
      // línea de producto separado se IGNORA (§4.39g.2): aplicarlo sería fusionar dos identidades.
      // v1.53: sin llave tampoco hay override que buscar (§4.40.4b).
      const override =
        l.cardProductId == null && l.variant.gradeKey != null
          ? (overrides.get(variantKey({ ...l.variant, gradeKey: l.variant.gradeKey })) ?? null)
          : null;
      decisions.set(
        l.it.id,
        await this.derivedLine(l, curve, override, baseRefs, products, productRefs),
      );
    }
    return { lines, decisions, overrides };
  }

  /**
   * v1.51 (M-46, §4.39e) — el precio DERIVADO de una línea, por el **seam único** `decideBuyLine`
   * con la curva vigente y los lotes ya leídos. Prohibida una cuarta reimplementación de la
   * secuencia curva/override/bounty/pendiente.
   *
   * **`null` = la línea no tiene precio derivable por un problema de IDENTIDAD**, no de mercado: el
   * acabado snapshoteado ya no está en `availableFinishes` de la carta (deriva del catálogo), o el
   * `cardProductId` no resuelve. La mesa **no revienta con un 422 por eso** —el contrato solo declara
   * `403`/`404` y esta pantalla es diagnóstica—, pero **tampoco inventa un `pendingReason`**: los dos
   * valores de ese enum (`no_market`/`premium_at_floor`) afirman algo sobre el MERCADO, y aquí el
   * mercado no llegó a consultarse. Se devuelve `derivedPriceCents: null` con `pendingReason: null`:
   * el front pinta `SIN PRECIO` y la línea sigue siendo rescatable con override al ofertar.
   * *La respuesta correcta a un dato que falta es decir que falta, no elegirle un motivo.*
   */
  private async derivedLine(
    l: DecisionLine,
    curve: PricingCurve,
    override: VariantPriceOverride | null,
    baseRefs: Map<string, { status: string; referenceMxnCents?: number | null }>,
    products: Map<number, { id: string; cardId: string; finishes: string[] }>,
    productRefs: Map<string, { status: string; referenceMxnCents?: number | null }>,
  ): Promise<BuyLineDecision | null> {
    const { it } = l;
    const cp = l.cardProductId != null ? (products.get(l.cardProductId) ?? null) : null;
    // ⚠️ v1.53 (§4.40.4b): la llave se REUSA de `l.variant`, no se vuelve a derivar. Antes se
    // reconstruía aquí con una segunda llamada a `gradeKeyFor` — dos derivaciones de la misma clave
    // en el mismo seam, exactamente el drift que `variant-key.ts` vino a cerrar una capa más arriba.
    // `null` (línea legacy no-raw) ⇒ no hay referencia que buscar: `pending`, y la línea **ni
    // siquiera entra** al cuerpo del dinero (ver el corto abajo).
    const gradeKey = l.variant.gradeKey;
    const reference =
      gradeKey == null
        ? { status: 'pending' }
        : l.cardProductId == null
          ? (baseRefs.get(
              variantKey({
                cardId: it.cardId,
                productType: it.productType,
                gradeKey,
                finish: l.variant.finish,
              }),
            ) ?? { status: 'pending' })
          : (cp
              ? productRefs.get(
                  cardProductRefKey({
                    cardProductId: cp.id,
                    productType: it.productType,
                    gradeKey,
                    finish: l.variant.finish,
                  }),
                )
              : null) ?? { status: 'pending' };
    // ⚠️ v1.55 · B-3 — **SIN LLAVE NO SE ENTRA AL CUERPO DEL DINERO, y el corto va AQUÍ, no en el
    // `catch`.** Antes la línea sin llave sí entraba y salía por la degradación del `catch`, que
    // atrapa `BUYLIST_RAW_ONLY`; o sea que **la pantalla dependía de QUÉ CÓDIGO lanzara la guarda**.
    // El día de `M-49` eso se rompe solo: con `'graded'` en la lista, la guarda de política ya no
    // dispara y el que lanza es el backstop de identidad (`500 BUYLIST_LINE_NOT_KEYABLE`), que **no
    // está en el allowlist** ⇒ una fila vieja **tumbaría la mesa entera**, que es exactamente lo que
    // toda esta degradación existe para impedir. Preguntar por la llave —el dato— en vez de por el
    // código de error —el síntoma— hace que la pantalla no dependa de eso.
    // *La lectura degrada; y degrada por lo que SABE, no por lo que le lanzaron.*
    if (gradeKey == null) {
      this.logger.warn(
        `decision-table: línea ${it.id} (${it.productType}) sin llave de variante; se emite SIN monto ` +
          'y sin motivo de mercado (la emisión exigirá `skip` u override motivado).',
      );
      return null;
    }
    try {
      return await this.decideBuyLine({
        card: it.card,
        productType: it.productType,
        rawCondition: it.rawCondition ?? undefined,
        finish: (it.finish ?? undefined) as Finish | undefined,
        curve,
        override,
        productId: l.cardProductId ?? undefined,
        prefetched: {
          cardProduct: cp ? { id: cp.id, cardId: cp.cardId, finishes: cp.finishes as Finish[] } : null,
          reference,
        },
      });
    } catch (e) {
      // Los códigos por-ítem que `batchQuote` degrada sin tumbar el lote (§4.29c), **MENOS uno**.
      // Cualquier otro error (infra) se propaga: un fallo de BD no puede disfrazarse de «línea sin
      // precio».
      // ⚠️ v1.54 — **la omisión de `NOT_FOUND` es DELIBERADA, y antes no estaba declarada** (el
      // comentario decía «los MISMOS» y eran cuatro de cinco, que es como una lista deja de vigilarse
      // a sí misma). Allí la carta la nombra **el cliente** y puede no existir ⇒ es un error suyo,
      // por-ítem. Aquí la carta viene **de la propia solicitud, ya cargada con su `include`**: si el
      // constructor dijera `NOT_FOUND` sería una inconsistencia NUESTRA —una `SellRequestItem`
      // apuntando a una `Card` inexistente—, y eso **no se pinta como «línea sin precio»**: sube.
      if (
        e instanceof BusinessException &&
        (e.code === 'FINISH_NOT_AVAILABLE' ||
          e.code === 'PRODUCT_NOT_FOUND' ||
          e.code === 'PRODUCT_CARD_MISMATCH' ||
          // ⚠️ v1.53 (§4.40.3.3 + §4.40.4b): la guarda raw-only entra al allowlist POR EL MISMO
          // motivo que en `batchQuote`, y aquí importa más: la mesa se abre sobre solicitudes
          // HISTÓRICAS, y una línea `graded` creada antes de la guarda tumbaría **la pantalla
          // entera** —con sus otras líneas raw perfectamente ofertables— por un dato viejo.
          // Degradar aquí NO afloja el dinero: `derived = null` ⇒ la emisión exige override
          // explícito con motivo o `skip` (`422 OFFER_LINE_NOT_PRICEABLE`).
          // ⚠️ v1.55 · B-3: **este código ya NO es el que sostiene la degradación de las no-raw** —lo
          // hace el corto por `gradeKey == null`, arriba—. Se queda porque la guarda se re-aplica
          // dentro de `decideBuyLine` y una ruta futura podría llegar aquí por otro camino: es
          // defensa en profundidad, no el mecanismo principal.
          e.code === 'BUYLIST_RAW_ONLY')
      ) {
        this.logger.warn(
          `decision-table: línea ${it.cardId} sin precio derivable (${e.code}); se emite SIN monto y sin motivo de mercado`,
        );
        return null;
      }
      throw e;
    }
  }

  /**
   * v1.51 (M-46, §4.39g) — **LA POSICIÓN: cuatro sumandos, cuatro fuentes, UNA llave.**
   *
   * | Sumando | Predicado | ¿Entra en `total`? | ¿Se pinta como «en camino»? |
   * |---|---|---|---|
   * | `stock` | `InventoryItem` de PLATAFORMA, on-hand, misma variante **con `cardProductId`** | sí | no |
   * | `verifying` | línea `buy` cuya solicitud está `recibida`\|`verificacion` | sí | no |
   * | `inTransit` | línea `buy` cuya solicitud está **`en_transito`** | sí | **SÍ — la ÚNICA** |
   * | `committed` | línea `buy` cuya solicitud está `ofertada`\|`aceptada` | sí | no |
   *
   * `total` contesta *«¿de cuántas copias ya soy responsable?»* — una línea ya ofertada es **dinero
   * comprometido** (D2: la oferta es vinculante). `inTransit` contesta *«¿qué viaja de verdad?»*.
   *
   * **Solo el `stock` cruza la frontera de streams** (vía `INVENTORY_POSITION_PORT`); los otros tres
   * salen de `SellRequestItem`, que `buylist` ya posee. Ese es el seam mínimo posible.
   *
   * `null` ⇒ **no se pudo contar**: el puerto falta (defecto de arranque) o falló. **JAMÁS se
   * degrada a ceros.**
   */
  /**
   * ⚠️⚠️ v1.51.22 · **B-3 — ¿PUEDE ESTA LÍNEA LLAVEARSE SIN MENTIR?** (revisado en v1.53, §4.40.3)
   *
   * Solo `raw`. Gobierna las DOS llaves de la mesa: la de **variante** (`gradeKey` ⇒ referencia y
   * override) y la de **posición** (`variantPositionKey` ⇒ los cuatro sumandos del conteo). Y no es
   * una restricción de producto: es que **para las otras dos la llave no distingue piezas que valen
   * distinto**, y una posición que mezcla identidades es exactamente lo que §P.8 llama *«peor que no
   * mostrar nada, porque se ve confiable»*.
   *
   * ### ⚠️ Qué cambió en v1.53, y por qué esto NO sobra
   * Cuando esto se escribió, la puerta estaba abierta por los dos lados: el cotizador aceptaba
   * `graded`/`sealed` **y** `buildGradeKey` rellenaba el hueco con `?? 'PSA'` / `?? '10'`. v1.53
   * cerró los dos:
   *
   * 1. **La guarda raw-only** (`assertBuylistProductType`, §4.40.3) impide que una línea no-raw
   *    **entre** al buylist: `422 BUYLIST_RAW_ONLY` en las tres superficies.
   * 2. **`buildGradeKey` perdió sus defaults** (§4.40.4): ya no existe el `graded:PSA:10` silencioso.
   *
   * Lo que **no** cambió es la BD: la guarda es una validación de ESCRITURA, no una constraint. Las
   * `SellRequestItem` no-raw **creadas antes de v1.53 siguen ahí**, y la mesa de decisión es
   * precisamente la pantalla que el operador abre sobre solicitudes viejas. Este predicado es lo que
   * hace que esa pantalla **se abra y diga la verdad** en vez de reventar o inventar un conteo. Su
   * justificación ya no es *«el default elige el grado más caro»* —ese default no existe—: es
   * **defender las filas legacy que la guarda no puede alcanzar hacia atrás**.
   *
   * ### Y lo medido sigue siendo cierto para esas filas
   * - **`graded`** — `SellRequestItem` **no tiene columnas de graduación** (ni `gradingCompany` ni
   *   `gradeValue`). Antes eso producía `graded:PSA:10` para TODA línea graduada (stock PSA 10 ajeno
   *   contado como propio, CGC 9.5 propio invisible: las dos direcciones del error a la vez). Hoy
   *   produciría un `IncompleteGradeIdentityError`. **Ninguna de las dos cosas es lo que el operador
   *   necesita ver**, y la tercera —`gradeKey: null` ⇒ SIN CONTEO— sí lo es.
   * - **`sealed` — el defecto es AJENO a v1.53 y sigue abierto.** El `groupBy` del adaptador agrupa
   *   por `(cardId, productType, rawCondition, gradingCompany, gradeValue, finish, cardProductId)` —
   *   **sin `sealedProductId`** —, así que **dos `SealedProduct` distintos de la misma `Card` caen en
   *   UN bucket**. `sealedProductId` aparece 2 veces en `inventory-publish.port.ts` y **0** en
   *   `inventory-position.port.ts`: los dos puertos **no acuerdan qué es una variante**. Eso no lo
   *   tocó la guarda raw-only y no lo arregla `buildGradeKey`.
   *
   * ⚠️ **La norma de `variant-key.ts` NO atrapa esto**, y conviene saber por qué antes de confiar en
   * ella: guarda **el FORMATO del string** («prohibida la interpolación a mano») y deja libre **la
   * DERIVACIÓN de sus partes**. El drift ocurre una capa por debajo, al construir `gradeKey`.
   *
   * ### Por qué se degrada en vez de arreglar la llave
   * La respuesta correcta a un conteo que no se puede hacer bien es **decir que no se pudo**, que es
   * el mecanismo que esta misma pantalla ya tiene y que el contrato exige usar aquí (*«PROHIBIDO
   * devolver `0`»*): `position: null`, `positionUnavailable: true`, `suggestion.verdict: "none"`. El
   * front pinta «SIN CONTEO» (DESIGN_SYSTEM §23.7).
   *
   * ⛔ **v1.55 — CORREGIDO: «hay que cambiar la forma del puerto» era un DIAGNÓSTICO EQUIVOCADO, y
   * era mío.** Decía que arreglarlo exigía que `VariantPositionRef` cargara `gradingCompany`,
   * `gradeValue` y `sealedProductId` —o sea un cambio de interfaz entre streams, escalado al
   * arquitecto—. **No es así, y lo verifiqué en el código:** la identidad del sellado **ya cabe en
   * `gradeKey`** (`sealedMarketGradeKey()` produce `sealed:tcg:<tcgplayerProductId>` desde v1.19), e
   * `InventoryItem` **ya tiene** la columna `sealedProductId` (`schema.prisma:784`). **El puerto no
   * necesita campos nuevos y NUNCA hubo nada que esperar del arquitecto.** Lo que hay es un defecto
   * de **adaptador**, dentro de un solo stream ⇒ **`BL-33`, mío, no bloqueante** (ver `TECH_DEBT`).
   *
   * **NO se degrada la línea entera:** `quotedPriceCents` (el snapshot congelado) y los `totals`
   * siguen siendo válidos y se siguen emitiendo — el contrato lo dice explícitamente («estos campos
   * son válidos aun con `positionUnavailable`: dependen de montos, no del conteo»). El
   * `derivedPriceCents` de una línea legacy no-raw sí sale `null` (`SIN PRECIO`), y eso es la guarda
   * raw-only hablando, no esta degradación. *Lo único que se calla es lo único que no se sabe.*
   *
   * ### ⚠️ v1.54/v1.55 · B-3 — **SON DOS PREGUNTAS, NO UNA. Y la segunda faltaba entera.**
   *
   * Hasta v1.53 esto era **un** predicado (`lineIsKeyable`) que consultaba
   * `BUYLIST_ACCEPTED_PRODUCT_TYPES` y **autorizaba** el literal `{ productType: 'raw' }` escrito a
   * mano en los call-sites. Unificaba **el permiso** y dejaba **la derivación clavada**, así que el
   * día que la lista ganara `'graded'` —por el camino que §4.40.6 + `M-49` describen— la guarda
   * dejaría pasar la línea y la derivación produciría **`raw:NM` para una graduada**: el defecto de
   * v1.53 con otro literal, con las tres superficies cotizando contra la referencia raw y la mesa
   * emitiendo **`stock: 0` con `positionUnavailable: false`** — el cero que §P.8 prohíbe.
   *
   * **El arreglo NO es partir la lista de política en dos** (§0.37.1(3) acertó: `ACCEPTED` es UNA y
   * sigue siéndolo). Es que **faltaba la segunda pregunta**:
   *
   * ```
   * llaveable = ACEPTADO ∧ CLAVABLE
   *             │           └── capacidad TÉCNICA: ¿la llave puede decir la identidad de esta fila
   *             │               sin mentir?  (`identityGradeKeyInput`, dueño: backend)
   *             └── política de PRODUCTO: ¿el negocio lo compra?
   *                 (`isPurchasableProductType` → `BUYLIST_ACCEPTED_PRODUCT_TYPES`, dueño: producto)
   * ```
   *
   * **Cierran en fechas distintas y por dueños distintos**, y por eso no pueden ser un solo booleano:
   * `graded` desbloquea con **`M-49`** (decisión de producto + captura de la identidad del slab);
   * `sealed` desbloquea con **`BL-33`** (defecto de adaptador, backend) **y** con una columna que hoy
   * no existe en la fila. Que hoy los dos den `false` es **coincidencia**, no equivalencia.
   *
   * Y el resultado de la conjunción **no es un booleano: es el INPUT**. Consecuencias buscadas:
   * - **Ensanchar la lista OBLIGA a visitar la derivación.** Añadir `'graded'` a
   *   `BUYLIST_ACCEPTED_PRODUCT_TYPES` deja pasar la política, pero la rama técnica **sigue
   *   devolviendo `null`** ⇒ `SIN PRECIO` + `SIN CONTEO`, nunca una llave mentirosa. Quien quiera
   *   que la línea valga algo **tiene que venir aquí y escribir con qué identidad se llavea**.
   * - **Un `ProductType` nuevo en el schema rompe la COMPILACIÓN** (el `never` del `default`), en vez
   *   de caer en una rama silenciosa.
   * - **Ningún call-site vuelve a escribir un literal de identidad.**
   */
  private static gradeKeyInputFor(line: {
    productType: ProductType;
    rawCondition?: RawCondition | null;
  }): GradeKeyInput | null {
    // Las dos preguntas, en el orden en que importan: primero si el negocio lo compra (si no, no hay
    // nada que llavear), luego si sabemos decir qué es.
    if (!BuylistService.isPurchasableProductType(line.productType)) return null;
    return BuylistService.identityGradeKeyInput(line);
  }

  /**
   * **PREGUNTA 1 — ¿EL NEGOCIO LO COMPRA?** Política de producto, no capacidad técnica.
   *
   * La lista es **UNA** y es literal (`PROJECT.md` §E/§K LOCKED/criterio 61): la misma que usa la
   * guarda `assertBuylistProductType` (`422 BUYLIST_RAW_ONLY`). **Ensancharla NO es una tarea de
   * backend** — la responde el dueño, `product-owner` actualiza `PROJECT.md` y sólo entonces se
   * programa `M-49` (§4.40.6/§4.40.7).
   */
  private static isPurchasableProductType(productType: ProductType): boolean {
    return BUYLIST_ACCEPTED_PRODUCT_TYPES.includes(productType);
  }

  /**
   * **PREGUNTA 2 — ¿PUEDE LA LLAVE DECIR LA IDENTIDAD DE ESTA FILA SIN MENTIR?** Capacidad técnica,
   * **dueño: backend**. `null` ⇒ no hay clave ⇒ no hay override, no hay referencia y no hay bucket.
   * **Jamás un default**: el `null` es una respuesta, no una ausencia.
   */
  private static identityGradeKeyInput(line: {
    productType: ProductType;
    rawCondition?: RawCondition | null;
  }): GradeKeyInput | null {
    switch (line.productType) {
      case 'raw':
        // La ÚNICA identidad que `SellRequestItem` sabe expresar entera. `?? null` (y no `?? 'NM'`):
        // el default de NM lo pone `buildGradeKey`, que es su dueño — aquí no se rellena nada.
        return { productType: 'raw', rawCondition: line.rawCondition ?? null };
      case 'graded':
        // **RAZÓN A — la FILA no guarda la identidad del slab.** `SellRequestItem` no tiene
        // `gradingCompany` ni `gradeValue` (`schema.prisma:1292+`): no hay dato del que derivar
        // `graded:<empresa>:<grado>`, y el `graded:PSA:10` que salía antes era **el grado más caro**
        // sobre una carta cuyo grado nunca se preguntó. **Desbloquea `M-49`, y sólo `M-49`.**
        return null;
      case 'sealed':
        // **RAZÓN B — DISTINTA, y su re-diagnóstico de v1.55 la separa aún más de la A.**
        // (1) **La fila tampoco dice QUÉ producto sellado es**: `SellRequestItem` no tiene
        //     `sealedProductId` — `cardProductId` es otro eje (el `tcgplayerProductId` de un
        //     `CardProduct` SEPARADO, M-32), no la identidad de un `SealedProduct`.
        // (2) **Y la clave plana `'sealed'` que devolvería `buildGradeKey` no es una identidad de
        //     producto**: `pricing.types.ts` la declara **la clave del override MANUAL del admin**
        //     (§4.19d). La de mercado por producto es `sealedMarketGradeKey()` ⇒
        //     `sealed:tcg:<tcgplayerProductId>`. Llavear con la plana colapsaría **todos** los
        //     sellados de la misma `Card` en un bucket.
        // ⛔ **Lo que este comentario decía antes —«el puerto no distingue el producto y hay que
        //     cambiar su forma; escalado al arquitecto»— era un diagnóstico EQUIVOCADO** (v1.55): el
        //     puerto **no** necesita campos nuevos, la identidad **ya cabe en `gradeKey`** y el
        //     colapso del conteo es un defecto del **adaptador** (`inventory-position.adapter.ts`
        //     agrupa sin `sealedProductId`, teniéndolo en la tabla). Eso es **`BL-33`**, backend, un
        //     solo stream, **no bloqueante** — hoy el único consumidor de este seam es raw-only.
        // *Aunque `M-49` cerrara la razón A mañana, ÉSTA seguiría abierta, y al revés.*
        return null;
      default: {
        // Un `ProductType` nuevo llega aquí: el `never` **no compila** y obliga a decidir su
        // identidad a mano. En runtime (fila casteada, enum por delante del código) degrada, que es
        // la única respuesta money-safe para una identidad que nadie ha declarado.
        const unreachable: never = line.productType;
        void unreachable;
        return null;
      }
    }
  }

  private async positionFor(
    refs: VariantPositionRef[],
    /** BL-16 (§4.39g.1): la solicitud EN PANTALLA, excluida de los tres sumandos de promesa. */
    excludeSellRequestId: string,
  ): Promise<PositionMap | null> {
    // (a) STOCK — el único sumando que cruza de `inventory`. Sin puerto o con puerto que truena, la
    // posición ENTERA queda no disponible: un desglose con tres sumandos ciertos y un cuarto
    // inventado sumaría a un total falso, y el total es lo que decide la sugerencia.
    let onHand: Map<string, number>;
    if (!this.inventoryPosition) {
      // El @Optional existe solo para los tests unitarios que construyen el servicio a mano; en
      // runtime esto es un DEFECTO DE ARRANQUE (§4.39f) y ya se gritó en `onModuleInit`.
      return null;
    }
    try {
      const counts = await this.inventoryPosition.onHandCountsFor(refs);
      if (!(counts instanceof Map)) return null;
      onHand = counts;
    } catch (e) {
      this.logger.error(
        `INVENTORY_POSITION_PORT falló al contar ${refs.length} variantes: ${(e as Error).message}. ` +
          'La mesa devuelve positionUnavailable — NUNCA 0 (§4.39f).',
      );
      return null;
    }

    // (b) LOS TRES SUMANDOS DE `SellRequestItem` — UNA query para las tres clases de estado. Se acota
    // por `cardId` (que es lo que el índice sirve) y por `offerDecision='buy'`: una línea `skip` no
    // es una compra, así que no compromete nada.
    if (refs.length === 0) return new Map();
    const rows = await this.prisma.sellRequestItem.findMany({
      where: {
        cardId: { in: [...new Set(refs.map((r) => r.cardId))] },
        offerDecision: 'buy',
        // ⚠️ v1.51.6 · **BL-16** (§4.39g.1) — **OTRAS solicitudes.** Los tres sumandos de PROMESA
        // excluyen la solicitud que se está mirando; `stock` **NO** (una pieza en bóveda es un
        // HECHO, no una promesa: da igual qué solicitud la trajo).
        //
        // Sin esto, abierta la mesa sobre una solicitud ya `ofertada`, **sus propias líneas suman a
        // `committed`** y el operador decidiría contra una posición **inflada por él mismo**.
        // `PROJECT.md` §P.2 es literal: *«ocho copias en la caja y tres más en camino es una razón
        // perfectamente buena para no comprar LA NOVENA»* — la novena es lo que se juzga; las ocho y
        // las tres son el contexto. Si la novena se cuenta a sí misma la frase es circular, y en
        // pantalla el número **engaña**: un `committed: 3` que son las tres líneas que el operador
        // tiene delante se lee como *«hay tres más en otro lado»*.
        //
        // Semántica del campo: `position` = «lo que ya tengo o ya debo, **SIN contar esta
        // solicitud**». Lo que aporta la de la pantalla ya está a la vista: son sus líneas.
        sellRequestId: { not: excludeSellRequestId },
        sellRequest: {
          status: {
            in: [
              ...SELL_REQUEST_VERIFYING_STATES,
              ...SELL_REQUEST_IN_TRANSIT_STATES,
              ...SELL_REQUEST_COMMITTED_STATES,
            ],
          },
        },
      },
      select: {
        cardId: true,
        productType: true,
        rawCondition: true,
        finish: true,
        cardProductId: true,
        sellRequest: { select: { status: true } },
      },
    });

    const out: PositionMap = new Map();
    for (const r of refs) {
      const key = variantPositionKey(r);
      if (out.has(key)) continue;
      // Clave PRESENTE en el Map del puerto ⇒ ese número. Clave AUSENTE ⇒ `0`, y es un CERO
      // LEGÍTIMO («no hay ninguna»): el cero PROHIBIDO —«no pude contar»— ya salió por arriba como
      // `null`, y los dos no se pueden confundir porque no llegan por el mismo camino.
      out.set(key, {
        stock: onHand.get(key) ?? 0,
        verifying: 0,
        inTransit: 0,
        committed: 0,
        total: 0,
      });
    }
    for (const row of rows) {
      // ⚠️ B-3: los sumandos de PROMESA se llavean con la MISMA derivación que los refs, así que
      // arrastran el mismo drift. La condición está aquí y no solo en el filtro de los refs porque
      // **este bucle es la otra mitad de la misma llave**: si un día se ensancha lo que es llaveable,
      // las dos mitades se mueven juntas o vuelven a discrepar en silencio.
      // (Hoy es redundante —sin ref no hay bucket— y esa redundancia es deliberada.)
      // ⚠️ v1.54 · B-3: se pide **el input**, no un permiso. El literal `{ productType: 'raw' }` que
      // vivía en la llamada de abajo se apoyaba en que el `continue` «ya había estrechado a raw» —una
      // deducción cierta solo mientras la lista valiera `['raw']`, o sea la mitad exacta del defecto.
      const input = BuylistService.gradeKeyInputFor(row);
      if (input == null) continue;
      const key = variantPositionKey({
        cardId: row.cardId,
        productType: row.productType,
        // MISMA función canónica que llavea el resto de las fuentes, con el input que produjo el
        // `switch`: el input ESTRICTO de v1.53 (§4.40.4) se satisface **por construcción**.
        gradeKey: this.pricing.gradeKeyFor(input),
        finish: row.finish,
        cardProductId: row.cardProductId ?? null,
      });
      const bucket = out.get(key);
      if (!bucket) continue; // variante que no está en esta solicitud.
      const status = row.sellRequest.status;
      const en = (set: readonly SellRequestStatus[]) => set.includes(status);
      if (en(SELL_REQUEST_VERIFYING_STATES)) bucket.verifying += 1;
      else if (en(SELL_REQUEST_IN_TRANSIT_STATES)) bucket.inTransit += 1;
      // `ofertada`|`aceptada`: la palabra ya está dada, pero NO es un paquete (criterio 116).
      else bucket.committed += 1;
    }
    for (const b of out.values()) b.total = b.stock + b.verifying + b.inTransit + b.committed;
    return out;
  }

  /**
   * v1.51 (M-46, §4.39g, criterios 144/153) — la posición y la **sugerencia** de UNA línea.
   *
   * **Precedencia, no un «o»:**
   * ```
   * bounty VIVO ∧ targetQty ≠ null  ⇒ manda el BOUNTY: do_not_buy ⇔ total ≥ bountyTargetQty
   * bounty VIVO ∧ targetQty = null  ⇒ manda el TOPE GENERAL  (fila LEGACY mal formada)
   * sin bounty                      ⇒ manda el TOPE GENERAL: do_not_buy ⇔ total ≥ variantPositionCap
   * ```
   *
   * **Un bounty vivo con `targetQty = null` NO es «sin límite»: cae al TOPE GENERAL**, y la respuesta
   * lo DECLARA (`rule: 'variant_cap'` **con** `bountyActive: true`) para que el caso legacy sea
   * legible en pantalla sin que nadie tenga que deducirlo. Tras el backfill de D35 no debería existir
   * ninguna fila así; la rama **no se retira** porque la columna sigue siendo `Int?` ⇒ el `null`
   * sigue siendo representable, y *un lector de dinero sin respuesta para un valor representable es
   * un lector que decide por omisión*. La respuesta money-safe es frenar.
   *
   * **Sin conteo no hay consejo:** `positionUnavailable` ⇒ `verdict: 'none'` con `rule: null`. Nunca
   * se infiere un veredicto sobre un total que no se pudo calcular.
   */
  private positionAndSuggestion(
    position: PositionMap | null,
    /** v1.53 (§4.40.4b): `null` ⇒ la línea no tiene llave de posición (legacy no-raw) ⇒ SIN CONTEO. */
    positionKey: string | null,
    override: VariantPriceOverride | null,
    decision: BuyLineDecision | null,
    variantPositionCap: number,
  ) {
    // «Bounty VIVO» = habilitado, no completado y EFECTIVO contra la curva vigente (§4.36.6): un
    // bounty por debajo de la tarifa de la curva dejó de ser bounty, y no puede gobernar el consejo.
    const bountyActive =
      override?.bountyEnabled === true &&
      override.bountyCompletedAt == null &&
      isBountyEffective(override.bountyPriceCents ?? null, decision?.quote.curveQuoteCents ?? null);

    const bucket = positionKey == null ? null : (position?.get(positionKey) ?? null);
    if (position == null || bucket == null) {
      // ⚠️ `position: null`, NO ceros. Un cero que significa «no pude contar» se ve confiable y
      // empuja a comprar de más (§P.8). El front pinta «SIN CONTEO» y no infiere nada.
      return {
        position: null,
        positionUnavailable: true,
        suggestion: { verdict: 'none' as const, rule: null, thresholdQty: null, bountyActive },
      };
    }

    const useBounty = bountyActive && override?.bountyTargetQty != null;
    const thresholdQty = useBounty ? (override?.bountyTargetQty as number) : variantPositionCap;
    return {
      // Los CUATRO sumandos + el total, SIEMPRE por separado: tienen confianza distinta y esa
      // distinción ES el valor de la pantalla. El único sitio donde se suman es `total`.
      position: { ...bucket },
      suggestion: {
        // ⚠️ INFORMATIVO. El backend NO valida la oferta contra esto (D6).
        verdict: bucket.total >= thresholdQty ? ('do_not_buy' as const) : ('buy' as const),
        rule: useBounty ? ('bounty_target' as const) : ('variant_cap' as const),
        thresholdQty,
        // `variant_cap` CON `bountyActive: true` es exactamente el caso legacy (criterio 144).
        bountyActive,
      },
    };
  }


  // ===========================================================================================
  // v1.51 — EL CICLO DE ADQUISICIÓN: LA OFERTA (§M5 · ARCHITECTURE §4.39h)
  // «Ahí mandamos el correo al cliente diciendo que estamos dispuestos a comprar y a cuánto.»
  // ===========================================================================================

  /**
   * Campos congelados de la oferta que la cancelación **limpia**, y los mismos que la emisión
   * escribe. Se declaran **una vez** porque emitir y cancelar tienen que ser exactamente inversos:
   * si la lista se escribiera dos veces, una cancelación podría dejar un monto congelado vivo y la
   * oferta siguiente heredaría una cifra que nadie decidió.
   */
  private static readonly OFFER_FROZEN_NULL = {
    offerGrossCents: null,
    offerShippingFeeCents: null,
    offerNetCents: null,
    offerAcceptDeadlineAt: null,
    offerAcceptReminderSentAt: null,
  } as const;

  /** Ídem, por línea. */
  private static readonly OFFER_LINE_NULL = {
    offerDecision: null,
    offeredPriceCents: null,
    offerDerivedPriceCents: null,
    offerOverrideReason: null,
    offerPriceBasis: null,
    offerMarketMxnCents: null,
    offerMarketBracket: null,
  } as const;

  /**
   * URL del portal para el CTA de los correos. Vacía ⇒ la plantilla degrada el botón a una
   * instrucción de texto. *Un botón muerto es peor que una frase.*
   */


  /**
   * **`POST /admin/buylist/:id/offer` — EMITIR (o PREPARAR) la oferta** (D1/D2/D13/D24/D26,
   * criterios 143/147/148).
   *
   * ### La secuencia es NORMATIVA y el orden importa (§4.39h)
   * ```
   * 1  precondición (cotizada ∧ offerState ∈ {null, cancelled})
   * 1-bis  PICKUP_ADDRESS_MISSING          ← lo más barato de comprobar, y hace inútil todo lo demás
   * 2  OFFER_LINES_MISMATCH                ← cubren EXACTAMENTE los ítems
   * 3  precio por línea (decideBuyLine)    ← OFFER_LINE_NOT_PRICEABLE / OVERRIDE_REASON_REQUIRED
   * 4-5 bruto → envío CONGELADO → neto
   * 6  OFFER_NET_BELOW_MINIMUM             ← ⚠️ ANTES del tope: nada inofertable llega a la cola
   * 6-bis A1 BUYLIST_LIMIT_EXCEEDED (per_request_offer)  ← ⚠️ v1.58 §M5-A / BL-38
   * 6-bis A2 INE_REQUIRED                                ← ⚠️ v1.58 §M5-A / BL-38
   * 7  tope del operador                   ← 200 (sale) | 202 (espera autorización)
   * 8  [tx SERIALIZABLE] A3 BUYLIST_LIMIT_EXCEEDED (per_month_offer)  ← ⚠️ v1.58 §M5-A / BL-38
   * 9  escrituras → guarda de proyección (500 OFFER_PROJECTION_INCOMPLETE)
   * ```
   *
   * ### ⚠️⚠️ v1.58 · **§M5-A / BL-38** — LOS TOPES AML Y EL INE SE EVALÚAN **AQUÍ**, SOBRE EL BRUTO
   * OFERTADO. **DINERO COMPROMETIDO / AML-KYC.**
   * `PROJECT.md:1127-1128` exige los topes **en los dos momentos** (al cotizar y al ofertar) y sobre
   * el **bruto ofertado**. Hasta v1.58 este método **no referenciaba ninguno de los tres diales**:
   * el tope por solicitud se juzgaba **exactamente una vez**, en el intake y sobre el **cotizado**.
   * **Y la oferta es VINCULANTE (D2):** emitir por encima del tope significa *el vendedor acepta →
   * manda sus cartas → al pagar no podemos*, y ahí **las dos salidas son malas** (incumplir la palabra
   * dada, o subir el dial de AML para poder cumplirla). ⇒ **Doctrina:** *toda regla que puede impedir
   * cumplir un compromiso se evalúa **donde el compromiso se contrae**, no donde se ejecuta.*
   * - **El monto es `G = offerGrossCents`, NO `brutoConsumado(req)`** (§M5-A.2) — razonado en el
   *   propio bloque 6-bis, donde está la trampa.
   * - **Aplica a TODO actor, `super_admin` incluido**: *«oferta sin tope»* es el tope del OPERADOR
   *   (delegación); el AML es **cumplimiento sobre el vendedor** y ningún rol lo levanta.
   * - **`offer/authorize` NO reevalúa nada, y no le hace falta** (§M5-A.5, demostración por
   *   inducción): el `202` **ya escribió `offerGrossCents`** sobre una fila que **ya está en el
   *   acumulado** ⇒ el compromiso entra al acumulado **al PREPARAR**, no al autorizar. Reevaluar
   *   compararía un **monto congelado** contra un **dial vivo**, el anti-patrón del criterio 157.
   *
   * ### Dos desenlaces, y la diferencia es la que importa
   * | Actor | Bruto | Resp. | Efecto |
   * |---|---|---|---|
   * | `super_admin` | cualquiera | **200** | `sent` + `ofertada` + **el correo SALE** |
   * | `vault_operator` | `≤ cap` (**inclusivo**) | **200** | ídem — sale sola |
   * | `vault_operator` | `> cap` | **202** | `pending_authorization`, **`status` SIGUE `cotizada`**, **NINGÚN correo** |
   *
   * **Una oferta que espera autorización NO EXISTE para el vendedor** (D13/D24): mandarle el correo
   * le filtraría la existencia y el orden de magnitud de un control interno nuestro. El `202` **es un
   * estado real, no un error**: el operador *puede* prepararla; lo que no puede es que salga sola.
   *
   * ### Money-safe
   * - **El precio sale de `decideBuyLine`** con la curva **vigente al ofertar** — no se hereda de la
   *   cotización (§P.2: entre cotizar y ofertar el mercado se movió, y lo vinculante es lo que
   *   ofertamos). **Prohibida una cuarta reimplementación** de la secuencia.
   * - **INVARIANTE `offerDecision='buy' ⇒ offeredPriceCents IS NOT NULL`**, en la MISMA transacción.
   *   `convertToInventory` ya lee `offeredPriceCents ?? …`: si esto no lo escribiera, la conversión
   *   capitalizaría el **precio COTIZADO** de una pieza comprada a otro precio, **sin fallar y sin
   *   avisar**, y el margen de M7 saldría inflado (§4.39i.5).
   * - **La tarifa se CONGELA aquí** (D25): si la etiqueta sale más cara la absorbemos; si sale más
   *   barata es margen nuestro. **Nunca se recalcula tras mandar la oferta** — si el descuento pudiera
   *   moverse, el neto dejaría de ser vinculante.
   * - **El override NO es puerta trasera al tope** (criterio 148c): el tope se juzga sobre el bruto
   *   **resultante**, overrides incluidos.
   *
   * El correo es **best-effort POST-COMMIT**: su fallo se loggea y **no revierte la oferta** — lo
   * contrario dejaría una decisión de dinero colgada de un servicio externo.
   */
  async adminOffer(
    id: string,
    actor: { id: string; role: Role },
    lines: { itemId: string; decision: BuyDecision; overridePriceCents?: number; overrideReason?: string }[],
  ) {
    // ---- 1. Precondición (lectura para el DIAGNÓSTICO; la guarda real es el `where` de abajo) ----
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: {
        items: { include: { card: { include: { set: true } } } },
        user: { select: { id: true, name: true, email: true, locale: true } },
      },
    });
    if (!req) throw BusinessException.notFound();
    if (req.offerState === 'sent') {
      // Una oferta ENVIADA no se edita: se cancela y se emite otra (criterio 145). El precio
      // ofertado es vinculante desde el correo (D2/D9).
      throw BusinessException.conflict(
        'OFFER_ALREADY_SENT',
        'This offer was already sent: cancel it and issue a new one',
        { status: req.status, offerState: req.offerState },
      );
    }
    if (req.status !== 'cotizada' || (req.offerState != null && req.offerState !== 'cancelled')) {
      throw BusinessException.conflict('OFFER_NOT_ALLOWED', 'This sell request cannot be offered', {
        status: req.status,
        offerState: req.offerState,
      });
    }

    // ---- 1-bis. SIN DIRECCIÓN DE ORIGEN NO SE OFERTA (D36) ----
    // Ofertar es comprometer dinero Y prometer una etiqueta. Si el hueco se descubriera al capturar
    // la guía, ya le habríamos escrito al vendedor que le compramos y estaríamos incumpliendo un
    // contrato por un dato que nunca pedimos.
    // ⚠️ PROHIBIDO rellenarla leyendo la libreta viva: sería inventarle un origen que él NO confirmó
    // para esta solicitud. *La respuesta correcta a un dato que falta es pedirlo, no adivinarlo.*
    if (req.pickupAddressSnapshot == null) {
      throw BusinessException.validation(
        'PICKUP_ADDRESS_MISSING',
        'This sell request has no pickup address snapshot',
        { sellRequestId: id },
      );
    }

    // ---- 2. Las líneas cubren EXACTAMENTE los ítems ----
    // Sin esto, una línea olvidada saldría del correo sin que nadie decidiera nada sobre ella.
    const itemIds = new Set(req.items.map((i) => i.id));
    const sent = new Set(lines.map((l) => l.itemId));
    const missingItemIds = [...itemIds].filter((x) => !sent.has(x));
    const unknownItemIds = [...sent].filter((x) => !itemIds.has(x));
    if (missingItemIds.length > 0 || unknownItemIds.length > 0 || lines.length !== sent.size) {
      throw BusinessException.validation(
        'OFFER_LINES_MISMATCH',
        'Offer lines must cover exactly the items of this sell request',
        { missingItemIds, unknownItemIds },
      );
    }

    // ---- 3. Precio por línea — el SEAM ÚNICO, en lote, con la curva VIGENTE AHORA ----
    const { decisions } = await this.deriveOfferLinesBatch(req.items);
    const byItem = new Map(lines.map((l) => [l.itemId, l]));
    const notPriceable: string[] = [];
    const reasonMissing: string[] = [];
    const resolved: {
      itemId: string;
      decision: BuyDecision;
      derived: BuyLineDecision | null;
      offeredPriceCents: number | null;
      overrideReason: string | null;
    }[] = [];
    for (const item of req.items) {
      const l = byItem.get(item.id) as (typeof lines)[number];
      const derived = decisions.get(item.id) ?? null;
      const derivedCents = derived?.quotedPriceCents ?? null;
      if (l.decision === 'skip') {
        resolved.push({ itemId: item.id, decision: 'skip', derived, offeredPriceCents: null, overrideReason: null });
        continue;
      }
      const hasOverride = l.overridePriceCents != null;
      const offered = hasOverride ? (l.overridePriceCents as number) : derivedCents;
      if (offered == null) {
        // La oferta NO sale a medias: o se le pone precio a mano, o esa línea se marca `skip`.
        notPriceable.push(item.id);
        continue;
      }
      // *Sin motivo no hay override* (criterio 148a): es lo que convierte un número a mano en una
      // decisión revisable en vez de una cifra huérfana. Se compara contra el DERIVADO, así que
      // reenviar el mismo número que dijo la curva NO exige motivo (no es un override).
      const isOverride = hasOverride && offered !== derivedCents;
      const reason = (l.overrideReason ?? '').trim();
      if (isOverride && (reason.length < 3 || reason.length > 500)) {
        reasonMissing.push(item.id);
        continue;
      }
      resolved.push({
        itemId: item.id,
        decision: 'buy',
        derived,
        offeredPriceCents: offered,
        overrideReason: isOverride ? reason : null,
      });
    }
    if (notPriceable.length > 0) {
      throw BusinessException.validation(
        'OFFER_LINE_NOT_PRICEABLE',
        'A `buy` line has no resolvable price and no override',
        { itemIds: notPriceable },
      );
    }
    if (reasonMissing.length > 0) {
      throw BusinessException.validation(
        'OVERRIDE_REASON_REQUIRED',
        'An override requires a reason (3-500 chars)',
        { itemIds: reasonMissing },
      );
    }

    // ---- 4-5. Bruto → envío CONGELADO → neto ----
    const buyLines = resolved.filter((r) => r.decision === 'buy');
    const offerGrossCents = buyLines.reduce((a, r) => a + (r.offeredPriceCents as number), 0);
    const [shippingFeeCents, minimumOfferNetCents, operatorCapCents, acceptDeadlineDays] =
      await Promise.all([
        this.settings.getNumber(SettingKey.BUYLIST_SHIPPING_FEE_CENTS),
        this.settings.getNumber(SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS),
        this.settings.getNumber(SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS),
        this.settings.getNumber(SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS),
      ]);
    // ⚠️ UNA SOLA BANDA (D31): siempre mandamos guía y siempre se descuenta.
    // ⚠️ INVARIANTE (i.1, criterio 152): **el neto NUNCA es negativo.** El `max(0,…)` no es una
    // defensa: es la DEFINICIÓN. Bruto $100 con tarifa $180 ⇒ **MX$0**, no −$80, y jamás un cargo,
    // un adeudo ni una retención contra operaciones futuras. *El peor caso para un vendedor es
    // cobrar $0 — nunca deber.*
    const offerNetCents = Math.max(0, offerGrossCents - shippingFeeCents);

    // ---- 6. PISO DE NETO (D34/D40) — ANTES del tope: nada inofertable llega a la cola ----
    if (offerNetCents < minimumOfferNetCents) {
      const requiredGrossCents = minimumOfferNetCents + shippingFeeCents;
      throw BusinessException.validation(
        'OFFER_NET_BELOW_MINIMUM',
        'The announced deposit would be below the minimum net',
        {
          grossCents: offerGrossCents,
          shippingFeeCents,
          netCents: offerNetCents,
          minimumNetCents: minimumOfferNetCents,
          requiredGrossCents,
          // El faltante va en BRUTO a propósito: la palanca del operador es el bruto. «Te faltan
          // $330 de bruto» es accionable donde «el neto es bajo» no lo es.
          grossShortfallCents: requiredGrossCents - offerGrossCents,
        },
      );
    }

    // ---- 6-bis. ⚠️⚠️ §M5-A · BL-38 — LOS TOPES AML Y EL UMBRAL DE INE, SOBRE EL BRUTO OFERTADO ----
    //
    // `PROJECT.md:1127-1128`, literal: *«los topes se evalúan **en los dos momentos** (al cotizar y al
    // ofertar), y el monto que los gobierna —y que gobierna el **KYC/INE**— es el **BRUTO OFERTADO**,
    // es decir el valor comprometido con el vendedor»*. Hasta v1.58 este método **no referenciaba
    // ninguno de los tres diales**: el tope por solicitud se juzgaba **una sola vez**, en el intake y
    // sobre el **cotizado**, mientras el override de D26 llega a MX$10,000 por línea (`@Max`) contra
    // un tope AML de MX$3,000. ⇒ **se emitía una oferta VINCULANTE por encima del tope** (D2, correo
    // al vendedor) y el hueco se descubría **al pagar**, cuando el vendedor ya mandó sus cartas.
    // *Un control que se descubre después de comprometer la palabra no controla: extorsiona.*
    //
    // ⚠️⚠️ **EL MONTO ES `G = offerGrossCents`, NO `brutoConsumado(req)` — y es la trampa de este
    // apartado** (§M5-A.2 / §4.39x.3). `brutoConsumado` mide el compromiso **CONSUMADO** leyendo la
    // fila persistida: `approvedTotalCents ?? offerGrossCents ?? quotedTotalCents ?? 0`. En este
    // instante y sobre esta fila la precondición de arriba garantiza `offerState ∈ {null,'cancelled'}`
    // y `offer/cancel` limpia `offerGrossCents` (`OFFER_FROZEN_NULL`) ⇒ **la cascada devolvería
    // `quotedTotalCents`, que es JUSTO el número que no ve el override**. *Un término correcto para el
    // compromiso CONSUMADO es el término equivocado para el que se está CONTRAYENDO, y los dos se
    // llaman «bruto».* `G` es el mismo número que alimenta el piso de neto, el tope del operador, el
    // correo y la columna: **un solo número gobierna la emisión entera.**
    //
    // ⚠️ **APLICA A TODO ACTOR, `super_admin` INCLUIDO** (§M5-A.3): *«el súper-admin oferta sin tope»*
    // habla del **tope del OPERADOR**, que es **delegación**. El tope AML es **cumplimiento sobre el
    // VENDEDOR** y **ningún rol lo levanta**: quien quiera moverlo mueve el dial (M10, auditado) o el
    // override por KYC de ese vendedor — actos con nombre, no un privilegio implícito.
    //
    // **Van DESPUÉS del piso de neto y ANTES del tope del operador** (§M5-A.6): los tres necesitan
    // `G`, y *nada inofertable llega a la cola de autorización* — una oferta que rompe el tope AML no
    // puede quedar esperando a un súper-admin **que no tiene poder para levantarlo**.
    const kycAml = await this.prisma.kycProfile.findUnique({
      where: { userId: req.userId },
      select: {
        capPerRequestCentsOverride: true,
        capPerMonthCentsOverride: true,
        ineFrontKey: true,
        ineBackKey: true,
      },
    });
    const [capPerRequest, capPerMonth, ineThreshold] = [
      kycAml?.capPerRequestCentsOverride ??
        (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS)),
      kycAml?.capPerMonthCentsOverride ??
        (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS)),
      // ⚠️ El umbral de INE **NO tiene override por usuario, y no se le inventa uno** (§M5-A).
      await this.settings.getNumber(SettingKey.INE_THRESHOLD_CENTS),
    ];

    // --- A1. Tope por solicitud. El borde es `>`: LA CIFRA EXACTA PASA. ---
    // Mismo comparador y mismo sentido que el intake (`quotedTotalCents > capPerRequest`) y misma
    // doctrina que los TRES bordes inclusivos del ciclo (v1.51.3/D40): *el error a evitar es
    // implementar uno estricto y rechazar exactamente la cifra que prometimos.*
    // Va antes que A2 porque su palanca es la que el operador ya tiene en la mano —bajar el bruto— y
    // **hace inútil al resto**: si el monto es ilegal a ese tamaño, el INE no lo arregla.
    if (offerGrossCents > capPerRequest) {
      throw BusinessException.validation(
        'BUYLIST_LIMIT_EXCEEDED',
        'Per-request cap exceeded by the offered gross',
        {
          // ⚠️ `scope` NUEVO y NO se acuña un `OFFER_LIMIT_EXCEEDED`: es UN código para UN control
          // —el tope AML— medido en CINCO momentos, y `scope` dice cuál. Un segundo nombre
          // fragmentaría el control que más falta hace poder auditar entero.
          scope: 'per_request_offer',
          // §M5-A.7, rama del OPERADOR: el TOPE sí viaja (es la cota de su propia acción y le dice
          // cuánto recortar); el UMBRAL DE INE no (ver A2).
          capCents: capPerRequest,
          wouldBeCents: offerGrossCents,
        },
      );
    }

    // --- A2. Umbral de INE. `>=`, y el archivo se RELEE del `KycProfile`. ---
    // ⚠️ `ineProvided` NO se lee de la columna `SellRequest.ineProvided`: es un snapshot del intake y
    // el vendedor pudo subir su INE **después**. *Negarle la oferta por leer un snapshot rancio sería
    // rechazarle un documento que ya nos dio.*
    const ineOnFile = kycAml?.ineFrontKey != null && kycAml?.ineBackKey != null;
    // ⚠️ **`ineRequired` es MONÓTONA (`false → true`, jamás al revés)** (§M5-A.4): una oferta que cruza
    // el umbral la ENCIENDE; una que queda por debajo **no la apaga**. Apagarla revertiría en silencio
    // una decisión de cumplimiento ya tomada (el intake la enciende también por una línea en
    // `precio_pendiente`) y no gana nada: si estaba encendida, el INE ya está en archivo.
    const offerCrossesIneThreshold = offerGrossCents >= ineThreshold;
    if (offerCrossesIneThreshold && !ineOnFile) {
      throw BusinessException.validation(
        'INE_REQUIRED',
        'INE on file is required for the offered gross',
        {
          // ⛔ **SIN `thresholdCents`, y es deliberado** (§M5-A.7): el destinatario aquí es el
          // OPERADOR, que **no es el sujeto** de la regla de INE y cuyas palancas son *conseguir el
          // documento* o *no ofertar* — el número no acota su acción y sí añade superficie. El intake
          // **sí** lo emite y **no se armoniza**: allá el destinatario es el VENDEDOR, que es el
          // sujeto y tiene que saber por qué le pedimos su identificación.
          sellRequestId: id,
          grossCents: offerGrossCents,
        },
      );
    }

    // ---- 7. Tope del operador (D13/D24). El borde es INCLUSIVO: $1,500 SALE. ----
    // El súper-admin oferta sin tope. El override no es puerta trasera: el tope mira el bruto
    // RESULTANTE, overrides incluidos.
    const requiresAuthorization =
      actor.role === Role.vault_operator && offerGrossCents > operatorCapCents;
    const now = new Date();
    // ---- 8. Al SALIR: plazo CONGELADO en días hábiles (D14, criterio 154) ----
    const offerAcceptDeadlineAt = requiresAuthorization
      ? null
      : addBusinessDays(now, acceptDeadlineDays);

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // ---- A3. ⚠️⚠️ §M5-A · BL-38 — TOPE MENSUAL, DENTRO DE LA TRANSACCIÓN SERIALIZABLE ----
        //
        // *En un tope de dinero, la lectura y la escritura van en la misma transacción o el tope es
        // decorativo.* Es el MISMO TOCTOU que ya cerraron el intake (SEC-A2) y `pay-spei` (AML-1): dos
        // emisiones concurrentes del mismo vendedor leerían el mismo acumulado y **pasarían las dos**.
        //
        // **Se REUSA el acumulado del intake** (`monthCommittedGrossCents`, ancla `createdAt`, predicado
        // por complemento sobre `NON_COMMITTING`): ⛔ no se crea un tercer acumulado ni se toca ninguna
        // ancla. Lo único que cambia es **el bruto de ESTA fila**.
        //
        // ⚠️ **LA FILA PROPIA YA ESTÁ DENTRO ⇒ SE SUSTITUYE, NO SE SUMA.** Es `cotizada`, que **no** está
        // en `NON_COMMITTING`, y hoy aporta `offerGrossCents ?? quotedTotalCents ?? 0` (con
        // `offerGrossCents` nulo por la precondición ⇒ el cotizado). *Sumar `G` sin excluirse contaría
        // el mismo compromiso dos veces y rechazaría ofertas legítimas: un tope que cuenta doble no es
        // más seguro, es otro tope.*
        //
        // **La propiedad que lo hace verificable sin leer este código:** la guarda asevera exactamente
        // el valor que `monthCommittedGrossCents` devolverá **el instante después de la escritura** —
        // tras el `updateMany` la fila aporta `G` y su estado (`cotizada` en el `202`, `ofertada` en el
        // `200`) sigue fuera de `NON_COMMITTING`. Un test lo comprueba llamando al acumulado antes y
        // después.
        //
        // ⚠️ **RESIDUAL NOMBRADO — el cruce de mes** (§M5-A.5): una solicitud creada en un mes y ofertada
        // en el siguiente **no está en la ventana** ⇒ su bruto ofertado no topa aquí. Es consecuencia del
        // ancla `createdAt`, que esta norma **no cambia** (moverla movería el acumulado del intake, que
        // hoy está bien). No queda descubierto en el dinero: al pagar, la fila entra al acumulado
        // **consumado** del mes del pago y **ahí sí** se compara. *El compromiso puede cruzar el mes; el
        // pago no.* NO bloqueante.
        const monthCommittedNow = await monthCommittedGrossCents(tx, req.userId, now);
        // El bruto que ESTA fila aporta HOY al acumulado, releído DENTRO de la transacción (no del `req`
        // de arriba: la lectura previa vive fuera del boundary atómico).
        const self = await tx.sellRequest.findUnique({
          where: { id },
          select: { createdAt: true, offerGrossCents: true, quotedTotalCents: true },
        });
        // Si la fila no está en la ventana del mes, **no entra al acumulado ni antes ni después**: ni se
        // resta su aporte de hoy ni se suma `G` (es exactamente el cruce de mes de arriba). Si
        // desapareció bajo nosotros, el `updateMany` de abajo da el `409` honesto.
        const selfInWindow = self != null && self.createdAt >= monthStartUtc(now);
        const wouldBeCents =
          monthCommittedNow -
          (selfInWindow ? (self.offerGrossCents ?? self.quotedTotalCents ?? 0) : 0) +
          (selfInWindow ? offerGrossCents : 0);
        if (wouldBeCents > capPerMonth) {
          // Si lanza, **la transacción se deshace entera**: no se persiste nada, no sale correo (va
          // post-commit), `offerSentAt` no se sella y la solicitud sigue `cotizada` ⇒ la mira la regla 7
          // del barrido (NUESTRO plazo), no la 1 (el suyo). *El defecto cae en nuestra cola y en nuestro
          // reloj* (§P.13).
          throw BusinessException.validation(
            'BUYLIST_LIMIT_EXCEEDED',
            'Per-month cap exceeded by the offered gross',
            { scope: 'per_month_offer', capCents: capPerMonth, wouldBeCents },
          );
        }
        // La precondición vive en el `where` (patrón `count===1`): la exclusión la da el motor, no un
        // `if` sobre la lectura de arriba, que una carrera puede invalidar.
        const guard = await tx.sellRequest.updateMany({
          where: {
            id,
            status: 'cotizada',
            closedAt: null,
            OR: [{ offerState: null }, { offerState: 'cancelled' }],
          },
          data: {
            // ⚠️ §M5-A.4 · BL-38 — `ineRequired` MONÓTONA: solo se ENCIENDE. Si el bruto ofertado cruza
            // el umbral, la fila queda marcada (llegó aquí con el INE ya en archivo: A2 es la puerta).
            // Si NO lo cruza, **la clave ni siquiera se emite** ⇒ un `true` del intake sobrevive. *Un
            // `ineRequired: offerCrossesIneThreshold` la apagaría, revirtiendo en silencio una decisión
            // de cumplimiento ya tomada.*
            ...(offerCrossesIneThreshold ? { ineRequired: true } : {}),
            ...(requiresAuthorization
              ? {
                  // ⚠️ `status` SIGUE `cotizada`: el cliente NO debe enterarse de que existe (D13/D24).
                  offerState: 'pending_authorization',
                  offerPreparedBy: actor.id,
                  offerPreparedAt: now,
                  offerGrossCents,
                  offerShippingFeeCents: shippingFeeCents,
                  offerNetCents,
                  offerCancelledAt: null,
                  offerCancelReason: null,
                }
              : {
                  offerState: 'sent',
                  status: 'ofertada',
                  offerPreparedBy: actor.id,
                  offerPreparedAt: now,
                  offerSentAt: now,
                  offerAcceptDeadlineAt,
                  offerAcceptReminderSentAt: null,
                  offerGrossCents,
                  offerShippingFeeCents: shippingFeeCents,
                  offerNetCents,
                  offerCancelledAt: null,
                  offerCancelReason: null,
                }),
          },
        });
        if (guard.count !== 1) {
          const current = await tx.sellRequest.findUnique({
            where: { id },
            select: { status: true, offerState: true },
          });
          throw BusinessException.conflict('OFFER_NOT_ALLOWED', 'This sell request cannot be offered', {
            status: current?.status,
            offerState: current?.offerState,
          });
        }
        // ---- Las líneas, en la MISMA transacción que el encabezado ----
        // Las `skip` comparten `data` ⇒ una sola escritura. Las `buy` llevan cada una su monto, así
        // que no hay forma de agruparlas: es una escritura por línea comprada, acotada por la
        // solicitud (no crece con el catálogo).
        const skipIds = resolved.filter((r) => r.decision === 'skip').map((r) => r.itemId);
        if (skipIds.length > 0) {
          await tx.sellRequestItem.updateMany({
            where: { id: { in: skipIds }, sellRequestId: id },
            data: { ...BuylistService.OFFER_LINE_NULL, offerDecision: 'skip' },
          });
        }
        for (const r of buyLines) {
          await tx.sellRequestItem.updateMany({
            where: { id: r.itemId, sellRequestId: id },
            data: {
              offerDecision: 'buy',
              // ⚠️ INVARIANTE: una línea `buy` SIEMPRE lleva monto. Es lo que `convertToInventory`
              // capitaliza como `acquisitionCostCents` (§4.39i.5).
              offeredPriceCents: r.offeredPriceCents,
              // Los TRES datos del override (criterio 148b): lo que dijo la curva, lo que se oferta y
              // por qué — para que el delta sea visible SIN leer la bitácora.
              offerDerivedPriceCents: r.derived?.quotedPriceCents ?? null,
              offerOverrideReason: r.overrideReason,
              // Enum EXISTENTE, sin valores nuevos: un override (y el rescate de un `precio_pendiente`)
              // queda `override`.
              offerPriceBasis: r.overrideReason != null ? 'override' : (r.derived?.priceBasis ?? null),
              // Instrumentación §N.8 del momento de OFERTAR — NO se reusa la del quote: son dos
              // decisiones en dos instantes, y la del quote ya está congelada.
              offerMarketMxnCents: r.derived?.quote.marketMxnCents ?? null,
              offerMarketBracket: marketBracketOf(r.derived?.quote.marketMxnCents ?? null),
            },
          });
        }
        // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; se proyecta abajo con `offerResponseShape`
        // (lista blanca del contrato §M5) antes de devolverla. `updateMany` no devuelve filas.
        const row = await tx.sellRequest.findUnique({
          where: { id },
          include: {
            items: { include: { card: { include: { set: true } } } },
            // El `locale` del VENDEDOR: es el que renderiza `terms`, y sin él la guarda validaría un
            // texto que no es el que él va a leer.
            user: { select: { locale: true } },
          },
        });
        if (!row) throw BusinessException.notFound();
        // ---- 7-bis. ⚠️⚠️ GUARDA DE PROYECCIÓN (v1.51.16 · BL-24) — ÚLTIMO PASO ANTES DEL COMMIT ----
        // Va **dentro** de la transacción y **después** de las escrituras a propósito: así valida la
        // fila REAL que `GET /buylist/requests/:id` leería, no una simulación armada a mano — y al
        // lanzar, **la transacción se deshace entera**. Consecuencia exacta y buscada: **no se emite,
        // no se persiste, NO sale correo** (va post-commit) y **`offerSentAt` nunca se sella**, así que
        // el plazo del vendedor **nunca se congela** y la solicitud se queda `cotizada` ⇒ la mira la
        // **regla 7 del barrido (NUESTRO plazo)**, no la 1 (el suyo). *El defecto cae en nuestra cola y
        // en nuestro reloj, que es donde §P.13 dice que tiene que caer.*
        this.assertOfferProjectionComplete(
          id,
          { ...row, locale: row.user?.locale ?? null },
          now,
        );
        return row;
      },
      // ⚠️ §M5-A.5 · BL-38 — **SERIALIZABLE**, por la MISMA razón que el intake (SEC-A2) y `pay-spei`
      // (AML-1): el tope mensual se lee y se escribe en el mismo boundary o dos emisiones concurrentes
      // del mismo vendedor leen el mismo acumulado y **las dos pasan**.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!updated) throw BusinessException.notFound();

    // ---- Correo POST-COMMIT, best-effort, y SOLO si la oferta salió ----
    // Con `202` NO se manda nada: esa oferta no existe para el vendedor.
    if (!requiresAuthorization) {
      await this.sendOfferMail(updated, req.user);
    }

    return {
      response: this.offerResponseShape(updated, requiresAuthorization),
      audit: {
        grossCents: offerGrossCents,
        shippingFeeCents,
        netCents: offerNetCents,
        // El dial vigente AL EMITIR queda en la bitácora: la pregunta «¿por qué se permitió esta
        // oferta?» es de auditoría, no de cálculo (por eso el piso NO lleva columna).
        minimumOfferNetCents,
        operatorCapCents,
        requiresAuthorization,
        buyLineCount: buyLines.length,
        skipLineCount: resolved.length - buyLines.length,
        overrides: resolved
          .filter((r) => r.overrideReason != null)
          .map((r) => ({
            itemId: r.itemId,
            derivedPriceCents: r.derived?.quotedPriceCents ?? null,
            offeredPriceCents: r.offeredPriceCents,
            reason: r.overrideReason,
          })),
      },
    };
  }

  /**
   * **`POST /admin/buylist/:id/offer/authorize`** — `super_admin` (D24, criterios 143/147).
   *
   * **Autoriza LO GUARDADO.** No acepta líneas ni montos: aceptar cambios aquí convertiría la
   * autorización en una segunda edición y el «quién preparó / quién autorizó» dejaría de significar
   * nada. **El piso de neto NO se reevalúa** (D34): reevaluarlo compararía un monto congelado contra
   * un dial vivo, que es el anti-patrón que el criterio 157 prohíbe en todas las demás congelaciones.
   *
   * **Precondición — DOS candados a propósito** (defensa en profundidad, D33):
   * ```
   * offerState = 'pending_authorization'  ∧  status = 'cotizada'  ∧  closedAt IS NULL
   * ```
   * El barrido ya anula la oferta en la misma transacción en que caduca, así que el primer conjunto
   * bastaría — **pero si un refactor futuro olvida anularla, el segundo sigue cerrando la puerta**.
   * Sin esto, el súper-admin **resucitaría una solicitud TERMINAL mandando un correo VINCULANTE** a
   * alguien a quien ya le escribimos que no procederíamos. *En dinero saliente, una sola guarda es
   * una guarda que se pierde.*
   *
   * **El plazo se congela EN ESTE INSTANTE** (criterio 157): la fecha se fija **al comunicarse**, y
   * la oferta se comunica ahora.
   */
  async adminOfferAuthorize(id: string, actor: { id: string; role: Role }) {
    const days = await this.settings.getNumber(
      SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS,
    );
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.sellRequest.updateMany({
        where: { id, offerState: 'pending_authorization', status: 'cotizada', closedAt: null },
        data: {
          offerState: 'sent',
          status: 'ofertada',
          offerAuthorizedBy: actor.id,
          offerAuthorizedAt: now,
          offerSentAt: now,
          offerAcceptDeadlineAt: addBusinessDays(now, days),
          offerAcceptReminderSentAt: null,
        },
      });
      if (guard.count !== 1) {
        const current = await tx.sellRequest.findUnique({
          where: { id },
          select: { status: true, offerState: true },
        });
        if (!current) throw BusinessException.notFound();
        // `details.status` para que la cola pueda decir «esta caducó mientras esperaba tu
        // autorización» en vez de un «conflicto» mudo.
        throw BusinessException.conflict(
          'OFFER_NOT_PENDING_AUTHORIZATION',
          'There is no offer pending authorization on this sell request',
          { offerState: current.offerState, status: current.status },
        );
      }
      // PROJECTION-EXEMPT: ídem — se proyecta con `offerResponseShape` antes de salir.
      return tx.sellRequest.findUnique({
        where: { id },
        include: {
          items: { include: { card: { include: { set: true } } } },
          user: { select: { id: true, name: true, email: true, locale: true } },
        },
      });
    });
    if (!updated) throw BusinessException.notFound();
    await this.sendOfferMail(updated, updated.user);
    return { response: this.offerResponseShape(updated, false) };
  }

  /**
   * **`POST /admin/buylist/:id/offer/cancel`** (criterio 145, D38, v1.51.4).
   *
   * **La única vía para corregir una oferta equivocada** — *no hay «corregir un número» sobre una
   * oferta que el vendedor ya tiene en su bandeja*. La solicitud vuelve a **`cotizada`** y los campos
   * congelados se **limpian**; la oferta anterior **sobrevive íntegra en `AuditLog`**.
   *
   * ### ⚠️ Los CUATRO efectos (D38 / v1.51.4 / **v1.55·D44**) cuelgan del MISMO `if`, y eso es la garantía
   * ```
   * offerState == 'sent'                  ⇒ offerIssueClockStartedAt = now   // D38  · reloj
   *                                       ∧ offerReissueCount        += 1    // (u)  · alerta admin
   *                                       ∧ offerSentCancelledAt     = now   // D44  · PANTALLA
   *                                       ∧ CORREO 5                         // (n)  · bandeja
   * offerState == 'pending_authorization' ⇒ nada de lo anterior — NI UN CORREO
   * ```
   * ⚠️ **v1.55 · D44 — el cuarto efecto entró aquí porque la PANTALLA colgaba de otra columna.**
   * Hasta v1.54, `lastOfferCancelledAt` se derivaba de `offerCancelledAt` + `offerSentAt`, que se
   * escriben en **las dos** ramas y sobreviven a todo: con **dos** cancelaciones el portal pintaba una
   * fecha **que el vendedor nunca supo**, contradiciendo su correo 5 (BL-31, criterio 176(d)). *Las
   * tres consecuencias pasan a ser cuatro efectos de un predicado, con el mismo `now()`.*
   * **Por qué reinicia el reloj:** la regla 7 medía desde `createdAt` y la cancelación no lo tocaba,
   * así que cancelar en el día 7 **para corregir un error nuestro** devolvía la solicitud a la fila
   * **con cero días** y el barrido de esa madrugada le mandaba un *«no procederemos»*. **El vendedor
   * cumplió, esperó, y recibía un cierre causado por nuestra corrección.**
   *
   * **Y el candado es ESTRUCTURAL:** cancelar una `pending_authorization` no reinicia nada porque esa
   * oferta **nunca existió para el vendedor**. Con eso el bucle **silencioso**
   * —preparar→cancelar→preparar— no existe: *el reinicio no puede ocurrir sin que al vendedor le
   * llegue un correo*. Como las tres cosas dependen de **una sola condición**, no pueden
   * desincronizarse.
   */
  async adminOfferCancel(id: string, actor: { id: string; role: Role }, reason?: string) {
    const now = new Date();
    // ⚠️ Los diales de la proyección se izan ANTES de la transacción: leerlos dentro alargaría su
    // ventana sin ganar nada — no participan en ninguna precondición, solo en la forma de la
    // respuesta.
    const dials = await this.adminCycleDials();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const before = await tx.sellRequest.findUnique({
        where: { id },
        include: { items: true, user: { select: { id: true, name: true, email: true, locale: true } } },
      });
      if (!before) throw BusinessException.notFound();
      const wasSent = before.offerState === 'sent';
      const guard = await tx.sellRequest.updateMany({
        where: {
          id,
          closedAt: null,
          offerState: { in: ['sent', 'pending_authorization'] },
          // Una `aceptada` NO se cancela por esta vía: ya hay un compromiso de las dos partes.
          status: { in: ['cotizada', 'ofertada'] },
        },
        data: {
          ...BuylistService.OFFER_FROZEN_NULL,
          offerState: 'cancelled',
          status: 'cotizada',
          // ⚠️⚠️ v1.51.20 · **BL-30 — `offerSentAt` YA NO SE LIMPIA AQUÍ, y el código era el que
          // estaba mal.** La línea decía `offerSentAt: null` contra **tres fuentes que dicen lo
          // contrario**: el schema (*«es el discriminador «esta solicitud va por el ciclo de oferta»
          // (§4.39i.6), y por eso NO se limpia al cancelar»*), ARCHITECTURE §4.39i.6, y el contrato
          // §6/D42, que apoya `lastOfferCancelledAt` **explícitamente** en que sobreviva.
          //
          // **Lo que rompía, medido por HTTP contra BD real:**
          // - **`lastOfferCancelledAt` salía SIEMPRE `null`** (su regla de entonces exigía
          //   `offerSentAt IS NOT NULL`) ⇒ el vendedor que **acababa de recibir el correo 5** entraba
          //   al portal y **no veía rastro** ni de la oferta ni de la cancelación: **la pantalla
          //   contradecía al correo**, que es justo lo que §23.5a prohíbe y lo que D42 vino a cerrar.
          //   ⚠️ **v1.55/D44: esa proyección ya NO mira `offerSentAt`** (mira `offerSentCancelledAt`),
          //   así que **este motivo caducó**. El OTRO sigue vivo y basta por sí solo, que es la razón
          //   por la que esta línea no vuelve.
          // - **La solicitud SALÍA del ciclo de oferta a ojos de las guardas.** `respond` e
          //   `itemDecision(adjust)` discriminan por `offerSentAt`, así que una solicitud cuya
          //   oferta se canceló volvía a admitir la vía de AJUSTE — la que el criterio 150 declara
          //   inexistente en el ciclo. *Cancelar una oferta no devuelve la solicitud al mundo legacy.*
          //
          // Lo que SÍ se limpia sigue igual: los montos y plazos congelados (`OFFER_FROZEN_NULL`) y
          // el desglose por línea. **`offerSentAt` no es un campo congelado: es un HECHO** —esta
          // persona vio una oferta nuestra— y los hechos no se borran al deshacer una decisión.
          // ⚠️ **No reabre ninguna fuga:** `offerPublicDTO` sigue gateado por `offerState === 'sent'`
          // (aquí pasa a `cancelled`), así que la oferta cancelada **no vuelve a viajar al cliente**;
          // y la re-emisión no lo mira (su precondición es `status='cotizada' ∧ offerState ∈
          // {null, cancelled}`), así que **se puede volver a ofertar sin cambiar nada**.
          offerCancelledAt: now,
          offerCancelReason: reason?.trim() ? reason.trim() : null,
          // D38 + v1.51.4 + ⚠️ v1.55/D44: los CUATRO efectos, bajo la MISMA condición y con el MISMO
          // `now()`. El cuarto —`offerSentCancelledAt`, LA PANTALLA— entra aquí y no en otro sitio
          // porque hasta v1.54 el correo y el reloj colgaban de este `if` **y la pantalla colgaba de
          // una columna ajena** (`offerCancelledAt`, que se escribe abajo en las DOS ramas): la
          // propiedad de `PROJECT.md` §E —*«un solo hecho gobierna las TRES, así que no pueden
          // desincronizarse»*— se sostenía **por coincidencia**, y la segunda cancelación la deshizo
          // (BL-31). Ahora son **cuatro efectos de un predicado**, y el invariante es asertable:
          //   `offerReissueCount > 0 ⇔ offerIssueClockStartedAt IS NOT NULL ⇔ offerSentCancelledAt IS NOT NULL`
          ...(wasSent
            ? {
                offerIssueClockStartedAt: now,
                offerReissueCount: { increment: 1 },
                offerSentCancelledAt: now,
              }
            : {}),
          // D22: si había guía emitida, se abre la tarea «cancelar guía no usada» — no desaparece
          // sola (criterio 139).
          ...(before.shipmentTrackingNumber != null && before.guideCancellationDoneAt == null
            ? { guideCancellationPendingAt: now }
            : {}),
        },
      });
      if (guard.count !== 1) {
        throw BusinessException.conflict(
          'OFFER_NOT_CANCELLABLE',
          'There is no live offer to cancel on this sell request',
          { status: before.status, offerState: before.offerState },
        );
      }
      await tx.sellRequestItem.updateMany({
        where: { sellRequestId: id },
        data: { ...BuylistService.OFFER_LINE_NULL },
      });
      // PROJECTION-EXEMPT: se proyecta con `toAdminSellRequestDTO` fuera de la tx (la lista blanca
      // que excluye `clabeSnapshotEnc`).
      const after = await tx.sellRequest.findUnique(
        { where: { id }, include: { items: { select: VERDICT_ITEM_SELECT } } },
      );
      return { before, after, wasSent };
    });

    // ⚠️ CORREO 5 y SOLO si la oferta se había ENVIADO. Escribirle sobre una
    // `pending_authorization` le filtraría que preparamos algo por encima del tope del operador.
    if (outcome.wasSent) {
      await this.sendOfferCancelledMail(outcome.before, outcome.before.user);
    }
    return {
      response: this.adminSellRequestDTO(outcome.after as VerdictItemsPayload, dials),
      audit: {
        wasSent: outcome.wasSent,
        reason: reason?.trim() || undefined,
        before: {
          offerState: outcome.before.offerState,
          offerGrossCents: outcome.before.offerGrossCents,
          offerShippingFeeCents: outcome.before.offerShippingFeeCents,
          offerNetCents: outcome.before.offerNetCents,
          offerSentAt: outcome.before.offerSentAt,
          offerAcceptDeadlineAt: outcome.before.offerAcceptDeadlineAt,
          lines: outcome.before.items.map((i) => ({
            itemId: i.id,
            offerDecision: i.offerDecision,
            offeredPriceCents: i.offeredPriceCents,
            offerDerivedPriceCents: i.offerDerivedPriceCents,
            offerOverrideReason: i.offerOverrideReason,
          })),
        },
      },
    };
  }

  /**
   * **`POST /buylist/requests/:id/offer-response`** — el vendedor acepta o rechaza **la oferta
   * completa** (D1/D2/D3, criterios 118/119/120/121/146/161).
   *
   * ### ⚠️ LA LÍNEA MÁS IMPORTANTE DE LA RELEASE: `accept` ⇒ `aceptada`, **NUNCA `aprobada`**
   * `accept` **no produce ninguna transición de dinero**: no toca ítems, no toca montos y **no
   * habilita el pago**. Si saltara a `aprobada`, la solicitud caería en la cola de «listas para pagar
   * SPEI» **sin envío, sin recepción y sin verificación** — pagaríamos por cartas que nunca
   * recibimos. Después de `aceptada` **todavía no hay nada en camino**: el conteo de «en camino» de
   * la mesa **no se mueve** (criterios 116/138).
   *
   * - **EXIGE SESIÓN DEL DUEÑO** (criterio 146): el correo **lleva** a la pantalla, pero la respuesta
   *   **no se ejecuta desde un enlace anónimo**. Un tercero con sesión propia ⇒ `404` (no `403`: no
   *   se confirma la existencia de una solicitud ajena).
   * - **TODO-O-NADA** (D1): no existe vía para aceptar solo algunas líneas ni para contraofertar.
   * - **SEC-A1** (criterio 120): ningún monto viaja en el body — la defensa es **la forma del DTO**.
   * - **El plazo vencido NO se puede aceptar** (`409 OFFER_EXPIRED`), y la guarda vive en el `where`.
   */
  async offerResponse(userId: string, id: string, decision: 'accept' | 'reject') {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    // Anti-IDOR: solicitud ajena o inexistente ⇒ MISMA respuesta 404.
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    if (req.status !== 'ofertada' || req.offerState !== 'sent') {
      throw BusinessException.conflict('OFFER_NOT_PENDING', 'There is no live offer to respond to', {
        status: req.status,
      });
    }
    const now = new Date();
    if (req.offerAcceptDeadlineAt != null && req.offerAcceptDeadlineAt.getTime() <= now.getTime()) {
      throw BusinessException.conflict('OFFER_EXPIRED', 'The acceptance deadline has passed', {
        offerAcceptDeadlineAt: req.offerAcceptDeadlineAt,
      });
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.sellRequest.updateMany({
        where: {
          id,
          userId,
          status: 'ofertada',
          offerState: 'sent',
          closedAt: null,
          // El plazo, TAMBIÉN en el `where`: un read-then-write dejaría aceptar una oferta que
          // venció entre la lectura y la escritura.
          offerAcceptDeadlineAt: { gt: now },
        },
        data:
          decision === 'accept'
            ? // ⚠️ `aceptada`. NUNCA `aprobada`. No se toca ni un monto ni un ítem.
              { status: 'aceptada', acceptedAt: now }
            : { status: 'rechazada', closedAt: now },
      });
      if (guard.count !== 1) {
        const current = await tx.sellRequest.findUnique({
          where: { id },
          select: { status: true, offerAcceptDeadlineAt: true },
        });
        if (
          current?.status === 'ofertada' &&
          current.offerAcceptDeadlineAt != null &&
          current.offerAcceptDeadlineAt.getTime() <= now.getTime()
        ) {
          throw BusinessException.conflict('OFFER_EXPIRED', 'The acceptance deadline has passed', {
            offerAcceptDeadlineAt: current.offerAcceptDeadlineAt,
          });
        }
        throw BusinessException.conflict(
          'OFFER_NOT_PENDING',
          'There is no live offer to respond to',
          { status: current?.status },
        );
      }
      // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; se proyecta abajo con la lista blanca de
      // cliente antes de devolverla. El join de `user` trae SOLO el `locale` (ver abajo) y **no se
      // esparce**: la respuesta se arma campo a campo.
      return tx.sellRequest.findUnique({
        where: { id },
        // ⚠️ v1.51.15 — el `locale` del VENDEDOR entra a esta respuesta. Sin él, `offerPublicDTO`
        // caía al idioma por defecto y **esta misma oferta se leía en dos idiomas distintos**: en
        // inglés al abrir el portal (`getMine` sí pasaba el locale) y en español al aceptarla. El
        // criterio 161(d) pide que la condición sea la MISMA palabra por palabra; un locale distinto
        // la cambia entera.
        include: { items: { include: { card: true } }, user: { select: { locale: true } } },
      });
    });
    if (!row) throw BusinessException.notFound();
    return {
      sellRequestId: row.id,
      status: row.status as 'aceptada' | 'rechazada',
      ...(row.acceptedAt ? { acceptedAt: row.acceptedAt } : {}),
      isTerminal: isTerminalSellRequestStatus(row.status),
      offer: this.offerPublicDTO({ ...row, locale: row.user?.locale ?? null }, row.items),
    };
  }

  /** Shape de respuesta compartido por `offer` y `offer/authorize` (§M5). */
  private offerResponseShape(
    req: Prisma.SellRequestGetPayload<{ include: { items: { include: { card: true } } } }> | {
      id: string;
      status: SellRequestStatus;
      offerState: SellOfferState | null;
      offerSentAt: Date | null;
      offerGrossCents: number | null;
      offerShippingFeeCents: number | null;
      offerNetCents: number | null;
      offerAcceptDeadlineAt: Date | null;
      items: Parameters<BuylistService['itemDTO']>[0][];
    },
    requiresAuthorization: boolean,
  ) {
    return {
      sellRequestId: req.id,
      status: req.status,
      offerState: req.offerState,
      offerSentAt: req.offerSentAt,
      offerGrossCents: req.offerGrossCents,
      offerShippingFeeCents: req.offerShippingFeeCents,
      offerNetCents: req.offerNetCents,
      offerAcceptDeadlineAt: req.offerAcceptDeadlineAt,
      requiresAuthorization,
      items: (req.items ?? []).map((i) => this.itemDTO(i)),
    };
  }

  /**
   * v1.51 (§11 `SellOfferPublicDTO`) — **LA OFERTA COMO LA VE EL VENDEDOR.** Presente **solo** con
   * `offerState='sent'`; `null` en cualquier otro caso.
   *
   * **LOS TRES MONTOS, SIN LETRAS CHIQUITAS** (D16, criterios 133/134): *«la resta se ENSEÑA, no se
   * esconde»*. **NUNCA lleva `offerState`** (admin-only: le filtraría el orden de magnitud de nuestro
   * tope interno) ni ninguna cifra de la mesa.
   *
   * `terms` lo **renderiza el backend** (misma fuente que el correo), y los plazos viajan como ISO ya
   * resuelto en días hábiles: **el front NO recalcula plazos** — dos implementaciones de «día hábil»
   * en dos lenguajes hacen que la pantalla y el correo digan fechas distintas (criterio 154).
   */
  private offerPublicDTO(
    req: {
      offerState: SellOfferState | null;
      offerSentAt: Date | null;
      offerGrossCents: number | null;
      offerShippingFeeCents: number | null;
      offerNetCents: number | null;
      offerAcceptDeadlineAt: Date | null;
      acceptedAt: Date | null;
      guideSentAt: Date | null;
      shipDeadlineAt: Date | null;
      sellerShippedDeclaredAt: Date | null;
      shipmentCarrier: string | null;
      shipmentTrackingNumber: string | null;
      locale?: string | null;
    },
    items: Parameters<BuylistService['itemDTO']>[0][],
  ) {
    if (req.offerState !== 'sent' || req.offerSentAt == null) return null;
    // ⚠️ v1.51.15 — **UNA sola llamada, para el bloque legal Y para cada línea.** No son dos renders
    // que coinciden: es el MISMO valor. Criterio 161(d) exige que lo que el vendedor lee pegado al
    // monto sea, palabra por palabra, lo que le dijo el correo; renderizarlo dos veces (aunque fuera
    // con la misma función) haría que la identidad dependiera de que nadie cambie un argumento.
    const shippingFeeCents = req.offerShippingFeeCents ?? 0;
    // Lo que se deposita es SIEMPRE el neto (D31: no hay `depositField` que consultar).
    const netCents = req.offerNetCents ?? 0;
    // ⚠️ v1.51.15 · BL-23(2) — los montos de `terms.rule` son **LAS MISMAS CONSTANTES** que se
    // emiten en el desglose, no una segunda lectura de la fila. La prosa dice *«se te depositan X»*
    // y el `AmountBreakdown` dice `netCents`: si salieran de dos expresiones distintas, un cambio en
    // una **haría que la pantalla se contradijera a sí misma** sobre una cifra vinculante.
    const terms = offerTermsCopy(req.locale, { shippingFeeCents, netCents });
    return {
      sentAt: req.offerSentAt,
      grossCents: req.offerGrossCents ?? 0,
      shippingFeeCents,
      netCents,
      acceptDeadlineAt: req.offerAcceptDeadlineAt,
      acceptedAt: req.acceptedAt,
      // ⚠️ v1.51.15 · **BL-23(5)** — **`guideSentAt` NO ES DERIVABLE**, y por eso es obligatorio.
      // `carrier != null` **NO implica guía viva**: al corregir la dirección tras la guía (§4.39t) se
      // **limpian** `guideSentAt`/`shipDeadlineAt` y se **CONSERVAN** `carrier`/`trackingNumber`
      // (son precisamente lo que hay que cancelar). Un cliente que dedujera «hay guía» del carrier
      // pintaría **instrucciones de envío para una etiqueta ANULADA**. Es el único marcador veraz.
      guideSentAt: req.guideSentAt,
      shipDeadlineAt: req.shipDeadlineAt,
      sellerShippedDeclaredAt: req.sellerShippedDeclaredAt,
      carrier: req.shipmentCarrier,
      trackingNumber: req.shipmentTrackingNumber,
      terms,
      lines: items.map((i) => this.itemDTO(i, { conditionLabel: terms.perLineConditionLabel })),
    };
  }

  /**
   * ⚠️⚠️ v1.51.16 · **BL-24** (§4.39h paso **7-bis** / (h.1) · §M5) — **GUARDA DE PROYECCIÓN: NO SE
   * EMITE UNA OFERTA QUE EL PORTAL NO PODRÍA MOSTRAR.**
   *
   * ### El defecto que cierra, y es de DINERO y de JUSTICIA
   * El portal aplica **R2 sin excepción**: una oferta incompleta —sin `terms`, o con líneas sin
   * `offerDecision`— **no se pinta a medias**, y eso es *correcto*. Pero entonces **el vendedor no
   * tiene forma de aceptar**, el barrido **sigue contando sus 2 días hábiles**, y acaba recibiendo un
   * correo que le dice que **no respondió**. **Falló nuestra proyección y la factura le llegaba a
   * él** — exactamente lo que §P.13 prohíbe, y la injusticia que motivó D38.
   *
   * ### ⚠️ LA GUARDA **ES** LA PROYECCIÓN — ésta es la parte que importa
   * Se llama a `offerPublicDTO`, **la MISMA función que sirve `GET /buylist/requests/:id`**. No es
   * una lista de comprobación paralela, y no puede serlo: una checklist aparte sería **un segundo
   * cuerpo de la regla de proyección**, justo lo que el arquitecto descartó en las otras dos vías. Al
   * ser la misma, **no puede divergir de lo que el portal recibe** y **cualquier campo que el portal
   * exija mañana entra al gate solo, sin que nadie se acuerde**.
   *
   * ### Por qué se proyecta «como si estuviera enviada»
   * `offerPublicDTO` devuelve `null` salvo con `offerState='sent'` — es su regla de VISIBILIDAD
   * (D13/D24: una oferta en cola de autorización **no existe** para el vendedor). Aquí se pregunta
   * otra cosa: *«cuando ESTA oferta salga, ¿se podrá mostrar?»*. Por eso se fuerzan los DOS campos
   * que gobiernan la visibilidad y **nada más**: el resto —`terms`, líneas, montos— es la fila real.
   * **Con `202` es donde importa**: `authorize` **no revalida** (§M5 lo dice por escrito para el piso
   * de neto), así que si la cola de autorización aceptara una oferta inmostrable, saldría inmostrable
   * al autorizarla y **el gate no habría servido de nada**.
   *
   * ### Qué se exige, literal del contrato
   * `terms` **íntegro** (`perLineConditionLabel`, `consequence`, `rule`) y **TODA** línea con su
   * `offerDecision`. Se añade el desglose **no vacío**: una oferta sin líneas es inmostrable por la
   * misma R2 (hoy inalcanzable — sin líneas `buy` el bruto es 0 y salta antes
   * `OFFER_NET_BELOW_MINIMUM`—, y un backstop se escribe justo para lo que «no puede pasar»).
   *
   * ⚠️ **NO valida montos ni plazos**: `acceptDeadlineAt` es `null` en el camino `202` **por diseño**
   * (lo congela `authorize`), y confundir *«incompleto para mostrar»* con *«incompleto para pagar»*
   * convertiría un backstop en una segunda regla de negocio.
   *
   * `500`, no `422`: **el operador no hizo nada mal y no puede corregir nada** en esa pantalla. Se
   * **loguea**, porque el filtro global no loguea las `BusinessException` y *un backstop que dispara
   * en silencio es un backstop que nadie arregla*.
   */
  private assertOfferProjectionComplete(
    id: string,
    row: Parameters<BuylistService['offerPublicDTO']>[0] & {
      items: Parameters<BuylistService['itemDTO']>[0][];
    },
    now: Date,
  ): void {
    const missing = offerProjectionGaps(
      this.offerPublicDTO(
        { ...row, offerState: 'sent', offerSentAt: row.offerSentAt ?? now },
        row.items,
      ),
    );
    if (missing.length === 0) return;
    // ⚠️ Se loguea ANTES de lanzar: es NUESTRO defecto, y el vendedor se queda sin su oferta.
    this.logger.error(
      `buylist offer projection incomplete for ${id}: ${missing.join(', ')} — la oferta NO se emite`,
    );
    throw BusinessException.internal(
      'OFFER_PROJECTION_INCOMPLETE',
      'The client projection of this offer is incomplete; the offer was not emitted',
      { missing, sellRequestId: id },
    );
  }

  /**
   * **CORREO 1 — la oferta.** POST-COMMIT y **best-effort**: su fallo se loggea y **NO revierte la
   * oferta** (lo contrario dejaría una decisión de dinero colgada de un servicio externo).
   * **Minimización:** solo las cartas de ESTA solicitud, sus montos y el plazo.
   *
   * ⚠️ **v1.54 · B-1 — la lista de prohibidos son CINCO cosas, y esta nota decía CUATRO.** El
   * criterio **173(h)** las enumera: **CLABE (ni enmascarada), datos de terceros, montos de OTRAS
   * solicitudes, cifras internas de la mesa y DOMICILIO**. El domicilio faltaba justo aquí, y justo
   * aquí se inyectaba: *una lista de prohibiciones incompleta es una autorización tácita.*
   */
  private async sendOfferMail(
    req: Prisma.SellRequestGetPayload<{ include: { items: { include: { card: { include: { set: true } } } } } }>,
    user: { name: string; email: string; locale: string | null } | null | undefined,
  ): Promise<void> {
    try {
      if (!this.mail || !user?.email) {
        this.logger.warn(
          `buylist offer mail skipped for ${req.id}: ${this.mail ? 'no recipient email' : 'MAIL_PORT unavailable'}`,
        );
        return;
      }
      const msg = sellOfferTemplate(
        {
          folio: req.id,
          lines: req.items.map((i) => ({
            cardName: i.card?.name ?? '',
            setName: i.card?.set?.name ?? '',
            cardNumber: i.card?.number ?? '',
            finish: (i.finish ?? 'normal') as Finish,
            offeredPriceCents: i.offerDecision === 'buy' ? i.offeredPriceCents : null,
          })),
          grossCents: req.offerGrossCents ?? 0,
          shippingFeeCents: req.offerShippingFeeCents ?? 0,
          netCents: req.offerNetCents ?? 0,
          acceptDeadlineAt: req.offerAcceptDeadlineAt as Date,
          // ⚠️ v1.54 · B-1 — **el `pickupAddressSnapshot` NO viaja al correo.** Aquí se inyectaba
          // `pickupAddressLine(req.pickupAddressSnapshot)` y el vendedor recibía su domicilio
          // completo en la bandeja. `PROJECT.md` §P.3 / criterio 173(h) lo prohíben en los CINCO
          // correos del ciclo. El aviso de «revisa tu dirección antes de aceptar» sigue en la
          // plantilla, **sin el dato**: se consulta en la cuenta, que es superficie autenticada.
          portalUrl: buylistPortalUrl(req.id, user.locale),
        },
        user.name ?? '',
        user.locale,
      );
      await this.mail.send({ ...msg, to: user.email });
    } catch (e) {
      this.logger.error(
        `buylist offer mail failed for ${req.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** **CORREO 5 — cancelamos la oferta.** Mismo régimen best-effort post-commit. */
  private async sendOfferCancelledMail(
    req: { id: string; offerSentAt: Date | null },
    user: { name: string; email: string; locale: string | null } | null | undefined,
  ): Promise<void> {
    try {
      if (!this.mail || !user?.email) {
        this.logger.warn(
          `buylist offer-cancel mail skipped for ${req.id}: ${this.mail ? 'no recipient email' : 'MAIL_PORT unavailable'}`,
        );
        return;
      }
      const msg = sellOfferCancelledTemplate(
        { folio: req.id, offerSentAt: req.offerSentAt, portalUrl: buylistPortalUrl(req.id, user.locale) },
        user.name ?? '',
        user.locale,
      );
      await this.mail.send({ ...msg, to: user.email });
    } catch (e) {
      this.logger.error(
        `buylist offer-cancel mail failed for ${req.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }


  // ===========================================================================================
  // v1.51 — LA GUÍA Y EL TRÁNSITO (§M5 · ARCHITECTURE §4.39)
  // ===========================================================================================


  /**
   * v1.51.3 (D36/D37, §4.39q) — **el snapshot de la dirección de origen, en UN solo sitio.**
   *
   * ⚠️ **SEC-A1 aplicado a un dato que no es dinero: NADIE ESCRIBE UN DOMICILIO — se ELIGE una fila
   * de la libreta del vendedor.** Ni el cliente ni el admin mandan campos sueltos; los dos mandan un
   * `addressId`. *La defensa es la forma del DTO: no hay campo de dirección que manipular.*
   *
   * ⛔ **PROHIBIDO derivarla de un pedido, del KYC o de «la default»**: sería inventarle al vendedor
   * un origen **que él no confirmó para esta solicitud**, y rompería entera la propiedad del
   * snapshot. Si no tiene la dirección buena en su libreta, **la añade ÉL** y el operador la
   * selecciona — para eso el operador tiene su teléfono (D12).
   *
   * **Misma respuesta para «no existe» y «no es suya»** (`422 PICKUP_ADDRESS_NOT_FOUND`): distinguir
   * las dos convertiría el endpoint en un oráculo de existencia de direcciones ajenas.
   *
   * Devuelve el JSON que se congela en `SellRequest.pickupAddressSnapshot` — **una copia, no una
   * FK**: `Address` se puede borrar, y una referencia viva dejaría solicitudes en vuelo sin origen.
   */
  private async resolvePickupAddressSnapshot(
    ownerUserId: string,
    addressId: string,
  ): Promise<Prisma.InputJsonValue> {
    const addr = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!addr || addr.userId !== ownerUserId) {
      throw BusinessException.validation(
        'PICKUP_ADDRESS_NOT_FOUND',
        'Address not found for this seller',
        // ⚠️ v1.51.20 (escalada 1, resuelta por el arquitecto) — **`field` Y NADA MÁS. El `addressId`
        // se RETIRA.** Este cuerpo lo comparten las TRES rutas (crear, cliente y admin), así que la
        // forma tiene que ser única o la ambigüedad se vuelve permanente.
        // **Por qué `field` y no el id:** `field` dice *qué control repintar* —lo único que separa
        // «capturar» (`PICKUP_ADDRESS_REQUIRED`) de «volver a elegir»—; **el id no contesta nada
        // nuevo: el cliente lo acaba de mandar en esta misma petición**. Y devolverlo **saca un UUID
        // ajeno** al cuerpo, a los logs y a la telemetría, **justo en el único código de la familia
        // que existe por ANTI-ENUMERACIÓN**. *Eco de un identificador que no es tuyo, en el error
        // diseñado para no confirmar que existe.*
        { field: 'addressId' },
      );
    }
    return {
      line1: addr.line1,
      ...(addr.line2 ? { line2: addr.line2 } : {}),
      ...(addr.neighborhood ? { neighborhood: addr.neighborhood } : {}),
      city: addr.city,
      state: addr.state,
      postalCode: addr.postalCode,
      country: addr.country,
      // ⚠️ El teléfono de la ETIQUETA es el del domicilio, **no `User.phone`** (que es el nuestro,
      // para llamarle). Se parecen y no son el mismo dato.
      phone: addr.phone,
      capturedAt: new Date().toISOString(),
      // Trazabilidad de QUÉ fila se copió, sin que sea una FK viva.
      addressId: addr.id,
    };
  }

  /**
   * **`PATCH /buylist/requests/:id/pickup-address` — el CLIENTE corrige su dirección de ORIGEN**
   * (v1.51.3, D36/D37 · API_CONTRACT §6 · ARCHITECTURE §4.39q.4).
   *
   * ### La precondición, NORMATIVA y evaluada en el motor
   * ```
   * legal ⇔ la solicitud es del usuario autenticado
   *       ∧ status ∉ SELL_REQUEST_TERMINAL_STATES  // ⚠️ NUEVO v1.58 (BL-36) — el comentario, DICHO
   *       ∧ closedAt    IS NULL      // no se toca una terminal
   *       ∧ guideSentAt IS NULL      // ⚠️ NO HAY PAPEL IMPRESO TODAVÍA
   * ```
   * ⚠️ **v1.58 · `BL-36` — el término de estado ENTRÓ A LA FÓRMULA, y entró por el CONTRATO.** Este
   * `where` decía `closedAt` y su comentario decía *«no se toca una terminal»*: **no eran lo mismo**
   * para la cohorte legacy pre-M-19. Cuando lo medí (0 filas locales) **no toqué el código**, porque
   * el término que faltaba estaba en **una fórmula que el contrato declara** y moverlo desde aquí
   * habría sido el código mandando sobre el contrato. El arquitecto normó la fórmula en v1.58 y
   * **entonces** el código la sigue. *Cero local no es cero: la cohorte es posible POR CONSTRUCCIÓN.*
   * **Se evalúa en el `updateMany` con el patrón `count === 1`**, no en un `if` sobre la lectura
   * previa: la carrera real es *«el operador captura la guía mientras el vendedor guarda la
   * corrección»*, y ahí tiene que ganar el motor, no el orden de llegada. `userId` va **también** en
   * el `where` por lo mismo — la autorización no puede quedarse colgada de una lectura que una
   * carrera invalide.
   *
   * ⚠️ **La línea es `guideSentAt`, NO `status`.** El estado no dice si hay papel; `guideSentAt` sí
   * («capturar es entregar», §4.39j). Una **`aceptada` SIN guía** todavía se corrige —y es el caso
   * que más importa: el vendedor acaba de aceptar y está revisando sus datos—; una **`aceptada` CON
   * guía**, no: ahí el remedio tiene endpoint, pero es de ADMIN (`adminUpdatePickupAddress`), porque
   * matar una etiqueta pagada y comprar otra **debe tener nombre, fecha y bitácora**.
   *
   * **Anti-IDOR:** solicitud ajena o inexistente ⇒ **la misma `404`**. Dirección ajena o inexistente
   * ⇒ **la misma `422 PICKUP_ADDRESS_NOT_FOUND`** (cuerpo compartido con la ruta de admin y con
   * `createRequest`: *una sola definición de «esta dirección es suya»*).
   *
   * **Devuelve los `addressId` para la bitácora — y NADA de PII**: el controller registra
   * `buylist.pickup_address.update` con el id anterior y el nuevo, jamás el domicilio.
   */
  async updatePickupAddress(userId: string, id: string, addressId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.sellRequest.findUnique({
        where: { id },
        select: {
          userId: true,
          status: true,
          closedAt: true,
          guideSentAt: true,
          pickupAddressSnapshot: true,
        },
      });
      // Anti-IDOR: ajena o inexistente ⇒ MISMA respuesta (no se confirma existencia).
      if (!before || before.userId !== userId) throw BusinessException.notFound();
      // La dirección se resuelve contra la libreta DEL PROPIO usuario autenticado.
      const snapshot = await this.resolvePickupAddressSnapshot(userId, addressId);
      const guard = await tx.sellRequest.updateMany({
        // ⚠️⚠️ v1.58 · **BL-36 (§M5-T, GRUPO B)** — `...liveRequestWhere()` aporta los DOS ejes de
        // «viva»: `status ∉ SELL_REQUEST_TERMINAL_STATES` **y** `closedAt IS NULL`. El comentario
        // *«no se toca una terminal»* llevaba desde v1.51.3 al lado de un término que **no lo decía**:
        // una fila **legacy anterior a M-19** es terminal con `closedAt = null` (el schema lo declara:
        // *«Nullable (filas legacy usan fallback)»*) y, **por ser también pre-M-46**, tiene
        // `guideSentAt` nulo ⇒ **pasaba la guarda entera**.
        // ⚠️ **El término NO sustituye a `guideSentAt`: se SUMA.** Son dos ejes —*«ya cerró»* y *«ya
        // hay papel»*— y hacen falta los dos, exactamente como en §M5-T.
        // ⛔ **Jamás un literal de estados** (§4.39c sitio 8): el helper ya existe y el día que
        // `SELL_REQUEST_TERMINAL_STATES` gane un valor, los dos `where` se mueven **juntos o ninguno**.
        // **Cero vocabulario nuevo y cero cambio de shape:** `409 PICKUP_ADDRESS_LOCKED` con
        // `details.status` ya estaba declarado, y `status` es justo el campo que explica el rechazo.
        where: { id, userId, ...this.liveRequestWhere(), guideSentAt: null },
        data: { pickupAddressSnapshot: snapshot },
      });
      if (guard.count !== 1) {
        throw BusinessException.conflict(
          'PICKUP_ADDRESS_LOCKED',
          'The pickup address can no longer be changed: the label is already printed or the request is closed',
          { status: before.status, guideSentAt: before.guideSentAt },
        );
      }
      const after = await tx.sellRequest.findUnique({
        where: { id },
        select: { id: true, pickupAddressSnapshot: true },
      });
      return {
        sellRequestId: after?.id as string,
        pickupAddress: after?.pickupAddressSnapshot ?? null,
        // Material de bitácora: SOLO los ids, jamás el domicilio.
        auditAddressIds: {
          before: (before.pickupAddressSnapshot as { addressId?: string } | null)?.addressId ?? null,
          after: addressId,
        },
      };
    });
  }

  /**
   * **`PATCH /admin/buylist/:id/pickup-address` — corregir la dirección DESPUÉS de la guía**
   * (v1.51.4, **BL-13**, §4.39t).
   *
   * ### Por qué existe: el remedio que quedaba ACUSABA AL VENDEDOR
   * Con la guía ya emitida y un typo **NUESTRO** en la etiqueta, no había salida: la cola de guía
   * muerta solo se abre si la solicitud **expira o se cancela**; `offer/cancel` **rechaza una
   * `aceptada`**; y la ruta del cliente está cerrada por `guideSentAt IS NULL`. ⇒ **La única salida
   * era dejar vencer el plazo de envío** ⇒ `expirada`/`not_shipped` ⇒ el correo de *«aceptaste y el
   * paquete no salió»*. **Un error nuestro terminaba imputándole un incumplimiento al vendedor** —
   * la misma injusticia que D38 quitó, por otra puerta. *No era una comodidad ausente: era un
   * desenlace incorrecto.*
   *
   * ### La guarda, y por qué cada condición
   * ```
   * legal ⇔ status ∉ SELL_REQUEST_TERMINAL_STATES  // ⚠️ NUEVO v1.58 (BL-36) — el comentario, DICHO
   *       ∧ closedAt                IS NULL   // no se toca una terminal
   *       ∧ shipmentConfirmedAt     IS NULL   // el paquete ya viaja: corregir el papel no lo desvía
   *       ∧ sellerShippedDeclaredAt IS NULL   // él dice que YA lo depositó ⇒ la etiqueta está USADA
   * ```
   * ⚠️ **v1.58 · `BL-36` — LOS DOS TÉRMINOS, PORQUE PUEDEN DISCREPAR.** Es la discrepancia **inversa**
   * a la de P1: allí `closedAt` sellado con `status` vivo; **aquí `status` terminal con `closedAt`
   * nulo** — la cohorte de las filas que se volvieron terminales **antes de M-19**, que el propio
   * schema declara (*«Nullable (filas legacy usan fallback)»*) y que `jobs/ine-retention.service.ts`
   * ya contempla. **Y toda fila pre-M-19 es también pre-M-46** ⇒ `guideSentAt`,
   * `shipmentConfirmedAt` y `sellerShippedDeclaredAt` son **null en ella**: **pasaba las DOS guardas
   * enteras**, la de cliente y ésta.
   * ⚠️ **La tercera se rechaza a propósito y hay que decirlo en voz alta:** si el vendedor ya
   * depositó, el papel **no está impreso: está en manos de una paquetería**. Cambiar la fila **no
   * mueve la caja**, y dejarlo pasar **crearía la ilusión de que sí**. Ahí el remedio es humano de
   * verdad —llamar a la paquetería— y **el sistema no debe fingir que tiene un botón para eso**.
   *
   * ⚠️ **A diferencia de la ruta de cliente, `guideSentAt` NO es precondición: es justo la ventana
   * que esta ruta existe para cubrir.**
   *
   * ### Los efectos, en UNA transacción
   * El snapshot **siempre** se re-congela. Y **si había papel impreso**, la solicitud vuelve a un
   * estado **que ya existe y ya se vigila**: `aceptada` **sin guía** ⇒ `shipDeadlineAt = null` ⇒ la
   * regla 2 del barrido **no la ve** ⇒ **no puede expirar por nuestro error**, y aparece en
   * `awaitingGuide`. *La corrección no inventa un camino: devuelve la solicitud al punto exacto del
   * que nunca debió salir.* **Cero estados nuevos, cero colas nuevas, cero correos.**
   *
   * ⚠️ **`guideCancellationDoneAt = null` REABRE la tarea, y sin esa línea el fallo es invisible:**
   * una **segunda** corrección sobre la misma solicitud **no volvería a aparecer en la cola** (el
   * predicado exige `doneAt IS NULL`) y **la etiqueta se perdería del P&L en silencio** — la cola de
   * guía muerta es *«la ÚNICA puerta por la que el costo de una etiqueta tirada entra al P&L»*.
   *
   * **`carrier`/`trackingNumber` NO se limpian**: son **lo que hay que cancelar**, y la fila de la
   * cola los muestra para que el operador sepa **qué** guía matar. Borrarlos la vaciaría de lo que la
   * hace trabajable.
   *
   * ⚠️ **LÍMITE ACEPTADO Y DECLARADO:** con **dos** correcciones sobre la misma solicitud, el segundo
   * `guide/cancellation-done` **pisa** `guideActualCostCents` del primero ⇒ el P&L pierde una
   * etiqueta. Se acepta: **este número no le paga a nadie** y exige equivocarse **dos veces con la
   * misma solicitud**. ⛔ **Prohibido el atajo de acumular (`+=`)**: convertiría *«el costo de la
   * etiqueta»* en *«la suma de los costos»* **sin cambiarle el nombre**.
   */
  async adminUpdatePickupAddress(id: string, addressId: string) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.sellRequest.findUnique({
        where: { id },
        select: {
          userId: true,
          status: true,
          closedAt: true,
          guideSentAt: true,
          shipmentConfirmedAt: true,
          sellerShippedDeclaredAt: true,
          pickupAddressSnapshot: true,
        },
      });
      if (!before) throw BusinessException.notFound();
      // La dirección se resuelve contra la libreta DEL VENDEDOR de esta solicitud, no del actor.
      const snapshot = await this.resolvePickupAddressSnapshot(before.userId, addressId);
      const hadGuide = before.guideSentAt != null;
      const guard = await tx.sellRequest.updateMany({
        // Guarda del MOTOR (`count === 1`), no un `if` sobre la lectura de arriba.
        // ⚠️⚠️ v1.58 · **BL-36 (§M5-T, GRUPO B)** — mismo hueco que en la ruta de cliente y misma
        // forma: `...liveRequestWhere()` = `status ∉ TERMINAL ∧ closedAt IS NULL`. Una fila legacy
        // **pre-M-19** es terminal con `closedAt = null` y, por ser también **pre-M-46**, tiene los
        // **otros tres términos nulos** ⇒ **pasaba entera**.
        // **Qué se evita, sin inflarlo:** re-congelar el `pickupAddressSnapshot` de una solicitud **ya
        // cerrada** — escribir **PII fresca sobre un expediente terminal** que va camino de la purga,
        // y dejar una bitácora que dice que la dirección de origen cambió en una operación que acabó
        // hace meses. **No mueve dinero, no imprime papel y no reabre nada:** es higiene de
        // expediente, y por eso es Baja y no Alta.
        // **Ningún trabajo legítimo se pierde**, comprobado verbo por verbo: matar una etiqueta y
        // comprar otra solo tiene sentido sobre una solicitud viva, y el `hadGuide` que reabre la
        // tarea de guía muerta **no puede disparar en esta cohorte** (`guideSentAt` es `null` en ella).
        // La tarea de guía muerta tiene **su propio endpoint**, que es la excepción NOMBRADA de §M5-T
        // y **no se toca**.
        where: {
          id,
          ...this.liveRequestWhere(),
          shipmentConfirmedAt: null,
          sellerShippedDeclaredAt: null,
        },
        data: {
          pickupAddressSnapshot: snapshot,
          ...(hadGuide
            ? {
                guideCancellationPendingAt: now,
                // ⚠️ REABRE la tarea. Sin esto, la segunda corrección pierde una etiqueta del P&L
                // **en silencio**.
                guideCancellationDoneAt: null,
                guideCancellationDoneBy: null,
                guideSentAt: null,
                // Sin guía no hay reloj: la regla 2 deja de ver la fila y NO puede expirar por
                // nuestro error.
                shipDeadlineAt: null,
              }
            : {}),
        },
      });
      if (guard.count !== 1) {
        throw BusinessException.conflict(
          'PICKUP_ADDRESS_LOCKED',
          'The pickup address can no longer be corrected on this sell request',
          {
            status: before.status,
            guideSentAt: before.guideSentAt,
            sellerShippedDeclaredAt: before.sellerShippedDeclaredAt,
          },
        );
      }
      const after = await tx.sellRequest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          pickupAddressSnapshot: true,
          guideSentAt: true,
          shipDeadlineAt: true,
          guideCancellationPendingAt: true,
        },
      });
      return {
        sellRequestId: after?.id as string,
        status: after?.status as SellRequestStatus,
        pickupAddress: after?.pickupAddressSnapshot ?? null,
        guideSentAt: after?.guideSentAt ?? null,
        shipDeadlineAt: after?.shipDeadlineAt ?? null,
        guideCancellationPendingAt: after?.guideCancellationPendingAt ?? null,
        // Material de bitácora: SOLO los ids, jamás el domicilio (misma norma que la ruta de cliente).
        auditAddressIds: {
          before: (before.pickupAddressSnapshot as { addressId?: string } | null)?.addressId ?? null,
          after: addressId,
        },
      };
    });
  }

  /**
   * **`POST /admin/buylist/:id/guide` — capturar la guía** (D19/D21/D22, criterios 122/123/137).
   *
   * ### ⚠️ La etiqueta se compra AL ACEPTAR, no al ofertar (D21)
   * Precondición **`status='aceptada'`**. *Ofertar a diez personas y comprar diez guías por
   * adelantado sería tirar el dinero de las que digan que no.* Una oferta rechazada o ignorada
   * **jamás genera etiqueta**.
   *
   * ### UN SOLO timestamp de guía, y es deliberado
   * `PROJECT.md` ancla el plazo en *«que la guía llega al vendedor»* y el número queda visible al
   * capturarse: **capturar ES entregar**. Dos campos (`emitida`/`entregada`) invitarían a que uno se
   * quede sin poblar y **el reloj arrancara en el momento equivocado**.
   *
   * ### El reloj arranca con la GUÍA, no con la aceptación (criterio 123)
   * `shipDeadlineAt = guideSentAt + buylistShipDeadlineBusinessDays` (días hábiles). Una guía
   * entregada dos días después de aceptar **corre el vencimiento dos días**: *sería injusto correrle
   * el reloj mientras espera una etiqueta que depende de nosotros.*
   *
   * **Mientras no haya guía, `shipDeadlineAt` es `null` ⇒ la regla 2 del barrido no ve la solicitud
   * ⇒ NO expira.** Es correcto (§P.13) pero deja **un pendiente NUESTRO** que podría quedarse quieto
   * para siempre — por eso existe la cola `awaitingGuide`.
   *
   * ### Re-captura: se corrige el número, NO se mueve la fecha
   * ```
   * shipDeadlineAt IS NULL      ⇒ congelar     // primera guía, o tras una corrección de dirección
   * shipDeadlineAt IS NOT NULL  ⇒ NO se toca   // criterio 157: la fecha ya comunicada no se mueve
   * ```
   * ⚠️ Sin el primer caso, la guía re-capturada tras una corrección dejaría `shipDeadlineAt` en
   * `null` **para siempre**: una solicitud invisible para el reloj **y** para la cola. *Un plazo que
   * no arranca es tan defectuoso como uno que arranca mal.*
   *
   * ### `409 GUIDE_CANCELLATION_PENDING` (v1.51.4 / BL-13)
   * Con una cancelación pendiente, capturar la etiqueta nueva **pisaría el número de la vieja** y la
   * cola pediría cancelar *la que ya es la buena*. **Una etiqueta viva por solicitud.**
   */
  async adminGuide(id: string, carrier: string, trackingNumber: string) {
    const days = await this.settings.getNumber(SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.sellRequest.findUnique({
        where: { id },
        select: {
          status: true,
          shipDeadlineAt: true,
          shipmentCarrier: true,
          shipmentTrackingNumber: true,
          guideCancellationPendingAt: true,
          guideCancellationDoneAt: true,
        },
      });
      if (!before) throw BusinessException.notFound();
      if (
        before.guideCancellationPendingAt != null &&
        before.guideCancellationDoneAt == null
      ) {
        throw BusinessException.conflict(
          'GUIDE_CANCELLATION_PENDING',
          'There is a pending guide cancellation: close it before capturing a new label',
          {
            carrier: before.shipmentCarrier,
            trackingNumber: before.shipmentTrackingNumber,
            guideCancellationPendingAt: before.guideCancellationPendingAt,
          },
        );
      }
      const guard = await tx.sellRequest.updateMany({
        // La guarda es del MOTOR (patrón `count===1`), no un `if` sobre la lectura de arriba.
        where: { id, status: 'aceptada', closedAt: null },
        data: {
          shipmentCarrier: carrier.trim(),
          shipmentTrackingNumber: trackingNumber.trim(),
          guideSentAt: now,
          // Solo se congela si NO había fecha: re-capturar corrige el número, no mueve el plazo.
          ...(before.shipDeadlineAt == null
            ? { shipDeadlineAt: addBusinessDays(now, days) }
            : {}),
        },
      });
      if (guard.count !== 1) {
        const current = await tx.sellRequest.findUnique({
          where: { id },
          select: { status: true },
        });
        throw BusinessException.conflict(
          'GUIDE_NOT_ALLOWED',
          'A guide can only be captured on an accepted sell request',
          { status: current?.status },
        );
      }
      const after = await tx.sellRequest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          shipmentCarrier: true,
          shipmentTrackingNumber: true,
          guideSentAt: true,
          shipDeadlineAt: true,
        },
      });
      return {
        sellRequestId: after?.id as string,
        status: after?.status as SellRequestStatus,
        shipmentCarrier: after?.shipmentCarrier ?? null,
        shipmentTrackingNumber: after?.shipmentTrackingNumber ?? null,
        guideSentAt: after?.guideSentAt ?? null,
        shipDeadlineAt: after?.shipDeadlineAt ?? null,
      };
    });
  }

  /**
   * **`POST /admin/buylist/:id/confirm-shipment` — LO ÚNICO que mueve a `en_transito`** (D20,
   * criterios 114/122/138).
   *
   * ### ⚠️ Por qué esto y el «ya lo mandé» son DOS actos y no uno
   * El plazo mide **una acción del vendedor**, pero nos enteramos por **una acción nuestra**. Sin
   * nada en medio: el vendedor deposita el día 3, el operador confirma el día 4, y el barrido ya
   * expiró una solicitud **en la que el vendedor cumplió** — se queda sin venta **por una latencia
   * nuestra**, y encima ya gastamos la etiqueta. Por eso `declare-shipped` **detiene el reloj sin
   * mover el estado** y esta confirmación **mueve el estado**: el barrido solo expira si **no hubo
   * ninguna de las dos**.
   *
   * **Y AHORA SÍ** la línea empieza a sumar a la cifra de **«en camino»** de la mesa de decisión de
   * **otras** solicitudes (criterio 116). Ni la compra de la guía ni el aviso del vendedor la mueven:
   * *contar promesas como inventario es exactamente el error que esa pantalla existe para evitar.*
   *
   * ### `guideSentAt` NO es precondición — fail-VISIBLE, no fail-blocking
   * Si el paquete llegó sin que hubiéramos capturado guía, **negar la confirmación no devuelve el
   * paquete**. El caso queda **anotado** (`guideMissing: true` en la bitácora), que le da a M9 una
   * métrica real de operación.
   *
   * ### ⚠️ FRONTERA MONEY-SAFE
   * `guideActualCostCents` **NO ENTRA JAMÁS en `payoutNetCents`**: al vendedor se le descuenta **la
   * tarifa congelada que aceptó**, cueste lo que cueste la etiqueta real (D25/criterio 157). Es
   * insumo **de reporte**, no de pago.
   */
  async adminConfirmShipment(
    id: string,
    actor: { id: string; role: Role },
    guideActualCostCents?: number,
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.sellRequest.findUnique({
        where: { id },
        select: { status: true, guideSentAt: true },
      });
      if (!before) throw BusinessException.notFound();
      const guard = await tx.sellRequest.updateMany({
        // Regla dura (criterio 114): **solo** `aceptada`. No existe secuencia que llegue a
        // `en_transito` sin pasar por `ofertada` y `aceptada`, y la guarda va en el `where`.
        where: { id, status: 'aceptada', closedAt: null },
        data: {
          status: 'en_transito',
          shipmentConfirmedAt: now,
          shipmentConfirmedBy: actor.id,
          // Insumo de REPORTE. No se toca `payoutNetCents` ni `offerShippingFeeCents`.
          ...(guideActualCostCents != null ? { guideActualCostCents } : {}),
        },
      });
      if (guard.count !== 1) {
        const current = await tx.sellRequest.findUnique({
          where: { id },
          select: { status: true },
        });
        throw BusinessException.conflict(
          'NOT_ACCEPTED',
          'Shipment can only be confirmed on an accepted sell request',
          { status: current?.status },
        );
      }
      const after = await tx.sellRequest.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          shipmentConfirmedAt: true,
          shipmentConfirmedBy: true,
          guideActualCostCents: true,
        },
      });
      return {
        response: {
          sellRequestId: after?.id as string,
          status: after?.status as SellRequestStatus,
          shipmentConfirmedAt: after?.shipmentConfirmedAt ?? null,
          shipmentConfirmedBy: after?.shipmentConfirmedBy ?? null,
          guideActualCostCents: after?.guideActualCostCents ?? null,
        },
        // Fail-VISIBLE: el caso «llegó sin guía capturada» no bloquea, pero queda contado.
        audit: { guideMissing: before.guideSentAt == null, guideActualCostCents },
      };
    });
  }

  /**
   * **`POST /buylist/requests/:id/declare-shipped` — el «ya lo mandé»** (§P.13, criterios 138/156).
   *
   * ### Los TRES efectos, y los tres importan
   * 1. **DETIENE el reloj del vendedor** (sella `sellerShippedDeclaredAt`): el barrido ya no puede
   *    expirar esa solicitud.
   * 2. **NO mueve el estado.** Sigue `aceptada`. **Es su palabra, todavía sin confirmar.**
   * 3. **NO suma al conteo de «en camino»** de la mesa. *Es una promesa, no un paquete.* El conteo se
   *    queda **corto, no inflado** — que es el lado seguro del error — y la alerta P17 existe para
   *    que alguien lo corrija pronto en vez de que se quede corto indefinidamente.
   *
   * **Idempotente:** una segunda llamada devuelve `200` con el timestamp **ya sellado** y **no lo
   * re-fija** — re-fijarlo le regalaría al vendedor **un reloj infinito**. A diferencia de `respond`,
   * aquí el `200` idempotente **sí** es correcto: no mueve dinero y el hecho que declara es puntual.
   */
  async declareShipped(userId: string, id: string) {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    // Anti-IDOR: ajena o inexistente ⇒ MISMA respuesta 404.
    if (!req || req.userId !== userId) throw BusinessException.notFound();
    if (req.status !== 'aceptada') {
      // Una `cotizada` u `ofertada` NO ofrece esta vía (criterio 114): la pantalla del cliente no
      // muestra guía ni instrucciones de envío hasta que la oferta está ACEPTADA.
      throw BusinessException.conflict('NOT_ACCEPTED', 'This sell request is not accepted', {
        status: req.status,
      });
    }
    if (req.sellerShippedDeclaredAt != null) {
      // Idempotencia: NO se re-fija. El reloj se detuvo una vez y ahí se queda.
      return {
        sellRequestId: req.id,
        status: req.status,
        sellerShippedDeclaredAt: req.sellerShippedDeclaredAt,
      };
    }
    const now = new Date();
    const guard = await this.prisma.sellRequest.updateMany({
      // La guarda del motor incluye `sellerShippedDeclaredAt: null`: dos llamadas concurrentes no
      // pueden re-sellar el timestamp (y con él, correr el reloj hacia adelante).
      where: { id, userId, status: 'aceptada', closedAt: null, sellerShippedDeclaredAt: null },
      data: { sellerShippedDeclaredAt: now },
    });
    const after = await this.prisma.sellRequest.findUnique({
      where: { id },
      select: { id: true, status: true, sellerShippedDeclaredAt: true },
    });
    if (guard.count !== 1 && after?.sellerShippedDeclaredAt == null) {
      throw BusinessException.conflict('NOT_ACCEPTED', 'This sell request is not accepted', {
        status: after?.status,
      });
    }
    return {
      sellRequestId: after?.id as string,
      status: after?.status as SellRequestStatus,
      sellerShippedDeclaredAt: after?.sellerShippedDeclaredAt as Date,
    };
  }

  /**
   * **`GET /admin/buylist/pending-shipment-confirmation`** — la cola «por confirmar envío»
   * (criterio 156).
   *
   * Es **el trabajo que la separación de D20 crea**: las solicitudes en las que **el vendedor ya
   * cumplió** (`sellerShippedDeclaredAt != null`) y **nosotros todavía no confirmamos**. Sin esta
   * cola, el reloj detenido sería un pendiente invisible.
   *
   * **`alert` es DERIVADO server-side, no se persiste** (basta el timestamp + el dial): han pasado
   * más de `buylistShipmentConfirmAlertBusinessDays` días hábiles desde la declaración.
   *
   * ⚠️ **La alerta NO HACE NADA MÁS: no expira, no cancela, no mueve el estado y no suma a «en
   * camino».** *El vendedor ya cumplió; el pendiente es nuestro, así que el remedio es hacerlo
   * visible, no castigarlo.* Orden `sellerShippedDeclaredAt` **asc** (lo más viejo primero: es una
   * cola de trabajo).
   */
  async adminPendingShipmentConfirmation(page: number, pageSize: number, onlyAlerts?: boolean) {
    const alertDays = await this.settings.getNumber(
      SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS,
    );
    const where: Prisma.SellRequestWhereInput = {
      status: 'aceptada',
      sellerShippedDeclaredAt: { not: null },
      shipmentConfirmedAt: null,
    };
    const include = { user: { select: { id: true, name: true, email: true, phone: true } } };
    const orderBy = { sellerShippedDeclaredAt: 'asc' } as const;
    // ⚠️ v1.51.18 · **BL-26** (§4.39m.7.2) — **`total` CUENTA EXACTAMENTE EL CONJUNTO QUE `data`
    // PAGINA.** Antes esta cola paginaba y contaba en SQL, y **después** filtraba `data` por `alert`:
    // con `?onlyAlerts=true` el `total` era el de la cola COMPLETA ⇒ **páginas vacías al final** y un
    // número que **miente sobre el tamaño del trabajo pendiente**, que es lo único que una cola
    // existe para decir. Es §P.8 aplicado a un conteo — la misma lógica que prohíbe el `0` de
    // `positionUnavailable`.
    //
    // ⚠️ **NO se arregla moviendo el filtro al `where`**, y ésta es la parte que hay que leer
    // despacio: `alert` es **derivado** y depende de `businessDaysSince`, **que LANZA** por doctrina.
    // Una fila fuera de la cobertura del calendario **degrada a `alert: true`** (BL-22) — un `where`
    // no puede expresar eso, y traducirlo pondría **una segunda definición de la alerta** en una
    // consulta que ningún test de días hábiles cubre. *Es el hallazgo de BL-22 mordiendo por el otro
    // lado.* **Se cuenta sobre el conjunto ya derivado, igual que se pagina.**
    //
    // Sin `onlyAlerts` **no se barre**: ahí `data` y `total` ya coinciden en SQL, y barrer de más
    // para obtener el mismo número sería pagar por nada.
    if (onlyAlerts) {
      const all = await this.prisma.sellRequest.findMany({ where, orderBy, include });
      const alerted = all.map((r) => this.pendingShipmentRow(r, alertDays)).filter((x) => x.alert);
      return {
        data: alerted.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: alerted.length,
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include,
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    return { data: rows.map((r) => this.pendingShipmentRow(r, alertDays)), page, pageSize, total };
  }

  /**
   * Una fila de la cola «por confirmar envío», con su `alert` **ya derivado**. Cuerpo ÚNICO: lo usan
   * la rama paginada en SQL y la que filtra por alerta — *el `total` no puede contar filas
   * construidas con una regla distinta de la que produce las filas de `data`.*
   */
  private pendingShipmentRow(
    r: Prisma.SellRequestGetPayload<{
      include: { user: { select: { id: true; name: true; email: true; phone: true } } };
    }>,
    alertDays: number,
  ) {
    // ⚠️ v1.51.14 · BL-22: se captura POR FILA. Antes, una sola fila fuera de la cobertura del
    // calendario devolvía `500` en TODA la cola.
    const waiting = this.safeDerive(
      () => businessDaysSince(r.sellerShippedDeclaredAt as Date),
      `días esperando de ${r.id}`,
    );
    return {
      sellRequestId: r.id,
      seller: this.sellerRef(r.user),
      sellerShippedDeclaredAt: r.sellerShippedDeclaredAt,
      shipDeadlineAt: r.shipDeadlineAt,
      carrier: r.shipmentCarrier,
      trackingNumber: r.shipmentTrackingNumber,
      businessDaysWaiting: waiting.value,
      ...(waiting.failed ? { businessDaysUnavailable: true as const } : {}),
      // ⚠️ **`alert` falla hacia `true`, no hacia `false`.** *«Llevo demasiado esperando»* y *«no
      // puedo saber cuánto llevo»* piden **la misma acción humana**: que alguien mire. Y un
      // `false` sacaría la fila del filtro `?onlyAlerts=true`, que es la única vista donde se
      // encontraría — **la fila más rara sería la más escondida**.
      // (Contraste con la mesa, que falla hacia `"none"`: allí el veredicto **aconseja un acto**
      // y uno inventado frenaría o empujaría una compra. *Donde el flag solo hace VISIBLE, se
      // falla hacia visible; donde condiciona un acto, hacia «no sé».*)
      alert: waiting.failed || (waiting.value as number) > alertDays,
    };
  }


  /**
   * **`GET /admin/buylist/offers/pending-authorization`** — la cola del súper-admin (D24, criterio
   * 143/147).
   *
   * ⚠️ **Estas filas SE MUEREN SOLAS.** Una oferta `pending_authorization` vive con
   * `status='cotizada'`, y esa `cotizada` **caduca a los 7 días hábiles como cualquier otra** (regla
   * 7): al vencer, el barrido **anula la oferta en la misma transacción**, así que autorizar después
   * devuelve `409`. Por eso `caducityAt` **no es decoración**: *una cola ordenada por antigüedad sin
   * la fecha en que cada fila muere es una cola que se trabaja a ciegas.*
   *
   * `excessCents` viaja calculado: es *«cuánto se pasó del tope»*, y **la UI no hace aritmética de
   * dinero** (misma norma que `requiresAuthorization` y `grossShortfallCents`).
   *
   * ⚠️ **v1.51.14 · BL-22 — `caducityAt` NACE con la degradación por fila puesta**, en vez de
   * escribir el mismo defecto una tercera vez.
   */
  async adminPendingOfferAuthorization(page: number, pageSize: number) {
    const [operatorCapCents, offerIssueDays] = await Promise.all([
      this.settings.getNumber(SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS),
      this.settings.getNumber(SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS),
    ]);
    const where: Prisma.SellRequestWhereInput = {
      offerState: 'pending_authorization',
      // Los DOS candados del `authorize`, también aquí: una fila que ya caducó no se trabaja.
      status: 'cotizada',
      closedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        // Cola de trabajo: lo más viejo primero.
        orderBy: { offerPreparedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          items: { select: { offerDecision: true } },
        },
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    return {
      data: rows.map((r) => {
        const caducity = this.caducityOf(r, offerIssueDays);
        return {
          sellRequestId: r.id,
          seller: this.sellerRef(r.user),
          preparedBy: r.offerPreparedBy,
          offerPreparedAt: r.offerPreparedAt,
          offerGrossCents: r.offerGrossCents,
          operatorCapCents,
          // Derivado: la UI no resta dinero.
          excessCents: Math.max(0, (r.offerGrossCents ?? 0) - operatorCapCents),
          lineCount: r.items.length,
          buyLineCount: r.items.filter((i) => i.offerDecision === 'buy').length,
          caducityAt: caducity.value,
          ...(caducity.failed ? { caducityUnavailable: true as const } : {}),
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /**
   * **`GET /admin/buylist/live-sellers`** — *«la lista de gente a la que le debemos una respuesta»*
   * (D12, criterios 129/130).
   *
   * **«Viva» = TODO lo que NO es terminal, POR EXCLUSIÓN** (criterio 129): así un estado nuevo del
   * enum entra a la cola **solo**, sin que nadie tenga que acordarse de actualizar una lista. Es la
   * única de las dos direcciones en la que olvidarse **falla hacia el lado seguro** (aparece de más
   * en una cola de trabajo, en vez de desaparecer de ella).
   *
   * **En UNA query agrupada** (P-5: prohibido que el front lo derive paginando).
   *
   * ⚠️ **El teléfono viaja EN LA FILA** para poder llamar sin abrir la ficha. Mismo régimen PII que
   * el correo (§4.18d): dato de contacto operativo de back-office **por rol**, **sin enmascarado y
   * sin reveal auditado** — y **PROHIBIDO en toda superficie pública** (criterio 130). `null` en
   * cuentas de Google y en cuentas viejas.
   */
  async adminLiveSellers(page: number, pageSize: number) {
    // UNA query agrupada: cuántas vivas por vendedor. El orden por defecto («la más antigua
    // primero») se resuelve sobre el agregado.
    const grouped = await this.prisma.sellRequest.groupBy({
      by: ['userId'],
      where: { status: { in: [...SELL_REQUEST_LIVE_STATES] }, closedAt: null },
      _count: { _all: true },
      _min: { createdAt: true },
      orderBy: { _min: { createdAt: 'asc' } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const total = (
      await this.prisma.sellRequest.groupBy({
        by: ['userId'],
        where: { status: { in: [...SELL_REQUEST_LIVE_STATES] }, closedAt: null },
        _count: { _all: true },
      })
    ).length;
    if (grouped.length === 0) return { data: [], page, pageSize, total };

    const userIds = grouped.map((g) => g.userId);
    const [users, latest] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        // Lista blanca: `phone` entra a propósito (D12) y nada más de la ficha del usuario.
        select: { id: true, name: true, email: true, phone: true },
      }),
      // El último estado por vendedor, en UNA lectura acotada a estos vendedores.
      this.prisma.sellRequest.findMany({
        where: {
          userId: { in: userIds },
          status: { in: [...SELL_REQUEST_LIVE_STATES] },
          closedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { userId: true, status: true, createdAt: true },
      }),
    ]);
    const byUser = new Map(users.map((u) => [u.id, u]));
    const latestByUser = new Map<string, SellRequestStatus>();
    for (const r of latest) if (!latestByUser.has(r.userId)) latestByUser.set(r.userId, r.status);
    return {
      data: grouped.map((g) => {
        const u = byUser.get(g.userId);
        return {
          seller: {
            id: g.userId,
            name: u?.name ?? '',
            email: u?.email ?? '',
            // D12: sin enmascarar. Es back-office por rol, no la CLABE.
            phone: u?.phone ?? null,
          },
          liveCount: g._count._all,
          oldestCreatedAt: g._min.createdAt,
          latestStatus: latestByUser.get(g.userId) ?? null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /**
   * **`GET /admin/buylist/guides/pending-cancellation`** — «cancelar guía no usada» (D22, criterio
   * 139).
   *
   * *Una etiqueta comprada y olvidada es **dinero tirado que nadie ve**.* Las dos mitades de D22 son
   * obligatorias: **que la etiqueta sea cancelable no sirve si nadie avisa.** Ésta es la mitad del
   * aviso.
   *
   * ⚠️ **NO DESAPARECE SOLA** (criterio 139): sale de la cola únicamente por
   * `POST …/guide/cancellation-done`. Por eso el predicado es
   * `guideCancellationPendingAt != null ∧ guideCancellationDoneAt IS NULL`, y **con el número de guía
   * a la vista** — sin él la fila no es trabajable.
   */
  async adminPendingGuideCancellation(page: number, pageSize: number) {
    const where: Prisma.SellRequestWhereInput = {
      guideCancellationPendingAt: { not: null },
      guideCancellationDoneAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.sellRequest.findMany({
        where,
        orderBy: { guideCancellationPendingAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      }),
      this.prisma.sellRequest.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        sellRequestId: r.id,
        seller: this.sellerRef(r.user),
        carrier: r.shipmentCarrier,
        trackingNumber: r.shipmentTrackingNumber,
        guideSentAt: r.guideSentAt,
        guideCancellationPendingAt: r.guideCancellationPendingAt,
        // Por qué se abrió la tarea. ⚠️ v1.51.4: puede ser un estado NO terminal — la corrección de
        // dirección sobre una solicitud VIVA es el tercer productor de esta cola.
        closedStatus: r.status,
        expiredReason: r.expiredReason,
      })),
      page,
      pageSize,
      total,
    };
  }

  /**
   * **`POST /admin/buylist/:id/guide/cancellation-done`** (D22, criterio 139).
   *
   * La **única** salida de la cola. Captura el costo REAL de la etiqueta que murió sin usarse: `0`
   * si la paquetería la reembolsó, el importe si no. **Sin este campo, la etiqueta tirada —el
   * «dinero que nadie ve» de D22— nunca entraría al P&L**, que es justo lo que la cola existe para
   * evitar.
   *
   * ⚠️ **Misma frontera money-safe que `confirm-shipment`: NO toca `payoutNetCents`.** Las dos ramas
   * son **disjuntas** (o el envío se confirmó, o la guía murió sin usarse), así que **nunca hay dos
   * escritores del campo en el mismo estado**.
   */
  async adminGuideCancellationDone(
    id: string,
    actor: { id: string; role: Role },
    guideActualCostCents?: number,
  ) {
    const now = new Date();
    const guard = await this.prisma.sellRequest.updateMany({
      where: { id, guideCancellationPendingAt: { not: null }, guideCancellationDoneAt: null },
      data: {
        guideCancellationDoneAt: now,
        guideCancellationDoneBy: actor.id,
        ...(guideActualCostCents != null ? { guideActualCostCents } : {}),
      },
    });
    const after = await this.prisma.sellRequest.findUnique(
      { where: { id }, include: { items: { select: VERDICT_ITEM_SELECT } } },
    );
    if (!after) throw BusinessException.notFound();
    if (guard.count !== 1) {
      throw BusinessException.conflict(
        'NO_PENDING_GUIDE_CANCELLATION',
        'There is no pending guide cancellation on this sell request',
        {
          guideCancellationPendingAt: after.guideCancellationPendingAt,
          guideCancellationDoneAt: after.guideCancellationDoneAt,
        },
      );
    }
    return this.adminSellRequestDTO(after, await this.adminCycleDials());
  }


  /**
   * **`POST /admin/buylist/:id/decline` — «DECLINAR AHORA»** (v1.51.3, D39).
   *
   * ### ⚠️ NO ES UN DESENLACE NUEVO: ES EL MISMO DE LA REGLA 7, SIN LA ESPERA
   * *El operador ya decidió que no compra; esperar siete días para que un cron diga lo que él ya sabe
   * no protege a nadie — deja al vendedor esperando y a la cola sucia.* Mismo `status` (`expirada`),
   * mismo `expiredReason` (`no_offer`), **mismo correo 4 con el mismo texto**.
   *
   * **Toda la diferencia está en `declinedBy`:** poblado ⇒ **lo decidió una persona**; `null` ⇒ lo
   * cerró el barrido. Es el único discriminador entre *«decidimos»* y *«dejamos vencer»*, y **vive
   * solo del lado admin**: para el vendedor las dos causas son **el mismo hecho**, y por eso
   * `expiredReason` **no gana un tercer valor** (ese enum viaja al cliente y gobierna su copy).
   *
   * ### ⚠️ NO se puede declinar una `ofertada`
   * Hay una oferta **vinculante** en la bandeja del vendedor: cerrarla por aquí le **retiraría un
   * trato que le prometimos** y le mandaría **el correo equivocado** (el 4 afirma que **nunca
   * ofertamos**). La vía correcta es `offer/cancel` —que manda el correo 5 y devuelve la solicitud a
   * `cotizada` con el reloj repuesto— y **desde ahí** sí se puede declinar. *Dos puertas, dos hechos:
   * una retira una oferta, la otra cierra una espera.*
   *
   * **SÍ se declina con una oferta `pending_authorization` viva** (la solicitud está en `cotizada` y
   * el vendedor no sabe que existe): **se anula en la misma transacción**, exactamente como la regla
   * 7. Sin eso, el súper-admin autorizaría después **sobre una solicitud TERMINAL**.
   *
   * **⚠️ SIN `200` idempotente:** un segundo `decline` ⇒ `409`. Este verbo **manda un correo a una
   * persona**, y un `200` silencioso en la segunda llamada esconde justo lo que hay que ver.
   *
   * ⚠️ **El `reason` NO llega hasta aquí, y es deliberado.** Es **motivo interno**: va al `AuditLog`
   * desde el controller y **NO lleva columna** (`declinedBy` + `closedAt` + la bitácora guardan el
   * acto entero). Recibirlo en el servicio sin usarlo sugeriría que hace algo — y lo único que puede
   * hacer un motivo aquí es acabar filtrándose al correo, que lo tiene **prohibido**.
   */
  async adminDecline(id: string, actor: { id: string; role: Role }) {
    const now = new Date();
    const dials = await this.adminCycleDials();
    const outcome = await this.prisma.$transaction(async (tx) => {
      const before = await tx.sellRequest.findUnique({
        where: { id },
        include: { user: { select: { name: true, email: true, locale: true } } },
      });
      if (!before) throw BusinessException.notFound();
      const guard = await tx.sellRequest.updateMany({
        // Transición TERMINAL ⇒ la guarda es la del motor (misma disciplina que `paySpei` y
        // `offer/authorize`), no un `if` sobre la lectura de arriba.
        where: { id, status: 'cotizada', closedAt: null },
        data: {
          status: 'expirada',
          expiredReason: SellRequestExpiryReason.no_offer,
          closedAt: now,
          // ⚠️ AQUÍ está toda la diferencia con la regla 7 del barrido.
          declinedBy: actor.id,
          // La oferta preparada muere con la solicitud, en la MISMA escritura.
          ...(before.offerState === 'pending_authorization'
            ? {
                offerState: 'cancelled',
                offerCancelledAt: now,
                offerCancelReason: 'decline: no procederemos con la oferta',
              }
            : {}),
        },
      });
      if (guard.count !== 1) {
        throw BusinessException.conflict(
          'DECLINE_NOT_ALLOWED',
          'Only an open, unoffered sell request can be declined',
          { status: before.status, offerState: before.offerState },
        );
      }
      // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; se proyecta abajo con la lista blanca admin.
      const after = await tx.sellRequest.findUnique(
        { where: { id }, include: { items: { select: VERDICT_ITEM_SELECT } } },
      );
      return { before, after };
    });

    // CORREO 4, best-effort POST-COMMIT. **Misma plantilla y mismo texto que la regla 7**: al
    // vendedor no le corresponde saber si le contestamos rápido o dejamos correr el reloj.
    await this.sendNotPursuedMail(id, outcome.before.user);
    // ⚠️ v1.51.20 · **I2** — la respuesta de esta mutación TERMINAL sella `expiredReason` y
    // `declinedBy`, que es justo lo que la distingue de la regla 7 del barrido. Con la proyección
    // vieja los dos salían ausentes: el cliente de la API no podía distinguir «lo decidimos» de «se
    // nos venció», que es la pregunta entera que D39 vino a contestar.
    return this.adminSellRequestDTO(outcome.after as VerdictItemsPayload, dials);
  }

  /** **CORREO 4 — «no procederemos».** Best-effort post-commit; su fallo no revierte el cierre. */
  private async sendNotPursuedMail(
    id: string,
    user: { name: string; email: string; locale: string | null } | null | undefined,
  ): Promise<void> {
    try {
      if (!this.mail || !user?.email) {
        this.logger.warn(
          `buylist decline mail skipped for ${id}: ${this.mail ? 'no recipient email' : 'MAIL_PORT unavailable'}`,
        );
        return;
      }
      const msg = sellRequestNotPursuedTemplate(
        { folio: id, portalUrl: buylistPortalUrl(id, user.locale) },
        user.name ?? '',
        user.locale,
      );
      await this.mail.send({ ...msg, to: user.email });
    } catch (e) {
      this.logger.error(
        `buylist decline mail failed for ${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Reveal on-demand de la CLABE COMPLETA (18 dígitos) para ejecutar el pago SPEI.
   * Marcado @MoneyOut (solo super_admin) y AUDITADO en el controller. Descifra el
   * snapshot cifrado de la solicitud (o, en su defecto, la CLABE de KYC). No enmascara:
   * es el único punto del sistema que devuelve la CLABE en claro, para copiarla a la banca.
   */
  async revealClabe(id: string): Promise<{ sellRequestId: string; clabe: string }> {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req) throw BusinessException.notFound();
    let clabe = this.pii.decryptOptional(req.clabeSnapshotEnc);
    if (!clabe) {
      const kyc = await this.prisma.kycProfile.findUnique({ where: { userId: req.userId } });
      clabe = this.pii.decryptOptional(kyc?.clabeEnc);
    }
    if (!clabe) {
      throw BusinessException.notFound('NOT_FOUND', 'No CLABE on file for this request');
    }
    return { sellRequestId: id, clabe };
  }

  /**
   * ⚠⚠ v1.56 · **§M5-T / BL-35 (P1 de `docs/PENTEST_NOTES.md`) — LOS DOS ÚNICOS VERBOS DE TRANSICIÓN QUE
   * ESCRIBÍAN SIN GUARDA, Y POR AHÍ SE PAGABA DOS VECES.**
   *
   * ### El defecto, medido en vivo (no deducido)
   * `receive`/`verify` hacían `update({ where: { id } })` a secas: **`adminGet` solo comprueba que la
   * fila EXISTA** (`findUnique` + `notFound`), no que esté viva. Con eso, un `vault_operator` —el rol
   * de MENOR confianza del back-office (S49-M1)— podía hacer `POST /verify` sobre una solicitud
   * **`pagada`** y devolverla a `verificacion` **con el `closedAt` todavía sellado**. A partir de ahí:
   * `verifiedAt` re-fijado + `verificacion ∈ SELL_REQUEST_PAYABLE_STATES` ⇒ `isPayable` **true otra
   * vez**; la idempotencia de `paySpei` (anclada **solo** en `status === 'pagada'`) **no dispara**; y
   * el CAS de las cuatro columnas de dinero **coincide** (ni `receive` ni `verify` tocan montos) ⇒
   * `count === 1` ⇒ **SEGUNDA LIQUIDACIÓN SPEI**. Verificado en BD: dos `speiReference` y dos `paidAt`
   * distintos sobre la misma solicitud, con la primera liquidación **ya sin rastro en la fila**.
   *
   * Y el daño no se agota en el doble depósito: **el tope AML mensual se evade** (el acumulado de
   * `monthCommittedGrossPaidCentsTx` cuenta solo `status:'pagada'`, así que la fila reactivada **sale
   * del acumulado** y cada re-pago se mide contra una cifra que no lo incluye) y **el libro de caja
   * queda corrupto** (la fila conserva solo la ÚLTIMA referencia). El paso habilitador lo alcanza el
   * operador; el pago exige `super_admin`, pero la reactivación **re-mete la solicitud en la cola de
   * «listas para pagar» sin ninguna señal de que ya se pagó** ⇒ se vuelve a pagar **sin colusión**.
   *
   * ### La guarda: la MISMA que sus hermanos, ni una forma nueva
   * `updateMany` con la precondición **en el `where`** + `count === 1` + relectura para responder
   * (`updateMany` no devuelve filas) — idéntico a `respond` (BL-2), `offerResponse`, `declare-shipped`,
   * `confirm-shipment`, `adminDecline` y `paySpei`. **La exclusión la da el motor, no un `if` sobre una
   * lectura previa que una carrera invalida.**
   *
   * ### ⚠ Por EXCLUSIÓN (no-terminal), no una matriz de predecesores exactos
   * El mínimo que cierra el agujero es *«no se transiciona lo cerrado»*. Apretar a «solo desde X»
   * sería inventar una máquina de estados que la mesa **no** usa hoy: en el propio PoC `receive` y
   * `verify` se dispararon **en cadena** justo tras `confirm-shipment`, y la bitácora real muestra
   * `receive`→`verify` con 20 ms de diferencia. *Una guarda que rompe el trabajo legítimo del día
   * siguiente no es más segura: es la que alguien acaba desactivando.* Es la misma dirección del
   * criterio 129 (`SELL_REQUEST_LIVE_STATES` por complemento): olvidarse falla hacia el lado seguro.
   *
   * ### ⚠ `closedAt: null` es la OTRA MITAD de la guarda, y no es redundante
   * En el código, **toda** escritura de `closedAt` va acompañada de un estado terminal (los seis
   * sitios del servicio y los cinco del barrido), así que sobre una fila SANA los dos términos dicen
   * lo mismo. Pero **hay filas que no lo son**: este mismo defecto dejó en BD solicitudes con
   * `closedAt` sellado y `status` no-terminal, y sobre ésas el término de estado **por sí solo dejaría
   * pasar la transición**. *Una guarda no puede apoyarse en el invariante que el bug rompió.*
   *
   * ⚠ **La transición y el movimiento de ítems van en UN SOLO boundary atómico, y la guarda va
   * PRIMERO.** Antes, los ítems se movían **antes** de escribir la solicitud: sobre una fila cerrada
   * eso dejaba los ítems en `recibida`/`verificacion` aunque la transición no prosperase. Misma
   * lección que BL-14 con `adjustmentSentAt`: *una precondición y su efecto son una operación del
   * motor, no dos pasos que una carrera pueda separar.*
   *
   * ### ⚠ IDEMPOTENCIA — `200`, y **la fecha NO se re-sella** (§M5 `receive`/`verify`, punto 3)
   * | Entrada | Respuesta |
   * |---|---|
   * | `legalT` ∧ `status ≠` destino | `200` · transiciona · sella la fecha (**primera vez**) |
   * | `legalT` ∧ `status =` destino | `200` idempotente · estado actual · ⛔ **NO re-fija la fecha** |
   * | terminal ∨ `closedAt ≠ null` | **`409 CONFLICT`** · `details: { status, closedAt }` · cero escritura |
   *
   * **T GANA SOBRE LA IDEMPOTENCIA:** una fila con `closedAt` sellado y `status='verificacion'` da
   * `409`, **no** `200` — *es el caso que P1 fabricó, y el único que distingue un guard de dos
   * términos de uno de uno.* Sale solo de la construcción: el `where` lleva los dos términos, así que
   * esa fila **no matchea** y cae en el `count !== 1`.
   *
   * El no-re-sellado vive en `sealOnceTx` (su bloque explica los dos relojes que el re-sellado
   * movía). **Y `200`, no el `201` del default de `POST` de Nest** (`@HttpCode` en el controller):
   * ningún verbo de transición hermano usa `201`, y **una repetición idempotente no crea nada**.
   */
  async receive(id: string) {
    await this.adminGet(id);
    const row = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.sellRequest.updateMany({
        where: { id, ...this.liveRequestWhere() },
        data: { status: 'recibida' },
      });
      if (guard.count !== 1) await this.throwRequestClosedConflict(tx, id);
      await this.sealOnceTx(tx, id, 'receivedAt');
      // DESPUÉS de la guarda, a propósito: una transición ilegítima no debe mover ni un ítem.
      await tx.sellRequestItem.updateMany({
        where: { sellRequestId: id, itemStatus: { in: ['cotizada', 'precio_pendiente'] } },
        data: { itemStatus: 'recibida' },
      });
      // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; se proyecta abajo con la lista blanca admin.
      // `updateMany` no devuelve filas ⇒ la relectura es la única forma de responder lo ya escrito.
      return tx.sellRequest.findUnique(
        { where: { id }, include: { items: { select: VERDICT_ITEM_SELECT } } },
      );
    });
    if (!row) throw BusinessException.notFound();
    // S49-M1: proyección admin (sin `clabeSnapshotEnc`). Ruta alcanzable por `vault_operator`, que
    // es justamente el rol de MENOR confianza del back-office (SEC-A4) — no debe ver PII bancaria.
    return this.adminSellRequestDTO(row, await this.adminCycleDials());
  }

  /**
   * ⚠⚠ v1.56 · **§M5-T / BL-35** — hermano exacto de `receive`, y **el verbo del PoC**: `verify` es el que
   * vuelve `isPayable` verdadero (fija `verifiedAt` y deja el `status` en `verificacion`, que está en
   * `SELL_REQUEST_PAYABLE_STATES`), así que era **el camino más corto de «pagada» a «pagable otra
   * vez»**. Misma guarda, mismo boundary atómico, mismo `409`. Ver el bloque de `receive`.
   */
  async verify(id: string) {
    await this.adminGet(id);
    const row = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.sellRequest.updateMany({
        where: { id, ...this.liveRequestWhere() },
        data: { status: 'verificacion' },
      });
      if (guard.count !== 1) await this.throwRequestClosedConflict(tx, id);
      await this.sealOnceTx(tx, id, 'verifiedAt');
      await tx.sellRequestItem.updateMany({
        where: { sellRequestId: id, itemStatus: 'recibida' },
        data: { itemStatus: 'verificacion' },
      });
      // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; se proyecta abajo con la lista blanca admin.
      return tx.sellRequest.findUnique(
        { where: { id }, include: { items: { select: VERDICT_ITEM_SELECT } } },
      );
    });
    if (!row) throw BusinessException.notFound();
    // S49-M1: proyección admin (sin `clabeSnapshotEnc`), igual que `receive`.
    return this.adminSellRequestDTO(row, await this.adminCycleDials());
  }

  /**
   * B-4 / S-B5: factor de ajuste al alza permitido sobre el precio cotizado. El admin puede
   * subir el monto aprobado hasta 2× lo cotizado (margen razonable para reevaluar al alza tras
   * verificar la carta) — nunca un monto arbitrario. Por encima de ese factor o del tope AML por
   * solicitud, se rechaza (422). NO afecta el flujo normal (aprobar el cotizado siempre pasa).
   */
  private static readonly APPROVED_PRICE_UPLIFT_FACTOR = 2;

  /**
   * B-4 / S-B5: valida server-side que el monto de dinero saliente por SPEI que un
   * `vault_operator`/admin aprueba no exceda una cota razonable. Defensa en profundidad además
   * del `@Max` del DTO (SEC-A1: el dinero se deriva/valida en el servidor, nunca se confía al DTO).
   *  - Cota relativa: ≤ `quotedPriceCents` × FACTOR (permite ajustes al alza acotados).
   *  - Cota absoluta AML: ≤ tope por solicitud (`buylist_cap_per_request_cents`); un ítem no puede
   *    aprobar más que el tope completo de una solicitud.
   * Sin `quotedPriceCents` (p. ej. carta que estaba en `precio_pendiente`), solo aplica la cota AML.
   *
   * RB-3 (v1.8-ronda-c): el cap AML se recibe YA resuelto por el llamador honrando el
   * `kyc.capPerRequestCentsOverride` del usuario (misma fuente que `createRequest`), no el dial
   * global a secas. Así un usuario con override más alto no ve rechazada una aprobación legítima.
   *
   * ### ⚠️⚠️ v1.58 · **BL-40 — DENTRO DEL CICLO EL TÉRMINO RELATIVO NO APLICA.** DINERO.
   * ```
   * offerSentAt IS NOT NULL   ⇒   cota = capAML                            // v1.58
   * offerSentAt IS NULL       ⇒   cota = min(quotedPriceCents × 2, capAML) // legacy, SIN CAMBIOS
   * ```
   * **El defecto, y es de la familia de `BL-38`:** dentro del ciclo `approve` **no acepta monto**, lo
   * **deriva** de `offeredPriceCents` (D2, inmutable) — **y aun así lo pasaba por la cota relativa**.
   * ⇒ un override al alza por encima del DOBLE de la cotización de esa línea —que es **exactamente lo
   * que D26 autoriza**— producía una oferta **VINCULANTE** que después **NO SE PODÍA APROBAR**, y por
   * tanto no se podía pagar. Con números ordinarios: línea cotizada **MX$300**, override motivado a
   * **MX$1,000**, bruto MX$1,000 (muy por debajo del tope AML de MX$3,000) ⇒ **la oferta sale, el
   * vendedor manda la carta y `approve` la rechaza contra una cota de MX$600.**
   * ***Y a diferencia del INE, aquí no hay documento que lo arregle: el vendedor no tiene ninguna
   * acción posible — ya se desprendió de su carta.***
   *
   * **Por qué se retira DENTRO del ciclo:** ahí el monto **no es entrada libre del operador**; es la
   * cifra **congelada y vinculante** que ya pasó **su propia** puerta — motivo obligatorio y auditado
   * (D26), tope del operador con escalación al súper-admin, y **desde v1.58 el tope AML sobre el bruto
   * de la oferta** (§M5-A). *La cota relativa estaba haciendo de guardia de un dato que ya no viene de
   * fuera.*
   *
   * ⛔ **Por qué NO se resuelve al revés** (imponer el `× 2` al OFERTAR, que era la otra salida): sería
   * **inventarle al negocio una cota que `PROJECT.md` no tiene**. D26 acota el override por el **tope
   * del operador** y por **motivo auditado**, no por un factor; y un factor mataría el caso que el
   * override existe para atender —**rescatar una línea en `precio_pendiente`** y repreciar una carta
   * que la curva subvalora—. *No se cierra un agujero poniéndole al negocio un límite que nadie
   * escribió.*
   *
   * **El término `capAML` SE QUEDA** (defensa en profundidad). Tras §M5-A **no puede disparar** sobre
   * una fila que pasó la emisión —cada línea ≤ el bruto ≤ el tope—, así que su valor es cubrir **filas
   * legacy y malformadas**, que es para lo que sirve un backstop.
   *
   * ⚠️ **`relativeCapApplies` es un parámetro OBLIGATORIO y sin default, a propósito:** un opcional
   * dejaría que un llamador futuro heredara la cota relativa **sin decidirlo**, que es exactamente
   * cómo se coló el defecto. *Quien aprueba dinero elige su cota explícitamente o no compila.*
   */
  private async assertApprovedPriceWithinCap(
    effectiveCents: number,
    quotedPriceCents: number | null,
    amlCap: number,
    opts: { relativeCapApplies: boolean },
  ): Promise<void> {
    const relativeCap =
      opts.relativeCapApplies && quotedPriceCents != null && quotedPriceCents > 0
        ? quotedPriceCents * BuylistService.APPROVED_PRICE_UPLIFT_FACTOR
        : amlCap;
    const cap = Math.min(relativeCap, amlCap);
    if (effectiveCents > cap) {
      throw BusinessException.validation(
        'APPROVED_PRICE_CAP_EXCEEDED',
        'Approved price exceeds the allowed cap for this item',
        // Shape declarado en §M5 (v1.58): el que ya emitía el código, sin tocarlo. `quotedPriceCents`
        // sigue viajando aunque dentro del ciclo no gobierne la cota — es el dato que explica el caso.
        { approvedPriceCents: effectiveCents, quotedPriceCents, cap },
      );
    }
  }

  /**
   * v1.51.5 · **BL-14** — el `where` de la guarda de terminal, en **UN SOLO SITIO**.
   *
   * Se deriva de `SELL_REQUEST_TERMINAL_STATES`, **la misma constante** de la que se deriva el
   * pre-check (`isTerminalSellRequestStatus`). Es la doctrina del **sitio 8** de §4.39c aplicada
   * aquí: dos literales de estados en un método de dinero es la forma más barata de que una edición
   * mueva uno y no el otro, y entonces *el pre-check dice «no» y la guarda «sí», o al revés*.
   */
  private notTerminalWhere(): Prisma.SellRequestWhereInput {
    return { status: { notIn: [...SELL_REQUEST_TERMINAL_STATES] } };
  }

  /**
   * ⚠⚠ v1.56 · **§M5-T / BL-35 (P1)** — **«viva» en LOS DOS EJES**: no-terminal **y** sin cerrar.
   *
   * Se construye **encima** de `notTerminalWhere()` (BL-14) en vez de escribir otro literal de
   * estados: la doctrina del **sitio 8** de §4.39c no admite una segunda lista, y el día que
   * `SELL_REQUEST_TERMINAL_STATES` gane un valor los dos `where` se mueven **juntos o ninguno**.
   *
   * ### Por qué `closedAt: null` NO es redundante con el término de estado
   * Sobre una fila **sana** los dos dicen lo mismo: en todo el backend, cada escritura de `closedAt`
   * va en el MISMO `data` que un estado terminal (seis sitios en este servicio, cinco en el barrido;
   * medido, no supuesto). Pero **P1 fabricó filas que no son sanas** — solicitudes con `closedAt`
   * sellado y `status` no-terminal, precisamente porque revivía el estado sin tocar el cierre— y
   * sobre ésas el término de estado, **solo**, deja pasar la escritura. *Una guarda que se apoya en
   * el invariante que el bug rompió no guarda nada.* Es también la lección del propio P1 aplicada un
   * nivel arriba: anclar una precondición de dinero en **un solo campo** es lo que falló.
   *
   * ⚠ **NO sustituye a `notTerminalWhere()`** ni se mete en sus tres llamadores (las escrituras
   * por-ítem de BL-14/BL-27): allí la precondición declarada por el contrato es *terminal*, y
   * ampliarla «por consistencia» cambiaría el `409` de un endpoint que hoy está bien.
   */
  private liveRequestWhere(): Prisma.SellRequestWhereInput {
    return { ...this.notTerminalWhere(), closedAt: null };
  }

  /**
   * ⚠ v1.56 · **§M5-T / BL-35 (P1)** — el `409` de *«esta solicitud ya cerró: no se transiciona»*, con el
   * estado **releído** (dentro de la transacción cuando la hay, para que `details.status` diga el
   * estado REAL contra el que se chocó, no el de una lectura vieja que la carrera invalidó).
   *
   * **Código `CONFLICT`, no uno inventado** (§N.2): es un código COMÚN del contrato (§3) y hay
   * precedente literal para EXACTAMENTE esta invariante — §4.18f, `POST /admin/buylist/:id/reject`
   * sobre otro terminal: *«se rechaza el cierre con `409 CONFLICT` (`details.status`) por invariante
   * “no pisar terminal”»*. **Misma invariante, mismo código, misma forma de `details`.**
   *
   * Hermano exacto de `throwTerminalConflict`, y **no se funde con él a propósito**: aquél dice *«los
   * ÍTEMS de esta solicitud ya no se deciden»* (`NO_LIVE_ADJUSTMENT`, §4.18f de `items/:itemId/
   * decision`) y éste dice *«la SOLICITUD ya no transiciona»*. Son dos endpoints, dos códigos ya
   * declarados y dos conductas distintas del back-office; un solo cuerpo tendría que mentir en uno.
   */
  private async throwRequestClosedConflict(
    db: SellRequestReader,
    sellRequestId: string,
  ): Promise<never> {
    const current = await db.sellRequest.findUnique({
      where: { id: sellRequestId },
      select: { status: true, closedAt: true },
    });
    throw BusinessException.conflict(
      'CONFLICT',
      'This sell request is terminal or closed and can no longer be transitioned',
      // ⚠ §M5-T: `details` lleva **LOS DOS** campos, y por el mismo motivo que la guarda lleva los
      // dos términos: con solo `status` el operador no puede distinguir *«ya cerró por el camino
      // normal»* de *«el status miente y lo que la bloquea es el `closedAt`»* — que es exactamente
      // la fila que P1 fabricó. `details` tiene que poder explicar el rechazo que la guarda produce.
      { status: current?.status, closedAt: current?.closedAt ?? null },
    );
  }

  /**
   * ⚠⚠ v1.56 · **§M5-T / BL-35 — «SELLA LA FECHA SOLO SI TODAVÍA ES `null`», EN EL MOTOR.**
   *
   * `receive`/`verify` son **idempotentes por contrato** (`200` con el estado actual cuando el
   * `status` ya es el destino) **y no pueden re-fijar su fecha**. Hasta v1.55 la fecha iba en el
   * mismo `data` que el `status`, así que **cada `POST` repetido la movía hacia adelante**.
   *
   * ### Eso no era cosmético: corría DOS relojes reales
   * - **`receivedAt` ancla el abandono a 30 días** del barrido (`jobs/buylist-sweep.service.ts`,
   *   regla 6: `receivedAt: { not: null, lte: thirtyDaysAgo }`) ⇒ un doble clic **posponía una
   *   transición TERMINAL** sobre mercancía de otra persona.
   * - **`receivedAt` y `verifiedAt` entran al `max(...)`** que fija la purga del INE mientras
   *   `closedAt` es `null` (`jobs/ine-retention.service.ts`) ⇒ cada repetición **posponía una
   *   obligación de retención de PII** (LFPDPPP, misma familia que BL-3).
   *
   * ***Un reintento de red no puede correr un plazo legal.***
   *
   * ### ⚠ Por qué es un `updateMany` propio y no un `if` que compone el `data`
   * El contrato lo dice literal: *«la fecha entra al `data` solo si aún es `null`, no un `if` de
   * aplicación que una carrera pueda saltar»*. Con `receivedAt: null` **en el `where`**, dos llamadas
   * concurrentes compiten en el motor y **solo una sella**; con un `if` sobre una lectura previa, las
   * dos leen `null` y las dos escriben. Es el mismo patrón exacto de `declare-shipped`
   * (`sellerShippedDeclaredAt: null` en su `where`) — **el precedente que el contrato cita**.
   *
   * ⚠ **`count === 0` NO es un error aquí**: significa *«ya estaba sellada»*, que es precisamente el
   * caso idempotente. La guarda de vida ya se evaluó **antes**, en la transición.
   *
   * ### ⚠️⚠️ v1.57 — LA FIRMA ES `TransactionOnlyClient`, Y ES LA MITAD DEL ARGUMENTO DE ARRIBA
   * Lo que hace **aceptable** que este método sea silencioso (`count === 0` ⇒ no pasa nada) es que
   * **el llamador mantiene el row lock dentro de la transacción**: el sellado va pegado a la guarda
   * de vida que acaba de casar, en el mismo boundary. Llamarlo con `this.prisma` —fuera de toda
   * transacción— convertiría el silencio en un fallo invisible sobre una fila que nadie sujeta.
   *
   * La firma anterior (`SellRequestReader = Pick<Prisma.TransactionClient,'sellRequest'>`) **también
   * la satisface `PrismaService`**, así que `sealOnceTx(this.prisma, …)` compilaba y **anulaba en
   * silencio el argumento de seguridad de este mismo docstring**. Es la jugada de **BL-25**: que
   * romper la invariante **falle en COMPILACIÓN**, no en una revisión.
   *
   * ⚠️ **`Prisma.TransactionClient` a secas NO lo consigue, y lo medí antes de escribirlo**:
   * `TransactionClient = Omit<PrismaClient, ITXClientDenyList>`, y en tipado **estructural** un
   * supertipo con miembros **de más** sigue siendo asignable a un `Omit` — `PrismaService` pasa.
   * Por eso `TransactionOnlyClient` marca la deny-list como `?: never`: el cliente transaccional real
   * **no tiene** `$transaction` (lo satisface), y `PrismaService` **sí** (falla). *Una firma que no
   * rechaza al impostor no es una firma: es un comentario con paréntesis.*
   */
  private async sealOnceTx(
    tx: TransactionOnlyClient,
    id: string,
    field: 'receivedAt' | 'verifiedAt',
  ): Promise<void> {
    await tx.sellRequest.updateMany({
      where: { id, [field]: null },
      data: { [field]: new Date() },
    });
  }

  /**
   * v1.51.14 · **BL-22** (§4.39k.1) — **una fila mala no tumba una cola.**
   *
   * `business-days` **lanza** cuando la tabla de festivos no cubre el rango, **y sigue lanzando**: lo
   * que se norma aquí es **el LLAMADOR**. En una superficie de **LISTADO** el error se captura **por
   * fila**, el derivado sale **`null`** con un **flag explícito**, y **la colección se devuelve
   * completa** — *un error de cobertura nunca llega a la respuesta HTTP*.
   *
   * **No es política nueva: une dos que ya existían.** (1) *«el caller captura»* era doctrina, pero
   * escrita solo para el barrido; (2) la forma por-fila es la de la mesa (`position: null` +
   * `positionUnavailable: true`).
   *
   * **Por qué importa tanto:** sin esto, **una sola fila** con una fecha fuera de cobertura devolvía
   * `500` **en toda la cola**, y lo que desaparecía no era un cálculo sino **una cola de trabajo
   * entera**. Un `500` de back-office se lee como *«no hay nada pendiente»* o *«hoy está rota»*, y en
   * ninguno de los dos casos alguien va a buscar una fila con una fecha rara: es literalmente *el
   * fallo que no se ve*.
   *
   * ### ⚠️ LAS ESCRITURAS NO USAN ESTO, Y ES LA OTRA MITAD DE LA NORMA
   * Al **congelar** un plazo (`offerAcceptDeadlineAt` al ofertar, `shipDeadlineAt` al capturar la
   * guía) el error **debe propagarse y la petición debe fallar**: *si no podemos calcular la fecha
   * límite, no emitimos la oferta.* **Se degrada lo que se MUESTRA, nunca lo que se COMPROMETE.**
   * Aplicar este `try/catch` ahí «por consistencia» congelaría un plazo equivocado.
   */
  private safeDerive<T>(compute: () => T, context: string): { value: T | null; failed: boolean } {
    try {
      return { value: compute(), failed: false };
    } catch (e) {
      this.logger.error(
        `derivada de días hábiles no disponible (${context}): ${(e as Error).message}. ` +
          'La fila se marca; la cola se pinta (§4.39k.1).',
      );
      return { value: null, failed: true };
    }
  }

  /**
   * v1.51.3 (D38) — la fecha en que una `cotizada` **muere sola** (regla 7 del barrido).
   * `addBusinessDays(offerIssueClockStartedAt ?? createdAt, dial)`.
   *
   * ⚠️ **La MISMA fórmula en los dos sitios que la muestran** (`AdminBuylistDTO.offerIssueDeadlineAt`
   * y `PendingOfferAuthorizationRowDTO.caducityAt`): *una fecha derivada de dos maneras distintas es
   * dos fechas*. Y se ancla en `offerIssueClockStartedAt`, no en `createdAt`, porque cancelar una
   * oferta enviada **repone los siete días íntegros**: una cola que siguiera mostrando la fecha vieja
   * **pintaría como perdidas justo las filas que acabamos de re-encolar por un error nuestro**.
   */
  /**
   * v1.51.3 (D33) + v1.51.14 (BL-22) — `offerIssueDeadlineAt` y su bandera, para una fila de la cola
   * de M5. **Solo una `cotizada` caduca**; en cualquier otro estado no hay fecha que mostrar y
   * tampoco hay nada que degradar.
   */
  private offerIssueDeadlineFields(
    r: { status: SellRequestStatus; createdAt: Date; offerIssueClockStartedAt: Date | null },
    days: number,
  ): { offerIssueDeadlineAt: Date | null; offerIssueDeadlineUnavailable?: true } {
    if (r.status !== 'cotizada') return { offerIssueDeadlineAt: null };
    const d = this.caducityOf(r, days);
    return {
      offerIssueDeadlineAt: d.value,
      ...(d.failed ? { offerIssueDeadlineUnavailable: true as const } : {}),
    };
  }

  private caducityOf(
    r: { createdAt: Date; offerIssueClockStartedAt: Date | null },
    days: number,
  ): { value: Date | null; failed: boolean } {
    return this.safeDerive(
      () => addBusinessDays(r.offerIssueClockStartedAt ?? r.createdAt, days),
      'caducidad de emisión',
    );
  }

  /**
   * v1.51.8 (§4.39c **sitio 10**) — **`isPayableSellRequest` traducido a `where` de Prisma**: los
   * **CUATRO** términos escalares (v1.51.8: dos; **v1.57 · §M5-P**: la recepción; **v1.61 · §M5-V**:
   * V-a), derivados de la misma constante y de los mismos campos.
   *
   * ⚠️ **La cuenta se actualiza cuando el predicado crece.** Este comentario dijo «TRES» durante una
   * versión en la que ya eran cuatro, y no es una errata inocua: quien audita el `where` cuenta lo
   * que el comentario le promete y para de buscar. *Un hueco con nombre deja de buscarse.*
   *
   * ⚠️⚠️ **Este fragmento se COMPONE, y sólo por `AND`.** Su llamador (`paySpei`) lo mete como
   * elemento de un `AND`, **nunca por spread**: con spread, una clave posterior del literal lo pisa
   * **en silencio** — que es exactamente como V-a dejó de llegar al motor (`B1`, v1.61.1).
   *
   * Existe porque un `where` es declarativo y no puede *invocar* el predicado; lo que sí puede es
   * **no repetir la constante**. Que las dos formas digan lo mismo lo asevera un test que las cruza
   * sobre **todo el enum × `receivedAt ∈ {null,fecha}` × `verifiedAt ∈ {null,fecha}`** — si alguien
   * mueve una y no la otra, ese test cae. *La guarda del motor y el aviso de la UI no pueden
   * discrepar en una ruta de dinero.*
   *
   * ⚠️⚠️ **v1.57 · §M5-P / BL-35 eje 2 — `receivedAt: { not: null }`.** Es **la guarda**, no el aviso:
   * el pre-check evita gastar una transacción SERIALIZABLE, pero lo que impide que salga un peso por
   * una carrera es **este `where`**. El PoC pagó **MX$320 reales** por una carta nunca recibida
   * porque este fragmento tenía dos términos y la promesa (b) de `PROJECT.md:1107` exige tres.
   * **Ni un peso sale de una fila con `receivedAt IS NULL`.**
   */
  private payableWhere(): Prisma.SellRequestWhereInput {
    return {
      status: { in: [...SELL_REQUEST_PAYABLE_STATES] },
      receivedAt: { not: null },
      verifiedAt: { not: null },
      // ⚠️⚠️ v1.61 · **§M5-V (V-a) — «y aprobamos ALGO».** Es **la guarda**, no el aviso: sin ella una
      // solicitud con TODAS sus líneas compradas rechazadas y ≥1 `skip` —que impide la
      // auto-transición a `rechazada`— **paga `max(0, offerGrossCents − fee)` por CERO cartas**.
      // Medido en vivo contra Postgres real (`BACKEND_NOTES` §0.45.1), no derivado.
      // ⛔ **`{ not: null }`, JAMÁS `{ gt: 0 }`**: el depósito de cero de D40 / criterio 140 tiene
      // `approvedTotalCents = 0` **con líneas aprobadas** y **se sigue pagando**.
      approvedTotalCents: { not: null },
    };
  }

  /**
   * v1.51.5 · **BL-14** — el `409` de la guarda, con el estado **releído** contra el que se chocó.
   *
   * Se relee (y **dentro de la transacción**, cuando la hay) porque la lectura inicial ya puede estar
   * vieja si otra llamada ganó la carrera: `details.status` tiene que decir el estado **real**, no el
   * que teníamos en la mano. Mismo código y misma forma que la guarda de `respond` (§9 BL-14).
   */
  private async throwTerminalConflict(db: SellRequestReader, sellRequestId: string): Promise<never> {
    const current = await db.sellRequest.findUnique({
      where: { id: sellRequestId },
      select: { status: true },
    });
    throw BusinessException.conflict(
      'NO_LIVE_ADJUSTMENT',
      'This sell request is closed: its items can no longer be decided',
      { status: current?.status },
    );
  }

  /**
   * v1.51.20 · **BL-27** — el `409` del CICLO DE OFERTA, con el estado **releído** (y dentro de la
   * transacción, cuando la hay). Hermano exacto de `throwTerminalConflict`: mismo motivo para releer
   * —`details.status` tiene que decir el estado REAL contra el que se chocó— y misma forma que el
   * `409` que ya emite `respond` (§4.39b.3). **Un solo cuerpo para los dos llamadores** (el pre-check
   * y la guarda del motor), porque dos literales del mismo error es la forma más barata de que uno
   * quede sin `details`.
   */
  private async throwAdjustNotAllowedInOfferCycle(
    db: SellRequestReader,
    sellRequestId: string,
  ): Promise<never> {
    const current = await db.sellRequest.findUnique({
      where: { id: sellRequestId },
      select: { status: true },
    });
    throw BusinessException.conflict(
      'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
      'Price adjustments do not exist in the offer cycle: the offered price is binding',
      { status: current?.status },
    );
  }

  /**
   * ⚠️⚠️ v1.51.20 — **LA ESCALERA DEL CICLO DE OFERTA, EN UN SOLO CUERPO.** §M5 (`PATCH
   * /admin/buylist/items/:itemId/decision`), ARCHITECTURE §4.39(i) **6-bis**. Solo se invoca con
   * `offerSentAt IS NOT NULL`: **fuera del ciclo nada de esto aplica** y `ITEM_NOT_OFFERED` **no
   * existe** —`offerDecision` es `null` en toda línea pre-ciclo, y aplicarlo allí rompería la cohorte
   * legacy entera.
   *
   * ### La PRECEDENCIA es normativa (escalada 3, resuelta por el arquitecto)
   * ```
   * 409 NO_LIVE_ADJUSTMENT                     «esta SOLICITUD está cerrada»   (terminal, ARRIBA de esto)
   *   >  409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE «este VERBO no existe aquí»     [solo decision="adjust"]
   *      422 ITEM_NOT_OFFERED                  «esta LÍNEA no se compró»       [solo decision="approve"]
   *   >  422 OFFER_PRICE_IMMUTABLE             «ese CAMPO no viaja»            [CUALQUIER decision]
   *   >  500 OFFERED_PRICE_MISSING             backstop: se compró y no sabemos cuánto
   * ```
   * **Criterio: de lo que anula el ACTO ENTERO a lo que objeta un CAMPO** — el mismo con el que ya se
   * puso el terminal encima de todo. *Una precedencia que cambia de criterio a mitad de lista no es
   * una precedencia: son dos.*
   *
   * ⚠️ **Esto INVIRTIÓ lo que yo había implementado** (yo puse el `422` del campo primero, siguiendo
   * el orden en que §M5 los **lista** — y el orden de una lista nunca fue una precedencia). El motivo
   * de que gane el `409`: *«ese campo no se toca»* le insinúa al operador *«quítalo y procede»*, **y
   * no procede** — el reintento sin monto choca igual con el `409`. **Dos errores para una causa, y
   * el primero apunta al remedio equivocado.** La elección es **neutra en dinero**: las dos ramas
   * rechazan sin escribir un peso.
   * **Los dos peldaños del medio NO compiten**: los selecciona un `decision` distinto y solo llega uno
   * por petición, así que su orden relativo nunca se plantea.
   *
   * ### ⚠️ `OFFER_PRICE_IMMUTABLE` es regla del CUERPO, no del VERBO
   * Dentro del ciclo, **`approvedPriceCents` presente ⇒ `422`, sea cual sea el `decision`, `reject`
   * incluido**. No contradice que `reject` siga siendo legal a los dos lados del eje: **lo que se
   * rechaza es el cuerpo, no el verbo**. *Aceptar-e-ignorar un campo de dinero entrena al integrador
   * a mandarlo, y el día que el verbo cambie empieza a tener efecto.*
   *
   * ### Por qué `ITEM_NOT_OFFERED` existe, y por qué era peor que «un cero mal puesto»
   * `offeredPriceCents` es **`null` en toda línea `skip`** (§11, por diseño). Con `?? 0` la línea
   * quedaba **`aprobada` con monto cero**, y `aprobada` es exactamente:
   * **(1)** el **único** estado que `POST …/convert-to-inventory` admite ⇒ **una carta que nunca
   * compramos entraba al inventario VENDIBLE** con `acquisitionCostCents = 0` ⇒ **M7 reportando 100 %
   * de margen sobre mercancía ajena**; y **(2)** el estado que **saca la línea de §H** —los plazos
   * 7d/30d se anclan en `rejectedAt`, que solo escribe `reject`— ⇒ **el reloj de devolución del
   * vendedor nunca arrancaba y su carta desaparecía en silencio**, sin correo y sin cola.
   * *Aquí ni siquiera falta un dato: la línea NO SE COMPRÓ, y el número correcto no es `0` — es que
   * la operación no exista.* El remedio está a un clic y es **`reject` con motivo**.
   *
   * **`convert-to-inventory` NO gana una segunda guarda:** con esta norma una `skip` **jamás alcanza
   * `aprobada`**, así que `ITEM_NOT_APPROVED` sigue bastando. *Duplicar la guarda duplicaría la
   * regla, y la copia se desfasa.*
   *
   * ⚠️ **Es SÍNCRONA y no lee la BD**: recibe la línea y el estado ya leídos. Eso es lo que permite
   * llamarla desde los **dos** sitios que la necesitan —el pre-check y el discriminador de la guarda
   * del motor— sin que puedan divergir.
   */
  private assertOfferCycleAllows(
    decision: 'approve' | 'adjust' | 'reject',
    approvedPriceCents: number | undefined,
    line: { id: string; offerDecision: BuyDecision | null; offeredPriceCents: number | null },
    status: SellRequestStatus,
    // ⚠️ v1.58 · §M5-R (BL-39) — la solicitud padre, para el peldaño de la RECEPCIÓN. Se pasa en vez
    // de leerse porque este cuerpo **es síncrono y no toca la BD**: es lo que permite que los DOS
    // llamadores —el pre-check y la relectura de la carrera— evalúen **la misma escalera**.
    parent: { id: string; receivedAt: Date | null },
  ): void {
    // --- Peldaño 2: anula el ACTO ENTERO -----------------------------------------------------
    // `adjust` no existe en el ciclo, nunca (criterio 150 por lo negativo).
    if (decision === 'adjust') {
      throw BusinessException.conflict(
        'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
        'Price adjustments do not exist in the offer cycle: the offered price is binding',
        { status },
      );
    }
    // Aprobar una carta que NO compramos. `reject` NO entra aquí: es legal sobre cualquier línea y es
    // justamente la vía correcta para una `skip` que llegó en el paquete (§H).
    if (decision === 'approve' && line.offerDecision !== 'buy') {
      throw BusinessException.validation(
        'ITEM_NOT_OFFERED',
        'This line was not purchased: it cannot be approved. Reject it with a reason instead',
        { itemId: line.id, offerDecision: line.offerDecision },
      );
    }
    // ⚠️ v1.58 · §M5-R (BL-39) — la RECEPCIÓN, en su peldaño exacto: **después** de `ITEM_NOT_OFFERED`
    // (que es irreparable por definición: ninguna recepción arregla una línea que no compramos) y
    // **antes** de `OFFER_PRICE_IMMUTABLE` (que solo objeta un campo del body, mientras esto anula el
    // acto entero). El cuerpo es el mismo que corre fuera del ciclo: una sola regla, dos entradas.
    this.assertRequestReceived(decision, parent, status);

    // --- Peldaño 3: objeta un CAMPO. CUALQUIER `decision`, `reject` incluido ------------------
    if (approvedPriceCents != null) {
      throw BusinessException.validation(
        'OFFER_PRICE_IMMUTABLE',
        'The offered price is binding: it cannot be repriced in the offer cycle',
        { itemId: line.id, offeredPriceCents: line.offeredPriceCents },
      );
    }

    // --- Peldaño 4: BACKSTOP. No es error del operador: es un invariante nuestro roto ---------
    if (decision === 'approve' && line.offeredPriceCents == null) {
      this.logger.error(
        `buylist offered price missing for item ${line.id}: la línea es \`buy\` y no tiene ` +
          '`offeredPriceCents`. Viola el invariante que la emisión garantiza SIN EXCEPCIÓN ' +
          '(§4.39i.5). NO se aprueba y NO se paga: se arregla el bug.',
      );
      throw BusinessException.internal(
        'OFFERED_PRICE_MISSING',
        'This purchased line has no offered price on record; it cannot be approved',
        { itemId: line.id },
      );
    }
  }

  /**
   * ⚠️⚠️ v1.58 · **§M5-R / BL-39 — INVARIANTE R: «NO SE APRUEBA LO QUE NO HA LLEGADO».**
   * **MERCANCÍA AJENA.** *P y R son la misma frase sobre los dos lados del trato: **P** mira el
   * dinero que sale, **R** la mercancía que entra.*
   *
   * ### El defecto que cierra, medido
   * `convertToInventory` gatea **solo** con `itemStatus === 'aprobada'` —su `findUnique` ni siquiera
   * incluye `sellRequest`— y la escalera de `itemDecision` (terminal → ciclo de oferta → cota de
   * precio) **no miraba `receivedAt` en ningún punto** ⇒ **una línea de una solicitud que nunca
   * recibimos podía quedar `aprobada` y de ahí convertirse en pieza de inventario**, con su costo
   * capitalizado en el P&L de M7.
   *
   * ### ⚠️ POR QUÉ VA EN `approve` Y NO EN LA CONVERSIÓN
   * La forma obvia —`receivedAt: { not: null }` en el `where` de `convert-to-inventory`— **cierra el
   * síntoma en el sitio equivocado**, y la razón ya estaba escrita en v1.51.20 para el caso gemelo de
   * la línea `skip`: *«`convert-to-inventory` NO gana una segunda guarda: con esta norma una `skip`
   * jamás alcanza `aprobada`, así que `ITEM_NOT_APPROVED` sigue bastando. Duplicar la guarda
   * duplicaría la regla, y la copia se desfasa.»* **Se hace INALCANZABLE el estado, y entonces la
   * guarda única del consumidor vuelve a ser suficiente.** ⇒ *Una invariante se cierra en el verbo que
   * PRODUCE el estado, no en cada verbo que lo consume* — la versión contraria escala con el número
   * de consumidores y **garantiza** que el día que aparezca el tercero alguien olvide la copia, que
   * es literalmente **cómo `receive`/`verify` se quedaron sin guarda** (P1).
   *
   * ### `receivedAt` y no `status = 'recibida'`, por la misma razón que §M5-P
   * Es un **HECHO**, no un estado de origen: **no enumera predecesores** ⇒ cerrar esto **no exige la
   * matriz** que `PROJECT.md` no declara, y **la cohorte legacy lo satisface** (llega a
   * `recibida`/`verificacion` sin pasar por `en_transito`, pero **sí pasando por `receive`**).
   * Propiedades del ancla, ya medidas en §M5-P: **un solo escritor** (`receive` vía `sealOnceTx`),
   * **una sola vez**, **ninguna ruta lo limpia**, **columna desde la migración inicial**.
   * ⛔ **Prohibido deducir de aquí una matriz de predecesores.**
   *
   * ### SOLO `approve`, y el residual se nombra
   * `approve` es la **única** decisión que **crea valor** (pone el monto, vuelve la línea pagable y
   * convertible) y la única que **afirma un hecho físico** —*«esta carta llegó y está NM»*
   * (`PROJECT.md:1088-1090`, D30)— sobre una carta que no está en nuestras manos. **`reject` NO se
   * gatea**: es la dirección **segura** (quita el monto, cierra solicitudes, desatasca filas) y
   * gatearlo **dejaría filas sin salida**, daño real a cambio de ninguno evitado. **`adjust` no
   * aplica**: dentro del ciclo no existe (`409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE`) y fuera es cohorte
   * legacy que no se retro-edita.
   * ⚠️ **RESIDUAL NOMBRADO:** `reject` pre-recepción sigue siendo llamable, **sella `rejectedAt`**
   * —ancla de los plazos de §H— y **manda correo**, así que puede arrancar un reloj de devolución
   * sobre una carta que no tenemos. **Sin dinero y sin mercancía ⇒ NO bloqueante** (familia de
   * `BL-35` eje 2-b). **Disparador para cerrarlo:** que aparezca cualquier consecuencia de dinero
   * colgada de `rejectedAt`.
   *
   * ### Aplica DENTRO y FUERA del ciclo
   * **No es una regla del ciclo de oferta: es una afirmación sobre mercancía física.** Por eso este
   * cuerpo se invoca desde los dos caminos (dentro, como peldaño de `assertOfferCycleAllows`; fuera,
   * directamente) en vez de escribirse dos veces. *Un solo cuerpo, muchos lectores* (§4.39c).
   *
   * ⚠️ **Esto es el AVISO honesto; la guarda REAL es el `where` del `updateMany`**
   * (`sellRequest: { receivedAt: { not: null } }`) con `count === 1`. Un `if` sobre la lectura previa
   * es read-then-write y esto decide si una carta ajena entra al inventario.
   */
  private assertRequestReceived(
    decision: 'approve' | 'adjust' | 'reject',
    parent: { id: string; receivedAt: Date | null },
    status: SellRequestStatus,
  ): void {
    if (decision !== 'approve' || parent.receivedAt != null) return;
    throw BusinessException.validation(
      'REQUEST_NOT_RECEIVED',
      'This sell request has no record of receipt: its lines cannot be approved',
      // Nombra la SOLICITUD, no la línea, porque el remedio es sobre la solicitud: `POST …/receive`.
      // *El error nombra la palanca.*
      { sellRequestId: parent.id, status },
    );
  }

  /**
   * v1.51.20 · **BL-27** — el conflicto de `itemDecision` cuando la guarda del MOTOR no encontró la
   * fila, **con el estado releído** y **discriminando por eje**. Es el hermano de la rama de error de
   * `respond` (§4.39b.3): *un código que miente sobre la causa manda a alguien a esperar algo que no
   * va a pasar.*
   *
   * **Precedencia idéntica a la del pre-check, y por CONSTRUCCIÓN:** terminal primero
   * (`409 NO_LIVE_ADJUSTMENT` gana) y, si la solicitud sigue viva y ya está en el ciclo, se delega en
   * **`assertOfferCycleAllows` — el MISMO cuerpo** que evaluó el pre-check. *Dos escaleras de
   * precedencia para el mismo endpoint son dos precedencias, y la que se lee en el código no sería la
   * que se dispara en una carrera.*
   *
   * ⚠️ **La línea se RELEE, y es lo que hace honesta la respuesta.** Llegar aquí significa que una
   * emisión de oferta ganó la carrera entre nuestra lectura y nuestra escritura, así que la línea que
   * teníamos en la mano es **pre-ciclo** (`offerDecision: null`, sin monto ofertado): evaluar la
   * escalera con ella daría `ITEM_NOT_OFFERED` sobre una línea que **acaba de comprarse**. Se relee
   * para que el error sea **el mismo que daría el reintento**.
   */
  private async throwItemDecisionConflict(
    // ⚠️ Se AMPLÍA el lector localmente en vez de tocar `SellRequestReader` (zona compartida,
    // `common/buylist-aml.ts`): la relectura de la LÍNEA solo la necesita este cuerpo, y ensanchar el
    // tipo común obligaría a proveer `sellRequestItem` a los tres acumulados AML que no lo usan.
    db: SellRequestReader & Pick<Prisma.TransactionClient, 'sellRequestItem'>,
    item: { id: string; sellRequestId: string; offeredPriceCents: number | null },
    decision: 'approve' | 'adjust',
    approvedPriceCents?: number,
  ): Promise<never> {
    const sellRequestId = item.sellRequestId;
    const current = await db.sellRequest.findUnique({
      where: { id: sellRequestId },
      // ⚠️ v1.58 · §M5-R (BL-39): `receivedAt` entra al `select` **por la misma razón** por la que
      // `status` entró en BL-14 y `offerSentAt` en BL-27 — sin leerlo, el error honesto de esta
      // carrera **no podría existir aunque estuviera escrito en el contrato**.
      select: { status: true, offerSentAt: true, receivedAt: true },
    });
    if (current != null && !isTerminalSellRequestStatus(current.status)) {
      const parent = { id: sellRequestId, receivedAt: current.receivedAt };
      if (current.offerSentAt != null) {
        const fresh = await db.sellRequestItem.findUnique({
          where: { id: item.id },
          select: { id: true, offerDecision: true, offeredPriceCents: true },
        });
        this.assertOfferCycleAllows(
          decision,
          approvedPriceCents,
          fresh ?? { id: item.id, offerDecision: null, offeredPriceCents: item.offeredPriceCents },
          current.status,
          parent,
        );
      } else {
        // ⚠️ v1.58 · §M5-R (BL-39) — **FUERA del ciclo la escalera del ciclo no corre, pero R sí**:
        // no es una regla del ciclo de oferta, es una afirmación sobre mercancía física. Mismo cuerpo.
        this.assertRequestReceived(decision, parent, current.status);
      }
    }
    // Terminal (o cualquier otra desaparición de la fila): el `409` de siempre, con su relectura.
    return this.throwTerminalConflict(db, sellRequestId);
  }

  /**
   * Cherry-pick: decisión carta por carta. API_CONTRACT §M5.
   *
   * ### ⚠️ v1.51.5 · BL-14 — GUARDA DE TERMINAL. Es DINERO, y era peor que un `if` faltante.
   * Hasta v1.51.4 este método **no leía `sellRequest.status` en ningún punto**: su `findUnique`
   * seleccionaba **solo `userId` y `user`**, así que el estado **ni siquiera estaba disponible** para
   * comprobarlo. Las únicas guardas eran existencia del ítem, idempotencia a nivel ítem y longitud
   * del motivo — **nada a nivel solicitud**. Consecuencia real: sobre una solicitud **`pagada`** un
   * operador re-decidía un ítem, `recomputeApprovedTotal` corría y **`approvedTotalCents` se
   * reescribía DESPUÉS de que el SPEI salió**. Es la hermana de **BL-2** por la puerta del ítem: BL-2
   * revivía la solicitud; ésta reescribe **el monto** de una solicitud ya liquidada.
   *
   * **De esta guarda depende `brutoConsumado` (§4.39i.4-bis).** Esa norma ancla el acumulado AML en
   * `approvedTotalCents` **porque en un terminal es final** — y sin este candado **no lo era**, así
   * que el tope mensual podía medir un número distinto del que salió por SPEI. Por eso van en el
   * mismo commit.
   *
   * **Cómo se cierra, en dos capas:**
   * - **Pre-check** con el estado ya leído ⇒ `409 NO_LIVE_ADJUSTMENT` (`details.status`) **antes de
   *   cualquier escritura** y antes incluso de la idempotencia del `reject`: sobre una solicitud
   *   cerrada la respuesta honesta es «esto ya no se opera», no un `200` que sugiere que sí.
   * - **Guarda del MOTOR** en el `where` de **todas** las escrituras (`updateMany` + `count === 1`),
   *   nunca un `if` sobre la lectura previa: eso es read-then-write y sufre TOCTOU. Mismo patrón
   *   atómico que `respond` (BL-2), `paySpei` y `rejectRequest`.
   *
   * ⚠️ **No basta la guarda del ciclo de oferta** (`422 OFFER_PRICE_IMMUTABLE` /
   * `409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE`): ésas miran `offerSentAt`, y una solicitud **pre-M-46**
   * ya pagada **no lo tiene**.
   *
   * ### ⚠️⚠️ v1.51.20 · **BL-27** — GUARDA DEL CICLO DE OFERTA. Es DINERO **SALIENTE MAL**, medido.
   * La guarda de terminal (BL-14) aterrizó **sola**: `ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` quedó
   * cableado **únicamente en `respond`** y `OFFER_PRICE_IMMUTABLE` **no existía en el código**.
   * Consecuencia reproducida por QA contra BD real, sobre una oferta **ya ACEPTADA**
   * (`offerGrossCents=63500`, `offerNetCents=45500`):
   * ```
   * PATCH /admin/buylist/items/{id}/decision {"decision":"adjust","approvedPriceCents":9900} → 200 OK
   * pay-spei → pagada | og 63500 | onet 45500 | apr 9900 | pay 0
   * ```
   * **El vendedor aceptó MX$500 y cobró MX$0.** *La aritmética del pago era correcta; lo que faltaba
   * era la guarda que impide reescribir el precio que ya es vinculante.*
   *
   * **Discriminador: `SellRequest.offerSentAt IS NOT NULL`** (§M5, criterios 119/124/150). Cuando lo es:
   * - **`approvedPriceCents` en el body ⇒ `422 OFFER_PRICE_IMMUTABLE`** (`details.itemId`,
   *   `details.offeredPriceCents`). El monto **no se toma del cliente NI DEL ADMIN**.
   * - **`decision:"adjust"` ⇒ `409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE`** (`details.status`). Es el
   *   criterio 150 **por lo negativo**: el ítem `ajustada` **no se usa en ninguna parte** del ciclo.
   * - **`approve` fija SERVER-SIDE `approvedPriceCents = SellRequestItem.offeredPriceCents`**, que es
   *   la línea que el vendedor aceptó por escrito.
   * - **`reject` NO cambia**: es el mecanismo del rechazo parcial (D30) y sigue intacto.
   *
   * **Precedencia NORMATIVA, escrita porque el contrato la fija explícitamente:** terminal ⇒
   * `409 NO_LIVE_ADJUSTMENT` **gana** sobre las dos. *Una solicitud cerrada no se discute por el
   * monto: no se toca.* Por eso el pre-check de terminal va **primero** y este bloque **después**.
   *
   * ### ⚠️⚠️ v1.58 · **§M5-R / BL-39 — LA RECEPCIÓN ES PRECONDICIÓN DE `approve`.** MERCANCÍA AJENA.
   * `decision:"approve"` exige **`sellRequest.receivedAt IS NOT NULL`** ⇒ si no,
   * **`422 REQUEST_NOT_RECEIVED`** (`details: { sellRequestId, status }`) y **cero escritura**. Sin
   * ese término, **una carta que nunca recibimos podía quedar `aprobada`** —el único estado que
   * `convert-to-inventory` admite— **y entrar al inventario vendible**. La norma completa, con el
   * porqué de que vaya AQUÍ y no en la conversión, vive en `assertRequestReceived`.
   * ⛔ **`convert-to-inventory` NO se toca:** con esto `aprobada` es **inalcanzable** sin recepción y
   * `422 ITEM_NOT_APPROVED` **vuelve a bastar**.
   *
   * **La escalera COMPLETA, en este orden exacto (§M5-R.4 · §4.39i.6-ter):**
   * ```
   * 409 NO_LIVE_ADJUSTMENT            (terminal — anula el ACTO y gana a todo)
   *   → 409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE
   *   → 422 ITEM_NOT_OFFERED          (aprobar lo que no compramos: ninguna recepción lo arregla)
   *   → 422 REQUEST_NOT_RECEIVED      ← ⚠️ v1.58
   *   → 422 OFFER_PRICE_IMMUTABLE     (peldaño 3: objeta un CAMPO, no el acto)
   *   → 500 OFFERED_PRICE_MISSING     (backstop)
   * ```
   * **`ITEM_NOT_OFFERED` gana** porque es irreparable por definición; **`REQUEST_NOT_RECEIVED` gana a
   * `OFFER_PRICE_IMMUTABLE`** porque anula el acto entero y el otro solo objeta un campo del body.
   *
   * **Y la guarda vive también en el MOTOR**, no solo en el `if`: cada escritura lleva
   * `offerSentAt` en su `where` **con el valor que se observó al resolver el monto**
   * (`{ not: null }` si el precio salió de la oferta, `null` si salió del body/cotización). Si una
   * emisión de oferta gana la carrera entre la lectura y la escritura, `count !== 1` y **no se
   * escribe un peso**: el monto que teníamos en la mano ya no es el vinculante. *Un `if` sobre una
   * lectura previa es read-then-write, y esto es dinero.*
   */
  async itemDecision(
    itemId: string,
    decision: 'approve' | 'adjust' | 'reject',
    approvedPriceCents?: number,
    // v1.18-buylist-rejects: motivo del rechazo — OBLIGATORIO con reject (3–500 chars); se IGNORA
    // (no se persiste) para approve/adjust.
    reason?: string,
  ) {
    const item = await this.prisma.sellRequestItem.findUnique({
      where: { id: itemId },
      include: {
        sellRequest: {
          select: {
            userId: true,
            // ⚠️ v1.51.5 (BL-14): el ESTADO de la solicitud. Su ausencia de este `select` era el
            // agujero: no había forma de comprobarlo aunque alguien hubiera querido.
            status: true,
            // ⚠️ v1.51.20 (BL-27): el DISCRIMINADOR del ciclo de oferta. Mismo agujero, otro eje:
            // sin leerlo, ni `OFFER_PRICE_IMMUTABLE` ni `ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` podían
            // existir aunque estuvieran escritos en el contrato.
            offerSentAt: true,
            // ⚠️ v1.58 (§M5-R / BL-39): la CONSTANCIA DE RECEPCIÓN. **Tercera vez el mismo agujero,
            // tercer eje**: sin leerlo, `REQUEST_NOT_RECEIVED` no podía existir aunque el contrato lo
            // declarara — igual que pasó con `status` (BL-14) y con `offerSentAt` (BL-27).
            receivedAt: true,
            // v1.18: destinatario/idioma del correo de rechazo (dueño de la solicitud).
            user: { select: { email: true, name: true, locale: true } },
          },
        },
        // v1.18: datos de la carta para el correo de rechazo (nombre/set/número).
        card: { select: { name: true, number: true, set: { select: { name: true } } } },
      },
    });
    if (!item) throw BusinessException.notFound();

    // ⚠️ v1.51.5 · BL-14 — PRE-CHECK de terminal. Va ANTES de todo lo demás (incluida la
    // idempotencia del `reject`): sobre una solicitud `pagada`/`rechazada`/`abandonada`/`expirada`
    // no hay decisión de ítem que tomar, y un `200` silencioso ahí diría que sí la hay.
    // La guarda REAL —la del motor— está en el `where` de cada escritura de abajo.
    if (isTerminalSellRequestStatus(item.sellRequest.status)) {
      throw BusinessException.conflict(
        'NO_LIVE_ADJUSTMENT',
        'This sell request is closed: its items can no longer be decided',
        { status: item.sellRequest.status },
      );
    }

    // ⚠️ v1.51.20 · BL-27 — PRE-CHECK del CICLO DE OFERTA. Va DESPUÉS del de terminal (precedencia
    // normativa: `NO_LIVE_ADJUSTMENT` gana) y ANTES de cualquier escritura. La guarda REAL —la del
    // motor— está en el `where` de cada escritura de abajo.
    const inOfferCycle = item.sellRequest.offerSentAt != null;
    // ⚠️ v1.58 · §M5-R (BL-39) — la solicitud padre que necesita el peldaño de la RECEPCIÓN.
    const parentRequest = { id: item.sellRequestId, receivedAt: item.sellRequest.receivedAt };
    if (inOfferCycle) {
      this.assertOfferCycleAllows(
        decision,
        approvedPriceCents,
        item,
        item.sellRequest.status,
        parentRequest,
      );
    } else {
      // ⚠️ v1.58 · §M5-R (BL-39) — **R aplica DENTRO y FUERA del ciclo**: no es una regla del ciclo de
      // oferta, es una afirmación sobre mercancía física. Dentro va como peldaño de la escalera del
      // ciclo (su sitio es entre `ITEM_NOT_OFFERED` y `OFFER_PRICE_IMMUTABLE`); fuera, sola. **El
      // cuerpo es el mismo** — una regla con dos entradas, no dos reglas.
      this.assertRequestReceived(decision, parentRequest, item.sellRequest.status);
    }
    // El `where` de TODAS las escrituras afirma el eje del ciclo TAL COMO SE OBSERVÓ al resolver el
    // monto. Si cambia bajo nuestros pies, `count !== 1` y no se escribe nada.
    const offerCycleWhere: Prisma.SellRequestWhereInput = {
      offerSentAt: inOfferCycle ? { not: null } : null,
    };
    // ⚠️⚠️ v1.58 · §M5-R (BL-39) — **LA GUARDA REAL: el `where` del `updateMany`, con `count === 1`.**
    // El pre-check de arriba da el error honesto; **lo que impide que una carta ajena llegue a
    // `aprobada` es esto**. Solo `approve`: `reject` (que tiene su propio `updateMany` más abajo) es
    // la dirección segura y `adjust` no lo gana — R.3.
    const receivedWhere: Prisma.SellRequestWhereInput =
      decision === 'approve' ? { receivedAt: { not: null } } : {};

    // ------- v1.18-buylist-rejects: semántica COMPLETA de `reject` (API_CONTRACT §M5) -------
    if (decision === 'reject') {
      // Idempotencia: re-reject sobre un ítem ya `rechazada` = no-op (200 con el estado actual;
      // NO re-fija rejectedAt, NO re-envía correo).
      if (item.itemStatus === 'rechazada') {
        // S49-R4: lista blanca en vez del rest-destructuring (que sólo excluía las dos relaciones
        // del `include` y dejaba pasar cualquier columna futura de `SellRequestItem`).
        return toAdminSellItemRow(item);
      }
      // `reason` obligatorio (3–500 chars tras trim). El DTO ya lo valida (400 VALIDATION_ERROR);
      // esto es defensa en profundidad para llamadas internas/whitespace-only.
      const trimmedReason = (reason ?? '').trim();
      if (trimmedReason.length < 3 || trimmedReason.length > 500) {
        throw BusinessException.badRequest(
          'VALIDATION_ERROR',
          'reason is required for decision "reject" (3–500 chars)',
          { field: 'reason' },
        );
      }
      const rejectedAt = new Date();
      // INVARIANTE de dinero (BL-1, §4.18b): el rechazo SACA el ítem del total aprobado aunque
      // antes hubiera sido aprobado/ajustado → approvedPriceCents=null ANTES del recompute.
      // v1.51.5 · BL-14: `updateMany` + `count === 1` con la guarda de terminal EN EL `where` — la
      // exclusión la da el motor, no un `if` sobre la lectura de arriba (que una carrera invalida).
      const guard = await this.prisma.sellRequestItem.updateMany({
        // ⚠️ v1.51.20 · BL-27 — el eje del ciclo **NO** entra a este `where`, y es deliberado:
        // `reject` es legal a los DOS lados del discriminador (D30: es el mecanismo del rechazo
        // PARCIAL, «se rechaza carta por carta con el correo que YA EXISTE») y su escritura **no
        // depende de ningún monto**. Meterlo aquí fabricaría un `409` por una carrera que no cambia
        // nada de lo que se escribe. *Se guarda lo que el estado condiciona, no todo lo que se leyó.*
        where: { id: itemId, sellRequest: this.notTerminalWhere() },
        data: {
          itemStatus: 'rechazada',
          approvedPriceCents: null,
          rejectedAt,
          rejectionReason: trimmedReason,
        },
      });
      if (guard.count !== 1) await this.throwTerminalConflict(this.prisma, item.sellRequestId);
      // `updateMany` no devuelve filas: la relectura es la única forma de responder el estado ya
      // escrito (mismo motivo que en `respond`).
      const updated = await this.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
      if (!updated) throw BusinessException.notFound();
      await this.recomputeApprovedTotal(item.sellRequestId);
      // Correo al vendedor: best-effort POST-commit — su fallo se loggea y NO revierte la decisión.
      await this.sendItemRejectedMail(item, trimmedReason, rejectedAt);
      // v1.24-buylist-request-reject (§4.18f, P-4): auto-transición de la SOLICITUD como efecto del
      // reject, TRAS el recompute. Si NO queda ningún ítem no-rechazado, cierra la solicitud a
      // `rechazada`+`closedAt`. NO toca montos (BL-1 ya lo hizo) NI envía correos.
      await this.maybeAutoRejectRequest(item.sellRequestId);
      return toAdminSellItemRow(updated); // S49-R4
    }
    // RB-3: cap AML efectivo = override por-KYC del usuario si existe, si no el dial global.
    // Misma fuente que honra `createRequest` (evita rechazar una aprobación legítima de un
    // usuario con tope elevado).
    const kyc = await this.prisma.kycProfile.findUnique({
      where: { userId: item.sellRequest.userId },
      select: { capPerRequestCentsOverride: true },
    });
    const amlCap =
      kyc?.capPerRequestCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS));
    let itemStatus: 'aprobada' | 'ajustada';
    const data: Prisma.SellRequestItemUpdateInput = {};
    if (decision === 'approve') {
      itemStatus = 'aprobada';
      // ⚠️ v1.51.20 · BL-27 — EN EL CICLO EL MONTO ES SERVER-SIDE Y ES **EL OFERTADO**: es la cifra
      // que el vendedor aceptó línea por línea en el correo (D2/D9/D30). Fuera del ciclo, el flujo
      // de ajuste NO se retira y el body sigue mandando (cohorte legacy, §4.39b.3).
      //
      // ⚠️ **SIN `?? 0`, y ésa es la corrección del arquitecto (escalada 2).** Dentro del ciclo la
      // escalera de arriba ya garantizó las DOS condiciones —`offerDecision === 'buy'` y
      // `offeredPriceCents != null`—: una `skip` sale por `422 ITEM_NOT_OFFERED` y una `buy` sin
      // precio por `500 OFFERED_PRICE_MISSING`. **Un `?? 0` aquí volvería a abrir el agujero**: la
      // línea quedaría `aprobada` con monto cero, que es el único estado que la conversión admite ⇒
      // mercancía ajena en el inventario vendible con costo 0, y el reloj de §H sin arrancar.
      // *El `!` no es confianza: es la afirmación de un invariante que se acaba de comprobar.*
      const effective = inOfferCycle
        ? (item.offeredPriceCents as number)
        : (approvedPriceCents ?? item.quotedPriceCents ?? 0);
      // B-4: cota server-side de dinero saliente (además del @Max del DTO). Se aplica TAMBIÉN al
      // monto derivado de la oferta: defensa en profundidad, no confianza en el origen.
      //
      // ⚠️⚠️ v1.58 · **BL-40 — DENTRO DEL CICLO LA COTA ES `capAML` A SECAS.** El comentario de arriba
      // decía *«defensa en profundidad, no confianza en el origen»*… **sobre un monto que nosotros
      // mismos ya le prometimos al vendedor por correo.** El término relativo (`× 2` sobre la
      // cotización) convertía **el caso que D26 existe para atender** —un override motivado por encima
      // del doble— en una oferta VINCULANTE **imposible de aprobar y por tanto de pagar**, sin ningún
      // remedio para el vendedor, que ya mandó la carta. La norma completa está en el helper.
      await this.assertApprovedPriceWithinCap(effective, item.quotedPriceCents, amlCap, {
        relativeCapApplies: !inOfferCycle,
      });
      data.approvedPriceCents = effective;
    } else {
      itemStatus = 'ajustada';
      const effective = approvedPriceCents ?? 0;
      // B-4: cota server-side de dinero saliente (además del @Max del DTO).
      // ⚠️ `adjust` **solo existe FUERA del ciclo** (dentro es `409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE`)
      // y su monto **sí viene del body**: la cota relativa es exactamente lo que tiene que acotarlo.
      // *BL-40 retira el término donde el monto es NUESTRO, no donde lo teclea alguien.*
      await this.assertApprovedPriceWithinCap(effective, item.quotedPriceCents, amlCap, {
        relativeCapApplies: true,
      });
      data.approvedPriceCents = effective;
    }
    data.itemStatus = itemStatus;
    // v1.18: si un ítem antes rechazado se re-decide approve/adjust, los campos de rechazo se
    // LIMPIAN (solo un ítem `rechazada` los expone; higiene de la fuente única de plazos).
    if (item.itemStatus === 'rechazada') {
      data.rejectedAt = null;
      data.rejectionReason = null;
    }
    // v1.51.5 · BL-14 — las DOS escrituras de esta rama van en UN SOLO boundary atómico, cada una
    // con la guarda de terminal en su `where`. Antes, el `adjustmentSentAt` se escribía **primero y
    // suelto**: sobre una solicitud cerrada dejaba el plazo de 7 días puesto aunque la decisión no
    // prosperara. *Una precondición y su efecto son una operación del motor, no dos pasos que una
    // carrera pueda separar.*
    const updated = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.sellRequestItem.updateMany({
        where: {
          id: itemId,
          sellRequest: { ...this.notTerminalWhere(), ...offerCycleWhere, ...receivedWhere },
        },
        data: data as Prisma.SellRequestItemUpdateManyMutationInput,
      });
      if (guard.count !== 1) {
        await this.throwItemDecisionConflict(tx, item, decision, approvedPriceCents);
      }
      if (decision === 'adjust') {
        // Dispara el plazo de 7 días en la solicitud — también guardado, y DESPUÉS de la decisión.
        const g2 = await tx.sellRequest.updateMany({
          where: { id: item.sellRequestId, ...this.notTerminalWhere(), ...offerCycleWhere },
          data: { adjustmentSentAt: new Date() },
        });
        if (g2.count !== 1) {
          await this.throwItemDecisionConflict(tx, item, decision, approvedPriceCents);
        }
      }
      // PROJECTION-EXEMPT: fila cruda DENTRO de la tx; el caller la proyecta con
      // `toAdminSellItemRow` antes de devolverla (abajo). `updateMany` no devuelve filas, así que la
      // relectura es la única forma de responder el estado ya escrito.
      return tx.sellRequestItem.findUnique({ where: { id: itemId } });
    });
    if (!updated) throw BusinessException.notFound();
    // RB-6 / SEC-D3: deriva y persiste `approvedTotalCents` server-side desde los montos aprobados
    // por ítem, en el punto donde esos montos cambian. Lo lee el P&L / la tarjeta "buylist del periodo".
    await this.recomputeApprovedTotal(item.sellRequestId);
    return toAdminSellItemRow(updated); // S49-R4
  }

  /**
   * RB-6 / SEC-D3: recalcula `SellRequest.approvedTotalCents` como la SUMA de `approvedPriceCents`
   * de sus ítems (derivación server-side, SEC-A1 — nunca de input del cliente). Se invoca cada vez
   * que una decisión de ítem fija/ajusta el monto aprobado. Si ningún ítem tiene monto aprobado,
   * queda `null` (no `0`) para distinguir "sin aprobar aún" de "aprobado en cero".
   *
   * v1.18-buylist-rejects (BL-1, §4.18b): el aggregate EXCLUYE además `itemStatus='rechazada'` —
   * defensa en profundidad sobre el invariante "un ítem rechazado JAMÁS suma en
   * approvedTotalCents" (el reject ya anula approvedPriceCents; esto lo blinda ante escrituras
   * futuras que olviden anular el monto). `quotedTotalCents` nunca se recalcula (snapshot).
   */
  private async recomputeApprovedTotal(sellRequestId: string): Promise<void> {
    const agg = await this.prisma.sellRequestItem.aggregate({
      where: {
        sellRequestId,
        approvedPriceCents: { not: null },
        itemStatus: { not: 'rechazada' },
      },
      _sum: { approvedPriceCents: true },
      _count: { approvedPriceCents: true },
    });
    const approvedTotalCents = agg._count.approvedPriceCents > 0 ? (agg._sum.approvedPriceCents ?? 0) : null;
    // ⚠⚠ v1.56 · **§M5-T / BL-35 (P1) — EL TERCER `update({where:{id}})`, Y SÍ ESCRIBE DINERO.**
    //
    // No es un verbo de transición (no mueve `status`), y su ÚNICA entrada —`itemDecision`— ya está
    // guardada por BL-14. Pero la guarda del llamador **no cubre esta escritura**: entre el `commit`
    // de la decisión por-ítem y este recálculo hay una ventana en la que `paySpei` puede commitear
    // `pagada`, y entonces esto **reescribe `approvedTotalCents` sobre una fila YA PAGADA Y CERRADA**.
    //
    // **El orden inverso sí está cubierto y por eso este no se veía:** si el recálculo commitea
    // ANTES, el CAS de las cuatro columnas de `paySpei` falla y no sale un peso. Lo que queda abierto
    // es *después*, y ahí el daño no es el depósito (ya salió, correcto) sino **el acumulado AML**:
    // `monthCommittedGrossPaidCentsTx` mide `brutoConsumado` sobre las filas `pagada`, así que mover
    // el bruto de una fila pagada **cambia retroactivamente cuánta cuota mensual consumió** — a la
    // baja, liberando tope. Es literalmente lo que el contrato afirma que no puede pasar: §4.18f
    // ancla la norma de `brutoConsumado` en que **`approvedTotalCents` es FINAL en `pagada`**.
    //
    // ⚠ **No lanza, y es deliberado.** Es un derivado best-effort que corre **post-commit** de una
    // decisión que ya prosperó legítimamente; un `409` aquí le devolvería un error al operador por
    // una escritura que el contrato ni siquiera le promete, y encima **después** de haber movido el
    // ítem. El no-op ES el resultado correcto: sobre una fila cerrada el total ya no se recalcula
    // porque **el total congelado es exactamente el que se pagó**. Se registra para que la carrera
    // sea VISIBLE (§4.39k.1: se degrada lo que se muestra, nunca lo que se compromete).
    const guard = await this.prisma.sellRequest.updateMany({
      where: { id: sellRequestId, ...this.liveRequestWhere() },
      data: { approvedTotalCents },
    });
    if (guard.count !== 1) {
      this.logger.warn(
        `recomputeApprovedTotal: ${sellRequestId} ya no está viva; el total aprobado NO se reescribe ` +
          '(§M5-T/BL-35: en una solicitud cerrada el bruto es final — es el que se pagó).',
      );
    }
  }

  /**
   * v1.24-buylist-request-reject (§4.18f, cierra P-4): re-evalúa el estado de la SOLICITUD tras
   * rechazar un ítem. Regla EXACTA de agregación: la solicitud pasa a `status='rechazada'` **sólo si
   * TODO ítem** está `itemStatus='rechazada'` (equivalente: **cero** ítems en estado no-rechazado).
   * `convertida_inventario` NO cuenta como rechazado (es un desenlace positivo), así que una solicitud
   * con ítems convertidos + rechazados **NO** se auto-rechaza. Al sellar el terminal fija
   * `closedAt=now()` (patrón SEC-D2, misma ancla que `paySpei`/`ine-retention`).
   *
   * IDEMPOTENTE y money-safe: NO toca montos (BL-1 ya sacó los ítems rechazados de
   * `approvedTotalCents` vía el recompute) NI envía correos (el correo por-ítem ya salió). Guard «no
   * pisar terminal»: `updateMany` con guardia de estado (mismo patrón atómico que `paySpei`) — nunca
   * reescribe una `pagada`/`abandonada` ni re-sella una `rechazada`.
   */
  private async maybeAutoRejectRequest(sellRequestId: string): Promise<void> {
    // v1.24 (endurecimiento §4.18f): el "¿queda algún ítem no-rechazado?" (count) y el "sella la
    // solicitud a rechazada" (updateMany) van en UN SOLO boundary atómico Serializable (mismo patrón
    // que `createRequest`/SEC-A2), haciendo verdadera la afirmación del doc «mismo transaction
    // boundary». Sin esto, count y update eran awaits secuenciales no atómicos. Dentro se usa `tx`.
    await this.prisma.$transaction(
      async (tx) => {
        // ¿Queda algún ítem NO-rechazado en la solicitud? (convertida_inventario cuenta como vivo).
        const nonRejectedCount = await tx.sellRequestItem.count({
          where: { sellRequestId, itemStatus: { not: 'rechazada' } },
        });
        if (nonRejectedCount > 0) return; // aún hay ítems no-rechazados → no se auto-rechaza.
        // Transición con guardia «no pisar terminal» (patrón updateMany de paySpei). Si la solicitud
        // ya es terminal (pagada/rechazada/abandonada) el updateMany no matchea → no-op.
        // ⚠️ v1.56 · **§M5-T** — el guard pasa a los **DOS** términos (`liveRequestWhere`). Escribe
        // `status`, luego obedece T; y llevaba **solo el de estado**, así que sobre la fila que P1
        // fabrica (`closedAt` sellado ∧ `status` no terminal) **auto-rechazaba una solicitud ya
        // pagada** — reescribiendo a `rechazada` una fila cuyo dinero ya salió.
        await tx.sellRequest.updateMany({
          where: { id: sellRequestId, ...this.liveRequestWhere() },
          data: { status: 'rechazada', closedAt: new Date() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * v1.24-buylist-request-reject (§4.18g): cierre EXPLÍCITO — botón «Rechazar solicitud» de M5
   * (`POST /admin/buylist/:id/reject`). Sella una solicitud a `rechazada`+`closedAt` SÓLO si TODOS
   * sus ítems ya están `rechazada`. Diseño deliberadamente ESTRECHO y money-safe: NO rechaza ítems
   * en cascada (eso es cherry-pick por-ítem con motivo/plazos/correo), NO mueve dinero, NO reevalúa
   * montos, NO manda correos. Cubre el back-log de solicitudes atoradas pre-fix P-4.
   *
   * Precondición: si queda ≥1 ítem no-rechazado → `422 REQUEST_HAS_NON_REJECTED_ITEMS`
   * (`details.nonRejectedItemStatuses`). Idempotencia: ya `rechazada` → `200` con el estado actual
   * (no re-sella, `transitioned=false` para que el controller NO audite como cambio). Otro terminal
   * (`pagada`/`abandonada`) → `409 CONFLICT` (`details.status`, invariante «no pisar terminal»).
   * `404` si no existe.
   *
   * @returns `{ request, transitioned }` — `request` es el shape de `adminGet` (Res 200 del contrato);
   *   `transitioned` indica si hubo un cambio real de estado (guía la auditoría del controller).
   */
  async rejectRequest(id: string): Promise<{ request: unknown; transitioned: boolean }> {
    const req = await this.prisma.sellRequest.findUnique({ where: { id } });
    if (!req) throw BusinessException.notFound();
    // Idempotencia: ya rechazada → 200 con el estado actual, sin re-sellar closedAt ni auditar.
    if (req.status === 'rechazada') {
      return { request: await this.adminGet(id), transitioned: false };
    }
    // Guard «no pisar terminal»: otro estado terminal (pagada/abandonada) NO se reescribe → 409.
    // (La `rechazada` ya se resolvió arriba como idempotente, así que aquí el set solo matchea
    // pagada/abandonada.) Reusa la constante única de terminales en vez del literal inline.
    if ((SELL_REQUEST_TERMINAL_STATES as readonly string[]).includes(req.status)) {
      throw BusinessException.conflict(
        'CONFLICT',
        'Request is already in a terminal state and cannot be rejected',
        { status: req.status },
      );
    }
    // v1.24 (endurecimiento §4.18g): el guard de precondición (leer ítems vivos) y el sellado del
    // estado (updateMany) van en UN SOLO boundary atómico Serializable (mismo patrón que
    // `createRequest`/SEC-A2), para que "todos los ítems rechazados" y "solicitud rechazada" no
    // puedan divergir tras un commit exitoso. Dentro se usa `tx`.
    const transitioned = await this.prisma.$transaction(
      async (tx) => {
        // Precondición (idéntica a la regla f): cierra SÓLO si TODOS los ítems ya están `rechazada`.
        // Cualquier ítem vivo (aprobada/ajustada/convertida_inventario/verificacion/…) bloquea el
        // cierre → 422 con los status vivos encontrados.
        const liveItems = await tx.sellRequestItem.findMany({
          where: { sellRequestId: id, itemStatus: { not: 'rechazada' } },
          select: { itemStatus: true },
        });
        if (liveItems.length > 0) {
          const nonRejectedItemStatuses = Array.from(
            new Set(liveItems.map((i) => i.itemStatus)),
          ) as SellItemStatus[];
          throw BusinessException.validation(
            'REQUEST_HAS_NON_REJECTED_ITEMS',
            'Request still has non-rejected items; reject them per-item before closing the request',
            { nonRejectedItemStatuses },
          );
        }
        // Efecto ÚNICO: status → rechazada + closedAt=now(). Guard atómico «no pisar terminal»
        // (patrón updateMany de paySpei) por si una transición concurrente ganó la carrera.
        // ⚠️ v1.56 · **§M5-T** — este endpoint es **el PRECEDENTE** de la invariante (§4.18f), y su
        // guard llevaba **un solo término**. Se le añade el segundo (`closedAt: null`, vía
        // `liveRequestWhere`) porque el precedente tiene que cumplir la norma que inspiró: sin él, la
        // fila con `closedAt` sellado ∧ `status` no terminal —la que P1 fabrica— pasaba el guard y se
        // reescribía a `rechazada` **encima de un SPEI ya liquidado**.
        // ⚠️ El `details` **no se toca**: §M5-T declara el segundo campo **aditivo y opcional aquí**
        // («§4.18f NO se retro-edita»), y la salida idempotente de abajo tampoco cambia — sobre una
        // fila sana los dos términos excluyen exactamente lo mismo, así que el `count === 0` llega a
        // la misma rama que hoy. Lo único nuevo es que la fila INCOHERENTE cae en el `409`.
        const res = await tx.sellRequest.updateMany({
          where: { id, ...this.liveRequestWhere() },
          data: { status: 'rechazada', closedAt: new Date() },
        });
        // count===0 ⇒ una transición concurrente cerró la solicitud entre la lectura inicial y el
        // update (espejo de la verificación de `paySpei`). Re-lee DENTRO de la tx y decide:
        //  - quedó `rechazada` → idempotente: 200 con estado actual, SIN auditar como cambio.
        //  - otro terminal (`pagada`/`abandonada`) → 409 CONFLICT. NUNCA reportamos `transitioned:true`
        //    cuando el update no cambió nada (elimina la entrada de auditoría fantasma).
        if (res.count === 0) {
          const current = await tx.sellRequest.findUnique({ where: { id }, select: { status: true } });
          if (current?.status === 'rechazada') return false;
          throw BusinessException.conflict(
            'CONFLICT',
            'Request is already in a terminal state and cannot be rejected',
            { status: current?.status },
          );
        }
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { request: await this.adminGet(id), transitioned };
  }

  /**
   * v1.18-buylist-rejects (§4.18c): correo al vendedor por RECHAZO de su carta. BEST-EFFORT
   * POST-COMMIT: se invoca DESPUÉS de persistir la decisión + recompute; cualquier fallo (puerto
   * ausente, proveedor caído, datos incompletos) se loggea y NO revierte la decisión ni falla el
   * request. Sin cola de reintentos en MVP (deuda aceptada BE-43). Minimización: solo carta
   * (nombre/set/número), acabado, motivo y plazos — SIN CLABE, SIN montos/estado de otros ítems.
   */
  private async sendItemRejectedMail(
    item: {
      id: string;
      finish: Finish;
      sellRequest?: { user?: { email: string; name: string; locale: string | null } | null } | null;
      card?: { name: string; number: string; set?: { name: string } | null } | null;
    },
    reason: string,
    rejectedAt: Date,
  ): Promise<void> {
    try {
      const user = item.sellRequest?.user;
      if (!this.mail || !user?.email) {
        this.logger.warn(
          `buylist reject mail skipped for item ${item.id}: ${this.mail ? 'no recipient email' : 'MAIL_PORT unavailable'}`,
        );
        return;
      }
      const { returnDeadlineAt, abandonDeadlineAt } = rejectDeadlines(rejectedAt);
      const msg = sellItemRejectedTemplate(
        {
          cardName: item.card?.name ?? '',
          setName: item.card?.set?.name ?? '',
          cardNumber: item.card?.number ?? '',
          finish: item.finish ?? 'normal',
          reason,
          returnDeadlineAt,
          abandonDeadlineAt,
        },
        user.name ?? '',
        user.locale,
      );
      await this.mail.send({ ...msg, to: user.email });
    } catch (e) {
      // El correo es efecto lateral best-effort: su fallo NUNCA revierte la decisión (§M5).
      this.logger.error(
        `buylist reject mail failed for item ${item.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * v1.18-buylist-rejects (§M5): pestaña «Rechazadas» — listado paginado TRANSVERSAL (todas las
   * solicitudes) de ítems `itemStatus='rechazada'` (RejectedSellItemDTO, §11). Orden `rejectedAt`
   * desc con legacy (sin rejectedAt) AL FINAL. La "fase" (ventana devolución/abandono/abandonada)
   * la deriva el FRONT de now vs las fechas — aquí no se expone como campo. Índice
   * `@@index([itemStatus])` (M-22) sirve el filtro sin barrer la tabla.
   */
  async adminRejectedItems(page: number, pageSize: number, userId?: string) {
    const where: Prisma.SellRequestItemWhereInput = { itemStatus: 'rechazada' };
    // Filtro por vendedor (simetría F1 con ?userId= de los otros listados admin).
    if (userId) where.sellRequest = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.sellRequestItem.findMany({
        where,
        orderBy: { rejectedAt: { sort: 'desc', nulls: 'last' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          // `set` completo: `toCardDTO` proyecta `setName` desde la relación (patrón
          // canónico, mismo include que sealed-mapping.service).
          card: { include: { set: true } },
          sellRequest: {
            select: { id: true, userId: true, user: { select: { id: true, name: true, email: true, phone: true } } },
          },
        },
      }),
      this.prisma.sellRequestItem.count({ where }),
    ]);
    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(rows.map((i) => i.cardId));
    const data = rows.map((i) => ({
      id: i.id,
      sellRequestId: i.sellRequestId,
      seller: this.sellerRef(i.sellRequest?.user),
      // T-1 (techlead v1.19): proyección canónica CardDTO (setName/subtypes/availableFinishes),
      // NUNCA la fila Prisma cruda — contrato §11 RejectedSellItemDTO exige card: CardDTO.
      card: toCardDTO(i.card, pricedByCard.get(i.cardId)),
      productType: i.productType,
      finish: i.finish ?? 'normal',
      quotedPriceCents: i.quotedPriceCents ?? undefined,
      reason: i.rejectionReason ?? null,
      rejectedAt: i.rejectedAt ?? null,
      // Plazos DERIVADOS de rejectedAt (misma familia 7d/30d que buylist-sweep); legacy → null.
      ...rejectDeadlines(i.rejectedAt),
    }));
    return { data, page, pageSize, total };
  }

  /**
   * Conversión a inventario en un clic. API_CONTRACT §M5.
   *
   * ### ⚠️ v1.51.18 (fase 8 · §4.39m.3/m.5) — la conversión ya no MUERE aquí
   * Antes la pieza nacía `in_stock` **sin ubicación y sin precio**, y **nada la empujaba a la venta**.
   * Ahora:
   * - **`locationId` OPCIONAL** (m.3): se **ofrece** para no obligar a un segundo viaje, pero **NO se
   *   exige** — *bloquear la conversión por falta de ubicación atoraría el pago al vendedor, y el
   *   pago no puede depender de que ya sepamos en qué caja va la carta*. ⚠️ **NO acepta
   *   `listPriceCents`** (D10, criterio 126): el ciclo **no captura precios de venta**.
   * - **Disparador (a)**: POST-COMMIT se pide a `inventory` que **reevalúe** la pieza. Se pide, no se
   *   ordena: el puerto **no acepta estado destino ni precio**, y las guardas viven del otro lado.
   * - La respuesta gana **`pendingPublish`** — el deep-link desde M5 a la cola de M1. `missing: []` ⇒
   *   **se publicó sola** (criterio 125).
   */
  async convertToInventory(itemId: string, actorUserId: string, locationId?: string) {
    const item = await this.prisma.sellRequestItem.findUnique({
      where: { id: itemId },
      include: { card: true },
    });
    if (!item) throw BusinessException.notFound();
    // Guardia rápida (pre-check): si ya está convertido, es idempotente. Se evalúa ANTES
    // que la guardia de aprobación para que un item ya convertido (itemStatus=
    // 'convertida_inventario') no dispare 422 en reintentos.
    if (item.inventoryItemId) {
      // ⚠️ v1.51.18: el replay **también** trae `pendingPublish`. Si solo lo trajera la primera
      // conversión, M5 perdería el deep-link justo en el reintento — que es cuando el operador está
      // buscando qué pasó. Y **se re-dispara**: el puerto es idempotente y un disparo perdido en la
      // llamada original es exactamente lo que un reintento debe poder recuperar.
      return {
        inventoryItemId: item.inventoryItemId,
        alreadyConverted: true,
        pendingPublish: await this.triggerPublish(item.inventoryItemId),
      };
    }
    // GUARDIA DE APROBACIÓN (PROJECT §H, criterios 3d/16): SOLO una carta cuyo resultado
    // de verificación fue `aprobada` puede convertirse en InventoryItem vendible. Una carta
    // `rechazada` (resultado de verificación NO-NM) NUNCA debe volverse vendible; tampoco
    // una `cotizada`/`recibida`/`verificacion`/`ajustada` (aún sin decisión de aprobación).
    if (item.itemStatus !== 'aprobada') {
      throw BusinessException.validation(
        'ITEM_NOT_APPROVED',
        'Only an approved sell item can be converted to sellable inventory',
        { itemStatus: item.itemStatus },
      );
    }
    // SEC-A3: el pre-check por sí solo sufre TOCTOU (dos llamadas concurrentes ven
    // `inventoryItemId=null`). La guardia real es el índice único en
    // `InventoryItem.sourceSellRequestItemId`: la creación concurrente colisiona (P2002)
    // y se resuelve como "ya convertido", garantizando UN solo InventoryItem.
    try {
      const folio = await this.prisma.nextFolio();
      const created = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.inventoryItem.create({
          data: {
            folio,
            cardId: item.cardId,
            productType: item.productType,
            rawCondition: item.rawCondition,
            // v1.6-finish: el acabado snapshoteado se PROPAGA a la copia física (ARCHITECTURE §3.7).
            finish: item.finish,
            // ⚠️ v1.51 (M-46, D7, §4.39d) — **LA PROPAGACIÓN QUE TRES COMENTARIOS AFIRMABAN Y NO
            // EXISTÍA.** `schema.prisma`, `dto/buylist.dto.ts` y ARCHITECTURE §4.29d decían desde
            // v1.30 que `SellRequestItem.cardProductId` «se propaga al `InventoryItem` al convertir»;
            // `InventoryItem` **no tenía la columna** y este `create` **no la propagaba ni podía**.
            // M-46 crea la columna y ESTA línea es la propagación. Los tres comentarios quedaron
            // corregidos y la deuda documental registrada en `docs/TECH_DEBT.md` (INV-D7).
            // `null` = línea de set_base ⇒ pieza de set_base. Sin esto, los conteos de la mesa de
            // decisión mezclarían una promo con la del set base (§P.8 / D6).
            cardProductId: item.cardProductId,
            ownerType: 'platform',
            status: 'in_stock',
            // v1.51.18 (§4.39m.3): la ubicación **se ofrece, no se exige**. `undefined` ⇒ la pieza
            // nace sin caja y sale SEÑALADA en `pending-publish` — nunca invisible.
            ...(locationId ? { locationId } : {}),
            acquisitionType: 'buylist',
            // ⚠️ v1.51 (M-46, §4.39i.5, criterio 135) — **el costo de inventario es el BRUTO de esa
            // línea**, y desde el ciclo la fuente ÚNICA es `offeredPriceCents` (congelado al ofertar,
            // no se mueve jamás — D2/D9). El fallback `approvedPriceCents ?? quotedPriceCents` se
            // conserva para las filas **pre-M-46**, donde `offeredPriceCents` es `null` y no puede
            // ser otra cosa. Hoy nada escribe `offeredPriceCents` ⇒ **esta línea es un no-op sobre
            // los datos existentes**; se pone ahora porque olvidarla después sería registrar el costo
            // COTIZADO de una pieza que se compró a otro precio.
            // **El envío NO entra al costo de la pieza**: dos piezas idénticas compradas al mismo
            // bruto tienen el MISMO costo y el MISMO margen, llegue una en un paquete caro y la otra
            // no. Mezclarlos ensuciaría el P&L por carta que M7 existe para mostrar.
            acquisitionCostCents:
              item.offeredPriceCents ?? item.approvedPriceCents ?? item.quotedPriceCents ?? 0,
            sourceSellRequestItemId: item.id,
          },
        });
        await tx.inventoryMovement.create({
          data: {
            itemId: inv.id,
            toStatus: 'in_stock',
            reason: MovementReason.buylist_convert,
            actorUserId,
            note: `from sellRequestItem ${item.id}`,
          },
        });
        await tx.sellRequestItem.update({
          where: { id: itemId },
          data: { itemStatus: 'convertida_inventario', inventoryItemId: inv.id },
        });
        return inv;
      });
      // ⚠️ **POST-COMMIT.** La conversión ya está escrita: el disparo no puede deshacerla ni
      // retrasarla, y su fallo **no la revierte**. *Bloquear el pago al vendedor porque no pudimos
      // poner una carta a la venta invierte las prioridades.*
      return {
        inventoryItemId: created.id,
        folio: created.folio,
        alreadyConverted: false,
        pendingPublish: await this.triggerPublish(created.id),
      };
    } catch (e) {
      // Violación de unicidad → otra conversión ganó la carrera: ya convertido.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.inventoryItem.findFirst({
          where: { sourceSellRequestItemId: itemId },
          select: { id: true },
        });
        return {
          inventoryItemId: existing?.id,
          alreadyConverted: true,
          ...(existing?.id ? { pendingPublish: await this.triggerPublish(existing.id) } : {}),
        };
      }
      throw e;
    }
  }

  /**
   * ⚠️ v1.51.18 · **BL-25** (§4.39m.5) — **el disparador (a): «reevalúa esta pieza».**
   *
   * Traduce el resultado del puerto al `pendingPublish` que §M5 declara en la respuesta de
   * `convert-to-inventory`: el **deep-link desde M5 a la cola de M1**. `missing: []` ⇒ **la pieza se
   * publicó sola** (criterio 125).
   *
   * ### ⚠️ Best-effort, con su red nombrada
   * Se llama **post-commit** y **nunca lanza**: la conversión ya ocurrió y *no puede fallar porque la
   * publicación falle*. Un fallo aquí —o un puerto no cableado— **no deja la pieza invisible**: la
   * deja en **`GET /admin/inventory/pending-publish`**, que es una cola que un operador trabaja.
   * ⚠️ **Esa cola ES la red de este disparo** ⇒ **no se retira ni se estrecha sin sustituirla**; el
   * día que se «optimice», esto pasa a ser fail-silent sobre inventario **pagado y no vendible**.
   *
   * ⚠️ **El degradado NO inventa un estado bueno.** Sin puerto se responde `missing: []`… **no**: se
   * responde con lo que sabemos, que es *nada*, y por eso `missing` sale **vacío solo cuando el
   * puerto confirmó que no falta nada**. Si el puerto no contesta, se dice `['location','price']`
   * —*«no sé, revísalo»*— porque un `[]` inventado significaría **«ya está a la venta»** y sacaría la
   * pieza de la pantalla que existe para encontrarla. *Donde el flag solo hace VISIBLE, se falla
   * hacia visible.*
   */
  private async triggerPublish(
    inventoryItemId: string,
  ): Promise<{ missing: ('location' | 'price')[]; pendingPriceEntryId?: string }> {
    const unknown = { missing: ['location', 'price'] as ('location' | 'price')[] };
    if (!this.inventoryPublish) {
      this.logger.warn(
        `convert-to-inventory: INVENTORY_PUBLISH_PORT no disponible para ${inventoryItemId}; ` +
          'la pieza queda en pending-publish',
      );
      return unknown;
    }
    try {
      const [res] = await this.inventoryPublish.reevaluateForPublication([inventoryItemId]);
      if (!res) return unknown;
      return {
        missing: res.missing,
        ...(res.pendingPriceEntryId ? { pendingPriceEntryId: res.pendingPriceEntryId } : {}),
      };
    } catch (e) {
      this.logger.error(
        `convert-to-inventory: disparo de publicación falló para ${inventoryItemId}: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
      return unknown;
    }
  }

  /**
   * Pago SPEI manual (super_admin, money-out). Precondición: aprobada + verificada.
   * API_CONTRACT §M5, PROJECT criterio 26.
   *
   * v1.28 (P-22, §4.26e): la transición a `pagada` y el CONTEO de bounty
   * (`bountyAcquiredQty` por cada ítem con snapshot `priceBasis='bounty'`, con auto-apagado al
   * alcanzar `bountyTargetQty`) corren en la MISMA transacción — o se paga Y se cuenta, o nada.
   * Idempotente ante replays: el conteo solo corre en la llamada que HACE la transición
   * (updateMany count===1); un re-POST/replay ve `pagada` y devuelve el estado sin re-contar.
   */
  async paySpei(id: string, speiReference: string, paidBy: string) {
    // ⚠️ v1.61 · §M5-V — el `include` de las líneas es **precondición del verbo, no adorno de la
    // respuesta**: V-b se evalúa sobre ellas y el DTO publica `pendingDecisionItemCount`.
    const req = await this.prisma.sellRequest.findUnique({
      where: { id },
      include: { items: { select: VERDICT_ITEM_SELECT } },
    });
    if (!req) throw BusinessException.notFound();
    // SEC-M5: idempotencia — si ya está pagada, no se hace un segundo asiento; se
    // devuelve el estado existente (dos POST /pay-spei concurrentes o reintentos).
    // S49-M1: proyectado — este `req` viene de un `findUnique` SIN select, o sea con el snapshot
    // cifrado de la CLABE dentro. Es el camino MÁS fácil de alcanzar (basta re-postear el pago).
    if (req.status === 'pagada') {
      return this.adminSellRequestDTO(req, await this.adminCycleDials());
    }
    // ⚠️⚠️ v1.56 · **§M5-T / BL-35 — LA HUELLA DACTILAR DE UN ROLLBACK, Y TIENE QUE SER RUIDOSA.**
    //
    // Va **inmediatamente después** del corto-circuito idempotente y **antes** de todo lo demás: el
    // orden ES la norma. `status === 'pagada'` ⇒ `200` con la PRIMERA liquidación (reintento, hoy
    // intacto). Pero **`paidAt` poblado con `status` distinto de `pagada`** no es un reintento: es
    // una fila que **ya cobró y a la que alguien le movió el estado hacia atrás**. Devolverle el
    // `200` idempotente **escondería exactamente lo que P1 enseñó a buscar** — *la idempotencia
    // existe para absorber un reintento, no para normalizar una incoherencia.*
    //
    // Y `closedAt` poblado con `status` no terminal es la otra mitad de la misma huella (§M5-T: los
    // dos términos, porque se midió que discrepan).
    //
    // ⚠️ **Es un PRE-CHECK, no la guarda.** La guarda real son los dos términos nuevos del `where`
    // del `updateMany` de abajo, que es lo que una carrera no puede saltar; esto solo evita gastar
    // una transacción SERIALIZABLE y una lectura de KYC en una fila que ya sabemos que no se paga, y
    // permite dar el `details` correcto (`paidAt` vs `closedAt`) en vez del genérico del CAS.
    if (req.paidAt != null) {
      throw BusinessException.conflict(
        'CONFLICT',
        'This sell request already has a settlement on record; it cannot be paid again',
        { status: req.status, paidAt: req.paidAt },
      );
    }
    if (req.closedAt != null) {
      throw BusinessException.conflict(
        'CONFLICT',
        'This sell request is closed and can no longer be paid',
        { status: req.status, closedAt: req.closedAt },
      );
    }
    // v1.51 (M-46, §4.39c **SITIO 8**) — el «estado pagable» estaba escrito INLINE **dos veces en
    // este mismo método**: aquí (pre-check) y en el `where` del `updateMany` de abajo (la guarda
    // atómica real). Dos literales en un método de DINERO SALIENTE es la forma más barata de que una
    // edición mueva uno y no el otro: el pre-check diría «no» y la guarda «sí», o al revés.
    // **Una sola constante, los dos sitios.**
    // v1.51.8 (**SITIO 10**): y ahora son **TRES** lectores con **UN** cuerpo — el tercero es
    // `AdminBuylistDTO.isPayable`, que es lo que gobierna el botón de pagar en M5. La condición
    // completa (v1.57 · §M5-P: la recepción; v1.61 · §M5-V: V-a ⇒ **CUATRO** términos escalares, más
    // V-b, que mira las LÍNEAS y por eso no cabe en el predicado de la fila) vive en
    // `isPayableSellRequest` / `isPayableSellRequestWithItems`; aquí solo
    // se invoca. ⚠️ **Que el término nuevo entrara por el cuerpo compartido y no por un `if` local
    // es el punto entero**: `isPayable` gobierna el botón de pagar en M5, así que una guarda sin
    // señal dejaría al súper-admin autorizando con la pantalla diciéndole que la carta llegó.
    // ⚠️⚠️ v1.61 · **§M5-V (V-b) — «y juzgamos TODO LO QUE COMPRAMOS». VA ANTES DE LA GENÉRICA.**
    //
    // La escalera de §M5-V.6 es normativa y este peldaño **gana** a `VALIDATION_ERROR` aunque V-a
    // también falle, y no es cosmética: **cuando faltan veredictos, decidirlos es el acto que
    // satisface los DOS términos**. Mandar al operador el mensaje genérico lo manda a revisar el
    // estado y la recepción —que están bien— en vez de a la pantalla donde está el trabajo. *El
    // error nombra la palanca*, misma disciplina que `REQUEST_NOT_RECEIVED` (§M5-R).
    //
    // ⚠️ **No hay guarda gemela en el `where` del `updateMany`, y es una decisión medida, no un
    // olvido.** *Un candado probable vale más que dos que se tapan entre sí.* Para que esta ventana
    // fuera explotable una línea `buy` tendría que **PERDER** su veredicto entre este chequeo y la
    // escritura, y **dentro del ciclo eso no existe**: `adjust` —el único destino no-veredicto que
    // `itemDecision` sabe escribir— responde `422 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE` con
    // `offerSentAt != null` (criterio 150), `approve`/`reject`/`convert` mueven a estados que **son**
    // veredicto, y `offer/cancel` —lo único que borra `offerDecision`— solo **quita** líneas del
    // conjunto. **El único eje que sí se mueve bajo nosotros es el MONTO, y ése ya lo afirma el CAS
    // de las cuatro columnas** (B-2) más `approvedTotalCents: { not: null }` de `payableWhere()`.
    // ⚠️ El `?? []` es **solo por los mocks unitarios** (filas construidas a mano, sin `include`); el
    // tipo de `req` ya garantiza las líneas en producción.
    const pendingDecisionItemIds = pendingBuyDecisionItemIds(req, req.items ?? []);
    if (pendingDecisionItemIds.length > 0) {
      throw BusinessException.validation(
        'ITEMS_NOT_DECIDED',
        'Payment requires a verification verdict on every purchased line',
        { sellRequestId: id, pendingDecisionItemIds },
      );
    }
    if (!isPayableSellRequest(req)) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Payment allowed only after receipt/verification and approval',
      );
    }
    // v2.1.6 (AML-1, §4.36.6a) — TOPE MENSUAL SOBRE EL DINERO QUE SALE, no solo sobre la cotización
    // de entrada. Se lee el override de KYC del VENDEDOR (mismo criterio que el intake).
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId: req.userId } });
    const capPerMonth =
      kyc?.capPerMonthCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS));

    // SEC-M5: transición atómica con guardia de estado (patrón count===1). El
    // `updateMany` solo prospera si la solicitud sigue en un estado pagable; dos
    // llamadas concurrentes → solo una hace la transición a `pagada` (y solo esa CUENTA bounty).
    //
    // v2.1.6 (AML-1): SERIALIZABLE, por la misma razón que el intake (SEC-A2). Sin ella, dos
    // `pay-spei` concurrentes de solicitudes distintas del MISMO vendedor leen el mismo acumulado y
    // las dos pasan — el bypass clásico del tope. Con serializable, una de las dos entra en conflicto
    // y no liquida.
    // ⚠️ Los diales de la proyección se leen ANTES de la transacción SERIALIZABLE: una query de
    // settings dentro alargaría la ventana de conflicto de un camino de DINERO SALIENTE sin
    // aportar a ninguna precondición — solo alimentan la FORMA de la respuesta.
    const dials = await this.adminCycleDials();
    const paid = await this.prisma.$transaction(
      async (tx) => {
        // ⚠️⚠️ v1.51.22 · **B-2 — EL IMPORTE SE RELEE DENTRO DE LA TRANSACCIÓN.**
        //
        // Hasta aquí el bruto salía del `req` de arriba, leído **fuera** del `$transaction` y con
        // **otra ida y vuelta a la BD en medio** (`kycProfile.findUnique` + `adminCycleDials`). En esa
        // ventana `itemDecision` es **legal concurrentemente** (`aprobada`/`verificacion` NO son
        // terminales, así que BL-14 no la frena) y llama a `recomputeApprovedTotal`, que **reescribe
        // `approvedTotalCents`**. Resultado medible: el SPEI salía con un bruto **ya superado** y el
        // chequeo AML comparaba contra la **cifra vieja** — el tope mensual se evaluaba sobre un
        // número que en el instante del `UPDATE` ya no existía.
        //
        // `payableWhere()` **no lo cubre**: fija `status`, `receivedAt` y `verifiedAt`, y ninguno de
        // los tres se mueve cuando cambia el monto. *Una guarda que no mira el importe no protege
        // el importe.*
        //
        // Se relee con `select` de **solo las columnas de dinero**: además de ser lo único que hace
        // falta, evita traerse otra vez el snapshot cifrado de la CLABE (S49-M1).
        const fresh = await tx.sellRequest.findUnique({
          where: { id },
          select: {
            approvedTotalCents: true,
            offerGrossCents: true,
            quotedTotalCents: true,
            offerShippingFeeCents: true,
          },
        });
        // La fila desapareció bajo nosotros (imposible sin `onDelete`, pero el `null` es
        // representable): NO se paga. Sale por el camino de `count !== 1`, que ya distingue el
        // replay idempotente del choque real.
        if (!fresh) return null;
        // v1.51.5 (§4.39i.4-bis) — SITIO (b): el término de la solicitud EN CURSO. Usa el MISMO
        // cuerpo que el acumulado de arriba (sitio (a)) porque son los dos lados de la misma
        // desigualdad `acumulado + enCurso > cap`: medir cada lado con una cascada distinta es
        // comparar dos cosas. Lo aprobado manda; sin decisiones por-ítem, **lo OFERTADO** (que es lo
        // vinculante, D2); y solo en filas pre-M-46, lo cotizado.
        const payoutCents = brutoConsumado(fresh);
        const alreadyPaid = await this.monthCommittedGrossPaidCentsTx(tx, req.userId);
        if (alreadyPaid + payoutCents > capPerMonth) {
          throw BusinessException.validation('BUYLIST_LIMIT_EXCEEDED', 'Per-month payout cap exceeded', {
            scope: 'per_month_payout',
            capCents: capPerMonth,
            wouldBeCents: alreadyPaid + payoutCents,
          });
        }
        const res = await tx.sellRequest.updateMany({
          // §4.39c sitio 8: la MISMA constante que el pre-check de arriba. Ésta es la guarda real
          // (patrón `count===1`): la del motor, no la de la aplicación.
          // v1.51.8: el fragmento sale de `payableWhere()`, que es la traducción a `where` de
          // `isPayableSellRequest` — **los CUATRO términos escalares (v1.57 · §M5-P, v1.61 · §M5-V),
          // la misma constante**. Hay un test que asevera que el predicado y el `where` coinciden en
          // TODO el enum × `receivedAt` × `verifiedAt` × `approvedTotalCents`, y una mutación que
          // verifica que quitar el término de CUALQUIERA de los lectores mata algo.
          // ⚠️ **Ese test cruza `payableWhere()` AISLADA**, y por sí solo **no** ve lo que la
          // composición tira: `buylist.pay-spei-where-composition.spec.ts` es el que mira **este**
          // objeto (`B1`).
          //
          // ⚠️⚠️ v1.51.22 · **B-2 — CAS SOBRE EL IMPORTE**, hermano exacto del `offerSentAt` que
          // `itemDecision` mete en el `where` de todas sus escrituras «con el valor que se observó al
          // resolver el monto». Aquí se afirman **las CUATRO columnas de las que sale el dinero**: los
          // tres términos de la cascada `brutoConsumado` **y** la tarifa congelada que produce
          // `payoutNetCents`. Si alguna se movió entre la relectura y esta escritura, `count !== 1` y
          // **no sale un peso**.
          //
          // **La relectura y el CAS no son redundantes, y por eso van los dos:** la relectura corrige
          // *qué número* se compara contra el tope; el CAS garantiza que *ese mismo número* siga
          // siendo el vigente cuando se escribe. Y el CAS **no depende del nivel de aislamiento del
          // otro lado**: el SSI de Postgres solo arbitra entre transacciones que TAMBIÉN son
          // `Serializable`, y `itemDecision` no lo es — así que sin CAS la relectura sola dejaría la
          // ventana abierta. *Un `updateMany` con predicado sí frena a cualquiera.*
          //
          // ⚠⚠ v1.56 · **§M5-T / BL-35 (P1) — DEFENSA EN PROFUNDIDAD: `paidAt IS NULL` Y `closedAt IS NULL`.**
          //
          // **La lección de P1 no es «faltaba una guarda en `verify`»: es que anclar la idempotencia
          // de un pago en UN SOLO campo (`status`) es frágil.** El corto-circuito de arriba mira
          // `status === 'pagada'` y el `where` miraba `status ∈ PAYABLE`; bastó con que **otro** verbo
          // moviera ese único campo hacia atrás para que las dos puertas se abrieran a la vez. Aquí
          // se afirman además **los dos hechos que NO se pueden deshacer moviendo un estado**: que
          // este dinero **no ha salido** (`paidAt`) y que la solicitud **no está cerrada**
          // (`closedAt`). Con esto, un rollback futuro **por CUALQUIER vía** —una guarda nueva que
          // alguien olvide, una migración, un script de soporte— deja de re-habilitar el pago.
          //
          // ⚠ **MEDIDO antes de ponerlo, no asumido** (rompería pagos buenos si algún flujo sellara
          // esos campos antes de pagar): `paidAt` lo escribe **un solo sitio en todo el backend** —
          // este mismo `data`, junto con `status:'pagada'`— y **todas** las escrituras de `closedAt`
          // (seis en este servicio, cinco en `jobs/buylist-sweep`) van en el MISMO `data` que un
          // estado **terminal**. ⇒ En una fila legítimamente pagable (`aprobada`/`verificacion`) los
          // dos son `null` **por construcción**, y estos dos términos **no pueden rechazar un pago
          // legítimo**: solo rechazan una fila que ya cobró o que ya cerró.
          //
          // ⚠️⚠️⚠️ v1.61.1 · **B1 — LOS FRAGMENTOS COMPARTIDOS ENTRAN POR `AND`, JAMÁS POR SPREAD.**
          //
          // Esto era `{ id, ...this.payableWhere(), …, approvedTotalCents: fresh.approvedTotalCents }`
          // y **en un objeto literal de JavaScript la clave posterior gana sobre el spread**: el
          // `approvedTotalCents: { not: null }` de **V-a no llegaba al motor**. El `where` que corría
          // era, medido: `…, "approvedTotalCents": null, …` — o sea `IS NULL`, que casa **exactamente
          // la fila que V-a existe para rechazar**. Y ese `null` es alcanzable:
          // `recomputeApprovedTotal` lo escribe cuando ninguna línea tiene `approvedPriceCents` y su
          // guarda deja pasar `verificacion`, así que un `itemDecision(reject)` concurrente en la
          // ventana B-2 lo produce — y **no es `Serializable`**, luego el SSI no arbitra. Resultado
          // reproducido antes de tocar nada: `count === 1` y `payoutNetCents = 72000` **por CERO
          // cartas**. `BL-45` reentrando por la puerta que este `where` existía para tapar.
          //
          // El CAS (`= fresh.approvedTotalCents`) y V-a (`IS NOT NULL`) **afirman cosas distintas
          // sobre la misma columna**, así que no pueden convivir en una clave de un objeto plano.
          // `AND` conserva **las dos**, y su desacuerdo es justamente la conducta correcta: con el
          // aprobado en `null` el CAS casa, V-a no ⇒ `count = 0` ⇒ **no sale un peso**. *No es un
          // segundo candado que tape al primero: son las dos mitades del mismo, y ahora las dos
          // llegan al SQL.*
          //
          // ⚠️ **La regla, para que no vuelva:** todo fragmento que venga de otro sitio
          // (`payableWhere()`) viaja como elemento de `AND`; **plano solo queda lo que nadie más
          // reclama** (`id`). Un spread no avisa cuando lo pisan; un `AND` no puede pisar. Y lo
          // asevera una prueba que mira **el objeto que se le pasa a `updateMany`** —no el ayudante
          // aislado, que es donde el assert 9 miraba mientras el término estaba ausente aquí—:
          // `test/buylist.pay-spei-where-composition.spec.ts`.
          where: {
            id,
            AND: [
              // §4.39c sitio 8 · §M5-P · §M5-V (V-a): la MISMA constante que el pre-check de arriba.
              this.payableWhere(),
              // §M5-T / BL-35 (P1): los dos hechos que NO se deshacen moviendo un estado.
              { paidAt: null, closedAt: null },
              // B-2: CAS sobre las CUATRO columnas de las que sale el dinero, con el valor releído.
              {
                approvedTotalCents: fresh.approvedTotalCents,
                offerGrossCents: fresh.offerGrossCents,
                quotedTotalCents: fresh.quotedTotalCents,
                offerShippingFeeCents: fresh.offerShippingFeeCents,
              },
            ],
          },
          // SEC-D2: `pagada` es terminal → sella closedAt (ancla la retención de INE al cierre real).
          data: {
            status: 'pagada',
            speiReference,
            paidBy,
            paidAt: new Date(),
            closedAt: new Date(),
            // v1.51.5 (§4.39i.4-bis) — SITIO (c): **la CAJA**, sellada en la MISMA transacción que
            // `pagada`. Es la fuente de M7 (netos), distinta del acumulado de compromiso (brutos):
            // *si el tope sumara netos, un envío caro bajaría el acumulado; si la caja sumara brutos,
            // M7 reportaría una salida que nunca ocurrió* (criterio 155).
            //
            // Con `approvedTotalCents = null` la fórmula vieja quedaba **indefinida**, y tratar el
            // bruto como `0` le pagaría **MX$0** a un vendedor que aceptó una oferta vinculante y
            // cuyas cartas nadie rechazó. La cascada le paga **lo ofertado menos el envío**, que es
            // literalmente lo que se le prometió. *El piso de cero protege al vendedor de deber; no
            // es una excusa para no pagarle* (invariante 1, criterio 152).
            //
            // `offerShippingFeeCents ?? 0`: en una fila **pre-M-46** no hay tarifa congelada porque
            // **no se le descontó ninguna**. Restar un dial vigente aquí sería cobrarle un envío que
            // nunca se le anunció — lo contrario de D25.
            //
            // ⚠️ B-2: la tarifa sale de `fresh`, **no** del `req` de fuera de la transacción. Los dos
            // términos de esta resta tienen que venir de la MISMA lectura: mezclar un bruto releído
            // con un envío viejo produciría un neto que no corresponde a ninguna versión de la fila.
            payoutNetCents: Math.max(0, payoutCents - (fresh.offerShippingFeeCents ?? 0)),
          },
        });
        if (res.count !== 1) return null;
        // v1.28 (P-22): conteo de bounty EN LA MISMA transacción del pago (§4.26e).
        await this.countBountyAcquisitionsTx(tx, id, paidBy);
        const row = await tx.sellRequest.findUnique({
          where: { id },
          include: { items: { select: VERDICT_ITEM_SELECT } },
        });
        // S49-M1: se proyecta DENTRO de la tx, para que el snapshot cifrado no sobreviva ni como
        // variable local del método (`paid` es lo que se devuelve tal cual al controller).
        return row ? this.adminSellRequestDTO(row, dials) : null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!paid) {
      const current = await this.prisma.sellRequest.findUnique({
        where: { id },
        include: { items: { select: VERDICT_ITEM_SELECT } },
      });
      // S49-M1: mismo motivo que la salida idempotente de arriba (fila cruda con la CLABE cifrada).
      if (current?.status === 'pagada') return this.adminSellRequestDTO(current, dials);
      // ⚠️ v1.51.22 · **B-2 — el CAS del importe tiene su propia salida, y no es la de arriba.**
      // Si la solicitud SIGUE siendo pagable, lo que falló no fue la precondición de estado: fue el
      // CAS del monto. Decirle al operador *«el pago solo se permite tras recepción/verificación»*
      // sobre una fila que está **aprobada y verificada** lo manda a revisar lo único que sí está
      // bien, y la acción correcta —**volver a abrir la solicitud, ver el monto NUEVO y decidir de
      // nuevo**— no se deduce de ese mensaje. `409 CONFLICT` es un código COMÚN del contrato (§3), no
      // uno inventado para esto.
      // ⚠️⚠️ v1.56 · **§M5-T / BL-35 (P1)** — el mismo par de casos que el pre-check de arriba, aquí
      // como **backstop de CARRERA**: si la reactivación (o el pago de otro hilo) ocurrió *después*
      // de aquella lectura, el CAS de `paidAt`/`closedAt` es quien lo frena y esta rama es la que le
      // pone nombre. **Van ANTES del `409` del CAS del importe** porque son hechos distintos con
      // conductas distintas: aquél dice *«el monto se movió, vuelve a mirarlo y decide»*; éstos dicen
      // *«esto ya se pagó / ya cerró: NO lo vuelvas a pagar»*. Mandar a un súper-admin a
      // «re-verificar el monto» de una solicitud que ya cobró lo empuja justo hacia el acto que este
      // bloqueo existe para impedir.
      if (current?.paidAt != null) {
        throw BusinessException.conflict(
          'CONFLICT',
          'This sell request already has a settlement on record; it cannot be paid again',
          { status: current.status, paidAt: current.paidAt },
        );
      }
      if (current?.closedAt != null) {
        throw BusinessException.conflict(
          'CONFLICT',
          'This sell request is closed and can no longer be paid',
          { status: current.status, closedAt: current.closedAt },
        );
      }
      if (current && isPayableSellRequest(current)) {
        throw BusinessException.conflict(
          'CONFLICT',
          'The approved amount changed while the payment was being processed; re-check the request before paying',
          { status: current.status },
        );
      }
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'Payment allowed only after receipt/verification and approval',
      );
    }
    return paid;
  }

  /**
   * v1.28 (P-22, §4.26e) — conteo TRANSACCIONAL de bounty al pagar: por cada `SellRequestItem`
   * de la solicitud con snapshot `priceBasis='bounty'` se incrementa `bountyAcquiredQty` de SU
   * fila M-30 (clave `(cardId, productType, gradeKey, finish)` del ítem — misma derivación que la
   * cotización). Reglas money-safe:
   *  - B-1 (mismo filtro que la invariante BL-1 de `recomputeApprovedTotal`): los ítems
   *    `itemStatus='rechazada'` se EXCLUYEN del conteo — con cherry-pick esas piezas NO se compran
   *    ni suman en `approvedTotalCents`, así que tampoco cuentan hacia el bounty (§4.26a: el campo
   *    mide «piezas COMPRADAS vía buylist PAGADA bajo bounty»). Sin este filtro, las rechazadas
   *    inflarían el contador, podrían auto-apagar el bounty antes de tiempo y auditarían
   *    `bounty.completed` en falso;
   *  - el incremento aplica AUNQUE el bounty ya esté apagado (la pieza SE COMPRÓ bajo bounty; el
   *    monto quedó snapshoteado — apagar no borra ni congela el contador);
   *  - fila M-30 desaparecida (borrada sin historia) ⇒ no hay contador que llevar: se omite SIN
   *    tumbar el pago (updateMany count=0);
   *  - AUTO-APAGADO: si el bounty sigue activo, tiene `bountyTargetQty` y `acquired ≥ target` ⇒
   *    `bountyEnabled=false` + `bountyCompletedAt=now()` + `AuditLog action=bounty.completed`
   *    (el aviso de M1 sale de `completedAt`). Sin objetivo ⇒ solo contador, nunca auto-off.
   * Corre DENTRO de la transacción del pago (el caller garantiza que solo la llamada que hizo la
   * transición llega aquí ⇒ idempotente ante replays).
   */
  private async countBountyAcquisitionsTx(
    tx: Prisma.TransactionClient,
    sellRequestId: string,
    actorUserId: string,
  ): Promise<void> {
    const bountyItems = await tx.sellRequestItem.findMany({
      // B-1: mismo filtro que BL-1 — un ítem rechazado NO se compró, así que NO cuenta bounty.
      // v2.0 (P-48): el snapshot pasa de `ruleSource='bounty'` a `priceBasis='bounty'` (mismo criterio,
      // campo nuevo). Las filas históricas con `ruleSource='bounty'` ya se pagaron o son legacy.
      where: { sellRequestId, priceBasis: 'bounty', itemStatus: { not: 'rechazada' } },
      select: { cardId: true, productType: true, rawCondition: true, finish: true },
    });
    if (bountyItems.length === 0) return;
    // Agrupa por clave M-30: UNA actualización por variante (+n piezas), sin N+1 por pieza.
    const byKey = new Map<
      string,
      { cardId: string; productType: ProductType; gradeKey: string; finish: Finish; qty: number }
    >();
    // v1.53-b (residuo del gate techlead): el `continue` de abajo era SILENCIOSO. `price-sync`, con
    // MENOS en juego (un barrido nocturno), sí cuenta y loguea sus omisiones — y esto corre dentro de
    // la transacción del PAGO. Si una línea legacy se salta el contador de bounty, el `bountyAcquiredQty`
    // de esa variante queda por debajo de la realidad y el auto-apagado del bounty se retrasa: es poco,
    // pero es dinero, y hasta ahora no dejaba rastro. Mismo patrón que `price-sync.service.ts`:
    // contador + UNA línea de log al final, nunca por-fila (esto está en la ruta caliente del pago).
    let skippedNoGradeIdentity = 0;
    for (const it of bountyItems) {
      // v1.53 (§4.40.4b, MONEY) — clave TOLERANTE, y a propósito: esto corre DENTRO de la transacción
      // del PAGO y sólo lleva un CONTADOR de bounty. Un `throw` aquí tumbaría un pago por una fila
      // LEGACY (creada antes de la guarda raw-only, §4.40.5a) — la misma doctrina que el
      // `if (res.count === 0) continue` de abajo: «fila desaparecida ⇒ nada que contar, el pago NO se
      // cae». No es fail-open: sin clave no hay `VariantPriceOverride` que casar, así que no se
      // incrementa nada. Antes, una línea graduada casaba con la fila `graded:PSA:10`, si existía.
      const gradeKey = this.pricing.tryGradeKeyFor({
        productType: it.productType,
        rawCondition: it.rawCondition,
      });
      if (gradeKey == null) {
        skippedNoGradeIdentity += 1;
        continue;
      }
      const finish = (it.finish ?? 'normal') as Finish;
      // P-30 H2 (§4.39e): agrupación por la MISMA llave que usan pricing/catálogo. Si esta se
      // construyera distinto, el bounty contaría piezas de una variante contra el objetivo de otra.
      const key = variantKey({ cardId: it.cardId, productType: it.productType, gradeKey, finish });
      const prev = byKey.get(key);
      if (prev) prev.qty += 1;
      else byKey.set(key, { cardId: it.cardId, productType: it.productType, gradeKey, finish, qty: 1 });
    }
    if (skippedNoGradeIdentity > 0) {
      // Observabilidad, no control de flujo: el pago sigue su curso exactamente igual.
      this.logger.warn(
        `bounty counter: ${skippedNoGradeIdentity} línea(s) de la solicitud ${sellRequestId} omitidas ` +
          'por identidad de grado incompleta (§4.40.4b); su `bountyAcquiredQty` NO se incrementó.',
      );
    }
    for (const g of byKey.values()) {
      const uniqueKey = {
        cardId: g.cardId,
        productType: g.productType,
        gradeKey: g.gradeKey,
        finish: g.finish,
      };
      const res = await tx.variantPriceOverride.updateMany({
        where: uniqueKey,
        data: { bountyAcquiredQty: { increment: g.qty } },
      });
      if (res.count === 0) continue; // fila borrada: nada que contar, el pago NO se cae
      const row = await tx.variantPriceOverride.findUnique({
        where: { cardId_productType_gradeKey_finish: uniqueKey },
      });
      if (
        row &&
        row.bountyEnabled &&
        row.bountyTargetQty != null &&
        row.bountyAcquiredQty >= row.bountyTargetQty
      ) {
        await tx.variantPriceOverride.update({
          where: { id: row.id },
          data: { bountyEnabled: false, bountyCompletedAt: new Date() },
        });
        // Auditoría del auto-apagado, en la MISMA tx del pago (sin PII; patrón AuditLog directo
        // porque AuditService escribe fuera de la transacción).
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'bounty.completed',
            entityType: 'VariantPriceOverride',
            entityId: row.id,
            after: {
              cardId: g.cardId,
              productType: g.productType,
              gradeKey: g.gradeKey,
              finish: g.finish,
              acquiredQty: row.bountyAcquiredQty,
              targetQty: row.bountyTargetQty,
              sellRequestId,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }
  }
}
