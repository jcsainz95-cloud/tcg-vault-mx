import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MovementReason, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { runSerializable } from '../../common/serializable-retry';
import { AuditService } from '../audit/audit.service';
import { INVENTORY_PUBLISH_PORT, InventoryPublishPort } from '../inventory/inventory-publish.port';
import { SupplierAccessService } from './supplier-access.service';
import { adjustedUnitCents } from './supply.constants';
import { PayDto, ReceiveDto, VerifyDto, pageOf } from './supply.dto';
import { purchaseView } from './supply-views';

const INCLUDE = {
  units: true,
  supplier: { select: { id: true, businessName: true } },
  inventoryItems: { select: { id: true } },
} as const;

@Injectable()
export class SupplyPurchaseService {
  private readonly logger = new Logger(SupplyPurchaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: SupplierAccessService,
    @Optional() @Inject(INVENTORY_PUBLISH_PORT) private readonly publish?: InventoryPublishPort,
  ) {}

  private async view(id: string, audience: 'admin' | 'supplier') {
    const p = await this.prisma.supplyPurchase.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    const card = await this.prisma.card.findUniqueOrThrow({ where: { id: p.cardId }, include: { set: true } });
    return purchaseView(p, card, audience);
  }

  async getAdmin(id: string) {
    const exists = await this.prisma.supplyPurchase.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();
    return this.view(id, 'admin');
  }

