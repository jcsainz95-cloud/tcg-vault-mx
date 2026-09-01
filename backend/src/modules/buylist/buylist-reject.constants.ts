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
