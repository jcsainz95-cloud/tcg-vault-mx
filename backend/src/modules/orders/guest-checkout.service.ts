import { Injectable, Logger } from '@nestjs/common';
import { Locale, Order, OrderStatus, Prisma, ShipmentRequest, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { computeDirectShipBreakdown, DirectShipBreakdownDTO } from '../../common/money';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { OrdersService } from './orders.service';
import { OrderAccessTokenService } from './order-access-token.service';
import { GuestOrderMailService } from './guest-order-mail.service';
import { GuestQuoteDto, GuestResendLinkDto, GuestSessionDto } from './dto/guest-checkout.dto';
import { maskEmail, maskPostalCode, maskRecipientName, normalizeEmail } from './guest-privacy';
import {
  DAY_MS,
  GUEST_DISPUTE_WINDOW_DAYS,
  GUEST_ORDER_RESERVATION_TTL_MIN,
  GUEST_TRACKING_MAX_AGE_DAYS,
  GuestOrderPublicStatus,
  SUPPORT_EVIDENCE_CONTACT,
} from './guest-checkout.constants';

/** Snapshot de dirección de un pedido `direct_ship` (el invitado no tiene fila `Address`). */
export interface GuestAddressSnapshot {
  line1: string;
  line2?: string | null;
  neighborhood?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  recipientName: string;
}

/**
 * GuestCheckoutService — comprar SIN cuenta (API_CONTRACT §4-G, ARCHITECTURE §4.21).
 *
 * Cinco invariantes que este servicio implementa y que NO se pueden relajar (§4-G.0):
 *  1. Un invitado NO tiene bóveda: sus `InventoryItem` conservan `ownerType='platform'`,
 *     `ownerUserId=null`, `ownershipStatus=null` durante TODO el ciclo; el estado lo lleva
 *     `status` (reserved → picking → shipped → delivered).
 *  2. El envío se cobra en el MISMO PaymentIntent que las cartas (`shippingFeeCents`).
 *  3. Un invitado nunca toca un endpoint `customer` (guard `RejectAuthenticatedGuard`), y el
 *     `OrderAccessToken` NO es credencial: solo lee UN pedido.
 *  4. El camino de invitado JAMÁS consulta `User` (ni por correo ni por nada): buscar
 *     `prisma.user` en este archivo debe dar CERO resultados (criterio 56).
 *  5. El único token en claro que devuelve la API es el de `POST /checkout/guest/session`, a
 *     quien acaba de crear el pedido.
 */
@Injectable()
export class GuestCheckoutService {
  private readonly logger = new Logger(GuestCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
    private readonly stripe: StripeService,
    private readonly tokens: OrderAccessTokenService,
    private readonly mail: GuestOrderMailService,
  ) {}

  // ------------------------------------------------------------------ quote

  /** §4-G.1 — desglose sin cobrar del carrito de invitado. READ-ONLY: no reserva inventario. */
  async quote(dto: GuestQuoteDto) {
    if (dto.shippingAddress) this.assertMxAddress(dto.shippingAddress.country);
    const { lines, subtotalCents } = await this.orders.priceCartLines(dto.inventoryItemIds);
    const breakdown = await this.breakdownFor(subtotalCents);
    return {
      items: lines.map((l) => ({
        inventoryItemId: l.inventoryItemId,
        card: l.cardSnapshot,
        unitPriceCents: l.unitPriceCents,
      })),
      fulfillmentMode: 'direct_ship' as const,
      breakdown,
      // Banderas, no texto (§0 i18n): el front renderiza ventas finales / factura / términos.
      notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    };
  }

  // ---------------------------------------------------------------- session

  /**
   * §4-G.2 — crea el pedido de invitado: reserva items, `Order` (`userId=null`, `guestEmail`,
   * `direct_ship`, snapshot de dirección) y UN SOLO PaymentIntent por el total (cartas + envío +
   * IVA + fee). Devuelve el `trackingToken` en claro a quien acaba de crear el pedido.
   */
  async createSession(dto: GuestSessionDto, requestIp?: string | null, idempotencyKey?: string) {
    // Destino bóveda ⇒ UPSELL, no error (criterio 48). El front NUNCA lo pinta como error.
    if (dto.fulfillmentMode === 'vault') {
      throw BusinessException.validation(
        'VAULT_REQUIRES_ACCOUNT',
        'The vault requires an account; guests can only use direct shipping.',
        { upsell: true, reason: 'VAULT_REQUIRES_ACCOUNT' },
      );
    }
    this.assertMxAddress(dto.shippingAddress.country);

    // Anti-enumeración (criterio 56): NO se consulta `User` por este correo. Que tenga cuenta o no
    // es indistinguible desde fuera (mismo status, mismo shape, mismos tiempos).
    const guestEmail = normalizeEmail(dto.email);

    const { lines, subtotalCents } = await this.orders.priceCartLines(dto.inventoryItemIds);
    const breakdown = await this.breakdownFor(subtotalCents);
    const orderNumber = await this.orders.nextOrderNumber();
    const addressSnapshot = this.toAddressSnapshot(dto.shippingAddress);

    const order = await this.prisma.$transaction(async (tx) => {
      for (const line of lines) {
        // Reserva ATÓMICA de la pieza única. DIFERENCIA CLAVE con el checkout con cuenta: NO se
        // escribe ownerType/ownerUserId/ownershipStatus — un pedido de invitado nunca entra a
        // bóveda (invariante §4-G.0-1). El guard `ownerType='platform'` impide además reservar
        // una pieza que ya es de un cliente.
        const reserved = await tx.inventoryItem.updateMany({
          where: {
            id: line.inventoryItemId,
            ownerType: 'platform',
            status: { in: ['listed', 'in_stock'] },
          },
          data: { status: 'reserved' },
        });
        if (reserved.count !== 1) {
          throw BusinessException.conflict('ITEM_UNAVAILABLE', 'Item unavailable');
        }
      }
      return tx.order.create({
        data: {
          userId: null,
          guestEmail,
          orderNumber,
          fulfillmentMode: 'direct_ship',
          shippingAddressSnapshot: addressSnapshot as unknown as Prisma.InputJsonValue,
          shippingFeeCents: breakdown.shippingFeeCents,
          locale: (dto.locale ?? 'es') as Locale,
          status: 'pending',
          subtotalCents: breakdown.subtotalCents,
          processingFeeCents: breakdown.processingFeeCents,
          ivaCents: breakdown.ivaCents,
          totalCents: breakdown.totalCents,
          ivaRatePct: breakdown.ivaRatePct,
          cfdiStatus: 'registrado',
          items: { create: lines },
        },
      });
    });

    // A2: el PaymentIntent es transaccional con la reserva. Si Stripe falla TRAS reservar, se
    // compensa (items vendibles otra vez + orden `failed`) y se devuelve un error de reintento.
    const idem = idempotencyKey ?? `pi-order-${order.id}`;
    let pi: { id: string; clientSecret: string };
    try {
      pi = await this.stripe.createPaymentIntent({
        amountCents: breakdown.totalCents,
        // Sin `userId` en la metadata: no hay usuario. `guest` permite distinguir en el dashboard.
        metadata: { orderId: order.id, kind: 'order', guest: 'true' },
        idempotencyKey: idem,
      });
    } catch (e) {
      await this.releaseReservation(
        order.id,
        lines.map((l) => l.inventoryItemId),
      );
      throw this.toRetryError(e);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: pi.id },
    });

    // §4-G.0-5: ÚNICA respuesta de API con un token en claro. Quien llama ES quien creó el pedido,
    // así que no hay filtración posible; resuelve la confirmación tras el redirect 3DS (sin sesión).
    const { clear } = await this.tokens.issue(order.id, { rotate: false, requestIp });

    return {
      orderId: order.id,
      orderNumber,
      breakdown,
      trackingToken: clear,
      stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret },
    };
  }

  // ------------------------------------------------------------------ track

  /**
   * §4-G.3 — vista pública de UN pedido. El DTO es una ALLOWLIST estricta: cualquier campo fuera
   * de la lista del contrato está PROHIBIDO (ids internos, dirección completa, correo/teléfono,
   * datos de pago más allá de marca+last4, datos internos y cualquier acción).
   * Errores NEUTROS: nunca revelan si el pedido existe.
   */
  async track(clearToken: string, now = new Date()) {
    const validation = await this.tokens.validate(clearToken, now);
    if (!validation.ok) {
      if (validation.code === 'INVALID_TOKEN') {
        throw BusinessException.notFound('INVALID_TOKEN', 'Invalid or unknown tracking link');
      }
      if (validation.code === 'TOKEN_EXPIRED') {
        throw new BusinessException('TOKEN_EXPIRED', 410, 'This tracking link has expired');
      }
      throw new BusinessException('TOKEN_REVOKED', 410, 'This tracking link is no longer valid', {
        reason: validation.reason,
      });
    }
    const token = validation.token;
    const order = await this.prisma.order.findUnique({
      where: { id: token.orderId },
      include: {
        items: { include: { inventoryItem: { include: { card: { include: { set: true } } } } } },
        shipmentRequests: { orderBy: { requestedAt: 'desc' } },
      },
    });
    // Defensa: un token vivo sin pedido (borrado) se trata igual que un token inventado.
    if (!order) throw BusinessException.notFound('INVALID_TOKEN', 'Invalid or unknown tracking link');

    await this.tokens.markUsed(token.id, now);
    return this.toTrackingDto(order, token.expiresAt);
  }

  // ----------------------------------------------------------- resend link

  /**
   * §4-G.4 — reenvía al correo DEL PEDIDO (nunca a otro) un enlace nuevo (rota los anteriores).
   * SIEMPRE responde `202 {status:'ACCEPTED'}`, exista o no el pedido/correo/token: no hay `404`,
   * ni diferencia de cuerpo, ni de tiempos (el trabajo real es post-respuesta, best-effort).
   * Únicos errores posibles: `400 VALIDATION_ERROR` (forma) y `429 RATE_LIMITED` (throttler).
   */
  resendLink(dto: GuestResendLinkDto): { status: 'ACCEPTED' } {
    const byToken = dto.token != null && dto.token !== '';
    const byPair = dto.email != null && dto.orderNumber != null;
    // `email` SOLO nunca se acepta: pedir además el número de pedido lo inutiliza como oráculo
    // ("¿este correo compró aquí?") y como vector de spam a terceros.
    const emailAlone = dto.email != null && dto.orderNumber == null;
    const orderNumberAlone = dto.orderNumber != null && dto.email == null;
    if ((byToken && (byPair || emailAlone || orderNumberAlone)) || (!byToken && !byPair)) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        'Provide either { token } or { email, orderNumber }',
      );
    }
    // Fire-and-forget: la respuesta no espera al trabajo real (ni a la latencia del correo).
    void this.processResend(dto);
    return { status: 'ACCEPTED' };
  }

  /**
   * Trabajo real del reenvío: best-effort y SILENCIOSO. Cualquier condición que impida enviar
   * (pedido inexistente, correo que no corresponde, pedido no-invitado, pedido fuera del tope de
   * edad, cuota diaria agotada) termina en no-op — jamás en un error observable.
   * `GUEST_ORDER_TOO_OLD` NO se devuelve aquí (sería un oráculo de existencia).
   */
  async processResend(dto: GuestResendLinkDto, now = new Date()): Promise<boolean> {
    try {
      const order = await this.findOrderForResend(dto);
      if (!order || !order.guestEmail) return false;
      if (order.createdAt.getTime() < now.getTime() - GUEST_TRACKING_MAX_AGE_DAYS * DAY_MS) {
        this.logger.debug(`resend skipped: order ${order.id} beyond max age`);
        return false;
      }
      if (await this.tokens.resendQuotaExceeded(order.id, now)) {
        this.logger.debug(`resend skipped: order ${order.id} over daily quota`);
        return false;
      }
      await this.mail.sendTrackingLink(order);
      return true;
    } catch (e) {
      this.logger.error(`resend failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Resuelve el pedido del reenvío. NUNCA consulta `User`; compara contra `Order.guestEmail`. */
  private async findOrderForResend(dto: GuestResendLinkDto): Promise<Order | null> {
    if (dto.token) {
      // Se acepta un token EXPIRADO o REVOCADO (el caso de uso es justo la página de "enlace
      // caducado"); solo se usa para identificar el pedido, nunca para autorizar una acción.
      const validation = await this.tokens.validate(dto.token);
      const orderId = validation.ok ? validation.token.orderId : (validation as { token?: { orderId: string } }).token?.orderId;
      if (!orderId) return null;
      return this.prisma.order.findUnique({ where: { id: orderId } });
    }
    const order = await this.prisma.order.findUnique({
      where: { orderNumber: dto.orderNumber as string },
    });
    if (!order || !order.guestEmail) return null;
    // El par debe coincidir exactamente; el envío va SIEMPRE a `Order.guestEmail`.
    return order.guestEmail === normalizeEmail(dto.email as string) ? order : null;
  }

  // ------------------------------------------------------------------ sweep

  /**
   * T9 (ARCHITECTURE §4.21e) — barrido de reservas de pedidos de invitado `pending` más viejos
   * que `GUEST_ORDER_RESERVATION_TTL_MIN`: libera las piezas (reserved → listed), marca la orden
   * `failed` y cancela el PaymentIntent (best-effort). Sin él, un atacante puede retener
   * inventario creando pedidos que nunca paga.
   */
  async sweepStaleGuestOrders(now = new Date()): Promise<{ swept: number }> {
    const cutoff = new Date(now.getTime() - GUEST_ORDER_RESERVATION_TTL_MIN * 60 * 1000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        guestEmail: { not: null },
        fulfillmentMode: 'direct_ship',
        createdAt: { lt: cutoff },
      },
      include: { items: { select: { inventoryItemId: true } } },
    });
    let swept = 0;
    for (const order of stale) {
      await this.releaseReservation(
        order.id,
        order.items.map((i) => i.inventoryItemId),
      );
      if (order.stripePaymentIntentId) {
        await this.stripe
          .cancelPaymentIntent(order.stripePaymentIntentId)
          .catch((e: unknown) =>
            this.logger.warn(`guest-order-sweep: no se pudo cancelar el PI: ${(e as Error).message}`),
          );
      }
      swept += 1;
    }
    if (swept > 0) this.logger.log(`guest-order-sweep: ${swept} pedidos de invitado liberados.`);
    return { swept };
  }

  // ------------------------------------------------------------- internals

  private assertMxAddress(country: string): void {
    if (country !== 'MX') {
      throw BusinessException.validation('ADDRESS_NOT_MX', 'Only MX addresses are allowed');
    }
  }

  private toAddressSnapshot(a: {
    line1: string;
    line2?: string;
    neighborhood?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone: string;
    recipientName: string;
  }): GuestAddressSnapshot {
    return {
      line1: a.line1,
      line2: a.line2 ?? null,
      neighborhood: a.neighborhood ?? null,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      country: a.country,
      phone: a.phone,
      recipientName: a.recipientName,
    };
  }

  /** Desglose con envío DENTRO de la orden (§4-G.0-2). La tarifa reusa el dial `SHIPPING_FEE_CENTS`. */
  private async breakdownFor(subtotalCents: number): Promise<DirectShipBreakdownDTO> {
    const shippingFeeCents = await this.settings.getNumber(SettingKey.SHIPPING_FEE_CENTS);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    return computeDirectShipBreakdown(subtotalCents, shippingFeeCents, ivaPct, fee);
  }

  /**
   * A2: compensación de la reserva. Devuelve cada pieza a `listed` (sigue siendo de plataforma:
   * nunca dejó de serlo) y marca la orden `failed`. La guardia `status:'reserved'` evita liberar
   * piezas que otro flujo ya movió.
   */
  private async releaseReservation(orderId: string, itemIds: string[]): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        await tx.inventoryItem.updateMany({
          where: { id: { in: itemIds }, status: 'reserved' },
          data: { status: 'listed' },
        });
        await tx.order.update({ where: { id: orderId }, data: { status: 'failed' } });
      })
      .catch(() => undefined);
  }

  private toRetryError(e: unknown): unknown {
    if (e instanceof BusinessException) return e;
    return BusinessException.retriable(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payment provider unavailable; the reservation was released. Please retry.',
    );
  }

  /**
   * §4-G.5 — mapeo normativo `Order.status` (+ envío) → `GuestOrderPublicStatus`. El estado
   * público NO es una columna: se deriva. `chargeback` NO se nombra hacia el invitado
   * (`en_revision`): decir "contracargo" en una vista sin autenticar da información operativa.
   */
  publicStatus(orderStatus: OrderStatus, shipmentStatus?: ShipmentStatus | null): GuestOrderPublicStatus {
    switch (orderStatus) {
      case 'pending':
        return 'pendiente_pago';
      case 'failed':
        return 'cancelado';
      case 'refunded':
        return 'reembolsado';
      case 'chargeback':
        return 'en_revision';
      case 'settled':
        break;
    }
    switch (shipmentStatus) {
      case 'solicitado':
      case 'picking':
        return 'preparando';
      case 'guia':
        return 'guia';
      case 'enviado':
        return 'enviado';
      case 'entregado':
        return 'entregado';
      case 'cancelado':
        return 'en_revision';
      default:
        // Ventana entre el webhook y la creación del envío.
        return 'pagado';
    }
  }

  /**
   * Envío VIGENTE del pedido: el más reciente no cancelado (si todos están cancelados, el más
   * reciente). Invariante de aplicación: a lo más un envío ACTIVO por orden.
   */
  private activeShipment(shipments: ShipmentRequest[]): ShipmentRequest | undefined {
    return shipments.find((s) => s.status !== 'cancelado') ?? shipments[0];
  }

  /**
   * Construye el `GuestOrderTrackingDTO`. ALLOWLIST literal del contrato: se enumeran uno por uno
   * los campos permitidos y NO se hace spread de ninguna fila de BD — así, si el modelo gana una
   * columna interna mañana, NO se filtra por accidente (mismo criterio que `toClientShipment`).
   */
  private toTrackingDto(
    order: Order & {
      items: {
        unitPriceCents: number;
        inventoryItem: {
          finish: string;
          productType: string;
          rawCondition: string | null;
          sealedSubtype: string | null;
          gradingCompany: string | null;
          gradeValue: string | null;
          card: { name: string; number: string; imageSmallUrl: string | null; set: { name: string } | null };
        };
      }[];
      shipmentRequests: ShipmentRequest[];
    },
    tokenExpiresAt: Date,
  ) {
    const shipment = this.activeShipment(order.shipmentRequests);
    const address = (order.shippingAddressSnapshot ?? {}) as Partial<GuestAddressSnapshot>;
    const deliveredAt = shipment?.deliveredAt ?? null;

    return {
      // Identificador LEGIBLE. El uuid interno (`order.id`) está PROHIBIDO aquí (§4-G.3).
      orderNumber: order.orderNumber ?? '',
      status: this.publicStatus(order.status, shipment?.status),
      placedAt: order.createdAt,
      paidAt: order.settledAt ?? undefined,
      // Confirma al comprador QUÉ correo usó, sin revelarlo (el enlace puede reenviarse).
      emailMasked: maskEmail(order.guestEmail),
      items: order.items.map((oi) => ({
        name: oi.inventoryItem.card.name,
        setName: oi.inventoryItem.card.set?.name ?? '',
        number: oi.inventoryItem.card.number,
        finish: oi.inventoryItem.finish,
        productType: oi.inventoryItem.productType,
        rawCondition: oi.inventoryItem.rawCondition ?? undefined,
        sealedSubtype: oi.inventoryItem.sealedSubtype ?? undefined,
        gradingCompany: oi.inventoryItem.gradingCompany ?? undefined,
        gradeValue: oi.inventoryItem.gradeValue ?? undefined,
        imageSmallUrl: oi.inventoryItem.card.imageSmallUrl ?? undefined,
        unitPriceCents: oi.unitPriceCents,
      })),
      breakdown: {
        subtotalCents: order.subtotalCents,
        shippingFeeCents: order.shippingFeeCents,
        ivaCents: order.ivaCents,
        ivaRatePct: order.ivaRatePct,
        processingFeeCents: order.processingFeeCents,
        totalCents: order.totalCents,
        currency: 'MXN' as const,
      },
      shipping: {
        // Dirección MÍNIMA: ciudad/estado + 2 últimos dígitos del CP + nombre abreviado.
        city: address.city ?? '',
        state: address.state ?? '',
        postalCodeMasked: maskPostalCode(address.postalCode),
        recipientNameMasked: maskRecipientName(address.recipientName),
        carrier: shipment?.carrier ?? undefined,
        trackingNumber: shipment?.trackingNumber ?? undefined,
        shippedAt: shipment?.shippedAt ?? undefined,
        deliveredAt: deliveredAt ?? undefined,
      },
      // Solo tras liquidar, y SOLO marca + 4 últimos (nunca PAN/BIN/titular/clientSecret).
      payment:
        order.paymentMethodBrand || order.paymentMethodLast4
          ? {
              brand: order.paymentMethodBrand ?? undefined,
              last4: order.paymentMethodLast4 ?? undefined,
            }
          : undefined,
      claim: { available: order.claimedAt == null },
      support: {
        evidenceContact: SUPPORT_EVIDENCE_CONTACT,
        disputeWindowDays: GUEST_DISPUTE_WINDOW_DAYS,
        disputeDeadlineAt: deliveredAt
          ? new Date(deliveredAt.getTime() + GUEST_DISPUTE_WINDOW_DAYS * DAY_MS)
          : undefined,
      },
      tokenExpiresAt,
    };
  }
}
