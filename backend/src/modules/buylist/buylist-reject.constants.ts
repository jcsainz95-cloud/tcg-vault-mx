/**
 * v1.18-buylist-rejects (ARCHITECTURE §4.18a) — plazos del ítem RECHAZADO, anclados a
 * `SellRequestItem.rejectedAt` (M-22). Misma familia de constantes 7d/30d que
 * `src/jobs/buylist-sweep.service.ts` (el sweep ancla el 7d del AJUSTE en `adjustmentSentAt` y el
 * 30d de abandono de SOLICITUD en `createdAt`; el ítem rechazado ancla AMBOS en `rejectedAt`).
 * Los plazos NO se persisten: se derivan al proyectar (fuente única = rejectedAt). Sin transición
 * automática del ítem al vencer (informativos para back-office y vendedor).
 *
 * NOTA (deuda menor, v1.51/M-46): `buylist-sweep.service.ts` aún tiene sus 7/30 inline. Es la ÚNICA
 * de las tres notas de deuda de este archivo que M-46 **no** cobra: el barrido es del ciclo (§4.39j)
 * y se reapunta cuando ese archivo se reescriba con sus siete reglas. Las otras dos —el set terminal
 * y el `CLOSED` de `ine-retention`— **ya se cobraron**, ver abajo.
 */
export const BUYLIST_REJECT_RETURN_WINDOW_DAYS = 7;
export const BUYLIST_REJECT_ABANDON_WINDOW_DAYS = 30;

/**
 * v1.51 (M-46, §4.39c **SITIO 7**) — **`SELL_REQUEST_TERMINAL_STATES` SE MUDÓ a
 * `src/common/sell-request-states.ts` y aquí solo queda la RE-EXPORTACIÓN de compatibilidad.**
 *
 * Vivía aquí desde v1.24, y con `expirada` en el enum su lista de **tres** valores dejaba de ser el
 * set terminal: el guard «no pisar terminal» **no vería** una solicitud `expirada` ⇒ **se podría
 * reescribir un terminal**. El set es **CLASE R** (lo declara `PROJECT.md` §P.1: *«los terminales
 * son CUATRO»*), así que su sitio es la zona compartida, no un archivo de un módulo.
 *
 * La deuda que pedía exactamente esto —las notas de `:9-11` y `:22-25` de este archivo— llevaba
 * **147 commits** sin cobrarse. **Se cobra en M-46**, junto con las otras cuatro copias.
 *
 * ⚠️ **La re-exportación NO es una segunda fuente**: es el MISMO símbolo. Existe para no romper
 * imports vivos; **el código nuevo importa de `common/sell-request-states`**.
 */
export { SELL_REQUEST_TERMINAL_STATES } from '../../common/sell-request-states';

/**
 * v1.51 · BL-2 (API_CONTRACT §6, ARCHITECTURE §4.39(b.2)) — los ÚNICOS estados de `SellRequest` en
 * los que un ajuste de precio está VIVO y por tanto se puede responder (`POST
 * /buylist/requests/:id/respond`). Es, por definición del contrato, **el mismo set que el barrido de
 * 7d reconoce** al caducar un ajuste sin respuesta: si el barrido puede rechazar la solicitud por no
 * contestar, el vendedor tiene que poder contestarla — y sólo en esos estados.
 *
 * Fuente ÚNICA del `where` del `updateMany` que hace de guarda atómica en `BuylistService.respond`.
 *
 * NOTA (deuda menor, v1.51/M-46): `src/jobs/buylist-sweep.service.ts` repite este literal inline.
 * Se reapunta cuando el barrido se reescriba con las siete reglas del ciclo (§4.39j); NO entra en
 * este pase, que solo cierra el radio del ENUM DE ESTADOS (§4.39c) y no los plazos del barrido.
 */
export const SELL_REQUEST_LIVE_ADJUSTMENT_STATES = ['verificacion', 'aprobada'] as const;

const DAY_MS = 24 * 3600 * 1000;

/**
 * Deriva los dos plazos del ítem rechazado desde su ancla única `rejectedAt`:
 *  - `returnDeadlineAt` = rejectedAt + 7 días (gestionar devolución, A COSTO DEL USUARIO).
 *  - `abandonDeadlineAt` = rejectedAt + 30 días (abandono).
 * Ítems legacy (rechazados antes de M-22, sin `rejectedAt`) → ambos `null` (contrato §M5/§11).
 */
export function rejectDeadlines(rejectedAt: Date | null | undefined): {
  returnDeadlineAt: Date | null;
  abandonDeadlineAt: Date | null;
} {
  if (!rejectedAt) return { returnDeadlineAt: null, abandonDeadlineAt: null };
  return {
    returnDeadlineAt: new Date(rejectedAt.getTime() + BUYLIST_REJECT_RETURN_WINDOW_DAYS * DAY_MS),
    abandonDeadlineAt: new Date(rejectedAt.getTime() + BUYLIST_REJECT_ABANDON_WINDOW_DAYS * DAY_MS),
  };
}

