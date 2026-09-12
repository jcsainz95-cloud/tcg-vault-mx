import { Injectable, Logger } from '@nestjs/common';
import {
  InventoryItem,
  Card,
  CardSet,
  Finish,
  MarketBracket,
  MovementReason,
  Order,
  OrderItem,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  ORDER_RESERVATION_TTL_MIN,
  RESERVATION_TX_OPTIONS,
  lockReservationGate,
  releaseReservationData,
  reservationGuard,
  reservedUntilFrom,
} from './reservation';
import { computeCartBreakdown, BreakdownDTO, PriceBasis, sealedPriceBasisOf, hasManualPrice } from '../../common/money';
import { marketBracketOf } from '../../common/pricing-curve';
import {
  CARD_IMAGE_SELECT,
  CardImageSource,
  FrozenCardFacts,
  HistoricalOrderItemCardDTO,
  OrderItemCardDTO,
  PersistedCardFacts,
  distinctCardIds,
  readFrozenCardFacts,
  resolveOrderItemCard,
} from './order-item-card';

/**
 * Titularidad a escribir al RESERVAR una pieza (T2). Es el único eje en el que difieren las dos
 * rutas de fulfillment:
 *  - `null` ⇒ envío directo (invitado): la pieza NO cambia de dueño, sigue siendo de la
 *    plataforma todo el ciclo (§4-G.0-1: un invitado no tiene bóveda).
 *  - objeto ⇒ bóveda: la pieza entra a la bóveda del comprador con titularidad `pending`.
 */
export type ReservationOwnership = {
  ownerType: 'customer';
  ownerUserId: string;
  ownershipStatus: 'pending';
} | null;

/**
 * v1.21.3-quote-prune — ítem de carrito PODADO por los dos endpoints de QUOTE (§4 y §4-G.1).
 * `cardName` viene si la pieza aún existe en BD (aunque ya no esté disponible); `null` si el
 * `inventoryItemId` ya no resuelve. SOLO quote: los caminos de session no lo usan (siguen estrictos).
 */
export interface UnavailableCartItemDTO {
  inventoryItemId: string;
  cardName: string | null;
}

/**
 * v1.68.1 (§4-R.5) — la RESERVA PROPIA que el quote ve sobre el carrito. SIEMPRE presente en los dos
 * quotes (`null` si no hay). Con más de una orden propia solapada describe la MÁS RECIENTE y
 * `coversCart:false`. `expired` = `reservedUntil <= now` (aún no barrida): sigue siendo propia.
 */
export interface OwnReservationDTO {
  orderId: string;
  orderNumber: string | null;
  reservedUntil: Date | null;
  expired: boolean;
  coversCart: boolean;
}

/** Identidad del cliente para el quote (§4-R.5): `userId` (cuenta) o la orden que el token resolvió (invitado). */
export type QuoteOwner = { userId: string } | { orderId: string };

/**
 * v2.0 (P-48, §4.36.7c / PROJECT §N.8) — la DECISIÓN de venta de UNA pieza: el monto y los cuatro
 * datos de instrumentación que se congelan con él. El quinto dato de §N.8 (el precio final) ES
 * `unitPriceCents`.
 */
interface SaleDecision {
  unitPriceCents: number;
  priceBasis: PriceBasis;
  /** Mercado CRUDO en centavos que entró al cálculo. `null` = no lo hubo (jamás un 0 inventado). */
  marketMxnCents: number | null;
  marketBracket: MarketBracket | null;
  finish: Finish;
}

/** Línea de orden lista para persistir: el snapshot de dinero + su instrumentación. */
/**
 * v1.68 (§4-R.2) — respuesta de `POST /checkout/session` (forma ÚNICA para `201` y `200 reused`,
 * aditiva sobre la de §4). El controller fija el código HTTP a partir de `reused`.
 */
export interface CheckoutSessionResult {
  orderId: string;
  orderNumber: string | null;
  breakdown: BreakdownDTO;
  stripe: { paymentIntentId: string; clientSecret: string };
  /** `true` SOLO en el `200` de reuso (misma orden, mismo PaymentIntent, TTL renovado). */
  reused: boolean;
  /** Hasta cuándo es tuya la reserva. */
  reservedUntil: Date;
  /** Órdenes PROPIAS sustituidas (carrito distinto); `[]` si ninguna. */
  supersededOrderIds: string[];
}

/**
 * v1.68 (§4-R.1) — una RESERVA PROPIA que interseca el carrito, leída BAJO la puerta por cliente y
 * por el mismo `tx`. `heldItemIds` son las piezas que HOY siguen `reserved` por esa orden (dueño =
 * orden); `heldAlive` dice si TODAS tienen `reservedUntil > now`.
 */
export interface OwnReservation {
  order: Order & { items: OrderItem[] };
  heldItemIds: string[];
  heldAlive: boolean;
}

/** v1.68 — qué decidió la transacción de checkout bajo la puerta (§4-R.2). */
type SessionOutcome =
  | { kind: 'reused'; order: Order; reservedUntil: Date }
  | {
      kind: 'created';
      order: Order;
      breakdown: BreakdownDTO;
      itemIds: string[];
      supersededOrderIds: string[];
      reservedUntil: Date;
    };

type OrderLineData = {
  inventoryItemId: string;
  /**
   * §5.2.7-b — antes era `object`, y por eso el compilador no podía ver la divergencia entre lo
   * que el backend persistía/servía y lo que el contrato prometía: ahí cayó `imageSmallUrl`.
   * Tipado con `FrozenCardFacts`, la clase (F) queda declarada y la próxima grieta no compila.
   */
  cardSnapshot: FrozenCardFacts;
  unitPriceCents: number;
  marketMxnCents: number | null;
  priceBasis: PriceBasis;
  marketBracket: MarketBracket | null;
  finish: Finish;
};

/**
 * ⭐⭐ **COND-1 (techlead, 2026-09-11) — el único fallo de precio que cae al precio CONGELADO.**
 *
 * Las dos rutas que recuperan una pieza reservada por el propio cliente (`priceCartForOrder` y
 * `priceCartForQuote`) atrapaban **toda** la clase `BusinessException` y caían a la línea congelada.
 * Hoy `salePriceOf` solo puede lanzar `PRICE_PENDING`, así que la conducta es idéntica — **el riesgo
 * es futuro y es de dinero**: `PricingService.computeSalePriceForItem` es el **seam único donde vive
 * el guardarraíl de venta** (§4.36.5b), y el día que ese seam emita otro código (una premium en el
 * piso, un override degenerado, un veredicto nuevo), una pieza reservada por el propio cliente lo
 * **esquivaría en silencio** y se cobraría al precio congelado. Un guardarraíl que un `catch` ancho
 * puede saltarse no es un guardarraíl.
 *
 * Con este predicado, **solo** `PRICE_PENDING` («el catálogo dejó de resolver el precio») justifica
 * el respaldo congelado de §4-R.2 regla 5; **cualquier otro código propaga** tal cual, con su status
 * HTTP, hasta el cliente.
 *
 * ⛔ Si alguien vuelve a ensanchar esto a `e instanceof BusinessException`, el caso
 * «propaga cualquier otro código» de `cond1-frozen-price-only-price-pending.spec.ts` se pone rojo.
 */
