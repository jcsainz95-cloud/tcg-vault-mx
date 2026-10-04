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
import { Prisma, Role, ShippedRefundReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { orderFullRefundComponents } from '../../common/money';
import { FullRefundService, VaultPieceState } from '../payments/refunds/full-refund.service';
import { NON_FAILED, PaymentRefundDTO, RefundLedgerService } from '../payments/refunds/refund-ledger.service';
import { ACCEPTED_SHIPPED_REFUND_REASONS } from '../../common/business-rules';
import { FULL_REFUND_REVIEW_SELECT, FullRefundReviewDTO, toFullRefundReviewDTO } from '../payments/refunds/refund-review';

/** 💰 v1.80.8.6 (§M4-SHIP.18.12 (4)/(6)) — tope de la nota del motivo «tras envío». */
export const SHIPPED_REFUND_NOTE_MAX = 500;

export interface ShippedRefundReasonResponse {
  orderId: string;
  outcome: 'recorded' | 'already_recorded';
  fullRefundReview: FullRefundReviewDTO;
}

/** Clase R: fuera de `ACCEPTED_SHIPPED_REFUND_REASONS` ⇒ `400 VALIDATION_ERROR {field, allowed}`. */
function assertShippedReason(field: string, value: unknown): ShippedRefundReason {
  if (typeof value !== 'string' || !(ACCEPTED_SHIPPED_REFUND_REASONS as readonly string[]).includes(value)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field}`, { field, allowed: [...ACCEPTED_SHIPPED_REFUND_REASONS] });
  }
  return value as ShippedRefundReason;
}

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
    dto: { reason: string; confirmPiecesWithCustomer?: boolean; shippedReason?: unknown },
    actor: { id: string; role: Role },
  ): Promise<{ orderId: string; status: string; refundId: string | null; refund: PaymentRefundDTO }> {
    // 💰 v1.80.8.6 (§M4-SHIP.18.12 (4)) — `shippedReason` clase R, validado ANTES de leer nada (400 sin escribir).
    const shippedReason = dto.shippedReason === undefined || dto.shippedReason === null ? null : assertShippedReason('shippedReason', dto.shippedReason);
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
        // 💰 v1.80.8.6 (§M4-SHIP.18.12 (4)): TODOS los envíos de la orden (cualquier estado), FOR UPDATE id asc., y su
        // estado leído DESPUÉS del candado — decide «enviado» (⛔ la lectura sin candado de `picking|guia` no lo ve).
        const shipments = await tx.shipmentRequest.findMany({
          where: { orderId },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        let shippedStatus: 'enviado' | 'entregado' | null = null;
        if (shipments.length > 0) {
          const ids = shipments.map((s) => s.id);
          const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
            SELECT id, status::text AS status FROM "ShipmentRequest" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
          const out = locked.find((s) => s.status === 'enviado' || s.status === 'entregado');
          shippedStatus = out ? (out.status as 'enviado' | 'entregado') : null;
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
        // 💰 v1.80.8.6 (§M4-SHIP.18.12 (4)) — el motivo «tras envío», ANTES de `createRows` (sin él: ni fila ni Stripe).
        if (shippedStatus && !shippedReason) {
          throw BusinessException.validation('REFUND_CONFIRMATION_REQUIRED', 'This order already shipped: a shipped refund reason is required', {
            required: ['shipped_reason'],
            shipmentStatus: shippedStatus,
          });
        }
        if (!shippedStatus && shippedReason) {
          throw BusinessException.conflict('SHIPPED_REFUND_REASON_NOT_APPLICABLE', 'This order has not shipped', { afterShipment: false });
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
          await this.fullRefund.onFullRefund(
            tx,
            { orderId },
            'm3',
            actor.id,
            shippedReason
              ? { shippedReason: { reason: shippedReason, note: dto.reason.trim().slice(0, SHIPPED_REFUND_NOTE_MAX) || null, byUserId: actor.id } }
              : {},
          );
        }
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'order.refund',
            entityType: 'Order',
            entityId: orderId,
            after: { reason: dto.reason, refundId: created.id, amountCents: created.amountCents, shippedReason },
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

  /**
   * 💰 v1.80.8.6 (§M4-SHIP.18.12 (6)) — `POST /admin/orders/:id/shipped-refund-reason`: registrar DESPUÉS el motivo de un
   * reembolso total hecho tras «enviado» (p. ej. desde el panel de Stripe ⇒ «reembolso por revisar»). Súper-admin
   * (`@MoneyOut` en el controlador). ⛔ Sin Stripe, ⛔ sin libro, ⛔ sin piezas ni `InventoryMovement`, ⛔ sin correo.
   * El motivo NO se edita: el mismo ⇒ `already_recorded`; otro ⇒ `409 …ALREADY_SET {reason}` (A-2: sin `recordedBy`).
   */
  async recordShippedRefundReason(orderId: string, body: unknown, actor: { id: string; role: Role }): Promise<ShippedRefundReasonResponse> {
    // Cuerpo: `{ reason, note? }` y NADA más (clave desconocida ⇒ 400). Validado antes de leer nada.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'body must be an object', { field: 'reason', allowed: [...ACCEPTED_SHIPPED_REFUND_REASONS] });
    }
    const raw = body as Record<string, unknown>;
    const unknownKey = Object.keys(raw).find((k) => k !== 'reason' && k !== 'note');
    if (unknownKey) throw BusinessException.badRequest('VALIDATION_ERROR', `unknown field ${unknownKey}`, { field: unknownKey });
    const reason = assertShippedReason('reason', raw.reason);
    let note: string | null = null;
    if (raw.note !== undefined && raw.note !== null) {
      if (typeof raw.note !== 'string') throw BusinessException.badRequest('VALIDATION_ERROR', 'note must be a string', { field: 'note' });
      const t = raw.note.trim();
      if (t.length > SHIPPED_REFUND_NOTE_MAX) {
        throw BusinessException.badRequest('VALIDATION_ERROR', `note must be at most ${SHIPPED_REFUND_NOTE_MAX} characters`, { field: 'note', max: SHIPPED_REFUND_NOTE_MAX });
      }
      note = t.length > 0 ? t : null;
    }
    const exists = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const decide = (row: { fullRefundAfterShipment: boolean; shippedRefundReason: ShippedRefundReason | null }) => {
          if (!row.fullRefundAfterShipment) {
            throw BusinessException.conflict('SHIPPED_REFUND_REASON_NOT_APPLICABLE', 'This order was not refunded after shipping', { afterShipment: false });
          }
          if (row.shippedRefundReason === reason) return 'already_recorded' as const;
          if (row.shippedRefundReason !== null) {
            throw BusinessException.conflict('SHIPPED_REFUND_REASON_ALREADY_SET', 'A shipped refund reason is already recorded', { reason: row.shippedRefundReason });
          }
          return null;
        };
        const [row] = await tx.$queryRaw<{ fullRefundAfterShipment: boolean; shippedRefundReason: ShippedRefundReason | null }[]>`
          SELECT "fullRefundAfterShipment", "shippedRefundReason"::text AS "shippedRefundReason" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
        const early = decide(row);
        if (early) return early;
        const cas = await tx.order.updateMany({
          where: { id: orderId, fullRefundAfterShipment: true, shippedRefundReason: null },
          data: { shippedRefundReason: reason, shippedRefundNote: note, shippedRefundReasonAt: new Date(), shippedRefundReasonByUserId: actor.id },
        });
        if (cas.count !== 1) {
          const again = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { fullRefundAfterShipment: true, shippedRefundReason: true } });
          const r = decide(again);
          if (r) return r;
          throw new Error(`shipped-refund-reason ${orderId}: CAS contó 0 sin motivo registrado (inesperado)`);
        }
        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.role,
            action: 'order.shipped_refund_reason_recorded',
            entityType: 'Order',
            entityId: orderId,
            after: { reason, note },
          },
        });
        return 'recorded' as const;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: FULL_REFUND_REVIEW_SELECT });
    return { orderId, outcome, fullRefundReview: toFullRefundReviewDTO(fresh) as FullRefundReviewDTO };
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
