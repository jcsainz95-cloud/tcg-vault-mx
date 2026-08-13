import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../payments/stripe.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { RefundDto } from './dto/orders.dto';

/**
 * M3 — Ventas / órdenes. vault_operator (lectura); super_admin (reembolso, money-out).
 * API_CONTRACT §M3.
 */
@Controller('admin/orders')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status as never;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { data, page: p, pageSize: ps, total };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.getOrder('', id, true);
  }

  @Post(':id/refund')
  @MoneyOut()
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundDto,
    @CurrentUser() user: { id: string; role: Role },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw BusinessException.notFound();
    if (!order.stripePaymentIntentId) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Order has no payment intent');
    }
    const refundId = await this.stripe.refund(order.stripePaymentIntentId, idempotencyKey);
    await this.prisma.order.update({
      where: { id },
      data: { status: 'refunded', refundedAt: new Date() },
    });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'order.refund',
      entityType: 'Order',
      entityId: id,
      after: { reason: dto.reason, refundId },
    });
    return { orderId: id, status: 'refunded', refundId };
  }
}
