/**
 * 💰 v1.80.8.6 (M-62, API_CONTRACT §M4-SHIP.18.12 (1)/(7)) — «REEMBOLSO POR REVISAR»: un predicado DERIVADO, una sola
 * redacción en sus dos formas (función y `where` de Prisma). ⛔ No es un `OrderStatus` ni una tabla.
 *
 *   por revisar ⇔ `fullRefundAfterShipment = true ∧ shippedRefundReason IS NULL`
 *
 * Lo leen: el listado de M3 (`refundReviewPending` por fila y `?refundReview=pending`), el detalle
 * (`FullRefundReviewDTO.pending`) y el tablero (`workQueue.refundReviews`). La paridad función ↔ `where` la vigila
 * `test/refund-review.spec.ts` sobre las cuatro combinaciones.
 */
import { Prisma, ShippedRefundReason } from '@prisma/client';

export interface RefundReviewColumns {
  fullRefundAfterShipment: boolean;
  shippedRefundReason: ShippedRefundReason | null;
}

export function isRefundReviewPending(order: RefundReviewColumns): boolean {
  return order.fullRefundAfterShipment === true && order.shippedRefundReason === null;
}

export const REFUND_REVIEW_PENDING_WHERE = {
  fullRefundAfterShipment: true,
  shippedRefundReason: null,
} as const satisfies Prisma.OrderWhereInput;

/** §M4-SHIP.18.12 (7) — en `GET /admin/orders/:id`; `null` si la orden no se cerró por reembolso total. */
export interface FullRefundReviewDTO {
  afterShipment: boolean;
  pending: boolean;
  reason: ShippedRefundReason | null;
  note: string | null;
  recordedAt: string | null;
  recordedBy: { id: string; name: string | null } | null;
}

/** Las columnas que la proyección necesita (las mismas que el `select` de quien la llama). */
export const FULL_REFUND_REVIEW_SELECT = {
  fullRefundClosedAt: true,
  fullRefundAfterShipment: true,
  shippedRefundReason: true,
  shippedRefundNote: true,
  shippedRefundReasonAt: true,
  shippedRefundReasonBy: { select: { id: true, name: true } },
} as const satisfies Prisma.OrderSelect;

export function toFullRefundReviewDTO(order: {
  fullRefundClosedAt: Date | null;
  fullRefundAfterShipment: boolean;
  shippedRefundReason: ShippedRefundReason | null;
  shippedRefundNote: string | null;
  shippedRefundReasonAt: Date | null;
  shippedRefundReasonBy: { id: string; name: string | null } | null;
}): FullRefundReviewDTO | null {
  if (order.fullRefundClosedAt === null) return null;
  return {
    afterShipment: order.fullRefundAfterShipment,
    pending: isRefundReviewPending(order),
    reason: order.shippedRefundReason,
    note: order.shippedRefundNote,
    recordedAt: order.shippedRefundReasonAt ? order.shippedRefundReasonAt.toISOString() : null,
    recordedBy: order.shippedRefundReasonBy ? { id: order.shippedRefundReasonBy.id, name: order.shippedRefundReasonBy.name ?? null } : null,
  };
}
