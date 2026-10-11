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
 *
 * 💰 v1.82 `POST /admin/orders/:id/items/:orderItemId/refund-delivered` (`super_admin`, `@MoneyOut`) — §PNL.2: UNA carta
 *  de un directo YA ENTREGADO. Mismos candados que la tx1 (envíos → `Order` → libro); fila `item_delivered`
 *  (`item-delivered:<orderItemId>`); ⛔ cero inventario; la orden sigue `settled`. Cuerpo puro: `item-delivered-refund.ts`.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { afterAutoCloseVia } from '../shipments/label-auto-close';
import { PaymentRefund, Prisma, Role, ShippedRefundReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { itemMissingRefundComponents, orderFullRefundComponents } from '../../common/money';
import { FullRefundService, VaultPieceState } from '../payments/refunds/full-refund.service';
import { NON_FAILED, PaymentRefundDTO, RefundLedgerService } from '../payments/refunds/refund-ledger.service';
import { ACCEPTED_SHIPPED_REFUND_REASONS } from '../../common/business-rules';
import { DeliveredRefundView, deliveredLinesOf, deliveredRefundDecision, deliveredRefundViewOf, parseItemDeliveredBody } from './item-delivered-refund';
import { ACCESSORY_LINE_READ_INCLUDE, OrderAccessoryLineDTO, accessoryDeliveredRefundOf, toOrderAccessoryLineDTO } from './accessory-lines-view';
import { ACCESSORY_LINE_QTY_MAX } from './dto/accessory-cart.dto';
import {
  FULL_REFUND_REVIEW_SELECT,
  FullRefundReviewDTO,
  isShippedOut,
  lockShipmentsOfOrder,
  ShippedOutStatus,
  toFullRefundReviewDTO,
} from '../payments/refunds/refund-review';

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
    // 💰 v1.81 (§M4-SHIP.19.8): post-commit de la cancelación automática de la guía (por token; ⛔ ciclo de módulos).
    @Optional() private readonly moduleRef?: ModuleRef,
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
    const closedShipmentIds: string[] = [];
    const row = await this.prisma.$transaction(
      async (tx) => {
        // Candados: envíos de la orden (directo) / retiros vivos + piezas (bóveda) → Order → libro.
        // 💰 v1.80.8.6 (§M4-SHIP.18.12 (4)): TODOS los envíos de la orden (cualquier estado), FOR UPDATE id asc., y su
        // estado leído DESPUÉS del candado — decide «enviado» (⛔ la lectura sin candado de `picking|guia` no lo ve).
        // Techlead C-1: el MISMO helper y el MISMO predicado que `onFullRefund` (`refund-review.ts`) ⇒ lo que M3 decide
        // aquí y lo que `onFullRefund` exige como invariante no pueden divergir.
        const shipments = await lockShipmentsOfOrder(tx, orderId);
        const shippedStatus: ShippedOutStatus | null = shipments.map((s) => s.status).find(isShippedOut) ?? null;
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
          const pass = await this.fullRefund.onFullRefund(
            tx,
            { orderId },
            'm3',
            actor.id,
            shippedReason
              ? { shippedReason: { reason: shippedReason, note: dto.reason.trim().slice(0, SHIPPED_REFUND_NOTE_MAX) || null, byUserId: actor.id } }
              : {},
          );
          closedShipmentIds.push(...(pass?.closedShipmentIds ?? []));
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
    // 💰 §19.8: la guía de los envíos cerrados se cancela en Skydropx DESPUÉS del commit (best-effort).
    await afterAutoCloseVia(this.moduleRef, closedShipmentIds);
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

  // ================================================================ 💰 v1.82 §PNL.2 — UNA carta tras la entrega

  /**
   * `items[].deliveredRefund` de `GET /admin/orders/:id` — mismo cuerpo que los pasos 3–4 del verbo, ⛔ sin candados.
   * Mapa `inventoryItemId ⇒ { orderItemId, vista }` (la pieza es única por orden). Tres consultas, ⛔ sin N+1.
   */
  async deliveredRefundViews(orderId: string): Promise<Map<string, { orderItemId: string; view: DeliveredRefundView }>> {
    const out = new Map<string, { orderItemId: string; view: DeliveredRefundView }>();
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: { select: { id: true, inventoryItemId: true, unitPriceCents: true } } } });
    if (!order) return out;
    const [lines, rows] = await Promise.all([
      deliveredLinesOf(this.prisma, orderId, order.items.map((i) => i.inventoryItemId)),
      this.prisma.paymentRefund.findMany({ where: { orderItemId: { in: order.items.map((i) => i.id) } }, select: { id: true, orderItemId: true } }),
    ]);
    const byItem = new Map(rows.map((r) => [r.orderItemId as string, r]));
    for (const oi of order.items) {
      out.set(oi.inventoryItemId, { orderItemId: oi.id, view: deliveredRefundViewOf(order, oi, byItem.get(oi.id) ?? null, lines.get(oi.inventoryItemId) ?? null) });
    }
    return out;
  }

  /**
   * 💰 §PNL.2 — el verbo. Orden normativo: (1) validación ⇒ 400; línea inexistente o de OTRA orden ⇒ 404; (2) tx con los
   * candados de M3 (envíos de la orden `FOR UPDATE` id asc. → `Order FOR UPDATE` → libro); (3) guardas bajo candado ⇒
   * `409 ITEM_REFUND_NOT_AVAILABLE {reason}`; (4) importe + defensa del remanente; (5) `expectedRefundCents ≠ A` ⇒ `409
   * REFUND_PREVIEW_STALE {refundCents}`; (6) fila `item_delivered` (`P2002` ⇒ `already_refunded`, ⛔ nunca 500); (7)
   * bitácora en la tx; (8) post-commit Stripe + AV-12 por el cuerpo del libro. ⛔ Cero inventario; la orden sigue `settled`.
   */
  async refundDelivered(orderId: string, orderItemId: string, rawBody: unknown, actor: { id: string; role: Role }): Promise<{ refund: PaymentRefundDTO }> {
    const body = parseItemDeliveredBody(rawBody);
    const head = await this.prisma.orderItem.findUnique({ where: { id: orderItemId }, select: { orderId: true } });
    // `:orderItemId` de OTRA orden ⇒ 404 (⛔ nunca se reembolsa una línea buscándola sin su orden).
    if (!head || head.orderId !== orderId) throw BusinessException.notFound();
    let row: PaymentRefund;
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          // (2) candados en el orden de M3.
          await lockShipmentsOfOrder(tx, orderId);
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          const oi = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, select: { id: true, inventoryItemId: true, unitPriceCents: true } });
          // (3) guardas BAJO candado (la primera que falle).
          const existing = await tx.paymentRefund.findUnique({ where: { orderItemId }, select: { id: true } });
          const line = (await deliveredLinesOf(tx, orderId, [oi.inventoryItemId])).get(oi.inventoryItemId) ?? null;
          const decision = deliveredRefundDecision(order, oi, existing, line);
          if (decision.kind === 'already_refunded') {
            throw BusinessException.conflict('ITEM_REFUND_NOT_AVAILABLE', 'This card was already refunded', { reason: 'already_refunded', refundId: decision.refundId });
          }
          if (decision.kind === 'blocked') {
            throw BusinessException.conflict('ITEM_REFUND_NOT_AVAILABLE', 'This card cannot be refunded after delivery', { reason: decision.reason });
          }
          // (4) defensa: la suma de reembolsos nunca excede lo cobrado (no debe ocurrir: `floor`, §M4-SHIP.4).
          const A = decision.components.amountCents;
          const refunded = await this.ledger.refundedNonFailedCents(tx, orderId);
          if (A > order.totalCents - refunded) {
            this.logger.error(`refund-delivered ${orderId}/${orderItemId}: A=${A} excede el remanente ${order.totalCents - refunded} (no debe ocurrir).`);
            throw BusinessException.conflict('CONFLICT', 'The refund would exceed what remains of the charge', { remainingCents: order.totalCents - refunded });
          }
          // (5) lo que el súper-admin vio.
          if (body.expectedRefundCents !== A) {
            throw BusinessException.conflict('REFUND_PREVIEW_STALE', 'The refund amount changed', { refundCents: A });
          }
          // (6) la fila del libro.
          const [created] = await this.ledger.createRows(
            tx,
            [
              {
                idempotencyKey: `item-delivered:${orderItemId}`,
                kind: 'item_delivered',
                orderId,
                orderItemId,
                shipmentItemId: decision.line.id,
                deliveredReason: body.reason,
                missingReason: null,
                reason: body.note,
                components: decision.components,
              },
            ],
            actor,
            { deliveredReason: body.reason },
          );
          // (7) bitácora del acto.
          await tx.auditLog.create({
            data: {
              actorUserId: actor.id,
              actorRole: actor.role,
              action: 'order.item_refund_delivered',
              entityType: 'Order',
              entityId: orderId,
              after: {
                orderItemId,
                inventoryItemId: oi.inventoryItemId,
                shipmentItemId: decision.line.id,
                reason: body.reason,
                note: body.note,
                amountCents: created.amountCents,
                refundId: created.id,
              },
            },
          });
          return created;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (e) {
      // (6) otra pestaña ganó la llave única (`orderItemId` / `idempotencyKey`) ⇒ 409 con la fila ganadora, ⛔ nunca 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const winner = await this.prisma.paymentRefund.findUnique({ where: { orderItemId }, select: { id: true } });
        throw BusinessException.conflict('ITEM_REFUND_NOT_AVAILABLE', 'This card was already refunded', {
          reason: 'already_refunded',
          ...(winner ? { refundId: winner.id } : {}),
        });
      }
      throw e;
    }
    // (8) post-commit: Stripe (`amount = A`, `Idempotency-Key = item-delivered:<id>`) y AV-12 (invitado incluido).
    const [finalRow] = await this.ledger.executeAndNotify([row.id], actor);
    return { refund: (await this.ledger.toDtos([finalRow]))[0] };
  }

  // ================================================================ 💰 v1.86⟨accesorios⟩ §AC.10 (2) — un renglón tras la entrega

  /**
   * ¿El deck de un paquete ya está reembolsado ENTERO? (P-EN-5, §AC.10 (3)): cada `deckOrderItemIds` tiene una fila NO
   * fallida `item_missing`, `item_delivered` o `case_refund`.
   */
  private async deckCovered(db: Prisma.TransactionClient | PrismaService, deckOrderItemIds: readonly string[]): Promise<boolean> {
    if (deckOrderItemIds.length === 0) return false;
    const rows = await db.paymentRefund.findMany({
      where: { orderItemId: { in: [...deckOrderItemIds] }, kind: { in: ['item_missing', 'item_delivered', 'case_refund'] }, ...NON_FAILED },
      select: { orderItemId: true },
    });
    const covered = new Set(rows.map((r) => r.orderItemId));
    return deckOrderItemIds.every((id) => covered.has(id));
  }

  /**
   * `accessoryLines` de `GET /admin/orders/:id` (§AC.12, §AC.19.6) con `deliveredRefund` (v1.86.2): el MISMO cuerpo que el
   * verbo (`accessoryDeliveredRefundOf` + `itemMissingRefundComponents`), ⛔ sin candados. La pantalla no calcula.
   */
  async accessoryLinesForM3(orderId: string): Promise<OrderAccessoryLineDTO[]> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return [];
    const lines = await this.prisma.orderAccessoryLine.findMany({
      where: { orderId },
      include: { ...ACCESSORY_LINE_READ_INCLUDE, shipmentLine: { select: { shipmentRequest: { select: { status: true } } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const out: OrderAccessoryLineDTO[] = [];
    for (const l of lines) {
      const deckCovered = l.kind === 'energy_bundle' ? await this.deckCovered(this.prisma, l.deckOrderItemIds) : false;
      out.push(
        toOrderAccessoryLineDTO(
          l,
          accessoryDeliveredRefundOf({ order, line: l, shipmentStatus: l.shipmentLine?.shipmentRequest.status ?? null, deckCovered }),
        ),
      );
    }
    return out;
  }

  /**
   * 💰 §AC.10 (2) — `POST /admin/orders/:id/accessory-lines/:lineId/refund-delivered` (súper-admin, `@MoneyOut`). Los pasos
   * de §PNL.2 cambiando la carta por el renglón: (1) cuerpo ⇒ `400 {field}`; renglón de OTRA orden ⇒ `404`; (2) candados
   * envíos → `Order` → renglón; (3) guardas bajo candado (`ITEM_REFUND_NOT_AVAILABLE {reason}`, `ACCESSORY_REFUND_EXCEEDS
   * {refundableQty}`, `BUNDLE_REFUND_REQUIRES_DECK`); (4) importe `itemMissingRefundComponents(order, k × P)` y defensa
   * del remanente; (5) `expectedRefundCents ≠ A` ⇒ `409 REFUND_PREVIEW_STALE {refundCents: A}`, cero escrituras; (6) CAS
   * `refundedQty + k ≤ quantity` y fila `item_delivered` (`acc-delivered:<lineId>:<refundedQty tras el acto>`, ⛔ sin línea
   * de envío); (7) bitácora; (8) post-commit Stripe + AV-12. ⛔ Cero inventario; la orden sigue `settled`.
   */
  async refundAccessoryDelivered(orderId: string, lineId: string, rawBody: unknown, actor: { id: string; role: Role }): Promise<{ refund: PaymentRefundDTO }> {
    const raw = typeof rawBody === 'object' && rawBody !== null && !Array.isArray(rawBody) ? (rawBody as Record<string, unknown>) : {};
    const quantity = raw.quantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > ACCESSORY_LINE_QTY_MAX) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'quantity must be an integer >= 1', { field: 'quantity' });
    }
    const body = parseItemDeliveredBody(rawBody);
    const head = await this.prisma.orderAccessoryLine.findUnique({ where: { id: lineId }, select: { orderId: true, kind: true } });
    if (!head || head.orderId !== orderId) throw BusinessException.notFound();
    // P-EN-5: el paquete se reembolsa ENTERO (⛔ proporcional por energía).
    if (head.kind === 'energy_bundle' && quantity !== 1) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'an energy bundle is refunded whole (quantity 1)', { field: 'quantity' });
    }
    let row: PaymentRefund;
    try {
      row = await this.prisma.$transaction(
        async (tx) => {
          await lockShipmentsOfOrder(tx, orderId);
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "OrderAccessoryLine" WHERE id = ${lineId} FOR UPDATE`;
          const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
          const line = await tx.orderAccessoryLine.findUniqueOrThrow({
            where: { id: lineId },
            include: { shipmentLine: { select: { shipmentRequest: { select: { status: true } } } } },
          });
          if (order.fulfillmentMode !== 'direct_ship') {
            throw BusinessException.conflict('ITEM_REFUND_NOT_AVAILABLE', 'Not a direct-ship order', { reason: 'not_direct_ship' });
          }
          // (3) guardas BAJO candado con el MISMO cuerpo que la vista `deliveredRefund` de M3 (⛔ dos reglas): orden
          // liquidada → todo reembolsado → entregado → (paquete) deck entero.
          const deckCovered = line.kind === 'energy_bundle' ? await this.deckCovered(tx, line.deckOrderItemIds) : false;
          const view = accessoryDeliveredRefundOf({ order, line, shipmentStatus: line.shipmentLine?.shipmentRequest.status ?? null, deckCovered });
          if (view.kind === 'not_refundable') {
            if (view.reason === 'fully_refunded') throw BusinessException.conflict('ACCESSORY_REFUND_EXCEEDS', 'More units than remain refundable', { refundableQty: 0 });
            if (view.reason === 'bundle_requires_deck') throw BusinessException.conflict('BUNDLE_REFUND_REQUIRES_DECK', 'The deck of this bundle is not fully refunded');
            throw BusinessException.conflict('ITEM_REFUND_NOT_AVAILABLE', 'This accessory cannot be refunded after delivery', { reason: view.reason });
          }
          const refundableQty = view.refundableQty;
          if (quantity > refundableQty) {
            throw BusinessException.conflict('ACCESSORY_REFUND_EXCEEDS', 'More units than remain refundable', { refundableQty });
          }
          // (4) `A` = `deliveredRefund.amountByQtyCents[quantity − 1]` (§AC.10 (2) v1.86.2): la cifra que vio el súper-admin.
          const components = itemMissingRefundComponents(order, quantity * line.unitPriceCents);
          const A = components.amountCents;
          const refunded = await this.ledger.refundedNonFailedCents(tx, orderId);
          if (A > order.totalCents - refunded) {
            this.logger.error(`refund-accessory-delivered ${orderId}/${lineId}: A=${A} excede el remanente ${order.totalCents - refunded} (no debe ocurrir).`);
            throw BusinessException.conflict('CONFLICT', 'The refund would exceed what remains of the charge', { remainingCents: order.totalCents - refunded });
          }
          if (body.expectedRefundCents !== A) {
            throw BusinessException.conflict('REFUND_PREVIEW_STALE', 'The refund amount changed', { refundCents: A });
          }
          const cas = await tx.$executeRaw`
            UPDATE "OrderAccessoryLine" SET "refundedQty" = "refundedQty" + ${quantity}::int
             WHERE id = ${lineId} AND "refundedQty" + ${quantity}::int <= quantity`;
          if (cas !== 1) throw BusinessException.conflict('ACCESSORY_REFUND_EXCEEDS', 'More units than remain refundable', { refundableQty });
          const [created] = await this.ledger.createRows(
            tx,
            [
              {
                idempotencyKey: `acc-delivered:${lineId}:${line.refundedQty + quantity}`,
                kind: 'item_delivered',
                orderId,
                orderAccessoryLineId: lineId,
                accessoryQty: quantity,
                deliveredReason: body.reason,
                missingReason: null,
                reason: body.note,
                components,
              },
            ],
            actor,
            { deliveredReason: body.reason },
          );
          await tx.auditLog.create({
            data: {
              actorUserId: actor.id,
              actorRole: actor.role,
              action: 'order.accessory_refund_delivered',
              entityType: 'Order',
              entityId: orderId,
              after: { orderAccessoryLineId: lineId, quantity, reason: body.reason, note: body.note, amountCents: created.amountCents, refundId: created.id },
            },
          });
          return created;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const line = await this.prisma.orderAccessoryLine.findUnique({ where: { id: lineId }, select: { quantity: true, refundedQty: true } });
        throw BusinessException.conflict('ACCESSORY_REFUND_EXCEEDS', 'More units than remain refundable', { refundableQty: line ? line.quantity - line.refundedQty : 0 });
      }
      throw e;
    }
    const [finalRow] = await this.ledger.executeAndNotify([row.id], actor);
    return { refund: (await this.ledger.toDtos([finalRow]))[0] };
  }
}
