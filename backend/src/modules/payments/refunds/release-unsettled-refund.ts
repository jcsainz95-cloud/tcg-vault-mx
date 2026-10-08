/**
 * 💰 v1.80.8.6 (M-62, API_CONTRACT §M4-SHIP.18.12 (3)/(5)) — CIERRA `SSL-R1`: las piezas que una orden NUNCA
 * liquidada tenía apartadas vuelven a la venta cuando esa orden se reembolsa entera. UN cuerpo; lo llaman SOLO
 * `onFullRefund` (las dos ramas de orden) y el barrido de reservas (`C-FULLREF-1`).
 *
 * **Precondición (la pone el llamador):** las piezas `reserved` por la orden ya están `FOR UPDATE` (id asc.,
 * {@link lockReservedOfOrder}) y DESPUÉS la fila `Order`, cuyo `status` se leyó bajo ese candado y es uno nunca
 * liquidado (`SETTLEABLE_ORDER_STATUSES` en `onFullRefund`; `refunded ∧ settledAt IS NULL` en el barrido).
 *
 * ⛔ **No `reservationGuard(orderId)`:** una pieza LEGADA (`reservedByOrderId = null`) puede estar apartada por OTRA
 * orden pendiente que también la tiene en sus líneas; soltarla le quitaría la carta a quien está pagando
 * (`orders.service.ts`, «soltar de más es peor que soltar de menos»). Las legadas siguen en su runbook (`RSV-L1`).
 * ⛔ El movimiento solo con `count === 1`: una reentrega del webhook (o el barrido detrás) no duplica historial.
 */
import { Prisma } from '@prisma/client';
import { releaseReservationData } from '../../orders/reservation';
import { releaseAccessoryReservations } from '../../orders/accessory-stock';

type Tx = Prisma.TransactionClient;

export type ReleaseUnsettledTrigger = 'm3' | 'charge_refunded' | 'unprepared' | 'reclaim' | 'sweep';

/**
 * Candado de las piezas `reserved` por la orden, id ascendente (el orden global: envíos → piezas → `Order`).
 * Devuelve los ids bloqueados (los que siguen `reserved` por ESA orden tras la re-evaluación de Postgres).
 */
export async function lockReservedOfOrder(tx: Tx, orderId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "InventoryItem"
     WHERE "reservedByOrderId" = ${orderId} AND status = 'reserved'
     ORDER BY id FOR UPDATE`;
  return rows.map((r) => r.id);
}

/** Lee (sin candado) los ids `reserved` por la orden — para unirlos al candado de piezas de la rama `vault`. */
export async function reservedIdsOfOrder(tx: Tx, orderId: string): Promise<string[]> {
  const rows = await tx.inventoryItem.findMany({
    where: { reservedByOrderId: orderId, status: 'reserved' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.id);
}

export async function releaseReservedOfUnsettledRefund(
  tx: Tx,
  orderId: string,
  trigger: ReleaseUnsettledTrigger,
  actorUserId: string | null,
  ctx: { lockedReservedIds: readonly string[]; orderNumber: string | null },
): Promise<string[]> {
  const released: string[] = [];
  for (const id of [...ctx.lockedReservedIds].sort()) {
    const r = await tx.inventoryItem.updateMany({
      where: { id, status: 'reserved', reservedByOrderId: orderId },
      data: releaseReservationData,
    });
    if (r.count !== 1) continue;
    const before = await tx.inventoryItem.findUniqueOrThrow({ where: { id }, select: { locationId: true } });
    await tx.inventoryMovement.create({
      data: {
        itemId: id,
        fromStatus: 'reserved',
        toStatus: 'listed',
        fromLocationId: before.locationId,
        toLocationId: before.locationId,
        reason: 'refund_release',
        actorUserId,
        note: `pedido ${ctx.orderNumber ?? orderId} reembolsado sin liquidar (${trigger})`,
      },
    });
    released.push(id);
  }
  // 💰 v1.86⟨accesorios⟩ (§AC.6 (2)/(5)): «pedido nunca liquidado ⇒ lo cubre (2)»: sus apartados de accesorio vuelven en
  // la MISMA tx (candado AC-B37). Idempotente: el `WHERE status = 'reserved'` del soltar.
  await releaseAccessoryReservations(tx, orderId);
  return released;
}
