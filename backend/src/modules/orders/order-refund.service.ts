/**
 * §M3 (v1.80 → v1.80.6) — EL REEMBOLSO TOTAL DE M3 y el reclamo a mano de una compra a bóveda.
 *
 * `POST /admin/orders/:id/refund` (`super_admin`, `@MoneyOut`) — «reembolsa LO QUE QUEDA»:
 *  tx1 (la que CREA la fila): candados envíos de la orden (`FOR UPDATE`, id asc.) → [bóveda: retiros vivos de
 *  sus cartas vigentes → piezas] → `Order FOR UPDATE` → libro. `remaining = totalCents − Σ no fallidas`;
 *  `≤ 0` ⇒ `409 CONFLICT`. Bóveda, SOLO aquí: `409 VAULT_PIECE_IN_PACKED_WITHDRAWAL` (una carta en una caja)
 *  y `422 REFUND_CONFIRMATION_REQUIRED` (una carta ya con el cliente sin `confirmPiecesWithCustomer:true`).
 *  Fila `order_full` (`order-full:<orderId>`, ÚNICA). Directo: `onFullRefund` cierra el envío vivo EN ESTA tx
 *  (§M4-SHIP.17.2). Bóveda: el cierre corre al CONFIRMAR (`executeRefund`, §M4-SHIP.18.3), ⛔ no aquí.
 *  Post-commit: `executeRefund` (Stripe con `amount = remaining` y esa llave).
 *
 * `POST /admin/orders/:id/reclaim-vault` (`super_admin`, custodia, ⛔ no dinero, auditado) — §M4-SHIP.18.10.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { orderFullRefundComponents } from '../../common/money';
import { FullRefundService, VaultPieceState } from '../payments/refunds/full-refund.service';
import { NON_FAILED, PaymentRefundDTO, RefundLedgerService } from '../payments/refunds/refund-ledger.service';

export interface VaultPieceDTO {
  orderItemId: string;
  inventoryItemId: string;
  folio: string;
  cardName: string;
  state: VaultPieceState;
  pendingConfirmation: boolean;
}

export interface ReclaimVaultResponse {
  orderId: string;
  reclaimed: string[];
  untouched: { inventoryItemId: string; state: VaultPieceState }[];
  chargebackNeedsManual: boolean;
  vaultPieces: VaultPieceDTO[];
}

@Injectable()
export class OrderRefundService {
  private readonly logger = new Logger(OrderRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: RefundLedgerService,
    private readonly fullRefund: FullRefundService,
  ) {}

  /** `vaultPieces` del detalle M3 (§M4-SHIP.18.6), derivado en la lectura. */
  async vaultPieces(orderId: string): Promise<VaultPieceDTO[]> {
    const res = await this.fullRefund.classifyVaultPieces(this.prisma as unknown as Prisma.TransactionClient, orderId);
    return res.pieces.map((p) => ({
      orderItemId: p.orderItemId,
      inventoryItemId: p.inventoryItemId,
      folio: p.folio,
      cardName: p.cardName,
      state: p.state,
      pendingConfirmation: p.pendingConfirmation,
    }));
  }

  async requestFullRefund(
    orderId: string,
    dto: { reason: string; confirmPiecesWithCustomer?: boolean },
    actor: { id: string; role: Role },
  ): Promise<{ orderId: string; status: string; refundId: string | null; refund: PaymentRefundDTO }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw BusinessException.notFound();
    if (!order.stripePaymentIntentId) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Order has no payment intent');
    }
    if (order.status !== 'settled') {
      throw BusinessException.validation('VALIDATION_ERROR', 'Only a settled order can be refunded', { status: order.status });
    }
    const row = await this.prisma.$transaction(
      async (tx) => {
        // Candados: envíos de la orden (directo) / retiros vivos + piezas (bóveda) → Order → libro.
        const shipments = await tx.shipmentRequest.findMany({
          where: { orderId, status: { in: ['picking', 'guia'] } },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        if (shipments.length > 0) {
          const ids = shipments.map((s) => s.id);
          await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
        }
        let vaultPreview: Awaited<ReturnType<FullRefundService['classifyVaultPieces']>> | null = null;
        if (order.fulfillmentMode === 'vault') {
          // Retiros vivos que contienen cartas vigentes de la compra, FOR UPDATE (id asc.), luego piezas.
          const live = await tx.shipmentItem.findMany({
            where: {
              inventoryItem: { orderItems: { some: { orderId } } },
              shipmentRequest: { status: { in: ['solicitado', 'picking', 'guia'] } },
            },
            select: { shipmentRequestId: true },
          });
          const wids = [...new Set(live.map((l) => l.shipmentRequestId))].sort();
          if (wids.length > 0) {
            await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ANY(${wids}::text[]) ORDER BY id FOR UPDATE`;
          }
          vaultPreview = await this.fullRefund.classifyVaultPieces(tx, orderId, { forUpdate: true });
        }
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
        if (locked.status !== 'settled') {
          throw BusinessException.conflict('CONFLICT', 'Order is no longer settled', { status: locked.status });
        }
        const nonFailed = await tx.paymentRefund.findMany({ where: { orderId, ...NON_FAILED } });
        const components = orderFullRefundComponents(order, nonFailed);
        if (components.amountCents <= 0) {
          throw BusinessException.conflict('CONFLICT', 'Nothing left to refund on this order', { refundedCents: order.totalCents - components.amountCents });
        }
        let piecesWithCustomer: string[] = [];
        if (vaultPreview) {
          const packed = vaultPreview.pieces.filter(
            (p) => p.state === 'in_custody' && p.shipment && (p.shipment.status === 'guia' || p.shipment.preparedAt !== null),
          );
          if (packed.length > 0) {
            throw BusinessException.conflict('VAULT_PIECE_IN_PACKED_WITHDRAWAL', 'A card of this purchase is inside a packed withdrawal', {
              items: packed.map((p) => ({ inventoryItemId: p.inventoryItemId, shipmentId: p.shipment!.id, shipmentStatus: p.shipment!.status })),
            });
          }
          piecesWithCustomer = vaultPreview.pieces.filter((p) => p.state === 'already_withdrawn').map((p) => p.inventoryItemId);
          if (piecesWithCustomer.length > 0 && dto.confirmPiecesWithCustomer !== true) {
            throw BusinessException.validation('REFUND_CONFIRMATION_REQUIRED', 'Some cards are already with the customer', {
              required: ['pieces_with_customer'],
              items: piecesWithCustomer,
            });
          }
        }
        let created;
        try {
          [created] = await this.ledger.createRows(
            tx,
            [{ idempotencyKey: `order-full:${orderId}`, kind: 'order_full', orderId, components, reason: dto.reason }],
            actor,
            piecesWithCustomer.length > 0 ? { confirmedPiecesWithCustomer: true, piecesWithCustomer } : {},
          );
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw BusinessException.conflict('CONFLICT', 'A full refund of this order already exists');
          }
          throw e;
        }
        if (order.fulfillmentMode === 'direct_ship') {
          await this.fullRefund.onFullRefund(tx, { orderId }, 'm3', actor.id);
        }
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'order.refund',
            entityType: 'Order',
            entityId: orderId,
            after: { reason: dto.reason, refundId: created.id, amountCents: created.amountCents },
          },
        });
        return created;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    const outcome = await this.ledger.executeRefund(row.id, actor);
    const finalRow = outcome.kind === 'done' || outcome.kind === 'not_requested' ? outcome.row : row;
    const after = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    return {
      orderId,
      status: after.status,
      refundId: finalRow.stripeRefundId,
      refund: (await this.ledger.toDtos([finalRow]))[0],
    };
  }

  /** §M4-SHIP.18.10 — re-correr el reclamo a mano (súper-admin). */
  async reclaimVault(
    orderId: string,
    dto: { note: string; confirmUnpacked?: boolean; inventoryItemIds?: string[] },
    actor: { id: string; role: Role },
  ): Promise<ReclaimVaultResponse> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, fulfillmentMode: true, fullRefundClosedAt: true, items: { select: { inventoryItemId: true } } },
    });
    if (!order) throw BusinessException.notFound();
    if (order.fulfillmentMode !== 'vault') throw BusinessException.conflict('CONFLICT', 'Not a vault order', { reason: 'not_vault' });
    if (order.fullRefundClosedAt === null) {
      throw BusinessException.conflict('CONFLICT', 'The full refund has not been confirmed yet', { reason: 'not_closed' });
    }
    if (dto.inventoryItemIds && dto.inventoryItemIds.length > 0) {
      if (dto.confirmUnpacked !== true) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'inventoryItemIds requires confirmUnpacked:true', { field: 'inventoryItemIds' });
      }
      const own = new Set(order.items.map((i) => i.inventoryItemId));
      const chains = await this.fullRefund.classifyVaultPieces(this.prisma as unknown as Prisma.TransactionClient, orderId);
      for (const p of chains.pieces) own.add(p.inventoryItemId);
      const foreign = dto.inventoryItemIds.filter((id) => !own.has(id));
      if (foreign.length > 0) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'inventoryItemIds must belong to this order', { field: 'inventoryItemIds', foreign });
      }
    }
    const pass = await this.prisma.$transaction(
      async (tx) => {
        const res = await this.fullRefund.onFullRefund(tx, { orderId }, 'reclaim', actor.id, {
          unpackedConfirmed: dto.confirmUnpacked === true,
          ...(dto.inventoryItemIds && dto.inventoryItemIds.length > 0 ? { unpackedItemIds: dto.inventoryItemIds } : {}),
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'order.vault_reclaim_requested',
            entityType: 'Order',
            entityId: orderId,
            after: {
              note: dto.note,
              confirmUnpacked: dto.confirmUnpacked === true,
              inventoryItemIds: dto.inventoryItemIds ?? null,
              reclaimedItemIds: res.reclaimedItemIds,
              untouched: res.untouched,
            },
          },
        });
        return res;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    return {
      orderId,
      reclaimed: pass.reclaimedItemIds,
      untouched: pass.untouched,
      chargebackNeedsManual: pass.chargebackNeedsManual,
      vaultPieces: await this.vaultPieces(orderId),
    };
  }
}
