import { Injectable, Logger } from '@nestjs/common';
import { Locale, Order, OrderStatus, Prisma, ShipmentRequest, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import {
  BreakdownDTO,
  computeCartBreakdown,
  computeDirectShipBreakdown,
  DirectShipBreakdownDTO,
} from '../../common/money';
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
  GUEST_CHECKOUT_TOKEN_TTL_MIN,
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

  /**
   * §4-G.1 — desglose sin cobrar del carrito de invitado. READ-ONLY: no reserva inventario.
   * v1.21.3-quote-prune: resolución POR ÍTEM (misma norma que `POST /checkout/quote`, porque
   * comparten `priceCartForQuote`): los ids muertos viajan en `unavailableItems` con `200`;
   * `items`/`breakdown` se calculan SOLO con los válidos. Carrito 100 % muerto ⇒ breakdown EN
   * CEROS incluido `shippingFeeCents: 0` (no hay nada que enviar), conservando
   * `fulfillmentMode`/`notices` (shape estable). El tope `GUEST_MAX_ITEMS` lo valida el DTO sobre
   * el array del REQUEST (pre-poda): podar a vacío es `200`, no `400`.
   * `createSession` (abajo) NO usa esta ruta: sigue estricta (anti double-sell).
   */
  async quote(dto: GuestQuoteDto) {
    if (dto.shippingAddress) this.assertMxAddress(dto.shippingAddress.country);
    const { items, lines, subtotalCents, unavailableItems } = await this.orders.priceCartForQuote(
      dto.inventoryItemIds,
    );
    const { breakdown, vaultBreakdown } = await this.quoteBreakdowns(
      subtotalCents,
      lines.length === 0,
    );
    return {
      // §5.2.5 / contrato v1.51-b: `card` es un `OrderItemCardDTO` (8 hechos congelados +
      // `imageSmallUrl` resuelta en lectura). Se usa el MISMO cuerpo que `POST /checkout/quote`
      // —el hueco gris del invitado tenía exactamente la misma causa— y sin consulta extra: la
      // imagen sale del `card` que `priceCartForQuote` ya cargó para preciar.
      items: this.orders.toOrderItemPreviews(items, lines),
      fulfillmentMode: 'direct_ship' as const,
      breakdown,
      // v1.21.4-dual-breakdown (§4-G.1): segundo desglose "de bóveda" (solo cartas, SIN envío),
      // informativo/reactivo (gancho del upsell). SIEMPRE presente; pagar bóveda sigue exigiendo
      // cuenta (§4-G.2 `422 VAULT_REQUIRES_ACCOUNT`).
      vaultBreakdown,
      unavailableItems,
      // Banderas, no texto (§0 i18n): el front renderiza ventas finales / factura / términos.
      notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    };
  }

  // ---------------------------------------------------------------- session

  /**
   * §4-G.2 — crea el pedido de invitado: reserva items, `Order` (`userId=null`, `guestEmail`,
   * `direct_ship`, snapshot de dirección) y UN SOLO PaymentIntent por el total (cartas + envío +
   * IVA + fee). Devuelve el `checkoutToken` (vida corta, §4-G.7a) a quien acaba de crear el pedido.
   */
  async createSession(dto: GuestSessionDto, requestIp?: string | null) {
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

    const { items, lines, subtotalCents } = await this.orders.priceCartForOrder(dto.inventoryItemIds);
    const breakdown = await this.breakdownFor(subtotalCents);
    const orderNumber = await this.orders.nextOrderNumber();
    const addressSnapshot = this.toAddressSnapshot(dto.shippingAddress);

    const order = await this.prisma.$transaction(async (tx) => {
      // Reserva ATÓMICA por el helper COMPARTIDO con el checkout de bóveda (T2): mismas guardias
      // (`ownerType='platform'` + estado vendible + `count===1`). La diferencia de esta ruta es el
      // `null`: NO se escribe titularidad, la pieza sigue siendo de la plataforma durante todo el
      // ciclo — invariante §4-G.0-1 (un invitado no tiene bóveda).
      await this.orders.reserveItems(tx, items, null);
      // PROJECTION-EXEMPT: return DENTRO de la `$transaction`; el caller proyecta la respuesta del
      // checkout de invitado (orderId/orderNumber/breakdown/stripe), nunca la fila `Order`.
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

    // A2: crear PI + compensar si el proveedor falla + persistir el id, por el helper COMPARTIDO
    // (T2). Lo único propio de esta ruta es la metadata: sin `userId` (no hay usuario) y con
    // `guest:'true'` para distinguir el pedido en el dashboard de Stripe.
    const pi = await this.orders.attachPaymentIntent({
      orderId: order.id,
      amountCents: breakdown.totalCents,
      metadata: { orderId: order.id, kind: 'order', guest: 'true' },
      inventoryItemIds: lines.map((l) => l.inventoryItemId),
    });

    // §4-G.0-5: ÚNICA respuesta de API con un token en claro. Quien llama ES quien creó el pedido,
    // así que no hay filtración posible; resuelve la confirmación tras el redirect 3DS (sin sesión).
    // v1.21.1 (§4-G.7a): es el token de CHECKOUT — vida CORTA (120 min) y NUNCA por correo. El
    // enlace duradero de 90 días lo emite el settle y viaja solo por correo. Así, el solapamiento
    // de dos puertas sin contraseña dura ≤2 h (T7b) en vez de 90 días.
    const { clear, expiresAt } = await this.tokens.issue(order.id, {
      rotate: false,
      requestIp,
      ttlMs: GUEST_CHECKOUT_TOKEN_TTL_MIN * 60 * 1000,
    });

    return {
      orderId: order.id,
      orderNumber,
      breakdown,
      checkoutToken: clear,
      checkoutTokenExpiresAt: expiresAt,
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
      // v1.21.1 (§4-G.4): el token vale como SELECTOR aunque esté EXPIRADO o REVOCADO — es el caso
      // NORMAL (se llega desde la página de "enlace expirado", o con un checkoutToken de 120 min ya
      // vencido). `orderIdForSelector` busca SOLO por hash, sin filtrar por expiresAt/revokedAt.
      // Identificar el pedido ≠ leerlo: la lectura (§4-G.3) sí exige un token vigente.
      const orderId = await this.tokens.orderIdForSelector(dto.token);
      if (!orderId) return null;
      // PROJECTION-EXEMPT: helper PRIVADO (`findOrderForResend`); resuelve el pedido para decidir a
      // qué correo se reenvía el enlace. Su valor NO sale en ninguna respuesta (§4-G.4 responde igual
      // exista o no el pedido, por anti-enumeración).
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
    let skipped = 0;
    for (const order of stale) {
      // B3 (v1.21.2) — ORDEN CRÍTICO: primero se CIERRA la vía de cobro y solo DESPUÉS se suelta
      // el inventario. Al revés (v1.21) producía el peor estado posible: el barrido liberaba la
      // pieza, la cancelación fallaba o llegaba tarde, y un webhook `succeeded` posterior liquidaba
      // la orden y creaba el envío ⇒ pedido PAGADO, envío en la cola del operador y la MISMA pieza
      // única otra vez comprable. Un PI que no se pudo cancelar significa que el pago **todavía
      // puede confirmarse**: esa reserva NO se puede soltar.
      if (order.stripePaymentIntentId) {
        const closed = await this.closePaymentIntentForSweep(order.stripePaymentIntentId);
        if (!closed) {
          // NO se traga el fallo (B3): el pedido no se barre en esta pasada y queda visible.
          this.logger.error(
            `guest-order-sweep: NO se pudo cancelar el PaymentIntent ${order.stripePaymentIntentId} ` +
              `del pedido ${order.orderNumber ?? order.id}; la reserva NO se libera (el pago aún ` +
              'puede confirmarse). Se reintentará en la próxima pasada.',
          );
          skipped += 1;
          continue;
        }
      }
      await this.orders.releaseReservation(
        order.id,
        order.items.map((i) => i.inventoryItemId),
      );
      swept += 1;
    }
    if (skipped > 0) {
      this.logger.warn(`guest-order-sweep: ${skipped} pedidos NO barridos (PaymentIntent vivo).`);
    }
    if (swept > 0) this.logger.log(`guest-order-sweep: ${swept} pedidos de invitado liberados.`);
    return { swept };
  }

  /**
   * B3 — cierra la vía de cobro de un pedido abandonado. Devuelve `true` SOLO si el PaymentIntent
   * quedó efectivamente cancelado (o ya lo estaba); `false` si sigue vivo, si ya se pagó o si no
   * se pudo determinar. **Ante la duda, `false`**: no liberar una reserva es un coste acotado
   * (inventario retenido una pasada más); liberarla con el pago vivo es un double-sell.
   */
  private async closePaymentIntentForSweep(paymentIntentId: string): Promise<boolean> {
    try {
      const { status } = await this.stripe.cancelPaymentIntent(paymentIntentId);
      return status === 'canceled';
    } catch (e) {
      // Stripe lanza tanto si el PI YA estaba cancelado (inocuo, se puede liberar) como si ya se
      // PAGÓ (jamás liberar). Se desambigua consultando el estado real.
      const status = await this.stripe.getPaymentIntentStatus(paymentIntentId);
      if (status === 'canceled') return true;
      this.logger.error(
        `guest-order-sweep: cancelación del PI ${paymentIntentId} falló (${(e as Error).message}); ` +
          `estado observado: ${status ?? 'desconocido'}.`,
      );
      return false;
    }
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

  /**
   * v1.21.4-dual-breakdown (§4-G.1) — computa los DOS desgloses del quote de invitado en UNA sola
   * lectura de settings (mismos diales que `breakdownFor`), sobre el MISMO `subtotalCents`:
   *  - `breakdown` (`DirectShipBreakdownDTO`, CON envío): el destino "envío directo", lo que se
   *    cobra; no cambió de shape ni fórmulas respecto de v1.21.3.
   *  - `vaultBreakdown` (`BreakdownDTO`, SIN envío): el destino "bóveda", SOLO cartas, informativo.
   *    Es EXACTAMENTE `computeCartBreakdown(subtotal, ivaRatePct, fee)` (§4-G.1).
   * Carrito 100 % podado (`empty`): AMBOS en ceros. El `breakdown` extiende el cero canónico de
   * `OrdersService` con `shippingFeeCents: 0` (nada que enviar); el `vaultBreakdown` ES ese mismo
   * cero canónico (cart breakdown sin envío), SIN `shippingFeeCents`.
   */
  private async quoteBreakdowns(
    subtotalCents: number,
    empty: boolean,
  ): Promise<{ breakdown: DirectShipBreakdownDTO; vaultBreakdown: BreakdownDTO }> {
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    if (empty) {
      const zero = this.orders.zeroCartBreakdown(ivaPct);
      return { breakdown: { ...zero, shippingFeeCents: 0 }, vaultBreakdown: zero };
    }
    const shippingFeeCents = await this.settings.getNumber(SettingKey.SHIPPING_FEE_CENTS);
    return {
      breakdown: computeDirectShipBreakdown(subtotalCents, shippingFeeCents, ivaPct, fee),
      vaultBreakdown: computeCartBreakdown(subtotalCents, ivaPct, fee),
    };
  }

  /** Desglose con envío DENTRO de la orden (§4-G.0-2). La tarifa reusa el dial `SHIPPING_FEE_CENTS`. */
  private async breakdownFor(subtotalCents: number): Promise<DirectShipBreakdownDTO> {
    const shippingFeeCents = await this.settings.getNumber(SettingKey.SHIPPING_FEE_CENTS);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    // MS-2 (BE-27): el pedido de invitado también PERSISTE una Order; un agregado no representable en
    // Int32 → 422 AMOUNT_TOO_LARGE vía la fuente única `orders.representableOrThrow` (no se persiste
    // overflow ni se clampa el total). El `quote` (read-only) NO usa esta ruta.
    return this.orders.representableOrThrow(() =>
      computeDirectShipBreakdown(subtotalCents, shippingFeeCents, ivaPct, fee),
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
