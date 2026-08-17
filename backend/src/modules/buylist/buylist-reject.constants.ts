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
