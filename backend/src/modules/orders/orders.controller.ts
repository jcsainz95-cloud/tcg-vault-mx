import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireEmailVerified } from '../../common/decorators/require-email-verified.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { OrderClaimService } from './order-claim.service';
import { QuoteDto, SessionDto } from './dto/orders.dto';
import { ClaimOrdersDto } from './dto/guest-checkout.dto';

@Controller()
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly claims: OrderClaimService,
  ) {}

  @Post('checkout/quote')
  @HttpCode(200)
  quote(@Body() dto: QuoteDto) {
    return this.orders.quote(dto.inventoryItemIds);
  }

  // v1.5: comprar es acción sensible → requiere emailVerified (403 EMAIL_NOT_VERIFIED si no).
  // El `checkout/quote` (read-only, arriba) NO se bloquea, para mostrar precios con el banner.
  @RequireEmailVerified()
  @Post('checkout/session')
  @HttpCode(201)
  session(
    @CurrentUser('id') userId: string,
    @Body() dto: SessionDto,
  ) {
    // H2 (money-safety): en rutas de dinero el header `Idempotency-Key` del cliente se IGNORA;
    // la clave se deriva SIEMPRE en el servidor (`pi-order-<id>`, en `attachPaymentIntent`).
    return this.orders.createSession(userId, dto.inventoryItemIds, dto.billingProfileId);
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

  /**
   * v1.21-guest-checkout §4-G.9 — pedidos de invitado SIN reclamar con el correo VERIFICADO de la
   * sesión. OJO (nota de implementación de Nest): esta ruta DEBE declararse ANTES de
   * `@Get('orders/:orderId')`, o `claimable` se resolvería como un `orderId`.
   * No es un oráculo: solo habla del correo de quien pregunta; nunca acepta un correo como input.
   */
  @RequireEmailVerified()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('orders/claimable')
  claimable(@CurrentUser('id') userId: string) {
    return this.claims.listClaimable(userId);
  }

  /**
   * §4-G.9 — reclamo EXPLÍCITO (nunca silencioso) y de una sola vez. Prueba de titularidad =
   * correo VERIFICADO (`@RequireEmailVerified` ⇒ 403 EMAIL_NOT_VERIFIED). Parcial-tolerante: un
   * pedido fallido no tumba los demás (HTTP 200 con `claimed` + `failed`). Auditado.
   */
  @RequireEmailVerified()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  @Post('orders/claim')
  @HttpCode(200)
  claim(@CurrentUser() user: { id: string; role: Role }, @Body() dto: ClaimOrdersDto) {
    return this.claims.claim(user, dto.orderIds);
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
