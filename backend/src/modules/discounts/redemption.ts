/**
 * redemption.ts — 💰 el CICLO DEL USO de un código (API_CONTRACT §DSC.5), en funciones sobre la `tx` del llamador.
 *
 *  - Liberar: en la MISMA `tx` que pone la orden en `failed` (lo llama `failPendingOrder`, el único escritor de
 *    `pending → failed`: barrido, webhook `payment_failed|canceled`, sustitución y compensación del PI).
 *  - Consumir: en la `tx` del settle (`onPaymentSucceeded`, ramas bóveda y directo), tras ganar el CAS.
 *  - ⛔ No existe verbo que saque una fila de `consumed` [D5]: reembolsos y contracargo no tocan el uso (901).
 *
 * Tolerancia declarada (BACKEND_NOTES §83.gates.2, mismo patrón que `accessoryLines?.length ?? 0`): los dobles de las
 * suites unitarias que construyen la `tx` a mano no traen el delegado `discountRedemption`; sin él no hay fila que
 * tocar. Con Prisma real el delegado SIEMPRE existe (lo exige el tipo de los llamadores). Candado: DCO-B5 (integración).
 */
import { DiscountKind, Prisma } from '@prisma/client';

type RedemptionDb = Partial<Pick<Prisma.TransactionClient, 'discountRedemption'>>;

/**
 * TL-DSC-4 — EL lector de «¿esta orden lleva código, y cuál?»: su `DiscountRedemption` (un hecho, un sitio: `Order` no guarda
 * el código, §DSC.1). Lo usan el reuso (`sameCodeAsOrder`), el bloque `discount` de la sesión reusada y del congelado, los tres
 * detalles (`GET /orders/:id`, `POST /orders/guest/track`, `GET /admin/orders/:id`) y los correos. `null` ⇔ sin código.
 * ⛔ Ningún otro sitio consulta `discountRedemption` por `orderId` para responder esto.
 */
export async function orderCodeOf(db: RedemptionDb, orderId: string): Promise<{ code: string; kind: DiscountKind } | null> {
  if (!db.discountRedemption) return null;
  const r = await db.discountRedemption.findUnique({ where: { orderId }, select: { code: { select: { code: true, kind: true } } } });
  return r ? { code: r.code.code, kind: r.code.kind } : null;
}

/** §DSC.5 «Reuso» — el MISMO código normalizado o ninguno en los dos lados (una sola definición para cuenta e invitado). */
export async function sameCodeAsOrder(db: RedemptionDb, orderId: string, code: string | null): Promise<boolean> {
  return ((await orderCodeOf(db, orderId))?.code ?? null) === code;
}

/** `OrderDiscountDTO` (§DSC.6 «Dónde se ve el pedido», 914; v1.110.3 con `merchandiseBeforeDiscountCents`). */
export interface OrderDiscountDTO {
  code: string;
  kind: DiscountKind;
  /** `Order.subtotalCents + discountCents` (lo de antes del descuento; el front pinta esto, ⛔ sin sumar). */
  merchandiseBeforeDiscountCents: number;
  discountCents: number;
  shippingWaivedCents: number;
}

/**
 * El `discount` de una orden YA creada, de sus columnas congeladas (⛔ sin recalcular). `null` sin código (el campo se OMITE,
 * I-1). Lo mismo sirve a los tres detalles, a los correos y —con `outcome: 'applied'`— a la sesión reusada y al congelado.
 */
export async function orderDiscountOf(
  db: RedemptionDb,
  order: { id: string; subtotalCents: number; discountCents?: number; shippingWaivedCents?: number },
): Promise<OrderDiscountDTO | null> {
  const c = await orderCodeOf(db, order.id);
  if (!c) return null;
  const discountCents = order.discountCents ?? 0;
  return {
    code: c.code,
    kind: c.kind,
    merchandiseBeforeDiscountCents: order.subtotalCents + discountCents,
    discountCents,
    shippingWaivedCents: order.shippingWaivedCents ?? 0,
  };
}

/** `reserved → released` de la orden. Devuelve si había un uso apartado. */
export async function releaseOrderRedemption(tx: RedemptionDb, orderId: string, now = new Date()): Promise<boolean> {
  if (!tx.discountRedemption) return false;
  const { count } = await tx.discountRedemption.updateMany({
    where: { orderId, status: 'reserved' },
    data: { status: 'released', releasedAt: now },
  });
  return count === 1;
}

/**
 * `reserved | released → consumed` de la orden (§DSC.5). Si venía de `released` (pago tardío que sí liquida) ⇒
 * `lateConsumed = true`: el cobro ya se hizo con descuento y manda, aunque rebase el límite por uno.
 */
export async function consumeOrderRedemption(
  tx: RedemptionDb,
  orderId: string,
  now = new Date(),
): Promise<{ consumed: boolean; late: boolean; codeId: string | null }> {
  if (!tx.discountRedemption) return { consumed: false, late: false, codeId: null };
  const row = await tx.discountRedemption.findUnique({ where: { orderId }, select: { id: true, status: true, codeId: true } });
  if (!row || row.status === 'consumed') return { consumed: false, late: false, codeId: row?.codeId ?? null };
  const late = row.status === 'released';
  const { count } = await tx.discountRedemption.updateMany({
    where: { id: row.id, status: row.status },
    data: { status: 'consumed', consumedAt: now, ...(late ? { lateConsumed: true } : {}) },
  });
  return { consumed: count === 1, late: count === 1 && late, codeId: row.codeId };
}

/** La rebaja por unidad congelada de las piezas de una orden (`OrderItem.unitDiscountCents`), por `inventoryItemId`. */
export async function frozenPieceDiscountsOf(db: Pick<Prisma.TransactionClient, 'orderItem'>, orderId: string): Promise<Map<string, number>> {
  const rows = await db.orderItem.findMany({ where: { orderId }, select: { inventoryItemId: true, unitDiscountCents: true } });
  return new Map(rows.map((r) => [r.inventoryItemId, r.unitDiscountCents]));
}
