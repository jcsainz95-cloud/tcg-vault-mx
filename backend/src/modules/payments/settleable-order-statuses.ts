import { OrderStatus } from '@prisma/client';

/**
 * ⭐⭐ API_CONTRACT §M4-VAULT.2-bis.2 (v1.80), ARCHITECTURE §4.21q (p) — `SEC-SETTLE-LATE`.
 *
 * **Lista CERRADA y POSITIVA de estados de origen desde los que un `payment_intent.succeeded` liquida
 * una orden.** La lee el early-return de `onPaymentSucceeded` (negada) y el CAS del settle en sus DOS
 * ramas (`vault` y `settleDirectShipOrder`). ⛔ Nunca dos listas: una sola constante, un solo predicado.
 *
 *  - `pending`: el camino normal.
 *  - `failed`: Stripe deja reintentar el cobro sobre el MISMO PaymentIntent tras un `payment_failed`;
 *    si llega `succeeded`, el dinero entró (prueba 38 (ii)).
 *  - ⛔ `settled`: reentrega (no-op). ⛔ `refunded`/`chargeback`: hechos POSTERIORES a un cobro ⇒ el
 *    `succeeded` es viejo; liquidar sería falso (no-op, `200`, `logger.warn`).
 *
 * Positiva a propósito: un valor NUEVO del enum queda, por omisión, **no liquidable** (el valor por
 * omisión en código de dinero es el que no mueve dinero), y el canario SL-6
 * (`test/payments.settle-late.spec.ts`) se pone rojo hasta que alguien lo decida.
 */
export const SETTLEABLE_ORDER_STATUSES = ['pending', 'failed'] as const satisfies readonly OrderStatus[];

/** ¿Un `succeeded` puede liquidar una orden en este estado? Negación exacta del early-return. */
export function isSettleableOrderStatus(status: OrderStatus): boolean {
  return (SETTLEABLE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}
