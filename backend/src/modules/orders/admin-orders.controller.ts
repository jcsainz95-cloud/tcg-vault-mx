import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { customerEmailOrBlank } from '../../common/customer-email';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseAdminListFilters } from '../../common/admin-list-filters';
import { parseEnumFilter } from '../../common/enum-filter';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { ChargebackInventoryDto, ReclaimVaultDto, RefundDto } from './dto/orders.dto';
import { OrderRefundService } from './order-refund.service';
import { GuestOrderMailService } from './guest-order-mail.service';
import { maskEmail } from './guest-privacy';
import { DAY_MS, GUEST_TRACKING_MAX_AGE_DAYS } from './guest-checkout.constants';
import { RefundLedgerService } from '../payments/refunds/refund-ledger.service';
import { ManualRefundService } from '../payments/refunds/manual-refund.service';
import { customerDisplayName } from '../vault/customer-display-name';
import { refundedCentsOf } from './order-public-status';
import { FULL_REFUND_REVIEW_SELECT, isRefundReviewPending, isShippedOut, REFUND_REVIEW_PENDING_WHERE, toFullRefundReviewDTO } from '../payments/refunds/refund-review';

/**
 * M3 — Ventas / órdenes. vault_operator (lectura); super_admin (reembolso, money-out).
 * API_CONTRACT §M3.
 */
/** `P-84` · clase **E** (§4.37): los estados de pedido por los que el back-office puede filtrar,
 * DERIVADOS del schema — nunca una lista escrita a mano. */
const ORDER_STATUS_FILTER_VALUES: readonly OrderStatus[] = Object.values(OrderStatus);

/**
 * 💰 v1.80.8.6 (§M4-SHIP.18.12 (7)) — `?refundReview=` · clase **L** (un solo valor: modo de consulta, ⛔ no existe en
 * el schema). `pending` ⇔ `REFUND_REVIEW_PENDING_WHERE` (el mismo predicado de `isRefundReviewPending`).
 */
export const REFUND_REVIEW_FILTER_VALUES = ['pending'] as const;

