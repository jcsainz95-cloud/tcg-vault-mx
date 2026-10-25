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
import { Prisma } from '@prisma/client';

type RedemptionDb = Partial<Pick<Prisma.TransactionClient, 'discountRedemption'>>;

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
