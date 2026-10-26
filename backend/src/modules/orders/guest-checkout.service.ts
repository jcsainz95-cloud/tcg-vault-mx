import { measurementColumnsData, type MeasurementColumns } from '../measurement/measurement-input';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Locale, Order, OrderStatus, Prisma, ProductType, ShipmentRequest, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { pieceDisplayIdentityOf } from '../../common/piece-display-identity';
import { PRICE_CONVENTION_OF_NEW_ROWS, BreakdownDTO, computeCartBreakdown, DirectShipBreakdownDTO } from '../../common/money';
import type { IvaDials } from '../../common/money';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { OrdersService, OwnReservation } from './orders.service';
import { frozenDirectShipBreakdownOf } from './frozen-breakdown';
import { RESERVATION_TX_OPTIONS, lockReservationGate, reservedUntilFrom } from './reservation';
import { OrderAccessTokenService } from './order-access-token.service';
import { activeShipment, clientRefundOf, publicStatus, refundedCentsOf } from './order-public-status';
import { CUSTOMER_TIMELINE_EVENTS_SELECT, TimelineEventRow, providerTrackingUrlOf, toCustomerTimeline } from '../shipments/customer-timeline';
import { GuestOrderMailService } from './guest-order-mail.service';
import { PostalCodeService } from '../shipping-provider/geo/postal-code';
import { blankToNull } from '../users/address-rules';
import { GuestQuoteDto, GuestResendLinkDto, GuestSessionDto } from './dto/guest-checkout.dto';
import { maskEmail, maskPostalCode, maskRecipientName, normalizeEmail } from './guest-privacy';
import {
  DAY_MS,
  GUEST_CHECKOUT_TOKEN_TTL_MIN,
  GUEST_DISPUTE_WINDOW_DAYS,
  GUEST_ORDER_RESERVATION_TTL_MIN,
  GUEST_TRACKING_MAX_AGE_DAYS,
  GuestOrderPublicStatus,
} from './guest-checkout.constants';
import { supportContact } from '../mail/support-contact';
import { DecksMetaService } from '../decks-meta/decks-meta.service';
import { sameLooseCart } from './accessory-cart';
import { reserveAccessories } from './accessory-stock';
import { BoxChoice, boxSnapshotOf } from './box-fit';
import {
  DirectShipDials,
  GuestShippingRuleDTO,
  PublicShippingRuleDTO,
  ShippingRuleKind,
  directShipBreakdownOf,
  directShipFeeOf,
  publicShippingRuleOf,
  shippingRuleDtoOf,
  shippingRuleKindOf,
} from './shipping-rule';
import {
  EMPTY_QUOTE_ACCESSORY_PART,
  QuoteAccessoryPart,
  SessionAccessoryPart,
  boxChoiceOf,
  createAccessoryLines,
  orderAccessoryCartOf,
  ownAccessoryReservedOf,
  quoteAccessoryPart,
  sameSlugSet,
  sessionAccessoryPart,
  sessionLinesDtoOf,
  shippingBoxDtoOf,
} from './guest-accessory-cart';
import { ACCESSORY_LINE_READ_INCLUDE, AccessoryLineReadRow, toOrderAccessoryLineDTO } from './accessory-lines-view';
import { photoDTO } from '../accessories/accessory-dto';
import { AppliedInTx, DiscountQuoteDTO, DiscountsService, normalizeDiscountCode } from '../discounts/discounts.service';
import { AppliedCartDiscount, priceDirectShipCartWithCode } from '../discounts/discount-pricing';
import {
  accessoryDiscountLines,
  bundleDiscountLines,
  chargedPieceLine,
  discountedAccessoryLine,
  FrozenAccessoryPrice,
  frozenAccessoryLine,
  frozenAccessoryMapOf,
  pieceDiscountLines,
  projectLineDiscount,
} from '../discounts/discount-lines';
import { frozenPieceDiscountsOf, orderDiscountOf, sameCodeAsOrder } from '../discounts/redemption';
import type { DiscountCartLine } from '../../common/money';
import type { EnergyBundleDTO } from '../decks-meta/energy-bundle';

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
  /** ⭐ v1.81 (M-64): décimo campo. Ausente en los snapshots anteriores (se lee como `null`). */
  references?: string | null;
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
    // ⭐ v1.81 (M-64, §M4-SHIP.19.5): la lista de colonias por CP. `@Optional()` (unitarios a mano); sin él, cotizar
    // con dirección o crear la sesión LANZA — ⛔ un pedido nunca nace sin validar la colonia.
    @Optional() private readonly postalCodesSvc?: PostalCodeService,
    // 💰 v1.86⟨accesorios⟩ (§AC.19.4): el validador de `deckPulls` (stream C). `@Optional()` por los unitarios a mano;
    // sin él, un carrito CON `deckPulls` lanza (⛔ nunca se cobra un paquete sin validar).
    @Optional() private readonly decksMeta?: DecksMetaService,
    // 💰 v1.110⟨descuentos⟩ (§DSC.5/§DSC.6). TL-DSC-5: ⛔ sin `@Optional()` — en la app el proveedor es obligatorio. El `?`
    // de TS es para los unitarios a mano: un request CON código y sin él falla ruidoso; las lecturas no lo necesitan.
    private readonly discountsSvc?: DiscountsService,
  ) {}

  private get discounts(): DiscountsService {
    if (!this.discountsSvc) throw new Error('DiscountsService no disponible');
    return this.discountsSvc;
  }

  private get postalCodes(): PostalCodeService {
    if (!this.postalCodesSvc) throw new Error('PostalCodeService no disponible');
    return this.postalCodesSvc;
  }

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
  async quote(dto: GuestQuoteDto, requestIp?: string | null) {
    const code = normalizeDiscountCode(dto.discountCode);
    if (dto.shippingAddress) {
      // ⭐ v1.80.12.5 (§M4-SHIP.19.25.1): el quote NO consulta el catálogo — solo forma (pipe) y `ADDRESS_NOT_MX`.
      // No persiste nada y ya no hay nada geográfico que rechazar.
      this.assertMxAddress(dto.shippingAddress.country);
    }
    // v1.68.1 (§4-R.5): la reserva propia existe SOLO con `retryOfCheckoutToken` + `email` válidos
    // (misma regla que la sesión, §4-R.3). Token inválido/otro correo ⇒ conducta de hoy. READ-ONLY.
    const claimedOrderId =
      dto.retryOfCheckoutToken && dto.email
        ? await this.resolveRetryClaim(dto.retryOfCheckoutToken, normalizeEmail(dto.email))
        : null;
    const {
      items,
      lines,
      subtotalCents,
      ivaDials,
      unavailableItems,
      ownReservation,
      reservedByYou,
      frozenOrder: frozenByItems,
    } = await (code === null
      ? this.orders.priceCartForQuote(dto.inventoryItemIds, claimedOrderId ? { orderId: claimedOrderId } : undefined)
      : // 💰 v1.110 (§DSC.5): congela solo con el MISMO código (sin código, el `null` por defecto: una orden CON código no se congela).
        this.orders.priceCartForQuote(dto.inventoryItemIds, claimedOrderId ? { orderId: claimedOrderId } : undefined, new Date(), code));
    // 💰 v1.86⟨accesorios⟩ (§AC.19.4, orden normativo de `quote`): (2) poda de piezas ⇒ `lines`; (3) el validador de
    // decks con las piezas YA podadas; (4) existencias: paquetes primero, luego sueltos con el remanente; (5) traducción;
    // (6) caja y desglose con lo que quedó. Sin accesorios ni `deckPulls` ⇒ ⛔ no se lee nada más (I-AC-5).
    const accLines = dto.accessoryLines ?? [];
    const pulls = dto.deckPulls ?? [];
    const acc: QuoteAccessoryPart =
      accLines.length > 0 || pulls.length > 0
        ? await quoteAccessoryPart(this.prisma as unknown as Prisma.TransactionClient, this.decksMeta, {
            lines: accLines,
            pulls,
            prunedInventoryItemIds: lines.map((l) => l.inventoryItemId),
            extra: claimedOrderId ? await ownAccessoryReservedOf(this.prisma as unknown as Prisma.TransactionClient, [claimedOrderId]) : undefined,
          })
        : EMPTY_QUOTE_ACCESSORY_PART;
    const frozenCandidate = await this.frozenForQuote(frozenByItems, claimedOrderId, lines.length, acc);
    // 💰 v1.110 (§DSC.5): el congelado de la orden propia rige solo con el MISMO código (o ninguno en los dos lados).
    const frozenOrder = frozenCandidate && (await sameCodeAsOrder(this.prisma, frozenCandidate.id, code)) ? frozenCandidate : null;
    const itemsEmpty = lines.length === 0;
    const empty = itemsEmpty && acc.accessoryLines.length === 0 && acc.energyBundles.length === 0;
    // 💰 v1.109 (§4-G.12 paso 1): la clase sale de lo cobrable YA podado (piezas válidas + accesorios y paquetes que quedaron).
    const kind = shippingRuleKindOf({
      productTypes: items.map((i) => i.productType),
      accessoryLineCount: acc.accessoryLines.length,
      energyBundleCount: acc.energyBundles.length,
    });
    const choice = empty ? null : await boxChoiceOf(this.prisma as unknown as Prisma.TransactionClient, acc.units);
    const computed = await this.quoteBreakdowns(subtotalCents + acc.subtotalCents, subtotalCents, empty, itemsEmpty, ivaDials, choice, empty ? null : kind);
    // Desglose CONGELADO de la orden propia cuando rige (coversCart y no vencida): lo que el PI cobra.
    const breakdownToday: DirectShipBreakdownDTO = frozenOrder
      ? frozenDirectShipBreakdownOf(frozenOrder)
      : computed.breakdown;
    const vaultBreakdown = computed.vaultBreakdown;
    // 💰 v1.110⟨descuentos⟩ (§DSC.6): sin código ⇒ ⛔ nada de esto corre y la respuesta es la de hoy (I-1).
    const dq =
      code === null
        ? null
        : await this.quoteDiscount({
            code,
            ip: requestIp ?? null,
            email: typeof dto.email === 'string' && dto.email.trim() !== '' ? normalizeEmail(dto.email) : null,
            claimedOrderId,
            frozenOrder,
            cart: [...pieceDiscountLines(items, lines), ...accessoryDiscountLines(acc.accessoryLines), ...bundleDiscountLines(acc.energyBundles)],
            ship: { kind: empty ? null : kind, choice },
            ivaRatePct: ivaDials.ivaRatePct,
          });
    const applied = dq?.applied ?? null;
    const breakdown: DirectShipBreakdownDTO = applied ? applied.breakdown : breakdownToday;
    const unit = applied?.unitDiscountCents ?? null;
    const frozenUnit = dq?.frozenUnit ?? null;
    const frozenAcc = dq?.frozenAccessory ?? null;
    return {
      // §5.2.5 / contrato v1.51-b: `card` es un `OrderItemCardDTO` (8 hechos congelados +
      // `imageSmallUrl` resuelta en lectura). Se usa el MISMO cuerpo que `POST /checkout/quote`
      // —el hueco gris del invitado tenía exactamente la misma causa— y sin consulta extra: la
      // imagen sale del `card` que `priceCartForQuote` ya cargó para preciar.
      items: unit
        ? this.orders.quoteItemPreviews(items, lines.map((l) => chargedPieceLine(l, unit)), reservedByYou ?? new Set<string>(), unit)
        : frozenUnit
          ? this.orders.quoteItemPreviews(items, lines, reservedByYou ?? new Set<string>(), frozenUnit)
          : this.orders.toOrderItemPreviews(items, lines, reservedByYou ?? new Set<string>()),
      fulfillmentMode: 'direct_ship' as const,
      breakdown,
      // v1.68.1 (§4-R.5): SIEMPRE presente (`null` si no hay reserva propia).
      ownReservation: ownReservation ?? null,
      // v1.21.4-dual-breakdown (§4-G.1): segundo desglose "de bóveda" (solo cartas, SIN envío),
      // informativo/reactivo (gancho del upsell). SIEMPRE presente; pagar bóveda sigue exigiendo
      // cuenta (§4-G.2 `422 VAULT_REQUIRES_ACCOUNT`).
      vaultBreakdown,
      unavailableItems,
      // Banderas, no texto (§0 i18n): el front renderiza ventas finales / factura / términos.
      notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
      // 💰 v1.86⟨accesorios⟩ (§AC.4, aditivo): SIEMPRE presentes (`[]`/`null` sin accesorios).
      accessoryLines: unit
        ? acc.accessoryLines.map((l, i) => discountedAccessoryLine(l, i, unit))
        : frozenAcc
          ? acc.accessoryLines.map((l) => frozenAccessoryLine(l, frozenAcc))
          : acc.accessoryLines,
      energyBundles: acc.energyBundles,
      energyBundleOffers: acc.energyBundleOffers,
      unavailableAccessories: acc.unavailableAccessories,
      unavailableBundles: acc.unavailableBundles,
      shippingBox: shippingBoxDtoOf(computed.choice),
      vaultExcludesAccessories: acc.accessoryLines.length > 0 || acc.energyBundles.length > 0,
      // 💰 v1.109 (§4-G.12 punto 4): SIEMPRE presente; `freeShippingRemainingCents` contra el `subtotalCents` de ESTA respuesta.
      shippingRule: applied && dq?.dials
        ? this.discountedShippingRule(empty ? null : kind, applied, dq.dials)
        : computed.shippingRule(breakdown.subtotalCents),
      ...(dq ? { discount: dq.discount } : {}),
    };
  }

  /**
   * §DSC.4 — el `shippingRule` con código: contra `S'` y la `E` resultante; si el envío gratis lo puso el código,
   * `freeShippingApplied: true` y `freeShippingRemainingCents: null`.
   */
  private discountedShippingRule(kind: ShippingRuleKind | null, applied: AppliedCartDiscount<DirectShipBreakdownDTO>, dials: DirectShipDials): GuestShippingRuleDTO {
    if (!applied.shipFee) throw new Error('discountedShippingRule: el envío directo con código siempre trae su `E`');
    const dto = shippingRuleDtoOf(kind, applied.breakdown.subtotalCents, dials, applied.shipFee);
    return applied.freeShippingByCode ? { ...dto, freeShippingApplied: true, freeShippingRemainingCents: null } : dto;
  }

  /**
   * 💰 v1.110⟨descuentos⟩ (§DSC.6) — el bloque `discount` del quote de invitado (siempre `200`). La orquestación es
   * `DiscountsService.quoteOutcome`; aquí solo el precio del envío directo. El por-cliente se evalúa solo si el quote trae `email`.
   */
  private async quoteDiscount(q: {
    code: string;
    ip: string | null;
    email: string | null;
    claimedOrderId: string | null;
    frozenOrder: Order | null;
    cart: DiscountCartLine[];
    ship: { kind: ShippingRuleKind | null; choice: BoxChoice | null };
    ivaRatePct: number;
  }): Promise<{
    discount: DiscountQuoteDTO;
    applied: AppliedCartDiscount<DirectShipBreakdownDTO> | null;
    frozenUnit: Map<string, number> | null;
    frozenAccessory?: Map<string, FrozenAccessoryPrice>;
    dials: DirectShipDials | null;
  }> {
    if (q.frozenOrder) {
      // La orden propia con ESTE código: lo que su PI cobra (§4-R.5 + §DSC.5), sin recalcular.
      const discount = await this.discounts.appliedOfOrder(this.prisma, q.frozenOrder);
      // v1.110.1 (§DSC.6, DCO-B5): los renglones de accesorio del congelado salen de `OrderAccessoryLine` (cobrado + rebaja).
      const accRows = await this.prisma.orderAccessoryLine.findMany({
        where: { orderId: q.frozenOrder.id },
        select: { kind: true, accessoryId: true, unitPriceCents: true, unitDiscountCents: true },
      });
      return {
        discount: discount ?? { outcome: 'invalid' },
        applied: null,
        frozenUnit: await frozenPieceDiscountsOf(this.prisma, q.frozenOrder.id),
        frozenAccessory: frozenAccessoryMapOf(accRows),
        dials: null,
      };
    }
    const dials = await this.directShipDials();
    const fee = await this.settings.getStripeFee();
    const { discount, applied } = await this.discounts.quoteOutcome({
      code: q.code,
      throttle: { ip: q.ip, email: q.email },
      customer: { email: q.email },
      excludeOrderIds: q.claimedOrderId ? [q.claimedOrderId] : [],
      price: (terms) => priceDirectShipCartWithCode(q.cart, terms, { kind: q.ship.kind, dials, choice: q.ship.choice }, q.ivaRatePct, fee),
    });
    return { discount, applied, frozenUnit: null, dials: applied ? dials : null };
  }

  /**
   * 💰 v1.109 (§4-G.12 punto 5) — `GET /checkout/shipping-rule`: las `E` ya derivadas con los diales vivos. Informativo
   * (la ficha, sin cotizar): lo cobrado lo decide `session`.
   */
  async publicShippingRule(): Promise<PublicShippingRuleDTO> {
    return publicShippingRuleOf(await this.directShipDials());
  }

  /**
   * 💰 v1.109.1 (§4-G.12 punto 3) — los TRES diales del envío directo, leídos una vez por petición. Son EXHIBIDOS (IVA
   * dentro): `E = dial`, ⛔ sin `shippingFeeDisplayCentsOf` (IVA-6). ⛔ `shipping_fee_cents` no se lee aquí: es el retiro.
   */
  private async directShipDials(): Promise<DirectShipDials> {
    return {
      cardsFeeCents: await this.settings.getNumber(SettingKey.DIRECT_SHIP_CARDS_FEE_CENTS),
      sealedFeeCents: await this.settings.getNumber(SettingKey.DIRECT_SHIP_SEALED_FEE_CENTS),
      freeFromCents: await this.settings.getNumber(SettingKey.DIRECT_SHIP_FREE_FROM_CENTS),
    };
  }

  /**
   * v1.68.1 + 💰 v1.86⟨accesorios⟩ — el desglose CONGELADO de la orden propia rige solo si esa orden cubre el carrito
   * ENTERO: piezas (lo decide `priceCartForQuote`) **y** el mismo multiconjunto de accesorios y los mismos paquetes. Un
   * carrito solo de accesorios (sin piezas) se compara directo contra la orden reclamada.
   */
  private async frozenForQuote(frozenByItems: Order | null, claimedOrderId: string | null, itemLines: number, acc: QuoteAccessoryPart): Promise<Order | null> {
    const db = this.prisma as unknown as Prisma.TransactionClient;
    if (frozenByItems) {
      const cart = await orderAccessoryCartOf(db, frozenByItems.id);
      return sameLooseCart(cart.loose, acc.loose) && sameSlugSet(cart.bundleSlugs, acc.bundleSlugs) && cart.allReserved ? frozenByItems : null;
    }
    if (!claimedOrderId || itemLines > 0 || (acc.loose.length === 0 && acc.bundleSlugs.length === 0)) return null;
    const order = await this.prisma.order.findUnique({ where: { id: claimedOrderId }, include: { items: { select: { id: true } } } });
    if (!order || order.status !== 'pending' || order.items.length > 0) return null;
    const cart = await orderAccessoryCartOf(db, order.id);
    const live = await this.prisma.orderAccessoryLine.count({ where: { orderId: order.id, status: 'reserved', reservedUntil: { gt: new Date() } } });
    const total = await this.prisma.orderAccessoryLine.count({ where: { orderId: order.id } });
    if (live === 0 || live !== total) return null;
    const { items: _items, ...row } = order;
    return sameLooseCart(cart.loose, acc.loose) && sameSlugSet(cart.bundleSlugs, acc.bundleSlugs) ? (row as Order) : null;
  }

  // ---------------------------------------------------------------- session

  /**
   * §4-G.2 — crea el pedido de invitado: reserva items, `Order` (`userId=null`, `guestEmail`,
   * `direct_ship`, snapshot de dirección) y UN SOLO PaymentIntent por el total (cartas + envío +
   * IVA + fee). Devuelve el `checkoutToken` (vida corta, §4-G.7a) a quien acaba de crear el pedido.
   */
  async createSession(
    dto: GuestSessionDto,
    requestIp?: string | null,
    // v1.102⟨mkt-fase2⟩ (API_CONTRACT §MKT.H.2): columnas YA saneadas; ver `OrdersService.createSession`.
    measurementColumns: Partial<MeasurementColumns> = {},
  ) {
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
    // ⭐ v1.80.12.5 (§M4-SHIP.19.25.1, `HECHOS.md:57`): `resolveAddressGeo` decide qué se guarda y ⛔ NUNCA rechaza
    // por geografía (con el catálogo vacío la tienda vende). Corre ANTES de reservar y antes del PaymentIntent; la
    // colonia sigue obligatoria como texto (pipe). `check` no se persiste.
    const { check: _check, ...geo } = await this.postalCodes.resolveAddressGeo(
      dto.shippingAddress.postalCode,
      dto.shippingAddress.neighborhood,
      dto.shippingAddress.city,
      dto.shippingAddress.state,
    );
    const addressSnapshot = this.toAddressSnapshot({ ...dto.shippingAddress, ...geo });

    // v1.68 (§4-R.3): la reserva PROPIA existe SOLO si el body trae `retryOfCheckoutToken` válido
    // que resuelve a una orden `pending` de ESTE correo. Sin reclamo ⇒ conducta de hoy, literal.
    const claimedOrderId = dto.retryOfCheckoutToken
      ? await this.resolveRetryClaim(dto.retryOfCheckoutToken, guestEmail)
      : null;

    // ⛔ v1.68.1: el precio, FUERA de la transacción (misma razón que la ruta de bóveda: dentro, cada
    // checkout pediría una segunda conexión para `PricingService` y N concurrentes agotan el pool).
    const { items, lines, subtotalCents, ivaDials } = await this.orders.priceCartOutsideGate(
      dto.inventoryItemIds,
      claimedOrderId ? { orderId: claimedOrderId } : undefined,
    );
    // 💰 v1.86⟨accesorios⟩ (§AC.4, §AC.19.4): con accesorios o `deckPulls` el desglose se arma DENTRO de la tx (precio
    // del accesorio y dial del paquete leídos por el `tx` y congelados; caja con las cajas del `tx`). Los diales de dinero
    // (`E_base` y la comisión) se leen AQUÍ, fuera, por la misma razón del pool. Sin accesorios ⇒ el camino de hoy, literal.
    const accLines = dto.accessoryLines ?? [];
    const pulls = dto.deckPulls ?? [];
    const withAccessories = accLines.length > 0 || pulls.length > 0;
    // 💰 v1.109 (§4-G.12): la clase (estricto: la sesión no poda) y los tres diales, leídos AQUÍ, fuera de la tx.
    // TL-ENV-1: la clase se calcula en UN sitio (`kindOf`, mismo manejo del vacío con y sin accesorios) y el importe y el
    // desglose en otro (`directShipBreakdownOf`, con `representableOrThrow` dentro).
    const itemTypes = items.map((i) => i.productType);
    const kindOf = (part: SessionAccessoryPart | null) =>
      shippingRuleKindOf({ productTypes: itemTypes, accessoryLineCount: part?.loose.length ?? 0, energyBundleCount: part?.bundles.length ?? 0 });
    const shipDials = await this.directShipDials();
    const stripeFee = await this.settings.getStripeFee();
    const ivaRatePct = ivaDials.ivaRatePct;
    // Sin accesorios, el desglose de hoy se arma FUERA de la tx (un `AMOUNT_TOO_LARGE` sale antes de tocar nada).
    const breakdownPre = withAccessories
      ? null
      : directShipBreakdownOf({ kind: kindOf(null), subtotalCents, dials: shipDials, choice: null, ivaRatePct, fee: stripeFee }).breakdown;
    // 💰 v1.110⟨descuentos⟩ (§DSC.6): el código y el bloqueo por intentos (`429` antes de tocar nada). Sin código ⇒ nada.
    const code = normalizeDiscountCode(dto.discountCode);
    const throttleKeys = code !== null ? await this.discounts.openAttempt({ ip: requestIp ?? null, email: guestEmail }) : [];

    const runTx = () => this.prisma.$transaction(
      async (
        tx,
      ): Promise<
        | { kind: 'reused'; order: Order; reservedUntil: Date; part: SessionAccessoryPart | null }
        | {
            kind: 'created';
            order: Order;
            breakdown: DirectShipBreakdownDTO;
            itemIds: string[];
            supersededOrderIds: string[];
            reservedUntil: Date;
            part: SessionAccessoryPart | null;
            choice: BoxChoice | null;
            unitDiscount: Map<string, number> | null;
          }
      > => {
        // §4-R.2: PUERTA POR CLIENTE (aquí, por correo normalizado: solo SERIALIZA; la titularidad la
        // prueba el token) → releer por el mismo tx → decidir → escribir.
        await lockReservationGate(tx, { guestEmail });
        const now = new Date();
        const own: OwnReservation[] = claimedOrderId
          ? await this.ownGuestReservations(tx, dto.inventoryItemIds, claimedOrderId, now)
          : [];
        // 💰 §AC.19.4 pasos 2–3 — validaciones de accesorios y paquetes, ANTES de crear nada (409 / 422 ⇒ rollback).
        const part = withAccessories
          ? await sessionAccessoryPart(tx, this.decksMeta, {
              lines: accLines,
              pulls,
              requestInventoryItemIds: dto.inventoryItemIds,
              extra: own.length > 0 ? await ownAccessoryReservedOf(tx, own.map((o) => o.order.id)) : undefined,
            })
          : null;
        if (
          own.length === 1 &&
          this.orders.isReusable(own[0], dto.inventoryItemIds) &&
          (await this.sameAccessoryCart(tx, own[0].order.id, part)) &&
          (await sameCodeAsOrder(tx, own[0].order.id, code))
        ) {
          // `renewReservation` renueva piezas y renglones de accesorio (§AC.6 (3)).
          const reservedUntil = await this.orders.renewReservation(tx, own[0].order.id, now);
          return { kind: 'reused', order: own[0].order, reservedUntil, part };
        }
        const supersededOrderIds: string[] = [];
        for (const o of own) {
          await this.orders.supersedeOwnOrder(tx, o);
          supersededOrderIds.push(o.order.id);
        }

        // 💰 §AC.7 + v1.109 (§4-G.12 pasos 1–3): la clase (piezas + renglones + paquetes), el umbral sobre `S` (TODO el
        // subtotal, I-AC-1) y la caja grande. Sin accesorios ⇒ `breakdownPre` (solo piezas).
        const kind = kindOf(part);
        const choice: BoxChoice | null = part ? await boxChoiceOf(tx, part.units) : null;
        let breakdown: DirectShipBreakdownDTO;
        let baseFeeCents = 0;
        if (part) {
          const today = directShipBreakdownOf({ kind, subtotalCents: subtotalCents + part.subtotalCents, dials: shipDials, choice, ivaRatePct, fee: stripeFee });
          baseFeeCents = today.ship.baseFeeCents;
          breakdown = today.breakdown;
        } else {
          breakdown = breakdownPre as DirectShipBreakdownDTO;
        }
        // 💰 v1.110⟨descuentos⟩ (§DSC.5 «Apartar», §DSC.4): tras la puerta y la sustitución — `applyInTx` (candado de la
        // fila del código, validez con el `now` de esta tx) con el cálculo sobre `S'`. Cualquier fallo ⇒ `422` y rollback.
        let orderLines = lines;
        let applied: AppliedInTx<AppliedCartDiscount<DirectShipBreakdownDTO>> | null = null;
        if (code !== null) {
          const cart = [
            ...pieceDiscountLines(items, lines),
            ...accessoryDiscountLines((part?.loose ?? []).map((l) => ({ accessoryId: l.row.id, unitPriceCents: l.row.priceCents, quantity: l.quantity }))),
            ...bundleDiscountLines((part?.bundles ?? []).map((b) => b.bundle)),
          ];
          applied = await this.discounts.applyInTx(tx, {
            code,
            customer: { email: guestEmail },
            now,
            price: (terms) => priceDirectShipCartWithCode(cart, terms, { kind, dials: shipDials, choice }, ivaRatePct, stripeFee),
          });
          const unit = applied.priced.unitDiscountCents;
          breakdown = applied.priced.breakdown;
          orderLines = lines.map((l) => chargedPieceLine(l, unit));
        }
        const boxSnapshot = part ? boxSnapshotOf(choice, baseFeeCents, part.units) : null;
        // v1.68.1: por el `tx` (una sola conexión por checkout; ver `OrdersService.nextOrderNumber`).
        const orderNumber = await this.orders.nextOrderNumber(tx);
        const reservedUntil = reservedUntilFrom(now);

        // PROJECTION-EXEMPT: return DENTRO de la `$transaction`; el caller proyecta la respuesta del
        // checkout de invitado (orderId/orderNumber/breakdown/stripe), nunca la fila `Order`.
        const order = await tx.order.create({
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
            // ⭐⭐ D56 / criterio **214** — misma regla que el checkout de bóveda: toda orden nueva
            // nace bajo la convención con la que se acaba de cobrar, y desde el corte es
            // `IVA_INCLUSIVE` (`subtotalCents` y `shippingFeeCents` llevan el IVA dentro). Sin
            // default de BD detrás: si esta línea se cae, el `INSERT` revienta (candado `IVA-3(e)`).
            priceConvention: PRICE_CONVENTION_OF_NEW_ROWS,
            // ⭐ La posición del dial que produjo estos precios (informativa/auditora, `/admin/*`).
            ivaTransferPct: ivaDials.ivaTransferPct,
            cfdiStatus: 'registrado',
            items: { create: orderLines },
            // 💰 v1.110 (§DSC.1): solo con código aplicado (sin él, el `INSERT` de hoy y el default 0).
            ...(applied ? { discountCents: applied.priced.discountCents, shippingWaivedCents: applied.priced.shippingWaivedCents } : {}),
            // 💰 v1.86⟨accesorios⟩ (§AC.1/§AC.7): la caja congelada (`null` ⇔ tarifa de hoy) y «revisar caja».
            ...(boxSnapshot ? { shippingBoxSnapshot: boxSnapshot as unknown as Prisma.InputJsonValue, shippingBoxReview: choice?.review ?? false } : {}),
            // v1.102⟨mkt-fase2⟩ (§MKT.H.2): consentimiento y primer origen, misma escritura que crea la fila.
            ...measurementColumnsData(measurementColumns),
          },
        });
        // Reserva ATÓMICA por el helper COMPARTIDO con el checkout de bóveda (T2): mismas guardias
        // (`ownerType='platform'` + estado vendible + `count===1`) y, desde v1.68, el DUEÑO (esta
        // orden) y el vencimiento. La diferencia de esta ruta es el `null`: NO se escribe titularidad,
        // la pieza sigue siendo de la plataforma durante todo el ciclo — invariante §4-G.0-1.
        if (applied) await applied.reserve({ orderId: order.id });
        await this.orders.reserveItems(tx, items, null, { orderId: order.id, reservedUntil });
        if (part) {
          // 💰 §AC.19.4 pasos 4–5: renglones congelados y el apartado ÚNICO por accesorio (Σ sueltos + Σ componentes),
          // `accessoryId` ascendente, condición en el `UPDATE`. 0 filas ⇒ 409 y se deshace TODO, piezas incluidas.
          await createAccessoryLines(tx, order.id, part, reservedUntil, applied?.priced.unitDiscountCents);
          await reserveAccessories(tx, order.id, part.wants);
        }
        return {
          kind: 'created',
          order,
          breakdown,
          itemIds: lines.map((l) => l.inventoryItemId),
          supersededOrderIds,
          reservedUntil,
          part,
          choice,
          unitDiscount: applied?.priced.unitDiscountCents ?? null,
        };
      },
      RESERVATION_TX_OPTIONS,
    );
    // §DSC.6: el genérico y el `not_applicable` cuentan como intento; se anotan FUERA de la tx deshecha.
    const outcome = code !== null ? await this.discounts.countingAttempts(code, throttleKeys, runTx) : await runTx();

    const order = outcome.order;
    // A2: crear PI + compensar si el proveedor falla + persistir el id, por el helper COMPARTIDO
    // (T2). Lo único propio de esta ruta es la metadata: sin `userId` (no hay usuario) y con
    // `guest:'true'` para distinguir el pedido en el dashboard de Stripe. En el REUSO (§4-R.3) es el
    // MISMO PaymentIntent de la orden: no se crea otro.
    const metadata = { orderId: order.id, kind: 'order', guest: 'true' };
    const stripe =
      outcome.kind === 'reused'
        ? await this.orders.paymentIntentForReuse(order, metadata, dto.inventoryItemIds)
        : await this.orders
            .attachPaymentIntent({
              orderId: order.id,
              amountCents: outcome.breakdown.totalCents,
              metadata,
              inventoryItemIds: outcome.itemIds,
            })
            .then((pi) => ({ paymentIntentId: pi.id, clientSecret: pi.clientSecret }));

    // §4-G.0-5: ÚNICA respuesta de API con un token en claro. Quien llama ES quien creó el pedido,
    // así que no hay filtración posible; resuelve la confirmación tras el redirect 3DS (sin sesión).
    // v1.21.1 (§4-G.7a): es el token de CHECKOUT — vida CORTA (120 min) y NUNCA por correo. El
    // enlace duradero de 90 días lo emite el settle y viaja solo por correo. Así, el solapamiento
    // de dos puertas sin contraseña dura ≤2 h (T7b) en vez de 90 días. En el reuso se emite uno
    // NUEVO con `rotate:false` (§4-R.3): el presentado sigue valiendo hasta su `expiresAt`.
    const { clear, expiresAt } = await this.tokens.issue(order.id, {
      rotate: false,
      requestIp,
      ttlMs: GUEST_CHECKOUT_TOKEN_TTL_MIN * 60 * 1000,
    });

    const breakdown: DirectShipBreakdownDTO =
      outcome.kind === 'reused'
        ? frozenDirectShipBreakdownOf(order)
        : outcome.breakdown;
    const discount = code !== null ? await this.discounts.appliedOfOrder(this.prisma, order) : null;

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      breakdown,
      checkoutToken: clear,
      checkoutTokenExpiresAt: expiresAt,
      stripe,
      // v1.68 (§4-R.3, ADITIVO)
      reused: outcome.kind === 'reused',
      reservedUntil: outcome.reservedUntil,
      supersededOrderIds: outcome.kind === 'reused' ? [] : outcome.supersededOrderIds,
      // 💰 v1.86⟨accesorios⟩ (§AC.4, §AC.19.4, aditivo): lo CREADO (en el reuso, lo de la orden reusada). ⛔ Sin
      // `energyBundleOffers` ni `unavailableBundles`: la sesión no ofrece.
      ...(await this.sessionAccessoryResponse(order, outcome.part, outcome.kind === 'created' ? { choice: outcome.choice, unitDiscount: outcome.unitDiscount } : null)),
      // 💰 v1.110 (§DSC.6): `applied` ⇒ la respuesta de hoy + `discount`; sin código, ni el campo (I-1).
      ...(discount ? { discount } : {}),
    };
  }

  /**
   * 💰 v1.86⟨accesorios⟩ (§AC.4 reuso) — `isReusable` exige además el MISMO multiconjunto `(accessoryId, quantity)` y el
   * MISMO conjunto de paquetes (por `deckSlug`), todos aún apartados. Si no ⇒ se sustituye (y `supersedeOwnOrder` suelta
   * también los apartados de accesorio, §AC.6 (2)).
   */
  private async sameAccessoryCart(tx: Prisma.TransactionClient, orderId: string, part: SessionAccessoryPart | null): Promise<boolean> {
    const cart = await orderAccessoryCartOf(tx, orderId);
    if (!cart.allReserved) return false;
    return sameLooseCart(cart.loose, part?.looseWants ?? []) && sameSlugSet(cart.bundleSlugs, part?.bundleSlugs ?? []);
  }

  /**
   * v1.68 (§4-R.2) + 💰 v1.86⟨accesorios⟩ — las reservas PROPIAS del invitado: las que intersecan el carrito por PIEZAS
   * (`findOwnLiveReservations`) **más** la orden reclamada si solo aparta accesorios (sin piezas no la encuentra el
   * pre-scan por piezas). `heldAlive` de esa orden = todos sus renglones `reserved` y sin vencer.
   */
  private async ownGuestReservations(tx: Prisma.TransactionClient, cartIds: string[], claimedOrderId: string, now: Date): Promise<OwnReservation[]> {
    const own = await this.orders.findOwnLiveReservations(tx, cartIds, { orderId: claimedOrderId }, now);
    if (own.some((o) => o.order.id === claimedOrderId)) return own;
    const order = await tx.order.findUnique({ where: { id: claimedOrderId }, include: { items: true } });
    if (!order || order.status !== 'pending') return own;
    const lines = await tx.orderAccessoryLine.findMany({ where: { orderId: claimedOrderId }, select: { status: true, reservedUntil: true } });
    if (!lines.some((l) => l.status === 'reserved')) return own;
    const heldAlive = order.items.length === 0 && lines.every((l) => l.status === 'reserved' && l.reservedUntil.getTime() > now.getTime());
    return [...own, { order, heldItemIds: [], heldAlive }];
  }

  /**
   * La parte aditiva de la respuesta de `session` (§AC.4): `accessoryLines`, `energyBundles` y `shippingBox` de lo CREADO;
   * en el REUSO, lo de la orden reusada con sus precios CONGELADOS (el PI cobra eso, no el catálogo de hoy).
   */
  private async sessionAccessoryResponse(
    order: Order,
    part: SessionAccessoryPart | null,
    created: { choice: BoxChoice | null; unitDiscount?: ReadonlyMap<string, number> | null } | null,
  ) {
    if (created) {
      const lines = (part?.loose ?? []).map((l) => ({
        accessoryId: l.row.id,
        name: l.row.name,
        category: l.row.category,
        energyType: l.row.energyType,
        unitPriceCents: l.row.priceCents,
        quantity: l.quantity,
        lineTotalCents: l.row.priceCents * l.quantity,
        photo: photoDTO(l.row.id, l.row.photoVersion),
      }));
      const unit = created.unitDiscount ?? null;
      return {
        // 💰 v1.110 (§DSC.6): con código, el cobrado por unidad y la proyección de línea (solo si > 0).
        accessoryLines: unit ? lines.map((l, i) => discountedAccessoryLine(l, i, unit)) : lines,
        energyBundles: (part?.bundles ?? []).map((b) => b.bundle) as EnergyBundleDTO[],
        shippingBox: shippingBoxDtoOf(created.choice),
      };
    }
    const db = this.prisma as unknown as Prisma.TransactionClient;
    const frozenBundles = await this.prisma.orderAccessoryLine.findMany({ where: { orderId: order.id, kind: 'energy_bundle' }, select: { deckSlug: true, unitPriceCents: true } });
    const priceBySlug = new Map(frozenBundles.map((b) => [b.deckSlug, b.unitPriceCents]));
    const snap = order.shippingBoxSnapshot as { code?: string; label?: string } | null;
    return {
      accessoryLines: await sessionLinesDtoOf(db, order.id),
      energyBundles: (part?.bundles ?? []).map((b) => ({ ...b.bundle, priceCents: priceBySlug.get(b.deckSlug) ?? b.bundle.priceCents })) as EnergyBundleDTO[],
      shippingBox: snap && snap.code ? { code: snap.code, label: snap.label ?? snap.code, review: order.shippingBoxReview } : null,
    };
  }

  /**
   * v1.68 (§4-R.3) — el reclamo de propiedad del invitado: el `checkoutToken` presentado debe ser
   * VÁLIDO (vivo, no revocado), resolver a una orden `pending` y esa orden tener EXACTAMENTE este
   * correo. Cualquier otra cosa ⇒ `null` = «no hay reclamo» (la pieza es ajena ⇒ el camino de hoy,
   * `409 ITEM_UNAVAILABLE`, sin distinguir token malo de pieza vendida). Un correo solo NO es
   * identidad (cualquiera puede teclearlo); el token ya es «la llave de ese pedido» (§4-G.7a).
   */
  private async resolveRetryClaim(clearToken: string, guestEmail: string): Promise<string | null> {
    const v = await this.tokens.validate(clearToken);
    if (!v.ok) return null;
    const order = await this.prisma.order.findUnique({
      where: { id: v.token.orderId },
      select: { id: true, status: true, guestEmail: true },
    });
    if (!order || order.status !== 'pending' || order.guestEmail !== guestEmail) return null;
    return order.id;
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
        items: { include: { inventoryItem: { include: { card: { include: { set: true } } } }, refund: true } },
        // ⭐ D2e (§19.12, PS-89): + los eventos del transportista para la línea de tiempo pública.
        shipmentRequests: { orderBy: { requestedAt: 'desc' }, include: { carrierEvents: CUSTOMER_TIMELINE_EVENTS_SELECT } },
        refunds: true,
        // 💰 v1.86⟨accesorios⟩ (§AC.12, §AC.19.6): los renglones con su accesorio VIGENTE (la foto de hoy) y componentes.
        accessoryLines: { include: ACCESSORY_LINE_READ_INCLUDE, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    // Defensa: un token vivo sin pedido (borrado) se trata igual que un token inventado.
    if (!order) throw BusinessException.notFound('INVALID_TOKEN', 'Invalid or unknown tracking link');

    await this.tokens.markUsed(token.id, now);
    // 💰 v1.110 (§DSC.6, 914): el código del pedido, solo si lo lleva (sin él, ni el campo).
    const discount = await orderDiscountOf(this.prisma, order);
    const dto = this.toTrackingDto(order, token.expiresAt);
    // v1.110.3: las piezas con la proyección de línea (`accessoryLines` ya la traen de `toOrderAccessoryLineDTO`).
    return discount ? { ...dto, items: dto.items.map((it, i) => projectLineDiscount(it, order.items[i].unitDiscountCents)), discount } : dto;
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
   *
   * v1.68 (§4-R.4) — **RAMA LEGADA, un release.** El barrido de verdad es
   * `OrdersService.sweepExpiredReservations` (por `reservedUntil`, las DOS rutas). Esta rama solo
   * cubre los pedidos de invitado `pending` con piezas `reservedByOrderId IS NULL` (en vuelo al
   * desplegar M-53), que no tienen vencimiento y se barren por `createdAt` como hoy. ⛔ Un pedido
   * con dueño NO entra aquí aunque sea viejo: su TTL pudo RENOVARSE por reuso y solo `reservedUntil`
   * dice si venció. Se retira con el conteo de ARCHITECTURE §4.48.7(5).
   *
   * ⚠️ **SEC-SB-1 / C9 — SUBSUMIDA desde v1.68.1.** Esta rama cubría SOLO invitado + `direct_ship`;
   * la legada de BÓVEDA (y la de envío directo de un usuario CON cuenta) no la barría nadie. Ahora
   * `OrdersService.sweepExpiredReservations` cubre **todas** las legadas (ver `legacyExpiredByOrder`)
   * y el job la ejecuta ANTES que a ésta, así que en régimen normal aquí ya no queda nada que barrer
   * (el `swept` de este método tiende a 0, no porque falle sino porque llega segundo). Se conserva
   * mientras dure la rama `IS NULL` del guard y se retira **con ella**, en la misma ficha `RSV-L1`,
   * cuando el conteo de §4.48.7(5) sea 0 en producción. ⛔ No ensanchar ésta: la política legada vive
   * ya en un solo sitio.
   */
  async sweepStaleGuestOrders(now = new Date()): Promise<{ swept: number }> {
    const cutoff = new Date(now.getTime() - GUEST_ORDER_RESERVATION_TTL_MIN * 60 * 1000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        guestEmail: { not: null },
        fulfillmentMode: 'direct_ship',
        createdAt: { lt: cutoff },
        items: { some: { inventoryItem: { status: 'reserved', reservedByOrderId: null } } },
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
        const { closed } = await this.orders.closePaymentIntent(order.stripePaymentIntentId);
        if (!closed) {
          // NO se traga el fallo (B3): el pedido no se barre en esta pasada y queda visible.
          this.logger.error(
            `order-reservation-sweep(legacy): NO se pudo cancelar el PaymentIntent ${order.stripePaymentIntentId} ` +
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
      this.logger.warn(`order-reservation-sweep(legacy): ${skipped} pedidos NO barridos (PaymentIntent vivo).`);
    }
    if (swept > 0) this.logger.log(`order-reservation-sweep(legacy): ${swept} pedidos legados de invitado liberados.`);
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
    references?: string;
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
      // ⭐ v1.81: décimo campo; vacío ⇒ `null`.
      references: blankToNull(a.references),
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
    /** 💰 v1.86⟨accesorios⟩: el `vaultBreakdown` es SOLO de cartas, como hoy (§AC.4). */
    itemsSubtotalCents: number,
    empty: boolean,
    itemsEmpty: boolean,
    // ⚠️ Los MISMOS diales que derivaron cada `P` del carrito, ⛔ no una segunda lectura.
    ivaDials: IvaDials,
    /** 💰 v1.86⟨accesorios⟩ (§AC.7): la caja elegida; `null` ⇒ sin caja. */
    choice: BoxChoice | null,
    /** 💰 v1.109 (§4-G.12 paso 1): la clase del carrito podado; `null` ⇔ nada cobrable. */
    kind: ShippingRuleKind | null,
  ): Promise<{
    breakdown: DirectShipBreakdownDTO;
    vaultBreakdown: BreakdownDTO;
    choice: BoxChoice | null;
    /** El DTO de §4-G.12 punto 4 contra el `subtotalCents` que viaja en la respuesta (el congelado si rige). */
    shippingRule: (subtotalCents: number) => GuestShippingRuleDTO;
  }> {
    const ivaPct = ivaDials.ivaRatePct;
    const fee = await this.settings.getStripeFee();
    const dials = await this.directShipDials();
    if (empty) {
      const zero = this.orders.zeroCartBreakdown(ivaPct);
      const none = directShipFeeOf(null, 0, dials, null);
      return { breakdown: { ...zero, shippingFeeCents: 0 }, vaultBreakdown: zero, choice: null, shippingRule: (s) => shippingRuleDtoOf(null, s, dials, none) };
    }
    // TL-ENV-1/TL-ENV-4: la cadena única (`S + E` no representable en Int32 ⇒ 422 AMOUNT_TOO_LARGE, ⛔ nunca un 500 crudo).
    const { ship, breakdown } = directShipBreakdownOf({ kind, subtotalCents, dials, choice, ivaRatePct: ivaPct, fee });
    return {
      breakdown,
      vaultBreakdown: itemsEmpty ? this.orders.zeroCartBreakdown(ivaPct) : computeCartBreakdown(itemsSubtotalCents, ivaPct, fee),
      choice,
      shippingRule: (s) => shippingRuleDtoOf(kind, s, dials, ship),
    };
  }

  /**
   * §4-G.5 — mapeo normativo `Order.status` (+ envío) → `GuestOrderPublicStatus`. El estado
   * público NO es una columna: se deriva. `chargeback` NO se nombra hacia el invitado
   * (`en_revision`): decir "contracargo" en una vista sin autenticar da información operativa.
   */
  publicStatus(orderStatus: OrderStatus, shipmentStatus?: ShipmentStatus | null, money?: { refundedCents: number; totalCents: number }): GuestOrderPublicStatus {
    // ⭐ v1.80.2 (§M4-SHIP.16): EXTRAÍDO a `order-public-status.ts` — el MISMO cuerpo que `GET /orders/:orderId`.
    return publicStatus(orderStatus, shipmentStatus, money);
  }

  private activeShipment<T extends ShipmentRequest>(shipments: T[]): T | undefined {
    return activeShipment(shipments);
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
        refund?: { status: string; amountCents: number; missingReason: string | null; submittedAt: Date | null; succeededAt: Date | null } | null;
        inventoryItem: {
          finish: string;
          productType: ProductType;
          rawCondition: string | null;
          sealedSubtype: string | null;
          gradingCompany: string | null;
          gradeValue: string | null;
          // §4.34a.2 — identidad de sellado (snapshot por-pieza), para que el resolutor único nombre
          // el SealedProduct y no el ancla. El query `include` del modelo completo las trae.
          sealedProductId: string | null;
          sealedProductName: string | null;
          sealedImageUrl: string | null;
          card: { name: string; number: string; imageSmallUrl: string | null; set: { name: string } | null };
        };
      }[];
      shipmentRequests: (ShipmentRequest & { carrierEvents?: TimelineEventRow[] })[];
      refunds?: { status: string; amountCents: number }[];
      accessoryLines?: AccessoryLineReadRow[];
    },
    tokenExpiresAt: Date,
  ) {
    const shipment = this.activeShipment(order.shipmentRequests);
    // ⭐ v1.80.12 (§M4-SHIP.19.20.1, «lo que ve el cliente»): con envío, la dirección es la DEL ENVÍO (la que el
    // operador pudo corregir); sin envío, la que capturó al pagar. Medido: era la única superficie del cliente que
    // leía `Order.shippingAddressSnapshot` habiendo envío (`/orders/:id` y `/shipments/:id` ya leían el del envío).
    const address = ((shipment?.addressSnapshot as Prisma.JsonValue | undefined) ?? order.shippingAddressSnapshot ?? {}) as Partial<GuestAddressSnapshot>;
    const deliveredAt = shipment?.deliveredAt ?? null;
    const trackingUrl = shipment ? providerTrackingUrlOf(shipment) : null;
    // v1.80 (§M4-SHIP.10): lo devuelto POR STRIPE (`submitted|succeeded`) y la regla «todo devuelto ⇒ reembolsado».
    const refundedCents = refundedCentsOf(order.refunds ?? []);

    return {
      // Identificador LEGIBLE. El uuid interno (`order.id`) está PROHIBIDO aquí (§4-G.3).
      orderNumber: order.orderNumber ?? '',
      status: this.publicStatus(order.status, shipment?.status, { refundedCents, totalCents: order.totalCents }),
      refundedCents,
      placedAt: order.createdAt,
      paidAt: order.settledAt ?? undefined,
      // Confirma al comprador QUÉ correo usó, sin revelarlo (el enlace puede reenviarse).
      emailMasked: maskEmail(order.guestEmail),
      items: order.items.map((oi) => ({
        // §4.34a.2 — para un sellado, el nombre es el del `SealedProduct` (resolutor único), NUNCA el
        // ancla. `number` es del ancla y el front NO lo muestra para sellado (contrato §4-G, forma
        // del DTO sin cambio).
        name: pieceDisplayIdentityOf(oi.inventoryItem).name,
        setName: oi.inventoryItem.card.set?.name ?? '',
        number: oi.inventoryItem.card.number,
        finish: oi.inventoryItem.finish,
        productType: oi.inventoryItem.productType,
        rawCondition: oi.inventoryItem.rawCondition ?? undefined,
        sealedSubtype: oi.inventoryItem.sealedSubtype ?? undefined,
        gradingCompany: oi.inventoryItem.gradingCompany ?? undefined,
        gradeValue: oi.inventoryItem.gradeValue ?? undefined,
        // ⭐ v1.94.1⟨sellado-display⟩ (§4.34a.2(E) escape #2) — la IMAGEN también por el resolutor: un
        // sellado con `sealedImageUrl` muestra el arte de la CAJA (→ ancla → null), no el del single.
        // Imagen = clase P resuelta en lectura (§5.2.3); se conserva la convención «ausente, no null».
        imageSmallUrl: pieceDisplayIdentityOf(oi.inventoryItem).imageSmallUrl ?? undefined,
        unitPriceCents: oi.unitPriceCents,
        // v1.80 (§M4-SHIP.10): la carta que no salió y se devolvió — solo filas aceptadas por Stripe. ⛔ Sin actor,
        // `failureCode` ni componentes.
        refund: clientRefundOf(oi.refund),
      })),
      // 💰 v1.86⟨accesorios⟩ (§AC.19.6): `OrderAccessoryLineDTO` (lista blanca; ⛔ `deliveredRefund`, costo, snapshot).
      accessoryLines: (order.accessoryLines ?? []).map((l) => toOrderAccessoryLineDTO(l)),
      // QA-REL-1 (§4-G.3 → `BreakdownDTO` completo, §M10-IVA.4): el MISMO constructor que el resto de vistas del
      // pedido, con `priceConvention`/`ivaIncluded` de la columna de ESTA orden. Antes se armaba a mano sin esos dos
      // campos y el front pintaba el IVA de un pedido IVA_INCLUSIVE como sumando (D54, criterio 190).
      breakdown: frozenDirectShipBreakdownOf(order),
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
        // ⭐ D2e (§19.12, PS-88/PS-89): liga de rastreo SOLO si Skydropx la dio; línea de tiempo pública (sin detalle ni códigos).
        ...(trackingUrl ? { trackingUrl } : {}),
        timeline: shipment ? toCustomerTimeline(shipment.carrierEvents ?? [], shipment) : [],
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
        // v1.82 · PNL-1: el MISMO resolutor que `GET /support/contact` (§PNL.1, `D-PNL-2`).
        evidenceContact: supportContact(),
        disputeWindowDays: GUEST_DISPUTE_WINDOW_DAYS,
        disputeDeadlineAt: deliveredAt
          ? new Date(deliveredAt.getTime() + GUEST_DISPUTE_WINDOW_DAYS * DAY_MS)
          : undefined,
      },
      tokenExpiresAt,
    };
  }
}
