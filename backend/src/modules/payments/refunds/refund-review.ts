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
import { Prisma, ShipmentStatus, ShippedRefundReason } from '@prisma/client';

/**
 * 💰 v1.80.8.6 (§M4-SHIP.18.12 (1)) — estados de un envío propio que cuentan como «ya salió». UNA sola fuente para los
 * tres lectores (techlead C-1, 2026-10-04): M3 tx1 (decide si pide `shippedReason`), `onFullRefund` (rama directo:
 * congela `fullRefundAfterShipment` y exige el motivo como invariante; bóveda: la clase `already_withdrawn`) y el
 * detalle de M3 (`shipmentShipped`). Si M3 y
 * `onFullRefund` leyeran listas distintas, o M3 dejaría de pedir el motivo (orden «por revisar» sin marca) o la
 * invariante de `onFullRefund` lanzaría (500). ⛔ Ninguna otra lista ni literal `'enviado' || 'entregado'` en ellos.
 */
export const SHIPPED_OUT_STATUSES = ['enviado', 'entregado'] as const satisfies readonly ShipmentStatus[];
export type ShippedOutStatus = (typeof SHIPPED_OUT_STATUSES)[number];

export function isShippedOut(status: string): status is ShippedOutStatus {
  return (SHIPPED_OUT_STATUSES as readonly string[]).includes(status);
}

/** Un envío bloqueado y su `status` leído BAJO el candado. */
export interface LockedShipment {
  id: string;
  status: string;
}

/**
 * 💰 v1.80.8.6 (§M4-SHIP.18.12 (2)/(4)) — «bloquear los envíos de la orden y leer su estado»: TODOS los `ShipmentRequest`
 * de la orden (cualquier estado) salvo `exceptIds`, `FOR UPDATE` id asc., y su `status` leído DESPUÉS del candado (⛔ la
 * lectura previa no decide: un `→enviado` que confirma entre ella y el `FOR UPDATE` se perdería — SRF-9/SRF-10).
 * Lo usan M3 tx1 y `onFullRefund` (pasos (1) y (4-bis), este con `exceptIds` = los ya bloqueados). Un solo cuerpo.
 */
export async function lockShipmentsOfOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  exceptIds: readonly string[] = [],
): Promise<LockedShipment[]> {
  const rows = await tx.shipmentRequest.findMany({
    where: { orderId, ...(exceptIds.length > 0 ? { id: { notIn: [...exceptIds] } } : {}) },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  return tx.$queryRaw<LockedShipment[]>`
    SELECT id, status::text AS status FROM "ShipmentRequest" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
}

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
