import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { findUnassignedLines } from './vault-orphans';

/**
 * §BOVEDA-COBRADA-SIN-PIEZAS punto 3 — `GET /admin/vault-orphans` (staff): lo que la reparación no pudo resolver y lo que decidir.
 * Solo LECTURA. ⛔ Sin datos personales del comprador ni de terceros: ids, folios, estados y motivos. El monto de la línea
 * (`amountCents`) solo viaja al súper-admin (es dinero; el operador recibe `null`, como el resto de cifras del back-office).
 */
@Controller('admin/vault-orphans')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminVaultOrphansController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser('role') role: Role) {
    const lines = await findUnassignedLines(this.prisma);
    const orders = new Map<string, { orderId: string; orderNumber: string | null; fulfillmentMode: string; settledAt: string | null; lines: unknown[] }>();
    for (const l of lines) {
      const o = orders.get(l.orderId) ?? { orderId: l.orderId, orderNumber: l.orderNumber, fulfillmentMode: l.fulfillmentMode, settledAt: l.settledAt ? l.settledAt.toISOString() : null, lines: [] };
      o.lines.push({
        orderItemId: l.orderItemId,
        inventoryItemId: l.inventoryItemId,
        folio: l.folio,
        itemStatus: l.itemStatus,
        state: l.fulfillmentFailedAt ? 'needs_attention' : 'unassigned',
        reason: l.fulfillmentFailedReason,
        fulfillmentFailedAt: l.fulfillmentFailedAt ? l.fulfillmentFailedAt.toISOString() : null,
        amountCents: role === Role.super_admin ? l.unitPriceCents : null,
      });
      orders.set(l.orderId, o);
    }
    const last = await this.prisma.auditLog.findFirst({
      where: { action: 'vault.orphan_repair_run' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, after: true },
    });
    return {
      summary: {
        orders: orders.size,
        lines: lines.length,
        needsAttention: lines.filter((l) => l.fulfillmentFailedAt !== null).length,
      },
      lastRun: last ? { at: last.createdAt.toISOString(), ...(last.after as Record<string, unknown>) } : null,
      data: [...orders.values()],
    };
  }
}
