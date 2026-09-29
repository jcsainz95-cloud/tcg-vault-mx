/**
 * §M4-SHIP.5 (`retry`) / §M4-SHIP.17.5 (`GET /admin/refunds`, `operator-summary`) — el libro, visto desde el
 * back-office. `retry`: operador+ (solo filas de envíos); lecturas: solo `super_admin`, `Cache-Control: no-store`.
 */
import { Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PaymentRefundKind, PaymentRefundStatus, Prisma, Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { parseAdminListFilters } from '../../../common/admin-list-filters';
import { parseEnumFilter } from '../../../common/enum-filter';
import { PrismaService } from '../../../prisma/prisma.service';
import { NON_FAILED, RefundLedgerService } from './refund-ledger.service';
import { RefundReportsService } from './refund-reports.service';

const KIND_VALUES: readonly PaymentRefundKind[] = Object.values(PaymentRefundKind);
const STATUS_VALUES: readonly PaymentRefundStatus[] = Object.values(PaymentRefundStatus);
const ROLE_VALUES: readonly Role[] = Object.values(Role);

@Controller('admin/refunds')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminRefundsController {
  constructor(
    private readonly ledger: RefundLedgerService,
    private readonly prisma: PrismaService,
    private readonly reports: RefundReportsService,
  ) {}

  /** 💰 `POST /admin/refunds/:id/retry` — reintentar una fila `requested` (operador+; `order_full`/`case_refund` solo súper-admin). */
  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.ledger.retry(id, user);
  }

  /** 🔒 `GET /admin/refunds/operator-summary` (súper-admin) — §M4-SHIP.17.5 (2). */
  @Get('operator-summary')
  @Roles(Role.super_admin)
  @Header('Cache-Control', 'no-store')
  operatorSummary() {
    return this.reports.operatorSummary();
  }

  /** 🔒 `GET /admin/refunds` (súper-admin) — el libro, filtrable. §M4-SHIP.17.5 (1). */
  @Get()
  @Roles(Role.super_admin)
  @Header('Cache-Control', 'no-store')
  async list(
    @Query('requestedByRole') requestedByRole?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('kind') kind?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    const f = parseAdminListFilters({ page, pageSize, from, to });
    const where: Prisma.PaymentRefundWhereInput = {};
    const role = parseEnumFilter('requestedByRole', requestedByRole, ROLE_VALUES);
    if (role) where.requestedByRole = role;
    if (actorUserId && actorUserId.trim()) where.requestedByUserId = actorUserId.trim();
    const k = parseEnumFilter('kind', kind, KIND_VALUES);
    if (k) where.kind = k;
    const st = parseEnumFilter('status', status, STATUS_VALUES);
    if (st) where.status = st;
    if (f.dateRange) where.createdAt = f.dateRange;
    const ps = Math.min(100, f.pageSize);
    const [rows, total, sum] = await Promise.all([
      this.prisma.paymentRefund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (f.page - 1) * ps,
        take: ps,
        include: {
          order: { select: { id: true, orderNumber: true, userId: true, guestEmail: true } },
          shipmentRequest: { select: { id: true, userId: true } },
          shipmentItem: { select: { shipmentRequestId: true, inventoryItem: { select: { folio: true, card: { select: { name: true } } } } } },
          replacementCase: { select: { originalInventoryItem: { select: { folio: true, card: { select: { name: true } } } } } },
        },
      }),
      this.prisma.paymentRefund.count({ where }),
      this.prisma.paymentRefund.aggregate({ where: { ...where, ...NON_FAILED }, _sum: { amountCents: true } }),
    ]);
    const dtos = await this.ledger.toDtos(rows);
    const data = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const buyerId = r.shipmentRequest?.userId ?? r.order?.userId ?? null;
      const customer = buyerId ? await this.reports.customerRef(buyerId) : null;
      const item = r.shipmentItem?.inventoryItem ?? r.replacementCase?.originalInventoryItem ?? null;
      data.push({
        ...dtos[i],
        order: r.order ? { id: r.order.id, orderNumber: r.order.orderNumber } : null,
        shipmentId: r.shipmentRequestId ?? r.shipmentItem?.shipmentRequestId ?? null,
        customer,
        item: item ? { folio: item.folio, cardName: item.card.name } : null,
      });
    }
    return { data, page: f.page, pageSize: ps, total, sumCents: sum._sum.amountCents ?? 0 };
  }
}
