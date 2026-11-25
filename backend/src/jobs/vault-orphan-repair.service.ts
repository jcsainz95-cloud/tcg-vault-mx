import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isSchedulerDisabled } from '../config/test-env';
import { SettleReconciliationService } from '../modules/payments/settle-reconciliation.service';
import { SettleLineContext, SettleRecord, anomaliesOf, releaseSupersededLeftovers, settleLineOrReplace } from '../modules/payments/settle-line';
import { UnassignedLine, findUnassignedLines } from '../modules/payments/vault-orphans';

/**
 * VaultOrphanRepairService — §BOVEDA-COBRADA-SIN-PIEZAS punto 3. Repara lo ya ocurrido y vigila lo nuevo: pedidos liquidados
 * (`vault` y `direct_ship`) con piezas que NO están donde el comprador las espera (la invariante, `vault-orphans.ts`).
 *
 * Aplica la MISMA función que la liquidación (`settleLineOrReplace`, ⛔ no un segundo cuerpo): pieza libre ⇒ se asigna; reservada
 * por otra orden del mismo usuario ⇒ se transfiere; no disponible ⇒ copia equivalente; sin copia ⇒ «requiere atención».
 *  - ⛔ NUNCA mueve dinero: reasigna y repone piezas; el reembolso de una línea lo decide el dueño.
 *  - Idempotente: una segunda corrida no cambia nada (lo ya resuelto sale de la consulta; lo «requiere atención» no se re-audita).
 *  - Auditada: guarda el estado ANTES (`vault.orphan_scan`) y cada cambio (`vault.orphan_repaired|replaced|attention`), más el
 *    resumen `vault.orphan_repair_run` (`reparadas`, `paraDecidir`, `total`).
 *  - Corre una vez al desplegar (marcador `vault.orphan_repair_run` con `trigger:'deploy'`) y a diario (`vault-orphan-repair`).
 *    La reposición por COPIA aplica a los pedidos anteriores al despliegue SOLO en la corrida de despliegue y para las líneas que ya
 *    estaban «requiere atención» (el dueño consiguió la carta); lo nuevo, siempre.
 */
export const VAULT_ORPHAN_REPAIR_RUN = 'vault.orphan_repair_run';

export type RepairTrigger = 'deploy' | 'daily' | 'manual';

export interface RepairReport {
  trigger: RepairTrigger;
  /** Líneas sin asignar al empezar. */
  total: number;
  /** Pedidos con al menos una de ellas. */
  orders: number;
  /** Líneas que quedaron respaldadas por pieza (asignadas, transferidas o repuestas) en esta corrida. */
  repaired: number;
  replaced: number;
  /** Líneas que siguen «requiere atención» (decisión del dueño). */
  forDecision: number;
  /** PaymentIntents de órdenes `failed` cancelados / que no se pudieron cerrar. */
  canceledPis: number;
  keptPis: number;
}

