import { IS_REAL, apiAs, resolveApiBaseUrl } from './env';
import { withFileLock } from './state';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * QA-REL-3 (QA de release, 2026-10-19) — la pieza `settled` del `customer` del seed es UNA
 * (`backend/prisma/seed-e2e.ts`, «Bóveda del cliente: un settled (retirable) y un pending»), y la
 * comparten dos casos `@real`:
 *
 *  - `shipments.spec.ts` «retirar» la CONSUME: `POST /shipments` deja un retiro `solicitado` (pago
 *    pendiente) y la pieza pasa a «EN RETIRO» (`shipmentState != null`, `withdrawable=false`). Nadie lo
 *    cancelaba ⇒ la pieza quedaba retenida para el resto de la corrida y para las siguientes.
 *  - `vault.spec.ts:15` necesita esa misma pieza con su enlace «Retirar» ⇒ rojo según el orden de los
 *    workers (y siempre rojo en la segunda corrida).
 *
 * El arreglo, en dos partes que van juntas:
 *  1. **El que consume, restaura**: el caso de retiro cancela SU retiro (el id que devolvió su propio
 *     `POST /shipments`) con `PATCH /admin/shipments/:id/status {to:'cancelado'}` (API_CONTRACT §5:
 *     `cancelado` libera el item ⇒ `shipmentState=null`; `TRANSITIONS.solicitado` admite `cancelado`;
 *     `409 PAID_SHIPMENT_NOT_CANCELLABLE` solo si el PI ya se cobró). Solo el suyo: ⛔ nunca barre
 *     retiros que no creó (el seed tiene retiros propios que miden otras pantallas).
 *  2. **Exclusión entre procesos** mientras dura el préstamo: los dos casos toman el mismo candado de
 *     fichero, así que `vault` nunca mira la pieza a mitad del retiro de `shipments`.
 * En MOCK no hay estado compartido (el «servidor» vive en el navegador de cada caso): sin candado.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
export async function withCustomerSettledHolding<T>(fn: () => Promise<T>): Promise<T> {
  if (!IS_REAL) return fn();
  return withFileLock(`customer:settled-holding:${await resolveApiBaseUrl()}`, fn, {
    // Cabe dentro del timeout de 120 s de un caso real (B-2, `playwright.config.ts`); el préstamo
    // dura lo que el caso de retiro (un cobro que se crea y se cancela).
    timeoutMs: 100_000,
    staleMs: 150_000,
  });
}

/** Cancela el retiro que creó el propio caso. Devuelve el status HTTP (2xx = liberado). */
export async function cancelOwnWithdrawal(shipmentId: string): Promise<number> {
  const res = await apiAs('admin', 'PATCH', `/admin/shipments/${encodeURIComponent(shipmentId)}/status`, {
    to: 'cancelado',
  });
  return res.status;
}
