import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../payments/stripe.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { ChargebackInventoryDto, RefundDto } from './dto/orders.dto';
import { GuestOrderMailService } from './guest-order-mail.service';
import { maskEmail } from './guest-privacy';
import { DAY_MS, GUEST_TRACKING_MAX_AGE_DAYS } from './guest-checkout.constants';

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
    private readonly guestMail: GuestOrderMailService,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('guest') guest?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const where: Prisma.OrderWhereInput = {};
    if (status) where.status = status as never;
    if (userId) where.userId = userId;
    // v1.21-guest-checkout (§M3): filtro opcional por naturaleza del pedido.
    if (guest === 'true') where.guestEmail = { not: null };
    if (guest === 'false') where.guestEmail = null;
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
    // v1.21-guest-checkout (§M3, ADITIVO): `isGuestOrder` derivado. Las columnas nuevas
    // (`guestEmail`, `orderNumber`, `fulfillmentMode`, `shippingFeeCents`, `claimedAt`,
    // `shippingAddressSnapshot`) ya viajan en la fila; el back-office está protegido por rol y el
    // correo del comprador es dato de contacto operativo (mismo criterio que AdminSellerRef.email).
    return {
      data: data.map((o) => ({ ...o, isGuestOrder: o.guestEmail != null })),
      page: p,
      pageSize: ps,
      total,
    };
  }

  /**
   * Detalle M3. v1.21-guest-checkout (§M3, ADITIVO): un pedido de invitado se ve IGUAL que uno con
   * cuenta (no hay "usuario fantasma"), más los campos operativos del invitado. `userId` puede
   * venir `null` — el front de M3 debe tolerarlo y etiquetar "invitado".
   */
  @Get(':id')
  async get(@Param('id') id: string) {
    const detail = await this.orders.getOrder('', id, true);
    const extra = await this.prisma.order.findUnique({
      where: { id },
      select: {
        userId: true,
        guestEmail: true,
        orderNumber: true,
        fulfillmentMode: true,
        shippingFeeCents: true,
        claimedAt: true,
        shippingAddressSnapshot: true,
        chargebackNeedsManual: true,
        disputeOutcome: true,
        paymentMethodBrand: true,
        paymentMethodLast4: true,
      },
    });
    return {
      ...detail,
      ...(extra ?? {}),
      isGuestOrder: extra?.guestEmail != null,
      claimedAt: extra?.claimedAt ?? undefined,
    };
  }

  /**
   * §4-G.9b — soporte reenvía/ROTA el enlace de seguimiento de un pedido de invitado
   * (PROJECT §J: "el token también puede reenviarse desde soporte"). Emite uno nuevo (revocando
   * los previos) y lo envía SIEMPRE a `Order.guestEmail`. NO devuelve el token (el claro solo
   * viaja por correo). NO es money-out. Auditado.
   */
  @Post(':id/tracking-link')
  @HttpCode(200)
  async trackingLink(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw BusinessException.notFound();
    if (!order.guestEmail) {
      throw BusinessException.validation('VALIDATION_ERROR', 'Order is not a guest order');
    }
    if (order.createdAt.getTime() < Date.now() - GUEST_TRACKING_MAX_AGE_DAYS * DAY_MS) {
      // Evita que el reenvío mantenga la puerta abierta para siempre; la vía es el RECLAMO.
      throw BusinessException.validation(
        'GUEST_ORDER_TOO_OLD',
        `Guest orders older than ${GUEST_TRACKING_MAX_AGE_DAYS} days cannot get a new tracking link`,
      );
    }
    const expiresAt = await this.guestMail.sendTrackingLink(order);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'order.tracking_link.reissue',
      entityType: 'Order',
      entityId: id,
      after: { orderNumber: order.orderNumber, expiresAt: expiresAt?.toISOString() },
    });
    // `sentTo` enmascarado: el operador confirma a qué buzón fue sin exponerlo en la respuesta.
    return { orderNumber: order.orderNumber, sentTo: maskEmail(order.guestEmail), expiresAt };
  }

  /**
   * v1.21.2 (T1, §M3) — DESENLACE HUMANO del inventario tras un contracargo con envío vivo.
   * `vault_operator+`, **auditado**, y **NO es money-out**: no mueve dinero, solo resuelve dónde
   * está una carta física. Es la contraparte obligatoria del congelamiento: sin este endpoint, una
   * pieza congelada por `charge.dispute.created` se queda congelada para siempre.
   *
   * `409 CONFLICT` si el desenlace no aplica al estado actual (re-expedir con la orden todavía en
   * `chargeback`, o cualquier desenlace sobre una orden ya resuelta) — eso ES la regla de
   * idempotencia: repetir un desenlace no duplica movimientos de inventario ni envíos.
   */
  @Post(':id/chargeback-inventory')
  @HttpCode(200)
  async chargebackInventory(
    @Param('id') id: string,
    @Body() dto: ChargebackInventoryDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.orders.resolveChargebackInventory(id, dto.outcome);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'order.chargeback_inventory',
      entityType: 'Order',
      entityId: id,
      after: {
        outcome: dto.outcome,
        note: dto.note,
        inventoryItemIds: res.inventoryItemIds,
        ...(res.shipmentId ? { shipmentId: res.shipmentId } : {}),
      },
    });
    return res;
  }

  /**
   * A1 — Reembolso admin. POLÍTICA DEL HUMANO: VENTAS FINALES, sin reembolso voluntario.
   * Este endpoint es EXCEPCIONAL (super_admin, money-out ya autorizado y auditado) y NO
   * auto-revierte el item al inventario: `onChargeRefunded` marca la orden `refunded` pero
   * NO re-agrega la carta. Úsese solo para casos excepcionales (obligación legal, error de
   * cobro), no como remedio de disputa (esa es la recompra de M8).
   */
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
    // SEC-M3: guardia de estado — solo se reembolsa una orden `settled`. Evita reembolsos
    // sobre órdenes ya reembolsadas/en contracargo/pendientes y transiciones inconsistentes.
    if (order.status !== 'settled') {
      throw BusinessException.validation('VALIDATION_ERROR', 'Only a settled order can be refunded', {
        status: order.status,
      });
    }
    // SEC-M3: idempotencia obligatoria hacia Stripe. Si el cliente no envía
    // `Idempotency-Key`, se deriva una determinista por orden para que reintentos no
    // generen reembolsos duplicados.
    const idem = idempotencyKey ?? `refund-${order.id}`;
    const refundId = await this.stripe.refund(order.stripePaymentIntentId, idem);
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
