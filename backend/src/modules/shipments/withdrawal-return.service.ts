import { Injectable } from '@nestjs/common';
import { MovementReason, Role, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { isBuylistInbound } from './label-subject';
import { resolveOriginsBatch } from '../payments/refunds/origin';
import { SpendAlertsService } from '../spend-alerts/spend-alerts.service';

/**
 * §RETIRO-SALIDA (DECISIONES punto 3) — «Recibimos la devolución»: la devolución FÍSICA de un paquete de RETIRO vuelve sus
 * piezas a la bóveda (`withdrawn → in_custody`). Un hecho que confirma una persona al recibir el paquete (no se automatiza).
 *
 * AISLADO A PROPÓSITO (el dueño aún no confirma este punto): quitarlo = borrar este fichero, `withdrawal-return.controller.ts`,
 * sus dos líneas en `shipments.module.ts` y la columna `ShipmentRequest.returnedAt` (el valor de enum queda inerte).
 *
 * Guardas: candado de la fila primero; solo envíos de RETIRO (`orderId` nulo) en `enviado|entregado`; CAS con `returnedAt IS NULL`
 * en el `WHERE` (doble envío ⇒ una sola reversa); piezas solo `withdrawn`, del dueño del retiro y no `missing` (guarda en el
 * `WHERE`, movimiento solo con `count = 1`). El envío CONSERVA su `status` y queda con `returnedAt`; al ganar resuelve el AG-28 (`ag28:<id>`).
 */
@Injectable()
export class WithdrawalReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SpendAlertsService,
  ) {}

  async returnReceived(
    id: string,
    actor: { id: string; role: Role },
    note?: string,
    now: Date = new Date(),
  ): Promise<{ row: ShipmentRequest; restored: number; skipped: number; won: boolean }> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${id} FOR UPDATE`;
        const cur = await tx.shipmentRequest.findUnique({ where: { id } });
        if (!cur || isBuylistInbound(cur)) throw BusinessException.notFound();
        // Directo (con pedido) o fuera de `enviado|entregado`: su devolución es otro caso (reembolso/reposición).
        if (cur.orderId !== null || (cur.status !== 'enviado' && cur.status !== 'entregado')) {
          throw BusinessException.conflict('RETURN_NOT_APPLICABLE', 'Only vault withdrawals in enviado/entregado can be marked as returned', { status: cur.status });
        }
        if (cur.returnedAt !== null) return { row: cur, restored: 0, skipped: 0, won: false };
        const items = await tx.shipmentItem.findMany({
          where: { shipmentRequestId: id, prepStatus: { not: 'missing' } },
          select: { inventoryItemId: true },
        });
        // RS-4 💰: si el reembolso TOTAL del pedido de origen YA se cerró (`fullRefundClosedAt`/`refunded`; p. ej. con
        // `confirmPiecesWithCustomer`: el cliente cobró y SE QUEDA la carta), la pieza ⛔ vuelve a la bóveda (cobraría y conservaría la
        // carta). Coherente con B3: sin cierre, la pieza devuelta se recupera a plataforma si luego se reembolsa. El candado de `Order`
        // (id asc.) serializa con `onFullRefund`, que sella `fullRefundClosedAt` bajo ese mismo `FOR UPDATE`.
        // Orden de candados de `onFullRefund` (envíos → piezas → Order): piezas FOR UPDATE (id asc.) ANTES que `Order`, o se cruzan (deadlock medido 29/30).
        const pieceIds = [...new Set(items.map((i) => i.inventoryItemId))].sort();
        if (pieceIds.length > 0) await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ANY(${pieceIds}::text[]) ORDER BY id FOR UPDATE`;
        const origins = await resolveOriginsBatch(tx, cur.userId ?? '', items.map((i) => i.inventoryItemId));
        const originOrderIds = [...new Set([...origins.values()].flatMap((o) => (o ? [o.orderId] : [])))].sort();
        const closedOrders = new Set<string>();
        if (originOrderIds.length > 0) {
          const rows = await tx.$queryRaw<{ id: string; fullRefundClosedAt: Date | null; status: string }[]>`
            SELECT id, "fullRefundClosedAt", status::text AS status FROM "Order" WHERE id = ANY(${originOrderIds}::text[]) ORDER BY id FOR UPDATE`;
          for (const r of rows) if (r.fullRefundClosedAt !== null || r.status === 'refunded') closedOrders.add(r.id);
        }
        let restored = 0;
        for (const si of items) {
          const origin = origins.get(si.inventoryItemId) ?? null;
          if (origin && closedOrders.has(origin.orderId)) continue;
          const moved = await tx.inventoryItem.updateMany({
            where: { id: si.inventoryItemId, status: 'withdrawn', ownerType: 'customer', ownerUserId: cur.userId },
            data: { status: 'in_custody' },
          });
          if (moved.count !== 1) continue;
          restored += 1;
          await tx.inventoryMovement.create({
            data: {
              itemId: si.inventoryItemId,
              fromStatus: 'withdrawn',
              toStatus: 'in_custody',
              reason: MovementReason.withdrawal_return,
              note: `shipment ${id} return received${note ? `: ${note}` : ''}`,
            },
          });
        }
        // 0 restaurables y sin marca ⇒ nada que confirmar (la transacción se revierte: ni `returnedAt` ni bitácora).
        if (restored === 0) throw BusinessException.conflict('RETURN_NOTHING_TO_RESTORE', 'No piece of this withdrawal can be restored to custody');
        const claimed = await tx.shipmentRequest.updateMany({ where: { id, returnedAt: null }, data: { returnedAt: now } });
        if (claimed.count !== 1) throw BusinessException.conflict('CONFLICT', 'Shipment changed; reload and retry');
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'shipment.return_received',
            entityType: 'ShipmentRequest',
            entityId: id,
            after: { restored, skipped: items.length - restored, returnedAt: now.toISOString(), ...(note ? { note } : {}) },
          },
        });
        await this.alerts.resolve(tx, `ag28:${id}`, now);
        const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id } });
        return { row, restored, skipped: items.length - restored, won: true };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }
}