  async listAdmin(q: { status?: string; supplierId?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip } = pageOf(q);
    const where: Prisma.SupplyPurchaseWhereInput = {};
    if (q.status && ['agreed', 'collected', 'verified', 'paid', 'cancelled'].includes(q.status)) where.status = q.status as 'agreed';
    if (q.supplierId) where.supplierId = q.supplierId;
    const [rows, total] = await Promise.all([
      this.prisma.supplyPurchase.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, select: { id: true } }),
      this.prisma.supplyPurchase.count({ where }),
    ]);
    return { data: await Promise.all(rows.map((r) => this.view(r.id, 'admin'))), page, pageSize, total };
  }

  private supplierIdOf(userId: string): Promise<string> {
    return this.access.supplierIdOfUser(userId);
  }

  async listSupplier(userId: string, q: { page?: string; pageSize?: string }) {
    const supplierId = await this.supplierIdOf(userId);
    const { page, pageSize, skip } = pageOf(q);
    const [rows, total] = await Promise.all([
      this.prisma.supplyPurchase.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, skip, take: pageSize, select: { id: true } }),
      this.prisma.supplyPurchase.count({ where: { supplierId } }),
    ]);
    return { data: await Promise.all(rows.map((r) => this.view(r.id, 'supplier'))), page, pageSize, total };
  }

  async getSupplier(userId: string, id: string) {
    const supplierId = await this.supplierIdOf(userId);
    const p = await this.prisma.supplyPurchase.findFirst({ where: { id, supplierId }, select: { id: true } });
    if (!p) throw BusinessException.notFound();
    return this.view(id, 'supplier');
  }

  /** Libera la cantidad reservada (y reabre la solicitud si quedó `filled`). `received` = piezas que SÍ quedaron. */
  private async release(tx: Prisma.TransactionClient, requestId: string, release: number, received: number) {
    if (release <= 0 && received <= 0) return;
    const now = new Date();
    await tx.$executeRaw`
      UPDATE "SupplyRequest"
      SET "qtyReserved" = "qtyReserved" - ${release},
          "qtyReceived" = "qtyReceived" + ${received},
          "status" = CASE WHEN "status" = 'filled'::"SupplyRequestStatus" AND "qtyReserved" - ${release} < "qtyWanted" AND "expiresAt" > ${now}
                          THEN 'open'::"SupplyRequestStatus" ELSE "status" END,
          "updatedAt" = ${now}
      WHERE "id" = ${requestId}`;
  }

  async receive(id: string, dto: ReceiveDto, key: string | undefined, actorId: string, actorRole: Role = Role.vault_operator) {
    const p = await this.prisma.supplyPurchase.findUnique({ where: { id } });
    if (!p) throw BusinessException.notFound();
    if (p.status !== 'agreed') {
      if (key && p.receiveKey === key) return this.view(id, 'admin');
      if (p.status === 'cancelled') throw new BusinessException('PURCHASE_EXPIRED', 410, 'Purchase expired');
      throw BusinessException.conflict('INVALID_STATE', `Purchase is ${p.status}`);
    }
    if (p.pickupDueAt.getTime() <= Date.now()) throw new BusinessException('PURCHASE_EXPIRED', 410, 'Pickup window expired');
    const ns = dto.units.map((u) => u.n);
    if (dto.units.length > p.qty || ns.some((n) => n > p.qty)) throw BusinessException.validation('UNITS_EXCEED_QTY', 'More units than agreed', { qty: p.qty });
    if (new Set(ns).size !== ns.length) throw BusinessException.badRequest('VALIDATION_ERROR', 'Duplicate unit numbers');
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.supplyPurchase.updateMany({
        where: { id, status: 'agreed', pickupDueAt: { gt: new Date() } },
        data: { status: 'collected', receivedAt: new Date(), receivedById: actorId, receiveKey: key ?? null },
      });
      if (c.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Purchase changed concurrently');
      if (dto.units.length) {
        await tx.supplyPurchaseUnit.createMany({ data: dto.units.map((u) => ({ purchaseId: id, n: u.n, condition: u.condition, note: u.note ?? null })) });
      }
    });
    await this.audit.log({ actorUserId: actorId, actorRole, action: 'supply.purchase.receive', entityType: 'SupplyPurchase', entityId: id, after: { units: dto.units.length } });
    return this.view(id, 'admin');
  }

  async verify(id: string, dto: VerifyDto, key: string | undefined, actorId: string, actorRole: Role = Role.vault_operator) {
    const p = await this.prisma.supplyPurchase.findUnique({ where: { id }, include: { units: true } });
    if (!p) throw BusinessException.notFound();
    if (p.status !== 'collected') {
      if (key && p.verifyKey === key) return this.view(id, 'admin');
      throw BusinessException.conflict('INVALID_STATE', `Purchase is ${p.status}`);
    }
    const byN = new Map(p.units.map((u) => [u.n, u]));
    const given = new Set(dto.units.map((u) => u.n));
    if (given.size !== dto.units.length || given.size !== byN.size || [...byN.keys()].some((n) => !given.has(n))) {
      throw BusinessException.validation('UNITS_MISMATCH', 'Verification must cover exactly the received units');
    }
    const plan = dto.units.map((v) => {
      const u = byN.get(v.n)!;
      if (v.result !== 'returned' && u.condition !== 'NM') throw BusinessException.validation('OK_NOT_NM', 'Only NM units can be accepted', { n: v.n });
      if (v.result === 'adjusted' && (v.adjustBps == null || v.adjustBps < 1 || v.adjustBps > 9999)) {
        throw BusinessException.validation('ADJUST_REQUIRED', 'adjustBps (1..9999) is required to adjust', { n: v.n });
      }
      const unitPayable = v.result === 'ok' ? p.agreedUnitCents : v.result === 'adjusted' ? adjustedUnitCents(p.agreedUnitCents, v.adjustBps!) : 0;
      // Un ajuste que dejaría la pieza en MX$0 no es un ajuste: se devuelve (`returned`). Piso > 0 centavos.
      if (v.result === 'adjusted' && unitPayable <= 0) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'adjustBps would pay MX$0 for the unit; use "returned"', { n: v.n });
      }
      return { unit: u, result: v.result, adjustBps: v.result === 'adjusted' ? v.adjustBps! : null, unitPayable, note: v.note ?? u.note };
    });
    const accepted = plan.filter((x) => x.result !== 'returned');
    const payable = plan.reduce((s, x) => s + x.unitPayable, 0);

    // Nada recibido o TODO devuelto: se cancela (con motivo), no se paga, no entra nada y se libera la reserva completa.
    if (accepted.length === 0) {
      const reason = plan.length === 0 ? 'none_received' : 'all_returned';
      await runSerializable(this.prisma, async (tx) => {
        const c = await tx.supplyPurchase.updateMany({
          where: { id, status: 'collected' },
          data: { status: 'cancelled', cancelReason: reason, payableCents: 0, verifiedAt: new Date(), verifiedById: actorId, verifyKey: key ?? null },
        });
        if (c.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Purchase changed concurrently');
        for (const x of plan) {
          await tx.supplyPurchaseUnit.update({ where: { id: x.unit.id }, data: { result: 'returned', adjustBps: null, unitPayableCents: 0, note: x.note } });
        }
        await this.release(tx, p.requestId, p.qty, 0);
      }, { label: 'supply-verify-none' });
      await this.audit.log({ actorUserId: actorId, actorRole, action: 'supply.purchase.verify', entityType: 'SupplyPurchase', entityId: id, after: { payableCents: 0, cancelled: reason } });
      return this.view(id, 'admin');
    }

    const folios = await this.prisma.nextFolios(accepted.length);
    const itemIds: string[] = [];
    await runSerializable(this.prisma, async (tx) => {
      itemIds.length = 0;
      const c = await tx.supplyPurchase.updateMany({
        where: { id, status: 'collected' },
        data: { status: 'verified', payableCents: payable, verifiedAt: new Date(), verifiedById: actorId, verifyKey: key ?? null },
      });
      if (c.count !== 1) throw BusinessException.conflict('INVALID_STATE', 'Purchase changed concurrently');
      let fi = 0;
      for (const x of plan) {
        let inventoryItemId: string | null = null;
        if (x.result !== 'returned') {
          const inv = await tx.inventoryItem.create({
            data: {
              folio: folios[fi++], cardId: p.cardId, productType: 'raw', rawCondition: 'NM', finish: p.finish,
              ownerType: 'platform', status: 'in_stock', acquisitionType: 'compra',
              // El costo es lo que se PAGA por la pieza (bruto = neto: sin factura, sin crédito de IVA que constar).
              acquisitionCostCents: x.unitPayable, acquisitionCostIvaCents: 0, supplyPurchaseId: id,
            },
          });
          await tx.inventoryMovement.create({
            data: { itemId: inv.id, toStatus: 'in_stock', reason: MovementReason.alta, actorUserId: actorId, note: `supply purchase ${id}` },
          });
          inventoryItemId = inv.id;
          itemIds.push(inv.id);
        }
        await tx.supplyPurchaseUnit.update({
          where: { id: x.unit.id },
          data: { result: x.result, adjustBps: x.adjustBps, unitPayableCents: x.unitPayable, note: x.note, inventoryItemId },
        });
      }
      // Lo no aceptado (devuelto o no entregado) reabre cantidad en la solicitud.
      await this.release(tx, p.requestId, p.qty - accepted.length, accepted.length);
    }, { label: 'supply-verify' });

    await this.audit.log({ actorUserId: actorId, actorRole, action: 'supply.purchase.verify', entityType: 'SupplyPurchase', entityId: id, after: { payableCents: payable, accepted: accepted.length } });
    await this.triggerPublish(itemIds);
    return this.view(id, 'admin');
  }

  /** Post-commit, best-effort (como el buylist): la pieza ya existe; si el puerto falla queda en pending-publish. */
  private async triggerPublish(ids: string[]) {
    if (!ids.length || !this.publish) return;
    try {
      await this.publish.reevaluateForPublication(ids);
    } catch (e) {
      this.logger.error(`supply verify: publish trigger failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async pay(id: string, dto: PayDto, key: string | undefined, actorId: string) {
    const p = await this.prisma.supplyPurchase.findUnique({ where: { id } });
    if (!p) throw BusinessException.notFound();
    const sameAs = (q: { method: string | null; reference: string | null; idempotencyKey: string | null }) =>
      (!!key && q.idempotencyKey === key) || (q.method === dto.method && (q.reference ?? null) === (dto.reference ?? null));
    if (p.status === 'paid') {
      if (sameAs(p)) return this.view(id, 'admin');
      throw BusinessException.conflict('ALREADY_PAID_DIFFERENT', 'Already paid with a different method or reference');
    }
    // Acuerdo todo devuelto / nada recibido: quedó `cancelled` con payable 0 ⇒ no hay nada que pagar (422, no 409).
    if (p.status === 'cancelled' && p.payableCents === 0) throw BusinessException.validation('NOTHING_TO_PAY', 'Nothing to pay');
    if (p.status !== 'verified') throw BusinessException.conflict('INVALID_STATE', `Purchase is ${p.status}`);
    if (!p.payableCents) throw BusinessException.validation('NOTHING_TO_PAY', 'Nothing to pay');
    try {
      const c = await this.prisma.supplyPurchase.updateMany({
        where: { id, status: 'verified' },
        data: { status: 'paid', method: dto.method, reference: dto.reference ?? null, paidAt: new Date(), paidById: actorId, idempotencyKey: key ?? null },
      });
      if (c.count !== 1) {
        const fresh = await this.prisma.supplyPurchase.findUnique({ where: { id } });
        if (fresh?.status === 'paid' && sameAs(fresh)) return this.view(id, 'admin');
        if (fresh?.status === 'paid') throw BusinessException.conflict('ALREADY_PAID_DIFFERENT', 'Already paid with a different method or reference');
        throw BusinessException.conflict('INVALID_STATE', 'Purchase changed concurrently');
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw BusinessException.conflict('INVALID_STATE', 'Idempotency-Key already used on another purchase');
      throw e;
    }
    await this.audit.log({ actorUserId: actorId, actorRole: Role.super_admin, action: 'supply.purchase.pay', entityType: 'SupplyPurchase', entityId: id, after: { method: dto.method, payableCents: p.payableCents } });
    return this.view(id, 'admin');
  }
}
