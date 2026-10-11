/**
 * 💰 v1.82 (API_CONTRACT §PNL.2, ARCHITECTURE §4.61.2) — reembolsar UNA carta de un pedido de envío directo YA ENTREGADO.
 *
 * Aquí viven las piezas PURAS (y la lectura de la línea entregada) que comparten el verbo
 * `POST /admin/orders/:id/items/:orderItemId/refund-delivered` (`OrderRefundService.refundDelivered`, con candados) y la
 * lectura `items[].deliveredRefund` de `GET /admin/orders/:id` (sin candados): **un cuerpo** para los pasos 3–4, así la
 * cifra que la pantalla muestra y la que el verbo exige (`expectedRefundCents`) no pueden divergir.
 *
 *  - Guardas, la PRIMERA que falle: `not_direct_ship` · `order_not_settled` · `legacy_convention` · `already_refunded`
 *    (cualquier fila del libro con ese `orderItemId`, en cualquier estado: una carta se reembolsa UNA vez,
 *    `PaymentRefund.orderItemId @unique`) · `not_delivered` (no hay línea `si` de un envío `entregado` de ESTA orden con
 *    esa pieza y `prepStatus ≠ missing`; con varias —reenvío— la del `deliveredAt` más reciente).
 *  - Importe `A = P + floor(F × P / G)` con las columnas PERSISTIDAS de la orden: `itemRefundComponents` (el cuerpo de
 *    `item_missing`, D-1 del dueño, `HECHOS.md:30`). Envío `0`.
 */
import { Order, PaymentRefund, Prisma, ShippedRefundReason } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { ACCEPTED_SHIPPED_REFUND_REASONS } from '../../common/business-rules';
import { MAX_CENTS, RefundComponents, ivaIsIncluded, itemRefundComponents } from '../../common/money';

/** Tope y piso de la nota OBLIGATORIA (tras `trim()`), §PNL.2. */
export const DELIVERED_REFUND_NOTE_MIN = 3;
export const DELIVERED_REFUND_NOTE_MAX = 500;

/** Los motivos por los que una carta entregada NO se reembolsa por esta vía (`409 ITEM_REFUND_NOT_AVAILABLE {reason}`). */
export type DeliveredRefundBlock = 'not_direct_ship' | 'order_not_settled' | 'legacy_convention' | 'not_delivered';

/** `items[].deliveredRefund` de M3 (§PNL.2): `null` ⇔ la línea ya tiene `refund` (que se pinta). */
export type DeliveredRefundView = { kind: 'refundable'; amountCents: number } | { kind: 'not_refundable'; reason: DeliveredRefundBlock } | null;

export interface ItemDeliveredBody {
  reason: ShippedRefundReason;
  note: string;
  expectedRefundCents: number;
}

/** La línea `si` que prueba la entrega: el envío de ESTA orden, `entregado`, con esa pieza y `prepStatus ≠ missing`. */
export interface DeliveredLine {
  id: string;
  shipmentRequestId: string;
  inventoryItemId: string;
}

type OrderMoney = Pick<
  Order,
  'fulfillmentMode' | 'status' | 'priceConvention' | 'subtotalCents' | 'shippingFeeCents' | 'processingFeeCents' | 'ivaCents' | 'ivaRatePct' | 'totalCents'
>;

export type DeliveredRefundDecision =
  | { kind: 'refundable'; components: RefundComponents; line: DeliveredLine }
  | { kind: 'blocked'; reason: DeliveredRefundBlock }
  | { kind: 'already_refunded'; refundId: string };

/**
 * Los pasos 3–4 de §PNL.2, sobre lo leído (el verbo lo lee BAJO candado; M3 sin candado). ⛔ No escribe.
 * `existing` = la fila del libro con ese `orderItemId` (cualquier estado) o `null`.
 */
export function deliveredRefundDecision(
  order: OrderMoney,
  orderItem: { unitPriceCents: number },
  existing: Pick<PaymentRefund, 'id'> | null,
  line: DeliveredLine | null,
): DeliveredRefundDecision {
  if (order.fulfillmentMode !== 'direct_ship') return { kind: 'blocked', reason: 'not_direct_ship' };
  if (order.status !== 'settled') return { kind: 'blocked', reason: 'order_not_settled' };
  if (!ivaIsIncluded(order.priceConvention)) return { kind: 'blocked', reason: 'legacy_convention' };
  if (existing) return { kind: 'already_refunded', refundId: existing.id };
  if (!line) return { kind: 'blocked', reason: 'not_delivered' };
  return { kind: 'refundable', components: itemRefundComponents(order, orderItem), line };
}

