/**
 * customer-overview.service.ts — §FICHA-CLIENTE (docs/API_CONTRACT_FICHA_CLIENTE.md §1): `GET /admin/users/:id/overview`.
 *
 * SOLO LECTURA, dinero en centavos. Mismo DTO para `vault_operator` y `super_admin` (decisión del dueño, HECHOS 2026-11-22:
 * el operador también ve los totales de vida). Todo `select`/`groupBy` en lista blanca (R-1); un número CONSTANTE de consultas
 * por llamada (ninguna por fila). ⛔ Sin dirección, CLABE, RFC, ids/llaves de Stripe, `idempotencyKey`, notas de reembolso,
 * INE ni notas internas (solo salen por `/notes`).
 */
import { Injectable } from '@nestjs/common';
import { Prisma, Role, ShipmentStatus } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { SELL_REQUEST_LIVE_STATES } from '../../common/sell-request-states';
import { PrismaService } from '../../prisma/prisma.service';
import { paymentRefundOfCustomer } from '../payments/refunds/customer-user-id';
import { OUTBOUND_ONLY } from '../shipments/label-subject';
import { PatrimonyValuationService } from '../pricing/patrimony-valuation.service';

const SHIPMENT_OPEN: ShipmentStatus[] = ['solicitado', 'picking', 'guia', 'enviado'];
/** La pelota está de NUESTRO lado (contrato §1). */
const SELL_NEEDS_STORE = ['recibida', 'verificacion', 'aprobada'] as const;
const DISPUTE_OPEN = ['abierta', 'en_revision'] as const;
const REFUND_PAYMENT_OPEN = ['requested', 'submitted'] as const;
const REFUND_LIST = 5;

export interface ShipmentRef {
  id: string;
  status: ShipmentStatus;
  mode: 'withdrawal' | 'direct_ship';
  orderId: string | null;
  orderNumber: string | null;
  itemsCount: number;
  totalCents: number;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  requestedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}
export interface RefundRef {
  id: string;
  channel: 'card' | 'spei';
  status: 'requested' | 'submitted' | 'succeeded' | 'failed' | 'pending' | 'paid' | 'cancelled';
  amountCents: number;
  orderId: string | null;
  createdAt: string;
}
export interface AdminUserOverviewDTO {
  userId: string;
  generatedAt: string;
  attention: {
    ordersPending: number;
    shipmentsOpen: number;
    sellRequestsOpen: number;
    sellRequestsNeedingStore: number;
    disputesOpen: number;
    refundsOpen: number;
  };
  summary: {
    customerSince: string;
    lastOrderAt: string | null;
    lastSellRequestAt: string | null;
    lifetime: {
      purchasesCount: number;
      purchasesCents: number;
      refundedCents: number;
      salesPaidCount: number;
      salesPaidCents: number;
      salesInProgressCents: number;
    };
  };
  vault: { piecesCount: number; valueCents: number | null; pricedCount: number; asOf: string | null };
  shipments: { total: number; items: ShipmentRef[] };
  refunds: { total: number; items: RefundRef[] };
  wishlist: { itemCount: number; alertsPaused: boolean };
  totals: { orders: number; sellRequests: number; disputes: number; ownedItems: number };
}