/**
 * ⚠️ v1.51.15 · **BL-23(3)** (API_CONTRACT §6 · ARCHITECTURE §4.39a) — **POR QUÉ QUEDÓ
 * `rechazada`: DERIVADO server-side, CERO DDL.**
 *
 * `rechazada` tiene **TRES productores** y ninguno era distinguible desde el DTO, así que el portal
 * usó una frase neutra *a propósito* (bien hecho). Pero **decirle «se te venció el plazo» a quien
 * PULSÓ RECHAZAR es acusarlo de una pasividad que no tuvo** — el mismo argumento de D33, y el mismo
 * que separó el correo 5 del 3. Aquí las causas **sí son hechos distintos para el destinatario**,
 * así que merecen valores distintos.
 *
 * ### No necesita columna: las dos causas ambiguas son excluyentes POR CONSTRUCCIÓN
 * Un rechazo del vendedor **solo es legal ANTES** del plazo (después es `409 OFFER_EXPIRED`) y el
 * barrido **solo puede actuar DESPUÉS**. La frontera no es una convención: es una guarda del
 * servidor. Por eso basta comparar `closedAt` con `offerAcceptDeadlineAt`.
 *
 * ### ⚠️ Y lo deriva EL SERVIDOR, no el front
 * Que el cliente comparara esas dos fechas sería **exactamente la reconstrucción en el cliente** que
 * `isTerminal` e `isPayable` vinieron a borrar.
 *
 * ### ⚠️ LA PRECONDICIÓN, NO SOLO EL ORDEN (v1.51.17)
 * `all_items_rejected` va **primero**: una solicitud que llegó a verificación **fue ofertada,
 * aceptada y enviada**, así que su `closedAt` cae muy **después** del plazo de aceptación. Evaluar
 * las fechas primero le diría *«no respondiste»* a un vendedor que respondió, mandó el paquete y
 * cuyo problema fue que **ninguna carta pasó la verificación**.
 *
 * Pero el orden **no basta como garantía**, y el arquitecto lo fijó mejor de lo que yo lo tenía: **las
 * reglas de fecha exigen `acceptedAt IS NULL`.** *Un orden es una convención que alguien reordena; una
 * precondición es un hecho de la máquina.* Hoy las dos formas son **equivalentes en todo caso
 * alcanzable**, pero si mañana existiera un productor de `rechazada` **posterior a la aceptación** que
 * **no** rechace todos los ítems, la versión que solo confía en el orden **caería a las fechas y
 * volvería a mentir**; con la precondición devuelve `null` — y `null` ya está normado como la
 * respuesta honesta: **más vale no decir la causa que decir la equivocada.**
 *
 * *Las dos reglas de fecha son excluyentes entre sí; `all_items_rejected` es de otro eje y las
 * domina; y `acceptedAt` es la frontera que impide que las de fecha se apliquen fuera de su mundo.*
 */
export type SellRequestRejectionReason =
  | 'declined_by_seller'
  | 'accept_deadline_passed'
  | 'all_items_rejected';

export function deriveRejectedReason(
  r: {
    status: string;
    closedAt?: Date | null;
    offerSentAt?: Date | null;
    offerAcceptDeadlineAt?: Date | null;
    /** v1.51.17 — la PRECONDICIÓN de las reglas de fecha. Ver el bloque de arriba. */
    acceptedAt?: Date | null;
  },
  items: { itemStatus: string }[] | null | undefined,
): SellRequestRejectionReason | null {
  // Solo tiene sentido sobre una solicitud RECHAZADA: en cualquier otro estado no hay causa que dar.
  if (r.status !== 'rechazada') return null;
  // (1) Ninguna carta pasó la verificación. Va PRIMERO — ver el bloque de arriba.
  const list = items ?? [];
  if (list.length > 0 && list.every((i) => i.itemStatus === 'rechazada')) return 'all_items_rejected';
  // (2)/(3) Las dos causas del ciclo de OFERTA. Su mundo es el de una oferta **sin aceptar**:
  //  - `acceptedAt != null` ⇒ la solicitud pasó de la oferta, así que ni «rechazó» ni «no contestó»
  //    describen lo que ocurrió. **`null` es la respuesta honesta** (v1.51.17).
  //  - Sin oferta enviada tampoco hay dato honesto (fila pre-M-46, o el `decline` del ajuste legacy,
  //    que exige `offerSentAt: null`).
  if (r.acceptedAt != null) return null;
  if (r.offerSentAt == null || r.closedAt == null || r.offerAcceptDeadlineAt == null) return null;
  return r.closedAt.getTime() <= r.offerAcceptDeadlineAt.getTime()
    ? 'declined_by_seller'
    : 'accept_deadline_passed';
}