/** La proyección de M3: la fila del libro manda (`null`); si no, el mismo cuerpo que el verbo. */
export function deliveredRefundViewOf(
  order: OrderMoney,
  orderItem: { unitPriceCents: number },
  existing: Pick<PaymentRefund, 'id'> | null,
  line: DeliveredLine | null,
): DeliveredRefundView {
  if (existing) return null;
  const d = deliveredRefundDecision(order, orderItem, null, line);
  if (d.kind === 'refundable') return { kind: 'refundable', amountCents: d.components.amountCents };
  if (d.kind === 'blocked') return { kind: 'not_refundable', reason: d.reason };
  return null;
}

/**
 * Las líneas entregadas de UNA orden para varias piezas, en UNA consulta (⛔ sin N+1). Por pieza gana la del envío con
 * `deliveredAt` más reciente (reenvío); empate o `deliveredAt` nulo ⇒ la del envío pedido más tarde.
 */
export async function deliveredLinesOf(
  db: Pick<Prisma.TransactionClient, 'shipmentItem'>,
  orderId: string,
  inventoryItemIds: string[],
): Promise<Map<string, DeliveredLine>> {
  const out = new Map<string, DeliveredLine>();
  if (inventoryItemIds.length === 0) return out;
  const rows = await db.shipmentItem.findMany({
    where: {
      inventoryItemId: { in: [...new Set(inventoryItemIds)] },
      prepStatus: { not: 'missing' },
      shipmentRequest: { orderId, status: 'entregado' },
    },
    select: { id: true, shipmentRequestId: true, inventoryItemId: true, shipmentRequest: { select: { deliveredAt: true, requestedAt: true } } },
  });
  type Row = (typeof rows)[number];
  const newer = (a: Row, b: Row) => {
    const [a1, b1] = [a.shipmentRequest.deliveredAt?.getTime() ?? -1, b.shipmentRequest.deliveredAt?.getTime() ?? -1];
    if (a1 !== b1) return a1 > b1;
    return a.shipmentRequest.requestedAt.getTime() > b.shipmentRequest.requestedAt.getTime();
  };
  const best = new Map<string, Row>();
  for (const r of rows) {
    const cur = best.get(r.inventoryItemId);
    if (!cur || newer(r, cur)) best.set(r.inventoryItemId, r);
  }
  for (const [pieceId, r] of best) out.set(pieceId, { id: r.id, shipmentRequestId: r.shipmentRequestId, inventoryItemId: r.inventoryItemId });
  return out;
}

/**
 * Validación del cuerpo (paso 1) ANTES de leer nada ⇒ `400 VALIDATION_ERROR {field}` (y `allowed` para `reason`).
 * Cuerpo crudo: las llaves extra se IGNORAN (⛔ un `amountCents` que llegue no se lee — el importe lo calcula el servidor).
 */
export function parseItemDeliveredBody(body: unknown): ItemDeliveredBody {
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (typeof raw.reason !== 'string' || !(ACCEPTED_SHIPPED_REFUND_REASONS as readonly string[]).includes(raw.reason)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid reason', { field: 'reason', allowed: [...ACCEPTED_SHIPPED_REFUND_REASONS] });
  }
  if (typeof raw.note !== 'string') {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'note is required', { field: 'note', min: DELIVERED_REFUND_NOTE_MIN, max: DELIVERED_REFUND_NOTE_MAX });
  }
  const note = raw.note.trim();
  if (note.length < DELIVERED_REFUND_NOTE_MIN || note.length > DELIVERED_REFUND_NOTE_MAX) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `note must be ${DELIVERED_REFUND_NOTE_MIN}–${DELIVERED_REFUND_NOTE_MAX} characters`, {
      field: 'note',
      min: DELIVERED_REFUND_NOTE_MIN,
      max: DELIVERED_REFUND_NOTE_MAX,
    });
  }
  const e = raw.expectedRefundCents;
  if (typeof e !== 'number' || !Number.isInteger(e) || e < 1 || e > MAX_CENTS) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'expectedRefundCents must be a positive integer', { field: 'expectedRefundCents' });
  }
  return { reason: raw.reason as ShippedRefundReason, note, expectedRefundCents: e };
}
