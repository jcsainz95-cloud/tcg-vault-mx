import { Injectable } from '@nestjs/common';
import { MovementReason, Role, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { isBuylistInbound } from './label-subject';
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
        let restored = 0;
        for (const si of items) {
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
