import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { QuoteDto, SessionDto } from './dto/orders.dto';

@Controller()
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('checkout/quote')
  @HttpCode(200)
  quote(@CurrentUser('id') userId: string, @Body() dto: QuoteDto) {
    return this.orders.quote(userId, dto.inventoryItemIds);
  }

  @Post('checkout/session')
  @HttpCode(201)
  session(
    @CurrentUser('id') userId: string,
    @Body() dto: SessionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.createSession(userId, dto.inventoryItemIds, dto.billingProfileId, idempotencyKey);
  }

  @Get('orders')
  list(
    @CurrentUser('id') userId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.orders.listOrders(
      userId,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    );
  }

  @Get('orders/:orderId')
  get(@CurrentUser('id') userId: string, @Param('orderId') orderId: string) {
    return this.orders.getOrder(userId, orderId);
  }

  @Post('orders/:orderId/request-invoice')
  @HttpCode(200)
  requestInvoice(@CurrentUser('id') userId: string, @Param('orderId') orderId: string) {
    return this.orders.requestInvoice(userId, orderId);
  }
}