@Injectable()
export class VaultOrphanRepairService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VaultOrphanRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly reconcile?: SettleReconciliationService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (isSchedulerDisabled()) return;
    // Pruebas/integración: `VAULT_ORPHAN_REPAIR_BOOT=off` (como `CARD_LINK_REPAIR_BOOT`); en producción la variable no existe ⇒ corre.
    if (process.env.VAULT_ORPHAN_REPAIR_BOOT === 'off') return;
    try {
      const done = await this.prisma.auditLog.findFirst({
        where: { action: VAULT_ORPHAN_REPAIR_RUN, after: { path: ['trigger'], equals: 'deploy' } },
        select: { id: true },
      });
      if (done) return;
      // Fuera del camino del arranque: el servidor no espera a la reparación para aceptar tráfico.
      setTimeout(() => {
        this.run('deploy').catch((e: unknown) => this.logger.error(`vault-orphan-repair(deploy): ${(e as Error).message}`));
      }, 5_000).unref();
    } catch (e) {
      this.logger.error(`vault-orphan-repair: no se pudo comprobar el marcador de despliegue (${(e as Error).message}).`);
    }
  }

  /** `run()` sin argumentos = la corrida diaria del scheduler. */
  async run(trigger: RepairTrigger = 'daily', now = new Date(), opts: { onlyOrderIds?: string[] } = {}): Promise<RepairReport> {
    const report: RepairReport = { trigger, total: 0, orders: 0, repaired: 0, replaced: 0, forDecision: 0, canceledPis: 0, keptPis: 0 };
    const deployRun = await this.prisma.auditLog.findFirst({
      where: { action: VAULT_ORPHAN_REPAIR_RUN, after: { path: ['trigger'], equals: 'deploy' } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    const deployedAt = deployRun?.createdAt ?? null;

    const lines = await findUnassignedLines(this.prisma, opts.onlyOrderIds ? { orderIds: opts.onlyOrderIds } : {});
    report.total = lines.length;
    const byOrder = new Map<string, UnassignedLine[]>();
    for (const l of lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);
    report.orders = byOrder.size;

    for (const [orderId, orderLines] of byOrder) {
      try {
        const r = await this.repairOrder(orderId, orderLines, { trigger, now, deployedAt });
        report.repaired += r.repaired;
        report.replaced += r.replaced;
      } catch (e) {
        this.logger.error(`vault-orphan-repair: el pedido ${orderId} no se pudo reparar (${(e as Error).message}); se reintenta en la próxima corrida.`);
      }
    }
    // Lo que sigue sin pieza (decisión del dueño) tras la corrida.
    report.forDecision = (await findUnassignedLines(this.prisma, opts.onlyOrderIds ? { orderIds: opts.onlyOrderIds } : {})).filter((l) => l.fulfillmentFailedAt !== null).length;

    // PIs huérfanos de órdenes `failed` (R2 / sustitución cuyo cancel falló): se reintenta su cierre.
    if (this.reconcile) {
      const failed = await this.prisma.order.findMany({
        where: { status: 'failed', stripePaymentIntentId: { not: null }, createdAt: { gt: new Date(now.getTime() - 7 * 86_400_000) } },
        select: { id: true },
        take: 100,
        orderBy: { createdAt: 'desc' },
      });
      for (const o of failed) {
        const res = await this.reconcile.cancelPaymentIntentOf(o.id).catch(() => 'kept' as const);
        if (res === 'canceled') report.canceledPis += 1;
        if (res === 'kept') report.keptPis += 1;
      }
    }

    await this.prisma.auditLog.create({
      data: {
        actorUserId: null,
        actorRole: null,
        action: VAULT_ORPHAN_REPAIR_RUN,
        entityType: 'Order',
        entityId: 'vault-orphan-repair',
        after: { ...report, reparadas: report.repaired, paraDecidir: report.forDecision } as unknown as Prisma.InputJsonValue,
      },
    });
    this.logger.log(
      `vault-orphan-repair(${trigger}): ${report.total} líneas sin asignar en ${report.orders} pedidos; reparadas ${report.repaired} ` +
        `(${report.replaced} repuestas), para decidir ${report.forDecision}.`,
    );
    return report;
  }

  private async repairOrder(
    orderId: string,
    scanned: UnassignedLine[],
    opts: { trigger: RepairTrigger; now: Date; deployedAt: Date | null },
  ): Promise<{ repaired: number; replaced: number }> {
    const first = scanned[0];
    // Antes de tocar nada se guarda el estado de cada pieza (lo que ya estaba «requiere atención» y sigue igual no se re-escanea).
    const fresh = scanned.filter((l) => l.fulfillmentFailedAt === null);
    if (fresh.length > 0) {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'vault.orphan_scan',
          entityType: 'Order',
          entityId: orderId,
          after: {
            trigger: opts.trigger,
            mode: first.fulfillmentMode,
            lines: fresh.map((l) => ({ orderItemId: l.orderItemId, inventoryItemId: l.inventoryItemId, folio: l.folio, status: l.itemStatus })),
          },
        },
      });
    }

    let supersededOrderIds: string[] = [];
    const records: SettleRecord[] = [];
    let repaired = 0;
    let replaced = 0;
    await this.txRetry(async (tx) => {
      records.length = 0;
      repaired = 0;
      replaced = 0;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, userId: true, orderNumber: true, status: true, fulfillmentMode: true, settledAt: true },
      });
      if (!order || order.status !== 'settled') return;
      // Se relee DENTRO de la tx (una liquidación concurrente pudo arreglar la línea entre el escaneo y aquí).
      const current = await findUnassignedLines(tx, { orderIds: [orderId] });
      const ctx: SettleLineContext = {
        tx,
        order: { id: order.id, userId: order.userId, orderNumber: order.orderNumber },
        mode: order.fulfillmentMode,
        now: opts.now,
        allowReplace: true,
        source: 'repair',
        failedHere: new Set<string>(),
      };
      const assigned: { orderItemId: string; inventoryItemId: string }[] = [];
      const writes: { action: string; after: Record<string, unknown> }[] = [];
      for (const l of current) {
        // Reposición por copia: en el despliegue, para pedidos posteriores a él, y para lo que el dueño ya tenía en su lista.
        ctx.allowReplace =
          opts.trigger === 'deploy' || l.fulfillmentFailedAt !== null || (opts.deployedAt !== null && order.settledAt !== null && order.settledAt >= opts.deployedAt);
        const res = await settleLineOrReplace(ctx, { id: l.orderItemId, inventoryItemId: l.inventoryItemId, fulfillmentFailedAt: l.fulfillmentFailedAt });
        records.push({ orderItemId: l.orderItemId, inventoryItemId: res.inventoryItemId, outcome: res.outcome });
        if (res.outcome.kind === 'skipped') continue;
        if (res.outcome.kind !== 'attention') {
          assigned.push({ orderItemId: l.orderItemId, inventoryItemId: res.inventoryItemId });
          repaired += 1;
          if (res.outcome.kind === 'replaced') {
            replaced += 1;
            writes.push({ action: 'vault.orphan_replaced', after: { orderItemId: l.orderItemId, was: l.itemStatus, originalInventoryItemId: l.inventoryItemId, copyInventoryItemId: res.inventoryItemId, trigger: opts.trigger } });
          } else {
            writes.push({ action: 'vault.orphan_repaired', after: { orderItemId: l.orderItemId, inventoryItemId: l.inventoryItemId, was: l.itemStatus, outcome: res.outcome.kind, trigger: opts.trigger } });
          }
        } else if (res.changed !== false) {
          writes.push({ action: 'vault.orphan_attention', after: { orderItemId: l.orderItemId, inventoryItemId: l.inventoryItemId, was: l.itemStatus, reason: res.outcome.reason, trigger: opts.trigger } });
        }
      }
      await releaseSupersededLeftovers(tx, ctx.failedHere);
      supersededOrderIds = [...ctx.failedHere];
      for (const w of writes) {
        await tx.auditLog.create({ data: { actorUserId: null, actorRole: null, action: w.action, entityType: 'Order', entityId: orderId, after: w.after as Prisma.InputJsonValue } });
      }
      const anomalies = anomaliesOf(records.filter((r) => r.outcome.kind !== 'attention' || writes.some((w) => w.action === 'vault.orphan_attention' && w.after.orderItemId === r.orderItemId)));
      if (anomalies.length > 0) {
        await tx.auditLog.create({ data: { actorUserId: null, actorRole: null, action: 'order.settle_item_not_reserved', entityType: 'Order', entityId: orderId, after: { anomalies, source: 'repair' } } });
      }
      await this.syncFulfillmentRows(tx, order, assigned, records.filter((r) => r.outcome.kind === 'attention').map((r) => r.orderItemId));
    });
    if (supersededOrderIds.length > 0 && this.reconcile) {
      await this.reconcile.afterSettle({ orderId, orderNumber: first.orderNumber, records, supersededOrderIds });
    }
    return { repaired, replaced };
  }

  /** La colocación de bóveda / el envío de ESTE pedido reflejan las piezas que ahora respaldan cada línea asignada. */
  private async syncFulfillmentRows(
    tx: Prisma.TransactionClient,
    order: { id: string; fulfillmentMode: 'vault' | 'direct_ship'; settledAt: Date | null },
    assigned: { orderItemId: string; inventoryItemId: string }[],
    attention: string[] = [],
  ): Promise<void> {
    if (order.fulfillmentMode === 'vault' && attention.length > 0) {
      // Una línea «requiere atención» ⇒ no hay pieza que colocar: sale de «Para bóveda» (solo si nadie la ha marcado ni tiene caso).
      await tx.vaultPlacementItem.deleteMany({ where: { orderItemId: { in: attention }, prepStatus: 'pending', replacementCase: null } });
      const placement = await tx.vaultPlacement.findUnique({ where: { orderId: order.id }, select: { id: true, status: true, preparedAt: true, _count: { select: { items: true } } } });
      if (placement && placement._count.items === 0 && placement.status === 'pending' && placement.preparedAt === null) {
        await tx.vaultPlacement.delete({ where: { id: placement.id } });
      }
    }
    if (assigned.length === 0) return;
    if (order.fulfillmentMode === 'vault') {
      await tx.vaultPlacement.createMany({ data: [{ orderId: order.id, createdAt: order.settledAt ?? new Date() }], skipDuplicates: true });
      const { id: placementId } = await tx.vaultPlacement.findUniqueOrThrow({ where: { orderId: order.id }, select: { id: true } });
      await tx.vaultPlacementItem.createMany({
        data: assigned.map((a) => ({ placementId, orderItemId: a.orderItemId, inventoryItemId: a.inventoryItemId })),
        skipDuplicates: true,
      });
      for (const a of assigned) {
        await tx.vaultPlacementItem.updateMany({ where: { orderItemId: a.orderItemId }, data: { inventoryItemId: a.inventoryItemId } });
      }
      return;
    }
    const shipment = await tx.shipmentRequest.findFirst({ where: { orderId: order.id, status: { not: 'cancelado' } }, select: { id: true } });
    if (!shipment) return;
    for (const a of assigned) {
      const has = await tx.shipmentItem.count({ where: { shipmentRequestId: shipment.id, inventoryItemId: a.inventoryItemId } });
      if (has === 0) await tx.shipmentItem.create({ data: { shipmentRequestId: shipment.id, inventoryItemId: a.inventoryItemId } });
    }
  }

  private async txRetry<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        const retriable = (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || e.code === 'P2028')) || /deadlock detected|could not serialize|40P01|40001/i.test(msg);
        if (!retriable || attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 60) * (attempt + 1)));
      }
    }
  }
}
