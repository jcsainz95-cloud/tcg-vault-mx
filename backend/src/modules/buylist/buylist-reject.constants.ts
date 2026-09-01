/**
 * v1.18-buylist-rejects (ARCHITECTURE §4.18a) — plazos del ítem RECHAZADO, anclados a
 * `SellRequestItem.rejectedAt` (M-22). Misma familia de constantes 7d/30d que
 * `src/jobs/buylist-sweep.service.ts` (el sweep ancla el 7d del AJUSTE en `adjustmentSentAt` y el
 * 30d de abandono de SOLICITUD en `createdAt`; el ítem rechazado ancla AMBOS en `rejectedAt`).
 * Los plazos NO se persisten: se derivan al proyectar (fuente única = rejectedAt). Sin transición
 * automática del ítem al vencer (informativos para back-office y vendedor).
 *
 * NOTA (deuda menor, ver resumen del pase): `buylist-sweep.service.ts` aún tiene sus 7/30 inline
 * (zona `src/jobs/` en uso por otro stream en este pase); cuando ese archivo se toque, debe importar
 * estas constantes para que la familia quede con fuente única.
 */
export const BUYLIST_REJECT_RETURN_WINDOW_DAYS = 7;
export const BUYLIST_REJECT_ABANDON_WINDOW_DAYS = 30;

/**
 * v1.24-buylist-request-reject (§4.18f/g) — estados TERMINALES de una `SellRequest`: una vez en uno
 * de ellos la solicitud ya no procesa (dinero salió / se cerró). Fuente ÚNICA del set usado por el
 * guard «no pisar terminal» de la auto-transición (`maybeAutoRejectRequest`) y del cierre explícito
 * (`rejectRequest`), evitando duplicar el literal inline en cada `updateMany`/guarda 409.
 *
 * NOTA (deuda menor, ver resumen del pase): `src/jobs/ine-retention.service.ts` define su propio
 * `CLOSED` con este MISMO set; vive en `src/jobs/` (zona en uso por otro stream en este pase), así
 * que NO se reapunta aquí para no arriesgar regresión cross-stream. Cuando ese archivo se toque,
 * debe importar esta constante para dejar la familia con fuente única.
 */
export const SELL_REQUEST_TERMINAL_STATES = ['pagada', 'rechazada', 'abandonada'] as const;

/**
 * v1.51 · BL-2 (API_CONTRACT §6, ARCHITECTURE §4.39(b.2)) — los ÚNICOS estados de `SellRequest` en
 * los que un ajuste de precio está VIVO y por tanto se puede responder (`POST
 * /buylist/requests/:id/respond`). Es, por definición del contrato, **el mismo set que el barrido de
 * 7d reconoce** al caducar un ajuste sin respuesta: si el barrido puede rechazar la solicitud por no
 * contestar, el vendedor tiene que poder contestarla — y sólo en esos estados.
 *
 * Fuente ÚNICA del `where` del `updateMany` que hace de guarda atómica en `BuylistService.respond`.
 *
 * NOTA (deuda menor, misma que las dos constantes de arriba): `src/jobs/buylist-sweep.service.ts:25`
 * repite este literal inline. NO se reapunta desde aquí porque `src/jobs/` es zona de otro stream;
 * cuando ese archivo se toque debe importar esta constante para dejar la familia con fuente única.
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