@Injectable()
export class CustomerOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patrimony: PatrimonyValuationService,
  ) {}

  async overview(userId: string): Promise<AdminUserOverviewDTO> {
    const p = this.prisma;
    // Los envíos de ESTE cliente: retiro (`userId`) o envío directo (nace sin `userId`; su dueño es `order.userId`). Solo `outbound`.
    const shipWhere: Prisma.ShipmentRequestWhereInput = { ...OUTBOUND_ONLY, OR: [{ userId }, { order: { userId } }] };
    // Una transacción de solo lectura (RepeatableRead = instantánea consistente); un número constante de consultas, ninguna por fila.
    const { user, orderGroups, sellGroups, sellOpenRows, shipGroups, shipRows, disputeGroups, prGroups, prRows, mrGroups, mrRows, items } =
      await p.$transaction(
        async (tx) => ({
        user: await tx.user.findUnique({
          where: { id: userId },
          select: { role: true, createdAt: true, wishlistAlertsPausedAt: true, _count: { select: { wishlistItems: true } } },
        }),
        orderGroups: await tx.order.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: { userId }, _count: { _all: true }, _sum: { totalCents: true }, _max: { settledAt: true } }),
        sellGroups: await tx.sellRequest.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          where: { userId },
          _count: { _all: true },
          _sum: { approvedTotalCents: true },
          _max: { createdAt: true },
        }),
        sellOpenRows: await tx.sellRequest.findMany({
          where: { userId, status: { in: [...SELL_REQUEST_LIVE_STATES] } },
          select: { approvedTotalCents: true, quotedTotalCents: true },
        }),
        shipGroups: await tx.shipmentRequest.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: shipWhere, _count: { _all: true } }),
        shipRows: await tx.shipmentRequest.findMany({
          where: shipWhere,
          orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: {
            id: true,
            status: true,
            orderId: true,
            order: { select: { orderNumber: true } },
            totalCents: true,
            carrier: true,
            trackingNumber: true,
            trackingUrl: true,
            requestedAt: true,
            shippedAt: true,
            deliveredAt: true,
            _count: { select: { items: true } },
          },
        }),
        disputeGroups: await tx.dispute.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: { userId }, _count: { _all: true } }),
        prGroups: await tx.paymentRefund.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: paymentRefundOfCustomer(userId), _count: { _all: true }, _sum: { amountCents: true } }),
        prRows: await tx.paymentRefund.findMany({
          where: paymentRefundOfCustomer(userId),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: REFUND_LIST,
          select: { id: true, status: true, amountCents: true, orderId: true, createdAt: true },
        }),
        mrGroups: await tx.manualRefund.groupBy({ by: ['status'], orderBy: { status: 'asc' }, where: { customerUserId: userId }, _count: { _all: true }, _sum: { amountCents: true } }),
        mrRows: await tx.manualRefund.findMany({
          where: { customerUserId: userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: REFUND_LIST,
          select: { id: true, status: true, amountCents: true, orderId: true, createdAt: true },
        }),
        // Misma regla que `ownedItems` de `GET /:id` (sin filtro de estado): el valor sale de la MISMA puerta de patrimonio.
        items: await tx.inventoryItem.findMany({
          where: { ownerUserId: userId },
          select: {
            id: true,
            cardId: true,
            productType: true,
            finish: true,
            rawCondition: true,
            gradingCompany: true,
            gradeValue: true,
            tcgplayerProductId: true,
            language: true,
            cardProductId: true,
          },
        }),
        }),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    if (!user || user.role === Role.supplier) throw BusinessException.notFound();

    const count = <T extends { status: string; _count: { _all: number } }>(rows: T[], ...st: string[]) =>
      rows.filter((r) => st.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
    const total = <T extends { _count: { _all: number } }>(rows: T[]) => rows.reduce((n, r) => n + r._count._all, 0);

    const settled = orderGroups.find((g) => g.status === 'settled');
    const paidSell = sellGroups.find((g) => g.status === 'pagada');
    const sellLast = sellGroups.reduce<Date | null>((m, g) => (g._max.createdAt && (!m || g._max.createdAt > m) ? g._max.createdAt : m), null);

    // refundedCents = Σ PaymentRefund succeeded + ManualRefund paid.
    const refundedCents =
      (prGroups.find((g) => g.status === 'succeeded')?._sum.amountCents ?? 0) + (mrGroups.find((g) => g.status === 'paid')?._sum.amountCents ?? 0);

    // Valor de bóveda: SOLO piezas con precio; ninguna ⇒ null (nunca 0). `asOf` = la fecha MÁS ANTIGUA de los precios usados.
    const values = await this.patrimony.valuePieces(items);
    let valueCents = 0;
    let pricedCount = 0;
    let asOf: string | null = null;
    for (const it of items) {
      const v = values.get(it.id);
      if (v && v.status === 'priced' && typeof v.referenceMxnCents === 'number') {
        valueCents += v.referenceMxnCents;
        pricedCount += 1;
        if (v.capturedDate && (asOf === null || v.capturedDate < asOf)) asOf = v.capturedDate;
      }
    }

    const refundItems: RefundRef[] = [
      ...prRows.map((r) => ({ id: r.id, channel: 'card' as const, status: r.status, amountCents: r.amountCents, orderId: r.orderId, createdAt: r.createdAt })),
      ...mrRows.map((r) => ({ id: r.id, channel: 'spei' as const, status: r.status, amountCents: r.amountCents, orderId: r.orderId, createdAt: r.createdAt })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, REFUND_LIST)
      .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

    return {
      userId,
      generatedAt: new Date().toISOString(),
      attention: {
        ordersPending: count(orderGroups, 'pending'),
        shipmentsOpen: count(shipGroups, ...SHIPMENT_OPEN),
        sellRequestsOpen: sellOpenRows.length,
        sellRequestsNeedingStore: count(sellGroups, ...SELL_NEEDS_STORE),
        disputesOpen: count(disputeGroups, ...DISPUTE_OPEN),
        refundsOpen: count(prGroups, ...REFUND_PAYMENT_OPEN) + count(mrGroups, 'pending'),
      },
      summary: {
        customerSince: user.createdAt.toISOString(),
        lastOrderAt: settled?._max.settledAt ? settled._max.settledAt.toISOString() : null,
        lastSellRequestAt: sellLast ? sellLast.toISOString() : null,
        lifetime: {
          purchasesCount: settled?._count._all ?? 0,
          purchasesCents: settled?._sum.totalCents ?? 0,
          refundedCents,
          salesPaidCount: paidSell?._count._all ?? 0,
          salesPaidCents: paidSell?._sum.approvedTotalCents ?? 0,
          salesInProgressCents: sellOpenRows.reduce((n, r) => n + (r.approvedTotalCents ?? r.quotedTotalCents), 0),
        },
      },
      vault: { piecesCount: items.length, valueCents: pricedCount > 0 ? valueCents : null, pricedCount, asOf },
      shipments: {
        total: total(shipGroups),
        items: shipRows.map((s) => ({
          id: s.id,
          status: s.status,
          mode: s.orderId ? ('direct_ship' as const) : ('withdrawal' as const),
          orderId: s.orderId,
          orderNumber: s.order?.orderNumber ?? null,
          itemsCount: s._count.items,
          totalCents: s.totalCents,
          carrier: s.carrier,
          trackingNumber: s.trackingNumber,
          // La columna solo la escribe la compra de guía en Skydropx (ya validada); sin guía ⇒ null. Nunca se construye con el número.
          trackingUrl: s.trackingUrl,
          requestedAt: s.requestedAt.toISOString(),
          shippedAt: s.shippedAt ? s.shippedAt.toISOString() : null,
          deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
        })),
      },
      refunds: { total: total(prGroups) + total(mrGroups), items: refundItems },
      wishlist: { itemCount: user._count.wishlistItems, alertsPaused: user.wishlistAlertsPausedAt !== null },
      totals: {
        orders: total(orderGroups),
        sellRequests: total(sellGroups),
        disputes: total(disputeGroups),
        ownedItems: items.length,
      },
    };
  }
}