@Controller('admin/orders')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guestMail: GuestOrderMailService,
    private readonly refunds: OrderRefundService,
    private readonly ledger: RefundLedgerService,
    private readonly manual: ManualRefundService,
  ) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('guest') guest?: string,
    // v1.21.2 (§M3, aditivo): cola de "contracargos por resolver". Sin este filtro el operador no
    // tiene forma de DESCUBRIR que hay piezas congeladas por un contracargo, y el desenlace humano
    // (`chargeback-inventory`) no se llamaría nunca — la pieza se quedaría congelada para siempre.
    @Query('needsManual') needsManual?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    // v1.25-buylist-orders-pagination (§M3, aditivos y opcionales — declarados AL FINAL para no
    // alterar el orden posicional de los params existentes): `q` (folio/comprador) y rango de MONTO
    // sobre `totalCents`. `from`/`to` ya existían (rango sobre `createdAt`).
    @Query('q') q?: string,
    @Query('minCents') minCents?: string,
    @Query('maxCents') maxCents?: string,
    // 💰 v1.80.8.6 (§M4-SHIP.18.12 (7)): «reembolso por revisar» (clase L, `pending`).
    @Query('refundReview') refundReview?: string,
  ) {
    // Validación TRANSVERSAL (paginación/fecha/monto/`q`) → 400 VALIDATION_ERROR (§Convenciones),
    // mismos nombres/semántica que `GET /admin/buylist`.
    const f = parseAdminListFilters({ page, pageSize, q, from, to, minCents, maxCents });
    const p = f.page;
    const ps = f.pageSize;
    const where: Prisma.OrderWhereInput = {};
    // `P-84` — AQUÍ había un `status as never`: el valor crudo entraba al `where` y Prisma
    // reventaba con `PrismaClientValidationError`, que el filtro global manda a **`500 INTERNAL`**
    // (medido por HTTP: `?status=banana` ⇒ `500`). El contrato §M3 ya exigía `400 VALIDATION_ERROR`
    // aquí, así que esto NO es conducta nueva — es código que dejó de incumplir lo publicado.
    // Clase **E**: derivado de `OrderStatus`. Si el schema gana un estado, el operador debe poder
    // filtrar por él el mismo día; una lista a mano volvería invisible en el back-office un estado
    // que la BD sí guarda.
    const statusFilter = parseEnumFilter('status', status, ORDER_STATUS_FILTER_VALUES);
    if (statusFilter) where.status = statusFilter;
    if (userId) where.userId = userId;
    // v1.21-guest-checkout (§M3): filtro opcional por naturaleza del pedido.
    if (guest === 'true') where.guestEmail = { not: null };
    if (guest === 'false') where.guestEmail = null;
    // Solo los dos valores explícitos filtran: omitirlo (o cualquier otro valor) deja el listado
    // EXACTAMENTE como estaba (misma forma de respuesta y mismo comportamiento por defecto).
    if (needsManual === 'true') where.chargebackNeedsManual = true;
    if (needsManual === 'false') where.chargebackNeedsManual = false;
    if (parseEnumFilter('refundReview', refundReview, REFUND_REVIEW_FILTER_VALUES) === 'pending') {
      Object.assign(where, REFUND_REVIEW_PENDING_WHERE);
    }
    if (f.dateRange) where.createdAt = f.dateRange;
    // v1.25 (§M3): rango de MONTO sobre `totalCents` — total canónico de la orden (gte/lte).
    if (f.centsRange) where.totalCents = f.centsRange;
    // v1.25 (§M3): `q` contains case-insensitive OR sobre folio (`orderNumber`), correo de invitado
    // (`guestEmail`) e identidad del comprador con cuenta (`userId` EXACTO + `user.name`/`user.email`
    // vía la relación `Order.user`). Cubre invitado (guestEmail) y con cuenta. NO busca datos de pago
    // (`paymentMethodLast4` queda fuera de alcance). Prisma parametrizado — nunca SQL crudo.
    if (f.q) {
      where.OR = [
        { orderNumber: { contains: f.q, mode: 'insensitive' } },
        { guestEmail: { contains: f.q, mode: 'insensitive' } },
        { userId: f.q },
        { user: { name: { contains: f.q, mode: 'insensitive' } } },
        { user: { email: { contains: f.q, mode: 'insensitive' } } },
        // v1.80 (§M4-SHIP.10): el destinatario del envío (ruta JSON, parametrizado — ⛔ SQL crudo).
        { shippingAddressSnapshot: { path: ['recipientName'], string_contains: f.q } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        // v1.80 (§M4-SHIP.10): `customer` y `refundedCents` en la MISMA consulta (⛔ sin N+1).
        include: { user: { select: { id: true, name: true, nameSource: true, email: true } }, refunds: { select: { status: true, amountCents: true } } },
      }),
      this.prisma.order.count({ where }),
    ]);
    // v1.21-guest-checkout (§M3, ADITIVO): `isGuestOrder` derivado. Las columnas nuevas
    // (`guestEmail`, `orderNumber`, `fulfillmentMode`, `shippingFeeCents`, `claimedAt`,
    // `shippingAddressSnapshot`) ya viajan en la fila; el back-office está protegido por rol y el
    // correo del comprador es dato de contacto operativo (mismo criterio que AdminSellerRef.email).
    return {
      // 💰 v1.80.8.6: las columnas del motivo «tras envío» ⛔ no viajan crudas — NINGUNA de las cinco (QA MENOR-1,
      // 2026-10-04: tampoco `fullRefundAfterShipment` ni `shippedRefundReason`). La fila lleva SOLO `refundReviewPending`
      // (§M3); el detalle trae `fullRefundReview`. Lo fija `test/admin-orders.list-review-columns.spec.ts`.
      data: data.map(({ user, refunds, fullRefundAfterShipment, shippedRefundReason, shippedRefundNote: _n, shippedRefundReasonAt: _a, shippedRefundReasonByUserId: _b, ...o }) => ({
        ...o,
        refundReviewPending: isRefundReviewPending({ fullRefundAfterShipment, shippedRefundReason }),
        isGuestOrder: o.guestEmail != null,
        // v1.80 (§M4-SHIP.10): `CustomerRefDTO | null` (`null` ⇔ invitado) y lo devuelto por Stripe.
        customer: user ? { userId: user.id, fullName: customerDisplayName(user), email: customerEmailOrBlank(user.email, 'AdminOrderSummary.customer', user.id) } : null,
        refundedCents: refundedCentsOf(refunds ?? []), // (`?? []`: dobles legacy sin relaciones)
      })),
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
  async get(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
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
        fullRefundClosedAt: true,
        // 💰 v1.80.8.6 (§M4-SHIP.18.12 (7)): las columnas de `fullRefundReview` (⛔ no se esparcen crudas).
        fullRefundAfterShipment: true,
        shippedRefundReason: true,
        shippedRefundNote: true,
        shippedRefundReasonAt: true,
        shippedRefundReasonBy: FULL_REFUND_REVIEW_SELECT.shippedRefundReasonBy,
        // v1.80 (§M4-SHIP.10): el comprador, el libro, los envíos y la colocación — en la MISMA consulta.
        user: { select: { id: true, name: true, nameSource: true, email: true } },
        refunds: { orderBy: { createdAt: 'asc' }, include: { orderItem: { select: { inventoryItemId: true } } } },
        shipmentRequests: { orderBy: { requestedAt: 'asc' }, select: { id: true, status: true, userId: true, requestedAt: true, preparedAt: true, carrier: true, trackingNumber: true } },
        vaultPlacement: { select: { id: true, status: true } },
      },
    });
    // ⭐ v1.80.4 (§M4-SHIP.18.6) — `vaultPieces`, DERIVADO en la lectura (un cuerpo con el cierre).
    const vaultPieces = extra?.fulfillmentMode === 'vault' ? await this.refunds.vaultPieces(id) : undefined;
    if (!extra) throw BusinessException.notFound();
    const {
      user: buyer,
      refunds: rows,
      shipmentRequests,
      vaultPlacement,
      fullRefundAfterShipment,
      shippedRefundReason,
      shippedRefundNote,
      shippedRefundReasonAt,
      shippedRefundReasonBy,
      ...cols
    } = extra;
    const fullRefundReview = toFullRefundReviewDTO({
      fullRefundClosedAt: extra.fullRefundClosedAt,
      fullRefundAfterShipment,
      shippedRefundReason,
      shippedRefundNote,
      shippedRefundReasonAt,
      shippedRefundReasonBy,
    });
    const refundDtos = await this.ledger.toDtos(rows);
    // ⭐ v1.80.2 (§M4-SHIP.15.13): las transferencias SPEI de los casos de esta orden — SOLO súper-admin (dinero y PII).
    const manualRows = user.role === Role.super_admin ? await this.prisma.manualRefund.findMany({ where: { orderId: id }, select: { id: true, status: true, amountCents: true } }) : null;
    const manualRefunds = manualRows ? await this.manual.dtosByIds(manualRows.map((m) => m.id)) : undefined;
    return {
      ...detail,
      ...cols,
      isGuestOrder: extra.guestEmail != null,
      claimedAt: extra.claimedAt ?? undefined,
      customer: buyer ? { userId: buyer.id, fullName: customerDisplayName(buyer), email: customerEmailOrBlank(buyer.email, 'AdminOrderDetail.customer', buyer.id) } : null,
      refunds: refundDtos,
      // `items[].refund: PaymentRefundDTO | null` (§M4-SHIP.10 M3, cualquier estado): la fila de ESA carta.
      items: (detail.items as { inventoryItemId: string }[]).map((it) => {
        const i = rows.findIndex((r) => r.orderItem?.inventoryItemId === it.inventoryItemId);
        return { ...it, refund: i >= 0 ? refundDtos[i] : null };
      }),
      shipments: shipmentRequests.map((s) => ({
        id: s.id,
        status: s.status,
        kind: s.userId ? 'vault_withdrawal' : 'guest_direct_ship',
        requestedAt: s.requestedAt.toISOString(),
        preparedAt: s.preparedAt ? s.preparedAt.toISOString() : null,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
      })),
      vaultPlacement: vaultPlacement ?? null,
      // 💰 v1.80.8.6 (§M4-SHIP.18.12 (7)): el registro del motivo y el estado VIVO del envío (lo usa el diálogo de M3
      // para pedir el motivo antes de enviar; quien decide es la tx1, ⛔ no este campo).
      fullRefundReview,
      shipmentShipped: shipmentRequests.some((s) => isShippedOut(s.status)),
      // v1.80.8.7 A-1: `settledAt: string | null`, SIEMPRE presente (lo emite `getOrder`; se fija aquí su presencia).
      settledAt: (detail as { settledAt?: Date | string | null }).settledAt ?? null,
      ...(manualRefunds ? { manualRefunds, manualRefundedCents: manualRows!.filter((m) => m.status === 'paid').reduce((a, m) => a + m.amountCents, 0) } : {}),
      ...(vaultPieces ? { vaultPieces } : {}),
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
    const res = await this.orders.resolveChargebackInventory(id, dto.outcome, new Date(), user.id);
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
   * A1 — Reembolso admin. POLÍTICA DEL HUMANO: VENTAS FINALES, sin reembolso voluntario. Este endpoint es
   * EXCEPCIONAL (super_admin, money-out ya autorizado y auditado).
   *
   * ⭐ v1.80 (§M3, §M4-SHIP.7): reembolsa LO QUE QUEDA (`totalCents − Σ` filas no fallidas del libro), con
   * fila `order_full` y Stripe con `amount`; la cabecera `Idempotency-Key` se acepta y ⛔ ya no se usa (la
   * idempotencia es la llave del libro). 🔒 v1.80.3: cierra el envío vivo de un directo en su tx.
   * 💰 v1.80.4/.5: en una orden `vault` DESHACE la venta al confirmar (§M4-SHIP.18). Norma y candados:
   * `OrderRefundService.requestFullRefund`.
   */
  @Post(':id/refund')
  @MoneyOut()
  async refund(
    @Param('id') id: string,
    @Body() dto: RefundDto,
    @CurrentUser() user: { id: string; role: Role },
    @Headers('idempotency-key') _idempotencyKey?: string,
  ) {
    return this.refunds.requestFullRefund(id, dto, user);
  }

  /**
   * 💰 v1.80.8.6 (§M4-SHIP.18.12 (6)) — registrar el motivo de un reembolso total hecho tras «enviado». `@MoneyOut()`:
   * el operador recibe `403 MONEY_OUT_FORBIDDEN` AUDITADO (criterio 250). Cuerpo crudo (`unknown`): el servicio lo
   * valida entero (clave desconocida ⇒ 400; el `whitelist` global la borraría en silencio).
   */
  @Post(':id/shipped-refund-reason')
  @MoneyOut()
  @HttpCode(200)
  async shippedRefundReason(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.refunds.recordShippedRefundReason(id, body, user);
  }

  /**
   * 🔒 v1.80.5/.6 (§M4-SHIP.18.10) — re-correr el reclamo de una compra a bóveda ya cerrada por reembolso
   * total. `super_admin`; custodia, ⛔ no dinero (sin `@MoneyOut`); auditado SIEMPRE
   * (`order.vault_reclaim_requested`).
   */
  @Post(':id/reclaim-vault')
  @Roles(Role.super_admin)
  @HttpCode(200)
  async reclaimVault(
    @Param('id') id: string,
    @Body() dto: ReclaimVaultDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.refunds.reclaimVault(id, dto, user);
  }
}
