import { Injectable } from '@nestjs/common';
import { InventoryItem, Card, CardSet, Finish, MarketBracket, MovementReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { CatalogService } from '../catalog/catalog.service';
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

@Injectable()
export class OrdersService {
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
    const gradeKey = this.pricing.gradeKeyFor(item);
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

  private async loadItems(ids: string[]) {
    const items = await this.prisma.inventoryItem.findMany({
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
  async priceCartForOrder(inventoryItemIds: string[]): Promise<{
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[];
    subtotalCents: number;
    lines: OrderLineData[];
  }> {
    const items = await this.loadItems(inventoryItemIds);
    for (const item of items) {
      if (!this.isSellable(item)) {
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
    }
    const { subtotalCents, lines } = await this.buildLines(items);
    return { items, subtotalCents, lines };
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
  async priceCartForQuote(inventoryItemIds: string[]): Promise<{
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[];
    subtotalCents: number;
    lines: OrderLineData[];
    unavailableItems: UnavailableCartItemDTO[];
  }> {
    // Un id repetido en el carrito no debe cotizar (ni podar) dos veces la misma pieza única.
    const uniqueIds = [...new Set(inventoryItemIds)];
    const found = await this.prisma.inventoryItem.findMany({
      where: { id: { in: uniqueIds } },
      include: { card: { include: { set: true } } },
    });
    const byId = new Map(found.map((i) => [i.id, i]));

    const valid: (InventoryItem & { card: Card & { set?: CardSet | null } })[] = [];
    const unavailableItems: UnavailableCartItemDTO[] = [];
    for (const id of uniqueIds) {
      const item = byId.get(id);
      if (!item) {
        unavailableItems.push({ inventoryItemId: id, cardName: null });
      } else if (!this.isSellable(item)) {
        unavailableItems.push({ inventoryItemId: id, cardName: item.card.name });
      } else {
        valid.push(item);
      }
    }
    const { subtotalCents, lines } = await this.buildLines(valid);
    return { items: valid, subtotalCents, lines, unavailableItems };
  }

  /**
   * v1.21 (M-25): siguiente número legible de pedido `TCG-000123` desde la secuencia Postgres
   * `order_number_seq`. Mismo patrón que `inventory_folio_seq` (`PrismaService.nextFolio`); se
   * implementa aquí —y no en `PrismaService`— porque `src/prisma/` es zona de otro stream.
   */
  async nextOrderNumber(): Promise<string> {
    // H3 (money-safety): `$queryRaw` con tagged template (parametrizado) en vez de `$queryRawUnsafe`.
    // La sentencia no lleva entradas del cliente, pero se prefiere la puerta segura por defecto
    // (mismo patrón que `master-set.service.ts`), para no dejar una superficie `Unsafe` viva.
    const rows = await this.prisma.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq') AS nextval`;
    return `TCG-${String(Number(rows[0].nextval)).padStart(6, '0')}`;
  }

  /**
   * POST /checkout/quote (§4) — v1.21.3-quote-prune: resolución POR ÍTEM. Los ids muertos del
   * carrito viajan en `unavailableItems` (siempre presente) con `200`; `items` y `breakdown` se
   * calculan SOLO con los válidos. Carrito 100 % muerto ⇒ `items: []` y breakdown EN CEROS (misma
   * forma; NO se corre el gross-up: cotizar la nada no puede producir un fee fijo > 0).
   * Session (`createSession`, abajo) NO usa esta ruta: sigue estricta.
   */
  async quote(inventoryItemIds: string[]) {
    const { items, subtotalCents, lines, unavailableItems } =
      await this.priceCartForQuote(inventoryItemIds);
    const previews = this.toOrderItemPreviews(items, lines);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const breakdown: BreakdownDTO =
      lines.length === 0
        ? this.zeroCartBreakdown(ivaPct)
        : computeCartBreakdown(subtotalCents, ivaPct, await this.settings.getStripeFee());
    return { items: previews, breakdown, unavailableItems };
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
  ): { inventoryItemId: string; card: OrderItemCardDTO; unitPriceCents: number }[] {
    const cardByItemId = new Map<string, CardImageSource>(items.map((i) => [i.id, i.card]));
    return lines.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: resolveOrderItemCard(l.cardSnapshot, cardByItemId.get(l.inventoryItemId)),
      unitPriceCents: l.unitPriceCents,
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
   */
  async reserveItems(
    tx: Prisma.TransactionClient,
    items: { id: string; folio: string }[],
    ownership: ReservationOwnership,
  ): Promise<void> {
    for (const item of items) {
      const reserved = await tx.inventoryItem.updateMany({
        where: { id: item.id, ownerType: 'platform', status: { in: ['listed', 'in_stock'] } },
        data: { status: 'reserved', ...(ownership ?? {}) },
      });
      if (reserved.count !== 1) {
        // Otro checkout ya reservó/vendió esta pieza (o cambió de estado/titularidad).
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
    }
  }

  /**
   * A2 — compensación de la reserva ante fallo del PaymentIntent (fuente ÚNICA, T2). Devuelve cada
   * pieza a estado vendible y de plataforma, y marca la orden `failed`. La guardia
   * `status: 'reserved'` evita liberar items que otro flujo ya movió.
   *
   * Escribe la titularidad de plataforma SIEMPRE, también en el envío directo: ahí es un no-op
   * (la pieza nunca dejó de ser de la plataforma) y evita tener dos cuerpos que puedan divergir.
   */
  async releaseReservation(orderId: string, itemIds: string[]): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        await tx.inventoryItem.updateMany({
          where: { id: { in: itemIds }, status: 'reserved' },
          data: {
            status: 'listed',
            ownerType: 'platform',
            ownerUserId: null,
            ownershipStatus: null,
          },
        });
        await tx.order.update({ where: { id: orderId }, data: { status: 'failed' } });
      })
      .catch(() => undefined);
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
   */
  async createSession(
    userId: string,
    inventoryItemIds: string[],
    billingProfileId: string | undefined,
  ) {
    const { items, subtotalCents: subtotal, lines: orderItemsData } =
      await this.priceCartForOrder(inventoryItemIds);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    // MS-2 (BE-27): un agregado no representable en Int32 → 422 AMOUNT_TOO_LARGE (nunca se persiste
    // un overflow ni se clampa el total). El mapeo es la fuente única `representableOrThrow`.
    const breakdown = this.representableOrThrow(() => computeCartBreakdown(subtotal, ivaPct, fee));

    const billingSnapshot = billingProfileId
      ? await this.prisma.billingProfile.findFirst({ where: { id: billingProfileId, userId } })
      : await this.prisma.billingProfile.findUnique({ where: { userId } });

    // v1.21 (M-25): el número legible se reserva ANTES de la transacción (nextval es
    // no transaccional; un hueco en la secuencia es inocuo, un número duplicado no).
    const orderNumber = await this.nextOrderNumber();

    // Reserva ATÓMICA de cada pieza única (helper compartido, T2) + creación de la Order pending
    // (ARCHITECTURE §8). Transición: listed/in_stock → reserved (aquí) → in_custody (settle) |
    // listed (pago falla / contracargo).
    const order = await this.prisma.$transaction(async (tx) => {
      // Bóveda: la pieza pasa a la bóveda del comprador con titularidad `pending`.
      await this.reserveItems(tx, items, {
        ownerType: 'customer',
        ownerUserId: userId,
        ownershipStatus: 'pending',
      });
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
          cfdiStatus: 'registrado',
          billingSnapshot: billingSnapshot ?? undefined,
          items: { create: orderItemsData },
        },
      });
      return created;
    });

    // A2 (cierra BE-7): crear PI + compensar si falla + persistir el id (helper compartido, T2).
    const pi = await this.attachPaymentIntent({
      orderId: order.id,
      amountCents: breakdown.totalCents,
      metadata: { orderId: order.id, userId, kind: 'order' },
      inventoryItemIds: orderItemsData.map((oi) => oi.inventoryItemId),
    });

    return {
      orderId: order.id,
      breakdown,
      stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret },
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
          // muestra una pieza sin precio — PROJECT §A).
          const toStatus = await this.sellableStatusFor(item);
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
   * ¿A qué estado vendible vuelve una pieza recuperada? `listed` si su precio de venta resuelve;
   * `in_stock` si queda pendiente (una pieza sin precio NUNCA se publica en Compra, PROJECT §A).
   */
  private async sellableStatusFor(item: InventoryItem): Promise<'listed' | 'in_stock'> {
    try {
      const full = await this.prisma.inventoryItem.findUnique({
        where: { id: item.id },
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
    const data = orders.map((o) => ({
      id: o.id,
      userId: o.userId,
      status: o.status,
      totalCents: o.totalCents,
      createdAt: o.createdAt,
      settledAt: o.settledAt,
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
    const breakdown: BreakdownDTO = {
      subtotalCents: order.subtotalCents,
      ivaCents: order.ivaCents,
      ivaRatePct: order.ivaRatePct,
      processingFeeCents: order.processingFeeCents,
      totalCents: order.totalCents,
      currency: 'MXN',
    };
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