function isPricePending(e: unknown): e is BusinessException {
  return e instanceof BusinessException && e.code === 'PRICE_PENDING';
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly stripe: StripeService,
    private readonly catalog: CatalogService,
  ) {}

  /** Resuelve el precio de venta de un item; lanza PRICE_PENDING si no vendible. */
  private async salePriceOf(
    item: InventoryItem & { card: Card & { set?: CardSet | null } },
  ): Promise<number> {
    return (await this.resolveSaleDecision(item)).unitPriceCents;
  }

  /**
   * v2.0 (P-48, §4.36.7c / PROJECT §N.8) — la DECISIÓN de venta completa: el monto Y la
   * instrumentación que se congela con él (mercado CRUDO, `priceBasis`, `marketBracket`, `finish`).
   *
   * Se resuelve AQUÍ, no en el momento de escribir, porque los cinco datos de §N.8 tienen que salir
   * del MISMO cálculo que fijó `unitPriceCents`: reconstruirlos después sería medir otra cosa.
   * `salePriceOf` queda como envoltorio para los callers que solo quieren el monto.
   */
  private async resolveSaleDecision(
    item: InventoryItem & { card: Card & { set?: CardSet | null } },
  ): Promise<SaleDecision> {
    // Sin mercado (override/bounty sin referencia, o pendiente): `marketMxnCents`/`marketBracket` van
    // en `null`. Honesto; jamás un 0 inventado (§4.36.7c).
    const instrument = (unitPriceCents: number, basis: PriceBasis, marketMxnCents: number | null): SaleDecision => ({
      unitPriceCents,
      priceBasis: basis,
      marketMxnCents,
      marketBracket: marketBracketOf(marketMxnCents),
      finish: item.finish,
    });
    // H-1 (E5-bis): el MISMO predicado que los otros cinco seams. Este sitio ya exigía `> 0` a mano y
    // era el único correcto; ahora la corrección vive en un cuerpo y no en la memoria de quien lea.
    if (hasManualPrice(item)) {
      // Peldaño 1 de la precedencia de VENTA: override POR PIEZA (§4.36.6) ⇒ basis `override`.
      return instrument(item.listPriceCents, 'override', null);
    }
    // v1.23-sealed-sales (§4.23d): el SELLADO deriva por mercado×spread. H-1 (v1.24): resolver ÚNICO
    // `resolveSealedSalePrice` (mismo cuerpo que catálogo/grid/bulk-publish, incluida la regla
    // override=0). Sin override>0 y sin mercado → PRICE_PENDING (money-safe, no se vende a precio basura).
    // SEC-A1: todo server-side.
    if (item.productType === 'sealed') {
      const ctx = await this.pricing.loadSealedSpreads();
      const marketRef = await this.pricing.getSealedMarketRef(item);
      const sale = this.pricing.resolveSealedSalePrice(item, marketRef, ctx);
      // BE-26 (money-safety): un precio de venta <= 0 (p. ej. regla `fixed:0`) NO es vendible. El
      // catálogo ya exige `> 0` para publicar; se alinea aquí para que ninguna session cobre $0.
      if (sale.salePriceCents == null || sale.salePriceCents <= 0) {
        throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no price`);
      }
      // §4.36.7a: el SELLADO no cambia de matemática; su basis se DERIVA de `priceSource`.
      const sealedMarket = this.pricing.gateSealedMarketCents(marketRef, ctx.sourceOn);
      return instrument(sale.salePriceCents, sealedPriceBasisOf(sale), sealedMarket);
    }
    // v1.53 (§4.40.4, **MONEY**) — CHECKOUT. La clave se pide con la TOLERANTE y su `null` se
    // convierte AQUÍ, explícitamente, en el rechazo que este método ya sabe emitir: `PRICE_PENDING`.
    //
    // **Por qué la tolerante en un camino de dinero, y por qué NO es fail-open:** el `null` NO cae a
    // un default —cae a NO VENDER—, que es el mismo criterio money-safe que aplica el resto del
    // método cuando no hay dato de mercado («sin dato ⇒ pendiente, jamás MX$0 ni precio inventado»,
    // `PROJECT.md` §E.1). Y evita cambiar un error de dinero por un 500 en el checkout: existen
    // piezas `listed` legacy con identidad de slab nula (§4.40.5c) y `IncompleteGradeIdentityError`
    // ahí sería una caída de servicio en vez de un rechazo honesto y accionable.
    // Antes de v1.53 esta línea resolvía `graded:PSA:10` y el comprador se llevaba —o pagaba— el
    // precio del grado MÁS CARO sobre una pieza cuyo grado nunca se capturó.
    const gradeKey = this.pricing.tryGradeKeyFor(item);
    if (gradeKey == null) {
      throw BusinessException.validation(
        'PRICE_PENDING',
        `Item ${item.folio} has no slab identity (grading company / grade value); not sellable`,
      );
    }
    // v1.6-finish: precio de venta contra la referencia del ACABADO del item.
    const ref = await this.pricing.getReference(item.cardId, item.productType, gradeKey, item.finish);
    const referenceMxnCents = ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
    // v2.0 (P-48, §4.36.1/§4.36.5b): precio de venta por la CURVA sobre el valor de mercado, vía el
    // SEAM ÚNICO del eje de venta — el checkout (auth Y guest) cobra EXACTAMENTE lo que publica el
    // storefront porque ambos pasan por el mismo cuerpo. SIN dato de mercado ⇒ `pending` ⇒
    // PRICE_PENDING (el PISO NO gana; jamás se cobra un precio inventado).
    // v1.28 (P-18, §4.26b): el sellOverride de la VARIANTE (M-30) pisa la curva y es ABSOLUTO.
    // El listPriceCents POR PIEZA ya ganó arriba (paso 1 de la precedencia, intacto).
    const variantOverride = await this.pricing.getVariantOverride(
      item.cardId,
      item.productType,
      gradeKey,
      item.finish,
    );
    // v2.0 (P-48, §4.36.5b) — SEAM ÚNICO: monto + GUARDARRAÍL en la misma llamada. En el checkout
    // (auth Y guest) una premium en el piso NO se vende: el storefront ya no la publica y esto cierra
    // la puerta de atrás (un `inventoryItemId` conocido que intente comprarse igual). Mismo código de
    // error que siempre.
    const sale = await this.pricing.computeSalePriceForItem({
      referenceMxnCents,
      // SOLO para el veredicto del guardarraíl (criterio 84): no entra al monto.
      rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
      controls: variantOverride,
    });
    if (sale.pendingReason != null) {
      throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no publishable price`);
    }
    // BE-26 (money-safety): un precio de venta <= 0 (p. ej. un override degenerado) NO es vendible. Se
    // rechaza igual que `== null` para que ninguna línea de session entre a $0.
    if (sale.priceCents == null || sale.priceCents <= 0) {
      throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no price`);
    }
    return instrument(sale.priceCents, sale.basis, sale.marketMxnCents);
  }

  private async loadItems(ids: string[], db: Prisma.TransactionClient = this.prisma) {
    const items = await db.inventoryItem.findMany({
      where: { id: { in: ids } },
      include: { card: { include: { set: true } } },
    });
    if (items.length !== ids.length) {
      throw BusinessException.notFound('NOT_FOUND', 'One or more items not found');
    }
    return items;
  }

  /**
   * v1.21.3-quote-prune — LA regla de venta, en un solo predicado: solo se vende una pieza de
   * PLATAFORMA en estado vendible. La usan la ruta estricta (session) y la tolerante (quote);
   * cambiarla aquí cambia a las dos — no admite dos cuerpos.
   */
  private isSellable(item: InventoryItem): boolean {
    return item.ownerType === 'platform' && ['listed', 'in_stock'].includes(item.status);
  }

  /**
   * Resuelve el precio de venta de cada línea (SEC-A1: server-side, vía `salePriceOf`) y acumula
   * el subtotal. Cuerpo ÚNICO de la regla de precios para strict Y lenient: `PRICE_PENDING`
   * conserva su semántica de 422 en ambos (en el quote se evalúa DESPUÉS de la poda porque aquí
   * solo entran ítems ya validados).
   */
  private async buildLines(
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[],
  ): Promise<{ subtotalCents: number; lines: OrderLineData[] }> {
    const lines: OrderLineData[] = [];
    let subtotalCents = 0;
    for (const item of items) {
      const d = await this.resolveSaleDecision(item);
      subtotalCents += d.unitPriceCents;
      lines.push({
        inventoryItemId: item.id,
        cardSnapshot: this.cardSnapshot(item),
        unitPriceCents: d.unitPriceCents,
        // v2.0 (§N.8): los cuatro campos de instrumentación viajan CON la línea, así que se persisten
        // en la MISMA transacción que congela `unitPriceCents` — no pueden desincronizarse.
        marketMxnCents: d.marketMxnCents,
        priceBasis: d.priceBasis,
        marketBracket: d.marketBracket,
        finish: d.finish,
      });
    }
    return { subtotalCents, lines };
  }

  /**
   * Valida disponibilidad y resuelve el precio de venta de cada línea del carrito — versión
   * ESTRICTA, usada por los DOS caminos de SESSION (con cuenta y de invitado). Fuente ÚNICA de la
   * regla de venta (delega en `isSellable`/`buildLines`): comprar como invitado NO cambia
   * condiciones comerciales (mismo precio, mismas validaciones).
   * `NOT_FOUND` global si algún id no resuelve; `ITEM_UNAVAILABLE` si la pieza no es de plataforma
   * o no está en `{listed, in_stock}`; `PRICE_PENDING` si no tiene precio de venta resoluble.
   * v1.21.3-quote-prune: session se queda estricta A PROPÓSITO (anti double-sell, caso v de
   * ARCHITECTURE §4.21h-1); la resolución por ítem vive SOLO en `priceCartForQuote` (quotes).
   */
  async priceCartForOrder(
    inventoryItemIds: string[],
    /**
     * v1.68.1 (pool de conexiones) — piezas que YA están `reserved` por una orden `pending` MÍA, con
     * su línea congelada. Son vendibles para mí (§4-R.2: reuso y sustitución las recuperan) y su
     * precio congelado es el respaldo si el de catálogo ya no resuelve.
     */
    ownReserved: Map<string, OrderItem> = new Map(),
  ): Promise<{
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[];
    subtotalCents: number;
    lines: OrderLineData[];
  }> {
    const items = await this.loadItems(inventoryItemIds);
    for (const item of items) {
      const mine = item.status === 'reserved' && ownReserved.has(item.id);
      if (!this.isSellable(item) && !mine) {
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
    }
    const lines: OrderLineData[] = [];
    let subtotalCents = 0;
    for (const item of items) {
      const frozen = ownReserved.get(item.id);
      let line: OrderLineData;
      try {
        line = (await this.buildLines([item])).lines[0];
      } catch (e) {
        // Una pieza ya reservada por mí conserva su precio congelado: no se re-precia ni se rompe
        // el reintento porque el catálogo dejó de resolver (§4-R.2 regla 5).
        // ⚠ COND-1: SOLO `PRICE_PENDING`. Ver {@link isPricePending}.
        if (!isPricePending(e) || !frozen) throw e;
        line = this.frozenLine(item, frozen);
      }
      subtotalCents += line.unitPriceCents;
      lines.push(line);
    }
    return { items, subtotalCents, lines };
  }

  /**
   * ⭐ v1.68.1 — **el pricing va FUERA de la transacción del checkout, y eso es money-safety, no
   * rendimiento.** Medido en CI (`connection_limit=5`, run 34624748695) y reproducido en local: con el
   * pricing DENTRO de la `tx`, cada checkout retiene la conexión de su transacción y pide una SEGUNDA
   * para `PricingService.getReference` (otro servicio, otro handle). Con N checkouts concurrentes ≥
   * pool/2 el pool se agota y la petición muere con `Timed out fetching a new connection` ⇒ 500 en una
   * ruta de dinero. La carrera de §4-R.7 R-3 daba **0/10** así.
   *
   * Preciar antes de la puerta NO relaja ningún invariante: quien impide la doble venta es el
   * `updateMany` guardado de `reserveItems` (`status ∈ {listed,in_stock}` + `count===1`) DENTRO de la
   * transacción, no esta lectura. Es, además, lo que se hacía antes de v1.68.
   *
   * El pre-scan de reservas propias es **best-effort** (fuera del candado): si una pieza pasa a ser mía
   * entre el escaneo y el precio, el precio lanza `ITEM_UNAVAILABLE` y se REINTENTA una vez con el
   * escaneo fresco. La decisión autoritativa la toma igualmente el escaneo de dentro del candado.
   */
  async priceCartOutsideGate(
    inventoryItemIds: string[],
    /** Sin identidad (invitado sin `retryOfCheckoutToken`) no hay reserva propia: conducta de hoy. */
    owner?: { userId: string } | { orderId: string },
  ): Promise<{
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[];
    subtotalCents: number;
    lines: OrderLineData[];
  }> {
    if (!owner) return this.priceCartForOrder(inventoryItemIds);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const own = await this.findOwnLiveReservations(this.prisma, inventoryItemIds, owner, new Date());
      const ownReserved = new Map<string, OrderItem>();
      for (const o of own) {
        const held = new Set(o.heldItemIds);
        for (const oi of o.order.items) if (held.has(oi.inventoryItemId)) ownReserved.set(oi.inventoryItemId, oi);
      }
      try {
        return await this.priceCartForOrder(inventoryItemIds, ownReserved);
      } catch (e) {
        const retriable =
          attempt === 0 && e instanceof BusinessException && e.code === 'ITEM_UNAVAILABLE';
        if (!retriable) throw e;
      }
    }
    // Inalcanzable (el segundo intento lanza o devuelve), pero el tipo lo exige.
    return this.priceCartForOrder(inventoryItemIds);
  }

  /**
   * v1.21.3-quote-prune (§4, §4-G.1) — resolución POR ÍTEM con poda amable, SOLO para los dos
   * endpoints de QUOTE. El carrito vive en `localStorage` como ids de piezas físicas ÚNICAS: al
   * venderse desaparecen, y un id muerto NO debe reventar la cotización entera con `404`/`409`
   * globales. Aquí ningún id produce error: los que no resuelven (`cardName: null`) o existen pero
   * no pasan `isSellable` (`cardName` con nombre, para el aviso del front) se devuelven en
   * `unavailableItems` (SIEMPRE presente; `[]` si todo el carrito resuelve) y `lines`/`subtotal`
   * se calculan SOLO con los válidos.
   * MISMA regla de venta y de precios que session (`isSellable` + `buildLines`): esto solo cambia
   * el TRANSPORTE del fallo (poda vs. excepción), nunca el criterio. `PRICE_PENDING` (422) se
   * conserva y se evalúa DESPUÉS de la poda: solo lo dispara un ítem VÁLIDO sin precio.
   */
  async priceCartForQuote(
    inventoryItemIds: string[],
    // v1.68.1 (§4-R.5): quién pregunta. Sin identidad ⇒ conducta de hoy, literal.
    owner?: QuoteOwner,
    now = new Date(),
  ): Promise<{
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[];
    subtotalCents: number;
    lines: OrderLineData[];
    unavailableItems: UnavailableCartItemDTO[];
    ownReservation: OwnReservationDTO | null;
    /** Piezas del carrito reservadas por una orden PROPIA (`items[].reservedByYou: true`). */
    reservedByYou: Set<string>;
    /** La orden propia cuyo desglose CONGELADO rige el quote (`coversCart` y no vencida); si no, `null`. */
    frozenOrder: Order | null;
  }> {
    // Un id repetido en el carrito no debe cotizar (ni podar) dos veces la misma pieza única.
    const uniqueIds = [...new Set(inventoryItemIds)];
    const found = await this.prisma.inventoryItem.findMany({
      where: { id: { in: uniqueIds } },
      include: { card: { include: { set: true } } },
    });
    const byId = new Map(found.map((i) => [i.id, i]));

    // ⭐ v1.68.1 — la reserva PROPIA es disponible. El eje es la ORDEN (`reservedByOrderId → Order
    // pending del cliente`), nunca el `userId`/`guestEmail` de la pieza (candado R-8). Una reserva
    // propia VENCIDA y aún no barrida sigue siendo propia (`expired: true`), nunca «ajena».
    const ownOrders = owner
      ? await this.prisma.order.findMany({
          where: {
            status: 'pending',
            ...('userId' in owner ? { userId: owner.userId } : { id: owner.orderId }),
            reservedItems: { some: { id: { in: uniqueIds }, status: 'reserved' } },
          },
          include: {
            items: true,
            reservedItems: { where: { status: 'reserved' }, select: { id: true, reservedUntil: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const reservedByYou = new Set<string>();
    for (const o of ownOrders) for (const r of o.reservedItems) reservedByYou.add(r.id);

    let ownReservation: OwnReservationDTO | null = null;
    let frozenOrder: Order | null = null;
    if (ownOrders.length > 0) {
      const { reservedItems, items: orderItems, ...order } = ownOrders[0];
      // ⚠ SB-D7 — **aquí decía `?? 0`, y `new Date(0)` es «1970-01-01», una cifra INVENTADA.** Una
      // pieza LEGADA (reservada antes de M-53) no tiene `reservedUntil`: su vencimiento es
      // **desconocido**, no «hace 56 años». El DTO lo publica (`ownReservation.reservedUntil`, §4-R.5)
      // y el front lo pinta, así que el `?? 0` ponía una fecha falsa en pantalla. Ahora: si CUALQUIER
      // pieza no tiene vencimiento, el vencimiento de la orden es `null` (desconocido).
      // El veredicto NO cambia: `expired` ya trataba `null` como vencida, igual que trataba el 0.
      const untils = reservedItems.map((r) => r.reservedUntil?.getTime() ?? null);
      const reservedUntil =
        untils.length > 0 && untils.every((t): t is number => t !== null)
          ? new Date(Math.min(...untils.filter((t): t is number => t !== null)))
          : null;
      const expired = reservedUntil == null || reservedUntil.getTime() <= now.getTime();
      const orderSet = new Set(orderItems.map((i) => i.inventoryItemId));
      const held = new Set(reservedItems.map((r) => r.id));
      const coversCart =
        ownOrders.length === 1 &&
        orderSet.size === uniqueIds.length &&
        uniqueIds.every((id) => orderSet.has(id) && held.has(id));
      ownReservation = { orderId: order.id, orderNumber: order.orderNumber, reservedUntil, expired, coversCart };
      if (coversCart && !expired) frozenOrder = order;
    }
    const frozenLineByItem = new Map(
      frozenOrder ? ownOrders[0].items.map((oi) => [oi.inventoryItemId, oi]) : [],
    );

    const valid: (InventoryItem & { card: Card & { set?: CardSet | null } })[] = [];
    const unavailableItems: UnavailableCartItemDTO[] = [];
    for (const id of uniqueIds) {
      const item = byId.get(id);
      if (!item) {
        unavailableItems.push({ inventoryItemId: id, cardName: null });
      } else if (this.isSellable(item) || (item.status === 'reserved' && reservedByYou.has(id))) {
        valid.push(item);
      } else {
        unavailableItems.push({ inventoryItemId: id, cardName: item.card.name });
      }
    }
    // Precios: CONGELADOS de la orden propia si rige (§4-R.2 regla 5: lo que el PI cobra); si no, en
    // lectura, como hoy. `PRICE_PENDING` se evalúa sobre los válidos SIN reserva propia; una pieza
    // propia sin precio en lectura cae a su precio congelado (ya lo tuvo al reservarse).
    const lines: OrderLineData[] = [];
    let subtotalCents = 0;
    for (const item of valid) {
      const frozen = frozenLineByItem.get(item.id);
      let line: OrderLineData;
      if (frozen) {
        line = this.frozenLine(item, frozen);
      } else if (reservedByYou.has(item.id)) {
        try {
          line = (await this.buildLines([item])).lines[0];
        } catch (e) {
          const own = ownOrders.flatMap((o) => o.items).find((oi) => oi.inventoryItemId === item.id);
          // ⚠ COND-1: SOLO `PRICE_PENDING`. Ver {@link isPricePending}.
          if (!isPricePending(e) || !own) throw e;
          line = this.frozenLine(item, own);
        }
      } else {
        line = (await this.buildLines([item])).lines[0];
      }
      subtotalCents += line.unitPriceCents;
      lines.push(line);
    }
    return { items: valid, subtotalCents, lines, unavailableItems, ownReservation, reservedByYou, frozenOrder };
  }

  /** Línea de quote con el precio CONGELADO de la `OrderItem` propia (la instrumentación viaja tal cual se congeló). */
  private frozenLine(
    item: InventoryItem & { card: Card & { set?: CardSet | null } },
    oi: { unitPriceCents: number; marketMxnCents: number | null; priceBasis: PriceBasis | null; marketBracket: MarketBracket | null; finish: Finish | null },
  ): OrderLineData {
    return {
      inventoryItemId: item.id,
      cardSnapshot: this.cardSnapshot(item),
      unitPriceCents: oi.unitPriceCents,
      marketMxnCents: oi.marketMxnCents,
      priceBasis: oi.priceBasis ?? 'market',
      marketBracket: oi.marketBracket,
      finish: oi.finish ?? item.finish,
    };
  }

  /**
   * v1.21 (M-25): siguiente número legible de pedido `TCG-000123` desde la secuencia Postgres
   * `order_number_seq`. Mismo patrón que `inventory_folio_seq` (`PrismaService.nextFolio`); se
   * implementa aquí —y no en `PrismaService`— porque `src/prisma/` es zona de otro stream.
   */
  async nextOrderNumber(db: Prisma.TransactionClient = this.prisma): Promise<string> {
    // H3 (money-safety): `$queryRaw` con tagged template (parametrizado) en vez de `$queryRawUnsafe`.
    // La sentencia no lleva entradas del cliente, pero se prefiere la puerta segura por defecto
    // (mismo patrón que `master-set.service.ts`), para no dejar una superficie `Unsafe` viva.
    //
    // v1.68.1 — `db`: dentro del checkout se pasa el `tx`. No es cosmético: con `this.prisma` se pedía
    // una SEGUNDA conexión mientras la transacción retenía la suya, y con el pool de CI
    // (`connection_limit=5`) N checkouts concurrentes lo agotaban (500 en ruta de dinero). `nextval` NO
    // es transaccional: pedirlo por el `tx` no lo ata al commit (un rollback deja un hueco, que es
    // inocuo — un número duplicado no lo sería).
    const rows = await db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq') AS nextval`;
    return `TCG-${String(Number(rows[0].nextval)).padStart(6, '0')}`;
  }

  /**
   * POST /checkout/quote (§4) — v1.21.3-quote-prune: resolución POR ÍTEM. Los ids muertos del
   * carrito viajan en `unavailableItems` (siempre presente) con `200`; `items` y `breakdown` se
   * calculan SOLO con los válidos. Carrito 100 % muerto ⇒ `items: []` y breakdown EN CEROS (misma
   * forma; NO se corre el gross-up: cotizar la nada no puede producir un fee fijo > 0).
   * Session (`createSession`, abajo) NO usa esta ruta: sigue estricta.
   */
  async quote(inventoryItemIds: string[], userId?: string) {
    const { items, subtotalCents, lines, unavailableItems, ownReservation, reservedByYou, frozenOrder } =
      await this.priceCartForQuote(inventoryItemIds, userId ? { userId } : undefined);
    const previews = this.toOrderItemPreviews(items, lines, reservedByYou);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    // v1.68.1 (§4-R.5): con reserva propia que cubre el carrito y no vencida, el desglose es el
    // CONGELADO de esa orden (lo que el PI cobra), para que pantalla y cobro no discrepen.
    const breakdown: BreakdownDTO = frozenOrder
      ? this.breakdownOf(frozenOrder)
      : lines.length === 0
        ? this.zeroCartBreakdown(ivaPct)
        : computeCartBreakdown(subtotalCents, ivaPct, await this.settings.getStripeFee());
    return { items: previews, breakdown, unavailableItems, ownReservation };
  }

  /**
   * §5.2.5 — proyección de LECTURA de las líneas de un QUOTE, cuerpo ÚNICO para las DOS superficies
   * de cotización (`POST /checkout/quote` y `POST /checkout/guest/quote`, que ya comparten
   * `priceCartForQuote`). Se unifica aquí precisamente porque el defecto original —la miniatura
   * ausente— vivía duplicado: dos mapeos idénticos, y arreglar uno solo habría dejado el otro roto.
   *
   * **Cero consultas extra:** ambas rutas ya cargan `card` en memoria para preciar
   * (`include: { card: { include: { set: true } } }`), así que la clase (P) sale del objeto ya
   * cargado. La consulta batcheada solo hace falta en el histórico (`getOrder`).
   *
   * El puente es `InventoryItem.id → item.card`, que en un quote ES la pieza que se está cotizando
   * (no hay acta de compra todavía). En el HISTÓRICO, en cambio, la unión va por `cardSnapshot.cardId`
   * y está PROHIBIDO pasar por `inventoryItemId` (§5.2.5).
   *
   * Público solo para `GuestCheckoutService` (mismo módulo `orders/`), que ya delega en
   * `priceCartForQuote`: no es superficie HTTP.
   */
  toOrderItemPreviews(
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[],
    lines: OrderLineData[],
    // v1.68.1 (§4-R.5): `reservedByYou: true` SOLO en las piezas reservadas por una orden propia; omitido si falso.
    reservedByYou: Set<string> = new Set(),
  ): { inventoryItemId: string; card: OrderItemCardDTO; unitPriceCents: number; reservedByYou?: true }[] {
    const cardByItemId = new Map<string, CardImageSource>(items.map((i) => [i.id, i.card]));
    return lines.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: resolveOrderItemCard(l.cardSnapshot, cardByItemId.get(l.inventoryItemId)),
      unitPriceCents: l.unitPriceCents,
      ...(reservedByYou.has(l.inventoryItemId) ? { reservedByYou: true as const } : {}),
    }));
  }

  /**
   * Breakdown EN CEROS para el quote de un carrito 100 % podado (§4/§4-G.1): misma forma, todo 0
   * (nunca pantalla de error en el front). `ivaRatePct` conserva el dial vigente — es una tasa,
   * no un monto. El invitado lo extiende con `shippingFeeCents: 0` (no hay nada que enviar).
   */
  zeroCartBreakdown(ivaRatePct: number): BreakdownDTO {
    return {
      subtotalCents: 0,
      ivaCents: 0,
      ivaRatePct,
      processingFeeCents: 0,
      totalCents: 0,
      currency: 'MXN',
    };
  }

  /**
   * §5.2.2 — construye la clase (F): los OCHO hechos de la compra que se CONGELAN. El retorno va
   * anotado a propósito (§5.2.7-b): con `FrozenCardFacts` explícito, añadir aquí un campo de
   * presentación —`imageSmallUrl` la primera— es un ERROR DE COMPILACIÓN, no un descuido.
   * La miniatura NO se persiste: se resuelve en lectura (`resolveOrderItemCard`).
   */
  private cardSnapshot(
    item: InventoryItem & { card: Card & { set?: CardSet | null } },
  ): FrozenCardFacts {
    return {
      cardId: item.cardId,
      name: item.card.name,
      setName: item.card.set?.name,
      number: item.card.number,
      productType: item.productType,
      rawCondition: item.rawCondition,
      gradingCompany: item.gradingCompany,
      gradeValue: item.gradeValue,
    };
  }

  /**
   * T2 (techlead) — RESERVA ATÓMICA de piezas únicas, **fuente ÚNICA para las dos rutas de
   * fulfillment**. Antes vivía duplicada en `OrdersService` (bóveda) y `GuestCheckoutService`
   * (envío directo), y las copias ya habían DIVERGIDO: la de invitado añadía el guard
   * `ownerType='platform'` y la de bóveda no. Unificar aquí garantiza que el próximo arreglo se
   * aplique a ambas — es el punto donde se corrompe inventario, así que no admite dos versiones.
   *
   * Guardias (se conserva la versión CORRECTA, la que tenía el guard):
   *  - `ownerType: 'platform'` — cierra la ventana TOCTOU que dejaba el chequeo pre-transaccional
   *    de `priceCartForOrder`: entre aquel `findMany` y esta transacción, otro flujo podía cambiar la
   *    titularidad de la pieza y el checkout de bóveda la habría reservado igual.
   *  - `status ∈ {listed, in_stock}` + `count === 1` — dos checkouts concurrentes por la misma
   *    pieza: solo uno gana la transición a `reserved`; el otro recibe `ITEM_UNAVAILABLE`.
   *
   * `ownership` es el ÚNICO eje en el que difieren las dos rutas:
   *  - `null` (envío directo / invitado): NO se escribe titularidad. La pieza sigue siendo de la
   *    plataforma durante todo el ciclo — invariante §4-G.0-1 (un invitado no tiene bóveda).
   *  - `{ownerType:'customer', ownerUserId, ownershipStatus:'pending'}` (bóveda): la pieza pasa a
   *    la bóveda del comprador con titularidad pendiente hasta el settle.
   *
   * v1.68 (§4-R, M-53) — `reservation` es el DUEÑO y el VENCIMIENTO: toda reserva nueva escribe
   * `reservedByOrderId = <orden>` y `reservedUntil = now + TTL`. La orden se crea ANTES en la misma
   * transacción (la FK exige que exista); si esta reserva falla, la transacción entera se deshace.
   */
  async reserveItems(
    tx: Prisma.TransactionClient,
    items: { id: string; folio: string }[],
    ownership: ReservationOwnership,
    reservation: { orderId: string; reservedUntil: Date },
  ): Promise<void> {
    for (const item of items) {
      const reserved = await tx.inventoryItem.updateMany({
        where: { id: item.id, ownerType: 'platform', status: { in: ['listed', 'in_stock'] } },
        data: {
          status: 'reserved',
          reservedByOrderId: reservation.orderId,
          reservedUntil: reservation.reservedUntil,
          ...(ownership ?? {}),
        },
      });
      if (reserved.count !== 1) {
        // Otro checkout ya reservó/vendió esta pieza (o cambió de estado/titularidad).
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
    }
  }

  /**
   * A2 — compensación de la reserva ante fallo del PaymentIntent (fuente ÚNICA, T2). Devuelve cada
   * pieza a estado vendible y de plataforma, y marca la orden `failed`.
   *
   * v1.68 (§4-R.2 regla 2) — la guardia es `reservationGuard(orderId)`: `status:'reserved'` **y**
   * `reservedByOrderId = <esta orden>` (o `NULL`, reserva legada). Solo el DUEÑO libera: tras una
   * sustitución O1→O2, la compensación o el webhook de O1 NO pueden soltar la pieza que O2 acaba de
   * reservar. El `data` limpia dueño y vencimiento (`releaseReservationData`).
   *
   * Escribe la titularidad de plataforma SIEMPRE, también en el envío directo: ahí es un no-op
   * (la pieza nunca dejó de ser de la plataforma) y evita tener dos cuerpos que puedan divergir.
   */
  async releaseReservation(orderId: string, itemIds: string[]): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        await tx.inventoryItem.updateMany({
          where: { id: { in: itemIds }, ...reservationGuard(orderId) },
          data: releaseReservationData,
        });
        await tx.order.update({ where: { id: orderId }, data: { status: 'failed' } });
      })
      .catch(() => undefined);
  }

  /**
   * v1.68 (B3 unificado, §4-R.2/§4-R.4) — cierra la vía de cobro de una orden antes de soltar su
   * reserva. `closed: true` SOLO si el PaymentIntent quedó efectivamente `canceled` (o ya lo estaba);
   * si no, `status` trae lo que Stripe reporta (`processing`/`succeeded`/…) o `null` si no se pudo
   * determinar. **Ante la duda, `closed:false`**: no liberar es un coste acotado; liberar con el pago
   * vivo es un double-sell. Vivía en `GuestCheckoutService` (solo invitado); ahora la usan el barrido
   * de las DOS rutas y la SUSTITUCIÓN del reintento.
   */
  async closePaymentIntent(paymentIntentId: string): Promise<{ closed: boolean; status: string | null }> {
    try {
      const { status } = await this.stripe.cancelPaymentIntent(paymentIntentId);
      return { closed: status === 'canceled', status };
    } catch (e) {
      // Stripe lanza tanto si el PI YA estaba cancelado (inocuo, se puede liberar) como si ya se
      // PAGÓ (jamás liberar). Se desambigua consultando el estado real.
      const status = await this.stripe.getPaymentIntentStatus(paymentIntentId);
      if (status === 'canceled') return { closed: true, status };
      this.logger.error(
        `reservation: cancelación del PI ${paymentIntentId} falló (${(e as Error).message}); ` +
          `estado observado: ${status ?? 'desconocido'}.`,
      );
      return { closed: false, status };
    }
  }

  /**
   * ⭐⭐ v1.68 (§4-R.2) — PRE-SCAN de reservas PROPIAS que intersecan el carrito. Se llama SIEMPRE
   * bajo `lockReservationGate` y por el MISMO `tx` (candado → releer → decidir → escribir).
   * «Propia» = reservada por una orden `pending` cuyo cliente es quien llama: `userId` (con cuenta)
   * o la orden que el `retryOfCheckoutToken` resolvió (invitado). El eje es la ORDEN
   * (`reservedByOrderId`), nunca el `userId`/`guestEmail` de la pieza: un hecho, un sitio (R-1).
   * v1.68.1 (fila «Propia VENCIDA»): una propia con `reservedUntil <= now` y aún no barrida TAMBIÉN
   * entra — `heldAlive:false` ⇒ nunca reuso (renovar competiría con el barrido) pero SUSTITUIBLE
   * (money-safe: su PI se cancela antes), nunca «ajena» (candado R-9).
   */
  async findOwnLiveReservations(
    tx: Prisma.TransactionClient,
    cartIds: string[],
    owner: { userId: string } | { orderId: string },
    now: Date,
  ): Promise<OwnReservation[]> {
    const ids = [...new Set(cartIds)];
    const held = await tx.inventoryItem.findMany({
      where: {
        id: { in: ids },
        status: 'reserved',
        reservedByOrder:
          'userId' in owner
            ? { userId: owner.userId, status: 'pending' }
            : { id: owner.orderId, status: 'pending' },
      },
      select: { reservedByOrderId: true },
    });
    const orderIds = [
      ...new Set(held.map((h) => h.reservedByOrderId).filter((x): x is string => x != null)),
    ];
    if (orderIds.length === 0) return [];
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        // `items` COMPLETOS: en el pre-scan de precio sirven de respaldo CONGELADO (§4-R.2 regla 5)
        // cuando una pieza ya reservada por mí perdió su precio de catálogo.
        items: true,
        reservedItems: { where: { status: 'reserved' }, select: { id: true, reservedUntil: true } },
      },
    });
    return orders.map(({ reservedItems, ...order }) => ({
      order,
      heldItemIds: reservedItems.map((i) => i.id),
      heldAlive: reservedItems.every(
        (i) => i.reservedUntil != null && i.reservedUntil.getTime() > now.getTime(),
      ),
    }));
  }

  /**
   * v1.68 (§4-R.2 fila REUSO) — ¿la orden propia retiene EXACTAMENTE el carrito (como conjuntos) y
   * todas sus piezas siguen reservadas por ella y vivas? Un carrito con ids repetidos NO reusa: cae a
   * la conducta de hoy (`loadItems` ⇒ 404), igual que antes de v1.68.
   */
  isReusable(own: OwnReservation, cartIds: string[]): boolean {
    const cart = new Set(cartIds);
    if (cart.size !== cartIds.length) return false;
    const orderItems = new Set(own.order.items.map((i) => i.inventoryItemId));
    if (cart.size !== orderItems.size) return false;
    for (const id of cart) if (!orderItems.has(id)) return false;
    const held = new Set(own.heldItemIds);
    for (const id of orderItems) if (!held.has(id)) return false;
    return own.heldAlive;
  }

  /** v1.68 (§4-R.2 regla 4) — el reuso RENUEVA el TTL de las piezas de la orden. No escribe nada más. */
  async renewReservation(tx: Prisma.TransactionClient, orderId: string, now: Date): Promise<Date> {
    const reservedUntil = reservedUntilFrom(now);
    await tx.inventoryItem.updateMany({
      where: { reservedByOrderId: orderId, status: 'reserved' },
      data: { reservedUntil },
    });
    return reservedUntil;
  }

  /**
   * ⭐⭐ v1.68 (§4-R.2 fila SUSTITUCIÓN) — sustituye UNA orden propia, EN ESTE ORDEN: (1) cancelar su
   * PaymentIntent en Stripe y comprobar que quedó `canceled` (B3); (2) liberar sus piezas guardadas
   * por `reservedByOrderId = vieja.id` y marcar la orden `failed`. Todo dentro del `tx` que tiene la
   * puerta: si (1) no confirma, se LANZA y la transacción se deshace ⇒ **cero escritura**.
   *  - `processing` | `succeeded` | `requires_capture` ⇒ `409 PAYMENT_IN_PROGRESS` (el pago puede o ya
   *    se consumó; el front lleva al cliente a ese pedido).
   *  - estado indeterminable ⇒ `503 PAYMENT_PROVIDER_UNAVAILABLE` (reintentar; nada cambió).
   * ⛔ El PI NUEVO se crea DESPUÉS del commit (`attachPaymentIntent`): «cancelar antes de crear»
   * (candado R-4).
   */
  async supersedeOwnOrder(tx: Prisma.TransactionClient, own: OwnReservation): Promise<void> {
    const { order } = own;
    if (order.stripePaymentIntentId) {
      const closed = await this.closePaymentIntent(order.stripePaymentIntentId);
      if (!closed.closed) {
        if (
          closed.status === 'processing' ||
          closed.status === 'succeeded' ||
          closed.status === 'requires_capture'
        ) {
          throw BusinessException.conflict(
            'PAYMENT_IN_PROGRESS',
            `The payment of order ${order.orderNumber ?? order.id} is in progress; nothing was changed.`,
            { orderId: order.id, orderNumber: order.orderNumber },
          );
        }
        throw BusinessException.retriable(
          'PAYMENT_PROVIDER_UNAVAILABLE',
          'Could not confirm the cancellation of the previous PaymentIntent; nothing was changed. Please retry.',
        );
      }
    }
    await tx.inventoryItem.updateMany({
      where: {
        id: { in: order.items.map((i) => i.inventoryItemId) },
        ...reservationGuard(order.id),
      },
      data: releaseReservationData,
    });
    await tx.order.update({ where: { id: order.id }, data: { status: 'failed' } });
  }

  /**
   * v1.68 (§4-R.2 fila REUSO) — el MISMO PaymentIntent de la orden reusada: se relee de Stripe (el
   * `clientSecret` no se persiste). ⛔ No crea PI. Única excepción: una orden `pending` SIN PI (Stripe
   * falló al crearlo y la compensación no llegó): se crea ahora con la MISMA clave server-side
   * (`pi-order-<id>`) ⇒ sigue siendo UN PI por orden. Un fallo de red aquí NO libera nada: la reserva
   * queda intacta y se responde 503 para reintentar.
   */
  async paymentIntentForReuse(
    order: Order,
    metadata: Record<string, string>,
    inventoryItemIds: string[],
  ): Promise<{ paymentIntentId: string; clientSecret: string }> {
    if (!order.stripePaymentIntentId) {
      // VENTANA de la carrera (medida: 1/10 corridas sin esto): el que esperaba la puerta entra
      // justo tras el commit del ganador, cuando éste AÚN está en `attachPaymentIntent`. Antes de
      // recurrir al `attach` se relee la orden unas veces: si el PI aparece, es ÉSE (cero PI nuevos).
      for (let i = 0; i < 20 && !order.stripePaymentIntentId; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const fresh = await this.prisma.order.findUnique({
          where: { id: order.id },
          select: { stripePaymentIntentId: true },
        });
        if (fresh?.stripePaymentIntentId) order = { ...order, stripePaymentIntentId: fresh.stripePaymentIntentId };
      }
    }
    if (!order.stripePaymentIntentId) {
      const created = await this.attachPaymentIntent({
        orderId: order.id,
        amountCents: order.totalCents,
        metadata,
        inventoryItemIds,
      });
      return { paymentIntentId: created.id, clientSecret: created.clientSecret };
    }
    try {
      const pi = await this.stripe.retrievePaymentIntent(order.stripePaymentIntentId);
      return { paymentIntentId: pi.id, clientSecret: pi.clientSecret };
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      throw BusinessException.retriable(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Payment provider unavailable; your reservation is intact. Please retry.',
      );
    }
  }

  /** El desglose CONGELADO de una orden (lo que su PaymentIntent cobra). El reuso no re-precia (§4-R.2 regla 5). */
  breakdownOf(order: Order): BreakdownDTO {
    return {
      subtotalCents: order.subtotalCents,
      ivaCents: order.ivaCents,
      ivaRatePct: order.ivaRatePct,
      processingFeeCents: order.processingFeeCents,
      totalCents: order.totalCents,
      currency: 'MXN',
    };
  }

  /**
   * ⭐ v1.68 (§4-R.4, D-SB-1) — BARRIDO ÚNICO por vencimiento para las DOS rutas (bóveda e invitado):
   * piezas `reserved` con `reservedUntil < now`, agrupadas por `reservedByOrderId`. Por orden: **B3
   * primero** (cancelar el PI y comprobar `canceled`; si no, NO se libera, se registra y se reintenta
   * en la próxima pasada), luego liberar con `reservationGuard(orden)` y `Order → failed` (si seguía
   * `pending`). Cambio de conducta declarado: una orden de BÓVEDA `pending` también expira a los
   * `ORDER_RESERVATION_TTL_MIN` (hoy quedaba reservada hasta que Stripe cancelara el PI, que no cancela
   * solo).
   *
   * ⭐⭐ **SEC-SB-1 / C9 (v1.68.1)** — el barrido cubre TAMBIÉN la reserva LEGADA (`reservedByOrderId
   * IS NULL`, anterior a M-53), que **no la barría nadie**: `sweepStaleGuestOrders` solo mira
   * invitados `direct_ship`, y el `not: null` de aquí arriba las excluye por construcción. Como la
   * migración M-53 fue **sin backfill**, «legada» no es «lo que estaba en vuelo al desplegar»: es
   * **toda** pieza que estuviera `reserved` en ese instante, incluida la acumulación histórica de
   * órdenes de BÓVEDA `pending` que nunca tuvieron barrido (D-SB-1). Ver
   * {@link legacyExpiredByOrder} para la política y por qué no puede soltar una reserva con dueño
   * vivo.
   */
  async sweepExpiredReservations(
    now = new Date(),
  ): Promise<{ swept: number; skipped: number; legacy: number }> {
    const expired = await this.prisma.inventoryItem.findMany({
      where: { status: 'reserved', reservedByOrderId: { not: null }, reservedUntil: { lt: now } },
      select: { id: true, reservedByOrderId: true },
    });
    const byOrder = new Map<string, string[]>();
    for (const row of expired) {
      if (!row.reservedByOrderId) continue;
      byOrder.set(row.reservedByOrderId, [...(byOrder.get(row.reservedByOrderId) ?? []), row.id]);
    }
    // SEC-SB-1: las legadas entran POR LA MISMA PUERTA (mismo bucle, mismo B3, mismo cuerpo de
    // liberación). Dos barridos paralelos sobre la misma orden cancelarían su PI dos veces y
    // liberarían en dos transacciones distintas; uno solo, agrupado por orden, no puede divergir (T2).
    const legacyByOrder = await this.legacyExpiredByOrder(now);
    let legacy = 0;
    for (const [orderId, itemIds] of legacyByOrder) {
      legacy += itemIds.length;
      byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), ...itemIds]);
    }
    let swept = 0;
    let skipped = 0;
    let noop = 0;
    for (const [orderId, itemIds] of byOrder) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderNumber: true, status: true, stripePaymentIntentId: true },
      });
      if (!order) continue;
      if (order.stripePaymentIntentId) {
        const closed = await this.closePaymentIntent(order.stripePaymentIntentId);
        if (!closed.closed) {
          this.logger.error(
            `order-reservation-sweep: NO se pudo cancelar el PaymentIntent ${order.stripePaymentIntentId} ` +
              `del pedido ${order.orderNumber ?? order.id} (estado ${closed.status ?? 'desconocido'}); ` +
              'la reserva NO se libera (el pago aún puede confirmarse). Se reintentará en la próxima pasada.',
          );
          skipped += 1;
          continue;
        }
      }
      // ⚠ SB-D7 — `swept` cuenta RESERVAS LIBERADAS, no vueltas del bucle. Antes sumaba `1`
      // aunque el `updateMany` tocara **cero** filas (la carrera normal: el webhook o una
      // sustitución liberaron esas piezas entre el `findMany` de arriba y esta transacción). Un
      // contador que sube sin haber liberado nada **miente en la única métrica** con la que se
      // vigila el barrido: no se puede distinguir «barrí 40 reservas» de «no había nada que barrer
      // 40 veces».
      const released = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.inventoryItem.updateMany({
          where: { id: { in: itemIds }, ...reservationGuard(orderId) },
          data: releaseReservationData,
        });
        if (order.status === 'pending') {
          await tx.order.update({ where: { id: orderId }, data: { status: 'failed' } });
        }
        return count;
      });
      if (released > 0) swept += 1;
      else noop += 1;
    }
    if (noop > 0) {
      this.logger.log(
        `order-reservation-sweep: ${noop} pedidos sin nada que liberar (otra ruta se les adelantó); ` +
          'la orden `pending` sí quedó `failed`.',
      );
    }
    if (skipped > 0) {
      this.logger.warn(`order-reservation-sweep: ${skipped} pedidos NO barridos (PaymentIntent vivo).`);
    }
    if (swept > 0) this.logger.log(`order-reservation-sweep: ${swept} reservas vencidas liberadas.`);
    if (legacy > 0) {
      // SEC-SB-1: se cuenta APARTE porque es una población que se AGOTA. Mientras este número no
      // sea 0 en una pasada, la rama `IS NULL` de `reservationGuard` NO se puede retirar (`RSV-L1`).
      this.logger.log(
        `order-reservation-sweep(legado): ${legacy} piezas LEGADAS (sin dueño) candidatas en ` +
          `${legacyByOrder.size} pedidos; el conteo de ARCHITECTURE §4.48.7(5) baja con cada pasada.`,
      );
    }
    return { swept, skipped, legacy };
  }

  /**
   * ⭐⭐ **SEC-SB-1 / C9** — las reservas LEGADAS que puede barrer esta pasada, agrupadas por la orden
   * a la que pertenecen. Una pieza legada (`status='reserved'` y `reservedByOrderId IS NULL`) no
   * lleva `reservedUntil` —M-53 no hizo backfill y no había de dónde sacarlo sin inventarlo—, así que
   * su vencimiento se deriva de la ÚNICA fecha que sí existe: `Order.createdAt + ORDER_RESERVATION_TTL_MIN`.
   *
   * ⛔ **Soltar de más es peor que soltar de menos** (le quitas a un cliente algo que está pagando).
   * Las tres condiciones que lo impiden, y ninguna es prescindible:
   *  1. **`Order.status = 'pending'`.** Una pieza legada bajo una orden `settled`/`refunded`/
   *     `chargeback` tiene dueño (alguien pagó): NO se toca, aunque siga `reserved` por una anomalía.
   *     Esa clase queda para el runbook, no para el barrido.
   *  2. **`createdAt < now − TTL`.** El checkout de hace diez minutos que aún está en el 3-D Secure
   *     NO es basura: es un cliente pagando. Mismo plazo que el resto del sistema (§4-R.1).
   *  3. **B3 (en el bucle del llamador): el PaymentIntent se cancela ANTES y tiene que quedar
   *     `canceled`.** Si Stripe dice `processing`/`succeeded`, la orden se salta entera. Ésta es la
   *     guarda fuerte: la única vía por la que una legada podía aún reclamarse es el webhook de su
   *     propio PI, y un PI cancelado ya no dispara `succeeded`.
   *
   * **Por qué la orden que encuentro es la dueña y no otra:** una pieza `reserved` está en las líneas
   * de como mucho UNA orden `pending` — `reserveItems` exige `status ∈ {listed,in_stock}` para crear
   * la `OrderItem`, y toda ruta que devuelve la pieza a ese estado (liberación, sustitución, webhook
   * `failed|canceled`, barrido) marca su orden `failed` en la MISMA transacción. Las demás órdenes que
   * mencionen la pieza son pasado terminal.
   *
   * Cubre lo que `GuestCheckoutService.sweepStaleGuestOrders` cubría (invitado + `direct_ship`) y
   * además lo que NO cubría nadie: bóveda, y envío directo de usuario CON cuenta. Las dos se retiran
   * juntas (`RSV-L1`) cuando el conteo de §4.48.7(5) sea 0 en producción.
   */
  private async legacyExpiredByOrder(now: Date): Promise<Map<string, string[]>> {
    const cutoff = new Date(now.getTime() - ORDER_RESERVATION_TTL_MIN * 60 * 1000);
    const legacyItem = { status: 'reserved', reservedByOrderId: null } as const;
    const stale = await this.prisma.order.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: cutoff },
        items: { some: { inventoryItem: legacyItem } },
      },
      select: {
        id: true,
        // SOLO las líneas legadas de la orden: el `swept` de la pasada cuenta piezas realmente
        // atrapadas, y no se arrastra a la liberación una línea que ya se resolvió por otra vía.
        items: { where: { inventoryItem: legacyItem }, select: { inventoryItemId: true } },
      },
    });
    const byOrder = new Map<string, string[]>();
    for (const order of stale) {
      const ids = [...new Set(order.items.map((i) => i.inventoryItemId))];
      if (ids.length > 0) byOrder.set(order.id, ids);
    }
    return byOrder;
  }

  /**
   * v1.68 (§4-R.5) — `reservedUntil` por orden para `GET /orders` y `GET /orders/:id`: el MENOR
   * vencimiento de las piezas que la orden retiene (todas se escriben juntas; el mínimo es el
   * conservador). Solo tiene sentido con `status:'pending'`; una `pending` legada (sin dueño) no trae
   * nada.
   */
  private async reservedUntilByOrder(orderIds: string[]): Promise<Map<string, Date>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.prisma.inventoryItem.groupBy({
      by: ['reservedByOrderId'],
      where: { reservedByOrderId: { in: orderIds }, status: 'reserved' },
      _min: { reservedUntil: true },
    });
    const out = new Map<string, Date>();
    for (const r of rows) {
      if (r.reservedByOrderId && r._min.reservedUntil) out.set(r.reservedByOrderId, r._min.reservedUntil);
    }
    return out;
  }

  /**
   * A2 (cierra BE-7) — crea el PaymentIntent de una orden ya reservada, COMPENSA si el proveedor
   * falla y persiste `stripePaymentIntentId`. Fuente ÚNICA para las dos rutas (T2): el bloque
   * «crear PI → compensar → persistir» estaba duplicado casi verbatim.
   *
   * La idempotency-key se deriva SIEMPRE en el SERVIDOR (`pi-order-<id>`). H2 (money-safety): en
   * RUTAS DE DINERO el header `Idempotency-Key` del cliente se IGNORA por completo — un cliente no
   * debe poder elegir (ni colisionar) la clave con la que se cobra. La clave server-derivada ya
   * garantiza que un reintento del mismo checkout no cree dos PaymentIntents.
   * Si Stripe falla TRAS reservar, se libera la reserva y la orden queda `failed`, en vez de dejar
   * piezas únicas atrapadas en `reserved` con una orden `pending` sin PaymentIntent.
   */
  async attachPaymentIntent(params: {
    orderId: string;
    amountCents: number;
    metadata: Record<string, string>;
    inventoryItemIds: string[];
  }): Promise<{ id: string; clientSecret: string }> {
    // H2: SIEMPRE la clave del servidor; jamás la del cliente.
    const idem = `pi-order-${params.orderId}`;
    let pi: { id: string; clientSecret: string };
    try {
      pi = await this.stripe.createPaymentIntent({
        amountCents: params.amountCents,
        metadata: params.metadata,
        idempotencyKey: idem,
      });
    } catch (e) {
      await this.releaseReservation(params.orderId, params.inventoryItemIds);
      throw this.toRetryError(e);
    }
    await this.prisma.order.update({
      where: { id: params.orderId },
      data: { stripePaymentIntentId: pi.id },
    });
    return pi;
  }

  /**
   * A2 — convierte un fallo del proveedor de pago en un error de reintento (503). Los errores de
   * negocio ya legibles (p. ej. `AMOUNT_TOO_LOW`, `CARD_DECLINED`) se propagan tal cual para que
   * el cliente no reintente ciegamente. Fuente ÚNICA (T2): estaba duplicado verbatim.
   */
  toRetryError(e: unknown): unknown {
    if (e instanceof BusinessException) return e;
    return BusinessException.retriable(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payment provider unavailable; the reservation was released. Please retry.',
    );
  }

  /**
   * MS-2 (BE-27) — FUENTE ÚNICA del mapeo de overflow de AGREGADOS a error de negocio, para las DOS
   * rutas que PERSISTEN una `Order` (bóveda y envío directo). Ejecuta el cómputo de un breakdown y, si
   * `grossUpTotal` lanzó por un `totalCents` no representable en Int32 (> `MAX_CENTS`), lo traduce a
   * `AMOUNT_TOO_LARGE` (422) en vez de dejar propagar un 500 crudo o —peor— reventar al persistir la
   * Order (excepción Postgres). Un agregado NUNCA se clampa (recortar = subcobro): se RECHAZA. Cualquier
   * otro `Error` (p. ej. mala config de fee) se propaga tal cual (es 500 legítimo de servidor).
   */
  representableOrThrow<T extends { totalCents: number }>(compute: () => T): T {
    try {
      return compute();
    } catch (e) {
      if (e instanceof Error && e.message.includes('MAX_CENTS')) {
        throw BusinessException.validation(
          'AMOUNT_TOO_LARGE',
          'Order amount exceeds the maximum representable value; please split the order.',
        );
      }
      throw e;
    }
  }

  /**
   * Checkout session: reserva items, crea Order pending y PaymentIntent Stripe.
   * ARCHITECTURE §3.3, §5.1. Concurrencia: reserva con status=reserved (pieza única).
   *
   * ⭐⭐ v1.68 (§4-R.2, ARCHITECTURE §4.48.2) — EL REINTENTO DEL MISMO CLIENTE. Bajo la PUERTA POR
   * CLIENTE (`lockReservationGate`, misma ceremonia que `lockFxGate`: candado → releer por el mismo
   * `tx` → decidir → escribir) se buscan las reservas PROPIAS y VIVAS que intersecan el carrito:
   *  - ninguna ⇒ como hoy: orden `pending` + reserva CON DUEÑO + PI ⇒ `201`;
   *  - exactamente una y su conjunto de piezas == el carrito ⇒ **REUSO**: misma orden, mismo PI, TTL
   *    renovado, breakdown CONGELADO (no se re-precia) ⇒ `200 reused:true`;
   *  - carrito distinto o más de una ⇒ **SUSTITUCIÓN**: por cada vieja, cancelar su PI y comprobar
   *    `canceled` ANTES de liberar+reservar+crear (todo en el `tx`); PI nuevo tras el commit ⇒ `201`
   *    con `supersededOrderIds`. Si el PI viejo no se puede cancelar ⇒ `409 PAYMENT_IN_PROGRESS`, cero
   *    escritura.
   *  - reservada por OTRO cliente ⇒ `409 ITEM_UNAVAILABLE`, como hoy (`reserveItems`/`isSellable`).
   * Idempotencia observable: N llamadas iguales, concurrentes o no ⇒ UNA orden `pending` y UN PI.
   */
  async createSession(
    userId: string,
    inventoryItemIds: string[],
    billingProfileId: string | undefined,
  ): Promise<CheckoutSessionResult> {
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();

    const billingSnapshot = billingProfileId
      ? await this.prisma.billingProfile.findFirst({ where: { id: billingProfileId, userId } })
      : await this.prisma.billingProfile.findUnique({ where: { userId } });

    // ⛔ El precio se resuelve FUERA de la transacción (y antes del candado): dentro, cada checkout
    // necesitaría una SEGUNDA conexión para `PricingService` y N concurrentes agotan el pool
    // (v1.68.1; ver `priceCartOutsideGate`). La atomicidad la da `reserveItems`, no esta lectura.
    const { items, subtotalCents: subtotal, lines: orderItemsData } =
      await this.priceCartOutsideGate(inventoryItemIds, { userId });

    const outcome = await this.prisma.$transaction(async (tx): Promise<SessionOutcome> => {
      await lockReservationGate(tx, { userId });
      const now = new Date();
      const own = await this.findOwnLiveReservations(tx, inventoryItemIds, { userId }, now);
      if (own.length === 1 && this.isReusable(own[0], inventoryItemIds)) {
        const reservedUntil = await this.renewReservation(tx, own[0].order.id, now);
        return { kind: 'reused', order: own[0].order, reservedUntil };
      }
      const supersededOrderIds: string[] = [];
      for (const o of own) {
        await this.supersedeOwnOrder(tx, o);
        supersededOrderIds.push(o.order.id);
      }

      // MS-2 (BE-27): un agregado no representable en Int32 → 422 AMOUNT_TOO_LARGE (nunca se persiste
      // un overflow ni se clampa el total). El mapeo es la fuente única `representableOrThrow`.
      const breakdown = this.representableOrThrow(() => computeCartBreakdown(subtotal, ivaPct, fee));
      // v1.21 (M-25): el número legible sale de la secuencia (nextval es no transaccional; un hueco
      // en la secuencia es inocuo, un número duplicado no). Solo se consume si se crea orden, y se pide
      // POR EL `tx` (v1.68.1: no gasta una segunda conexión del pool).
      const orderNumber = await this.nextOrderNumber(tx);
      const reservedUntil = reservedUntilFrom(now);

      // Creación de la Order pending ANTES de reservar (M-53: la FK del dueño exige que exista) +
      // reserva ATÓMICA de cada pieza única con dueño y vencimiento (helper compartido, T2).
      // Transición: listed/in_stock → reserved (aquí) → in_custody (settle) | listed (pago falla /
      // contracargo / barrido / sustitución).
      const created = await tx.order.create({
        data: {
          userId,
          // v1.21 (M-25): TODO pedido nuevo lleva número legible (también los de bóveda).
          orderNumber,
          status: 'pending',
          subtotalCents: breakdown.subtotalCents,
          processingFeeCents: breakdown.processingFeeCents,
          ivaCents: breakdown.ivaCents,
          totalCents: breakdown.totalCents,
          ivaRatePct: breakdown.ivaRatePct,
          // v1.64-iva-inclusive (M-50, §4.44.k · DEPLOY 1) — TODA orden nueva nace `IVA_EXCLUSIVE`,
          // que es la convención con la que ESTE código la acaba de cobrar. La conducta NO cambia:
          // el deploy 1 es puramente aditivo. ⛔ Se escribe EXPLÍCITAMENTE y no por default de BD:
          // la columna no tiene default justamente para que un camino que olvide esta línea REVIENTE
          // en vez de heredar un significado equivocado en silencio (§4.44.e, candado `IVA-3(e)`).
          // ⛔ `ivaTransferPct` se queda en `NULL`: bajo `IVA_EXCLUSIVE` el dial no participó.
          priceConvention: 'IVA_EXCLUSIVE',
          cfdiStatus: 'registrado',
          billingSnapshot: billingSnapshot ?? undefined,
          items: { create: orderItemsData },
        },
      });
      // Bóveda: la pieza pasa a la bóveda del comprador con titularidad `pending`.
      await this.reserveItems(
        tx,
        items,
        { ownerType: 'customer', ownerUserId: userId, ownershipStatus: 'pending' },
        { orderId: created.id, reservedUntil },
      );
      return {
        kind: 'created',
        order: created,
        breakdown,
        itemIds: orderItemsData.map((oi) => oi.inventoryItemId),
        supersededOrderIds,
        reservedUntil,
      };
    }, RESERVATION_TX_OPTIONS);

    if (outcome.kind === 'reused') {
      const stripe = await this.paymentIntentForReuse(
        outcome.order,
        { orderId: outcome.order.id, userId, kind: 'order' },
        inventoryItemIds,
      );
      return {
        orderId: outcome.order.id,
        orderNumber: outcome.order.orderNumber,
        breakdown: this.breakdownOf(outcome.order),
        stripe,
        reused: true,
        reservedUntil: outcome.reservedUntil,
        supersededOrderIds: [],
      };
    }

    // A2 (cierra BE-7): crear PI + compensar si falla + persistir el id (helper compartido, T2).
    // R-4: el PI NUEVO se crea DESPUÉS de haber cancelado y confirmado el viejo (dentro del tx).
    const pi = await this.attachPaymentIntent({
      orderId: outcome.order.id,
      amountCents: outcome.breakdown.totalCents,
      metadata: { orderId: outcome.order.id, userId, kind: 'order' },
      inventoryItemIds: outcome.itemIds,
    });

    return {
      orderId: outcome.order.id,
      orderNumber: outcome.order.orderNumber,
      breakdown: outcome.breakdown,
      stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret },
      reused: false,
      reservedUntil: outcome.reservedUntil,
      supersededOrderIds: outcome.supersededOrderIds,
    };
  }

  /**
   * v1.21.2 (T1, §M3) — DESENLACE HUMANO de una pieza CONGELADA por un contracargo con envío vivo.
   * Sin esta acción, la pieza congelada (`picking`, fuera de venta) se quedaría congelada para
   * siempre: ninguna automatización puede decidir dónde está físicamente la carta.
   *
   * Tres desenlaces, todos con `note` obligatoria (el registro de lo que el operador vio en el
   * estante) y todos dejando `chargebackNeedsManual=false`:
   *  - `recuperada`    — el operador tiene la carta ⇒ `picking|shipped → listed` (o `in_stock` si
   *                      su precio no resuelve) + `chargeback_return`. Vuelve a la venta CON
   *                      respaldo físico.
   *  - `no_recuperada` — la carta ya no está ⇒ **sin** movimiento de inventario; se queda donde
   *                      está. **No** se marca `lost`/`damaged`: no fue merma de almacén y
   *                      ensuciaría los reportes de pérdida (mismo cuidado que `delivered` vs
   *                      `withdrawn`). La pérdida se refleja en la orden `chargeback` para M7.
   *  - `reexpedir`     — solo si GANAMOS la disputa ⇒ envío nuevo con la misma forma que el del
   *                      settle; las piezas siguen en `picking`.
   *
   * Idempotencia (norma §M3): **cualquier** outcome sobre una orden con `chargebackNeedsManual=false`
   * (ya resuelta) devuelve `409 CONFLICT` y no duplica movimientos ni envíos. La garantía es
   * ATÓMICA, no de comentario: el guard y los efectos van en UNA transacción y la decisión se
   * "reclama" con `updateMany ... count===1` (ver dentro), así que dos llamadas concurrentes no
   * pueden crear dos envíos.
   */
  async resolveChargebackInventory(
    orderId: string,
    outcome: 'recuperada' | 'no_recuperada' | 'reexpedir',
    now = new Date(),
  ): Promise<{
    orderId: string;
    outcome: string;
    inventoryItemIds: string[];
    shipmentId?: string;
    chargebackNeedsManual: false;
  }> {
    // ⭐ I1 (techlead, 2026-09-11) — **el precio se resuelve ANTES de abrir la transacción**, por el
    // mismo motivo que el pricing del checkout salió de su `tx` en v1.68.1: `sellableStatusFor` usa
    // `this.prisma` y `this.pricing` (otros handles), así que llamarlo DENTRO del `$transaction`
    // pedía una SEGUNDA conexión **por pieza** mientras la primera seguía retenida. Con
    // `connection_limit=5` y varias resoluciones a la vez, el pool se agota y una ruta de dinero
    // muere con `Timed out fetching a new connection`. Era el defecto de v1.68.1 vivo en otra ruta.
    //
    // Preciar antes NO relaja nada: quien decide es el `updateMany` guardado por `status` de dentro
    // (`count !== 1 ⇒ continue`). El mapa se calcula sobre **todas** las piezas del pedido (no solo
    // las congeladas), así que toda pieza que la transacción encuentre congelada ya tiene veredicto
    // — sin ruta de respaldo que pudiera reintroducir la lectura de dentro.
    const sellableStatusByItem = await this.prescanSellableStatus(orderId, outcome);
    // TODO EN UNA TRANSACCIÓN (techlead): antes se leía `chargebackNeedsManual` FUERA y se
    // escribía DENTRO, así que dos llamadas concurrentes (doble submit; el endpoint no lleva
    // Idempotency-Key) pasaban ambas el guard. Con `recuperada` salvaba el `count===1` por pieza,
    // pero `reexpedir` creaba DOS `ShipmentRequest` para la misma orden — rompiendo el invariante
    // «a lo más un envío activo por orden» (§4-G.10) y duplicando la pieza en `pickingList()`.
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw BusinessException.notFound();
      if (order.fulfillmentMode !== 'direct_ship') {
        throw BusinessException.badRequest(
          'VALIDATION_ERROR',
          'Only a direct_ship order can have a frozen piece from a chargeback',
        );
      }

      // CLAIM ATÓMICO de la decisión: gana quien consiga la transición `true → false`
      // (mismo patrón `updateMany` + `count===1` que la reserva de piezas únicas). El perdedor ve
      // `count===0` ⇒ `409`, que ES la regla de idempotencia de §M3.
      // Si algo posterior lanza, la transacción REVIERTE y el flag vuelve a `true`: un desenlace
      // rechazado (p. ej. `reexpedir` sin disputa ganada) NO consume la decisión.
      const claimed = await tx.order.updateMany({
        where: { id: orderId, chargebackNeedsManual: true },
        data: { chargebackNeedsManual: false },
      });
      if (claimed.count !== 1) {
        throw BusinessException.conflict(
          'CONFLICT',
          'This chargeback has no pending inventory decision (already resolved or being resolved)',
        );
      }

      // Piezas CONGELADAS del pedido: las que siguen comprometidas con la venta.
      const frozen = await tx.inventoryItem.findMany({
        where: {
          id: { in: order.items.map((oi) => oi.inventoryItemId) },
          status: { in: ['picking', 'shipped'] },
        },
      });

      if (outcome === 'reexpedir') {
        // Re-expedir solo tiene sentido si la disputa se GANÓ (los fondos volvieron).
        if (order.status !== 'settled' || order.disputeOutcome !== 'won') {
          throw BusinessException.conflict(
            'CONFLICT',
            'Re-shipping requires a won dispute (order settled with disputeOutcome=won)',
          );
        }
        if (frozen.length === 0) {
          throw BusinessException.conflict('CONFLICT', 'There is no frozen piece to re-ship');
        }
        // Invariante §4-G.10: a lo más UN envío activo por orden. Con el claim atómico de arriba
        // esta comprobación no debería disparar nunca; se deja como red de seguridad explícita.
        const active = await tx.shipmentRequest.findFirst({
          where: { orderId: order.id, status: { not: 'cancelado' } },
        });
        if (active) {
          throw BusinessException.conflict(
            'CONFLICT',
            'This order already has an active shipment',
          );
        }
        // Misma FORMA que el envío del settle: montos en 0 (el ingreso vive en
        // Order.shippingFeeCents), sin userId y con el snapshot de dirección de la orden.
        const created = await tx.shipmentRequest.create({
          data: {
            userId: null,
            orderId: order.id,
            addressSnapshot: (order.shippingAddressSnapshot ?? {}) as Prisma.InputJsonValue,
            status: 'picking',
            pickingAt: now,
            shippingFeeCents: 0,
            ivaCents: 0,
            processingFeeCents: 0,
            totalCents: 0,
            // v1.64 (M-50, DEPLOY 1): la convención se escribe SIEMPRE, también en el envío de
            // montos-en-cero. Un cero también tiene convención, y una fila sin ella no se puede leer.
            priceConvention: 'IVA_EXCLUSIVE',
            items: { create: frozen.map((i) => ({ inventoryItemId: i.id })) },
          },
        });
        return {
          orderId: order.id,
          outcome,
          inventoryItemIds: frozen.map((i) => i.id),
          shipmentId: created.id,
          chargebackNeedsManual: false as const,
        };
      }

      if (outcome === 'recuperada') {
        if (frozen.length === 0) {
          throw BusinessException.conflict('CONFLICT', 'There is no frozen piece to recover');
        }
        const recovered: string[] = [];
        for (const item of frozen) {
          // `listed` solo si su precio de venta resuelve; si no, `in_stock` (en Compra NUNCA se
          // muestra una pieza sin precio — PROJECT §A). ⚠ I1: el veredicto viene del pre-escaneo de
          // FUERA de la transacción; aquí NO se toca `this.prisma`/`this.pricing` (segunda conexión).
          const toStatus = sellableStatusByItem.get(item.id) ?? 'in_stock';
          const moved = await tx.inventoryItem.updateMany({
            where: { id: item.id, status: item.status },
            data: {
              status: toStatus,
              ownerType: 'platform',
              ownerUserId: null,
              ownershipStatus: null,
            },
          });
          if (moved.count !== 1) continue;
          await tx.inventoryMovement.create({
            data: {
              itemId: item.id,
              fromStatus: item.status,
              toStatus,
              reason: MovementReason.chargeback_return,
              note: `chargeback resolved (recuperada) order ${order.orderNumber ?? order.id}`,
            },
          });
          recovered.push(item.id);
        }
        return {
          orderId: order.id,
          outcome,
          inventoryItemIds: recovered,
          chargebackNeedsManual: false as const,
        };
      }

      // `no_recuperada`: SIN movimiento de inventario. La pieza se queda donde está (terminal de
      // venta). NO se marca `lost`/`damaged`: no fue merma de almacén y ensuciaría los reportes.
      return {
        orderId: order.id,
        outcome,
        inventoryItemIds: frozen.map((i) => i.id),
        chargebackNeedsManual: false as const,
      };
    });
  }

  /**
   * ⭐ I1 — pre-escaneo de precios de `resolveChargebackInventory`, **fuera de toda transacción**.
   * Devuelve, por pieza del pedido, a qué estado vendible volvería si se recupera. Se calcula sobre
   * TODAS las piezas del pedido (no solo las congeladas) para que la transacción nunca encuentre una
   * pieza sin veredicto y no necesite una ruta de respaldo que vuelva a tocar la BD desde dentro.
   *
   * Solo trabaja para `recuperada`: es el único desenlace que mueve inventario por precio.
   */
  private async prescanSellableStatus(
    orderId: string,
    outcome: 'recuperada' | 'no_recuperada' | 'reexpedir',
  ): Promise<Map<string, 'listed' | 'in_stock'>> {
    const byItem = new Map<string, 'listed' | 'in_stock'>();
    if (outcome !== 'recuperada') return byItem;
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: { inventoryItemId: true },
    });
    for (const { inventoryItemId } of items) {
      byItem.set(inventoryItemId, await this.sellableStatusFor(inventoryItemId));
    }
    return byItem;
  }

  /**
   * ¿A qué estado vendible vuelve una pieza recuperada? `listed` si su precio de venta resuelve;
   * `in_stock` si queda pendiente (una pieza sin precio NUNCA se publica en Compra, PROJECT §A).
   *
   * ⛔ **Usa `this.prisma` y `this.pricing`** (dos handles que NO son el de una transacción en curso):
   * llamarlo dentro de un `$transaction` pide una segunda conexión por pieza y agota el pool (I1).
   * Su único llamador es {@link prescanSellableStatus}, que corre FUERA de la transacción.
   */
  private async sellableStatusFor(inventoryItemId: string): Promise<'listed' | 'in_stock'> {
    try {
      const full = await this.prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        include: { card: { include: { set: true } } },
      });
      if (!full) return 'in_stock';
      await this.salePriceOf(full);
      return 'listed';
    } catch {
      // PRICE_PENDING (o cualquier fallo al resolver el precio) ⇒ no se publica.
      return 'in_stock';
    }
  }

  async listOrders(userId: string, page: number, pageSize: number) {
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);
    // v1.68 (§4-R.5, ADITIVO): `orderNumber` siempre; `reservedUntil` SOLO con `status:'pending'`.
    const reservedUntil = await this.reservedUntilByOrder(
      orders.filter((o) => o.status === 'pending').map((o) => o.id),
    );
    const data = orders.map((o) => ({
      id: o.id,
      userId: o.userId,
      status: o.status,
      totalCents: o.totalCents,
      createdAt: o.createdAt,
      settledAt: o.settledAt,
      orderNumber: o.orderNumber,
      ...(o.status === 'pending' && reservedUntil.has(o.id)
        ? { reservedUntil: reservedUntil.get(o.id) }
        : {}),
    }));
    return { data, page, pageSize, total };
  }

  /**
   * §5.2.5 — resolución BATCHEADA de la clase (P) para el histórico: **UNA sola consulta** por los
   * `cardId` DISTINTOS del pedido, nunca un N+1. Solo se traen `id` e `imageSmallUrl`.
   *
   * ⛔ PROHIBIDO resolver vía `OrderItem.inventoryItemId → InventoryItem.card`: la pieza física
   * cambia de titular, estado y bóveda a lo largo del ciclo, y el acta de compra no puede colgar de
   * una entidad que sigue mutando. El `cardId` congelado es el único puente estable.
   *
   * Que un `cardId` no resuelva (la fila `Card` desapareció) NO es un error: rinde `null` y el
   * front pinta su placeholder.
   */
  private async loadCardsForSnapshots(
    facts: { cardId?: string }[],
  ): Promise<Map<string, CardImageSource>> {
    const ids = distinctCardIds(facts);
    if (ids.length === 0) return new Map();
    const cards = await this.prisma.card.findMany({
      where: { id: { in: ids } },
      select: CARD_IMAGE_SELECT,
    });
    return new Map(cards.map((c) => [c.id, { imageSmallUrl: c.imageSmallUrl }]));
  }

  /**
   * ⛑️ **T-2 (v1.51-e) — la proyección HERMANA del histórico, con su retorno ANOTADO.**
   *
   * Las dos cotizaciones ya cruzaban `toOrderItemPreviews`, con tipo declarado. Ésta —la superficie con
   * la garantía MÁS DÉBIL, porque lee de la columna `Json`— proyectaba en línea dentro de un `return` de
   * ~25 claves: su tipo era inferido y no se contrastaba con nada, justo donde más falta hace decirlo.
   * Ahora las **tres** superficies cruzan una frontera declarada.
   *
   * Reglas que este cuerpo hace cumplir (§5.2.4/§5.2.5) y que no se pueden relajar aquí:
   *  · los hechos salen del blob **tal cual se congelaron** — jamás se re-derivan;
   *  · `imageSmallUrl` **jamás** se lee del JSON: se une por el `cardId` congelado contra el mapa ya
   *    batcheado (prohibido `inventoryItemId → InventoryItem.card`, §5.2.5);
   *  · un `cardId` que no resuelve rinde `null`, que es un resultado legítimo, no un error.
   *
   * `facts[i]` corresponde a `items[i]`: los dos arrays salen del MISMO `order.items` en el mismo orden.
   */
  private toHistoricItemPreviews(
    items: { inventoryItemId: string; unitPriceCents: number }[],
    facts: PersistedCardFacts[],
    cardsById: Map<string, CardImageSource>,
  ): { inventoryItemId: string; card: HistoricalOrderItemCardDTO; unitPriceCents: number }[] {
    return items.map((i, idx) => ({
      inventoryItemId: i.inventoryItemId,
      card: resolveOrderItemCard(facts[idx], cardsById.get(facts[idx].cardId ?? '')),
      unitPriceCents: i.unitPriceCents,
    }));
  }

  async getOrder(userId: string, orderId: string, isAdmin = false) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw BusinessException.notFound();
    if (!isAdmin && order.userId !== userId) throw BusinessException.forbidden('FORBIDDEN');
    const breakdown: BreakdownDTO = this.breakdownOf(order);
    // v1.68 (§4-R.5, ADITIVO): `reservedUntil` SOLO con `status:'pending'`.
    const reservedUntil =
      order.status === 'pending'
        ? (await this.reservedUntilByOrder([order.id])).get(order.id)
        : undefined;
    // §5.2.4/§5.2.5 — ÉSTA es la superficie que lee del HISTÓRICO. Los hechos congelados salen del
    // JSON tal cual se escribieron al cobrar (NO se re-derivan nunca); `imageSmallUrl` NO se lee de
    // ahí —ni aunque estuviera— sino que se resuelve uniendo por el `cardId` congelado. Por eso el
    // MISMO código sirve pedidos viejos y nuevos: los pedidos anteriores a v1.51-b muestran
    // miniatura SIN migración ni backfill.
    const facts = order.items.map((i) => readFrozenCardFacts(i.cardSnapshot));
    const cardsById = await this.loadCardsForSnapshots(facts);
    return {
      id: order.id,
      status: order.status,
      createdAt: order.createdAt,
      settledAt: order.settledAt,
      // v1.68 (§4-R.5): número legible en el detalle del cliente (antes solo lo emitía el admin).
      orderNumber: order.orderNumber,
      ...(reservedUntil ? { reservedUntil } : {}),
      breakdown,
      items: this.toHistoricItemPreviews(order.items, facts, cardsById),
      cfdiStatus: order.cfdiStatus,
      invoiceRequested: order.invoiceRequested,
      stripePaymentIntentId: order.stripePaymentIntentId,
      // v1.21-guest-checkout (§4-G.8, ADITIVO): permite a la UI etiquetar "pedido hecho como
      // invitado" y mostrar cuándo se reclamó. SIN PII: no expone `guestEmail`.
      isGuestOrder: order.guestEmail != null,
      claimedAt: order.claimedAt ?? undefined,
    };
  }

  async requestInvoice(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw BusinessException.notFound();
    await this.prisma.order.update({ where: { id: orderId }, data: { invoiceRequested: true } });
    return { orderId, invoiceRequested: true, instructions: 'SEND_FISCAL_DATA_BY_EMAIL' };
  }
}
