import { Injectable } from '@nestjs/common';
import { InventoryItem, Card, CardSet, MovementReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { CatalogService } from '../catalog/catalog.service';
import { computeCartBreakdown, BreakdownDTO } from '../../common/money';

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
    if (item.listPriceCents != null && item.listPriceCents > 0) return item.listPriceCents;
    const gradeKey = this.pricing.gradeKeyFor(item);
    // v1.6-finish: precio de venta contra la referencia del ACABADO del item.
    const ref = await this.pricing.getReference(item.cardId, item.productType, gradeKey, item.finish);
    const referenceMxnCents = ref.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
    // v1.13-sales-pricing (§4.14d): precio de venta por RAREZA (SEC-A1: rareza de Card.rarity, acabado
    // de InventoryItem.finish). Con `fixed` devuelve el PISO aunque no haya market; con `pct` y sin
    // referencia → 'pending' → PRICE_PENDING (se conserva el comportamiento previo).
    const sale = await this.pricing.computeSalePriceForItem(
      { rarity: item.card.rarity, finish: item.finish },
      referenceMxnCents,
    );
    if (sale.salePriceCents == null) {
      throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no price`);
    }
    return sale.salePriceCents;
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
   * Valida disponibilidad y resuelve el precio de venta de cada línea del carrito.
   * Fuente ÚNICA de la regla de venta para los DOS checkouts (con cuenta y de invitado, §4-G.1):
   * comprar como invitado NO cambia condiciones comerciales (mismo precio, mismas validaciones).
   * `ITEM_UNAVAILABLE` si la pieza no es de plataforma o no está en `{listed, in_stock}`;
   * `PRICE_PENDING` si no tiene precio de venta resoluble (SEC-A1: se deriva server-side).
   */
  async priceCartLines(inventoryItemIds: string[]): Promise<{
    items: (InventoryItem & { card: Card & { set?: CardSet | null } })[];
    subtotalCents: number;
    lines: { inventoryItemId: string; cardSnapshot: object; unitPriceCents: number }[];
  }> {
    const items = await this.loadItems(inventoryItemIds);
    const lines: { inventoryItemId: string; cardSnapshot: object; unitPriceCents: number }[] = [];
    let subtotalCents = 0;
    for (const item of items) {
      if (item.ownerType !== 'platform' || !['listed', 'in_stock'].includes(item.status)) {
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
      const price = await this.salePriceOf(item);
      subtotalCents += price;
      lines.push({
        inventoryItemId: item.id,
        cardSnapshot: this.cardSnapshot(item),
        unitPriceCents: price,
      });
    }
    return { items, subtotalCents, lines };
  }

  /**
   * v1.21 (M-25): siguiente número legible de pedido `TCG-000123` desde la secuencia Postgres
   * `order_number_seq`. Mismo patrón que `inventory_folio_seq` (`PrismaService.nextFolio`); se
   * implementa aquí —y no en `PrismaService`— porque `src/prisma/` es zona de otro stream.
   */
  async nextOrderNumber(): Promise<string> {
    const rows = await this.prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
      "SELECT nextval('order_number_seq') AS nextval",
    );
    return `TCG-${String(Number(rows[0].nextval)).padStart(6, '0')}`;
  }

  async quote(userId: string, inventoryItemIds: string[]) {
    const { subtotalCents, lines } = await this.priceCartLines(inventoryItemIds);
    const previews = lines.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: l.cardSnapshot,
      unitPriceCents: l.unitPriceCents,
    }));
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    const breakdown = computeCartBreakdown(subtotalCents, ivaPct, fee);
    return { items: previews, breakdown };
  }

  private cardSnapshot(item: InventoryItem & { card: Card & { set?: CardSet | null } }) {
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
   *    de `priceCartLines`: entre aquel `findMany` y esta transacción, otro flujo podía cambiar la
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
   * La idempotency-key se deriva en el SERVIDOR (`pi-order-<id>`); el header del cliente es solo
   * un override, así que un reintento del mismo checkout no crea dos PaymentIntents.
   * Si Stripe falla TRAS reservar, se libera la reserva y la orden queda `failed`, en vez de dejar
   * piezas únicas atrapadas en `reserved` con una orden `pending` sin PaymentIntent.
   */
  async attachPaymentIntent(params: {
    orderId: string;
    amountCents: number;
    metadata: Record<string, string>;
    inventoryItemIds: string[];
    idempotencyKey?: string;
  }): Promise<{ id: string; clientSecret: string }> {
    const idem = params.idempotencyKey ?? `pi-order-${params.orderId}`;
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
   * Checkout session: reserva items, crea Order pending y PaymentIntent Stripe.
   * ARCHITECTURE §3.3, §5.1. Concurrencia: reserva con status=reserved (pieza única).
   */
  async createSession(
    userId: string,
    inventoryItemIds: string[],
    billingProfileId: string | undefined,
    idempotencyKey?: string,
  ) {
    const { items, subtotalCents: subtotal, lines: orderItemsData } =
      await this.priceCartLines(inventoryItemIds);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    const breakdown = computeCartBreakdown(subtotal, ivaPct, fee);

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
      idempotencyKey,
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
   * (ya resuelta) devuelve `409 CONFLICT` y no duplica movimientos ni envíos.
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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw BusinessException.notFound();
    if (order.fulfillmentMode !== 'direct_ship') {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        'Only a direct_ship order can have a frozen piece from a chargeback',
      );
    }
    // Idempotencia: una orden ya resuelta no vuelve a moverse.
    if (!order.chargebackNeedsManual) {
      throw BusinessException.conflict(
        'CONFLICT',
        'This chargeback has no pending inventory decision (already resolved)',
      );
    }

    // Piezas CONGELADAS del pedido: las que siguen en el almacén comprometidas con la venta.
    const frozen = await this.prisma.inventoryItem.findMany({
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
      const shipment = await this.prisma.$transaction(async (tx) => {
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
        await tx.order.update({
          where: { id: order.id },
          data: { chargebackNeedsManual: false },
        });
        return created;
      });
      return {
        orderId: order.id,
        outcome,
        inventoryItemIds: frozen.map((i) => i.id),
        shipmentId: shipment.id,
        chargebackNeedsManual: false,
      };
    }

    if (outcome === 'recuperada') {
      if (frozen.length === 0) {
        throw BusinessException.conflict('CONFLICT', 'There is no frozen piece to recover');
      }
      const recovered: string[] = [];
      await this.prisma.$transaction(async (tx) => {
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
        await tx.order.update({ where: { id: order.id }, data: { chargebackNeedsManual: false } });
      });
      return {
        orderId: order.id,
        outcome,
        inventoryItemIds: recovered,
        chargebackNeedsManual: false,
      };
    }

    // `no_recuperada`: SIN movimiento de inventario. La pieza se queda donde está.
    await this.prisma.order.update({
      where: { id: order.id },
      data: { chargebackNeedsManual: false },
    });
    return {
      orderId: order.id,
      outcome,
      inventoryItemIds: frozen.map((i) => i.id),
      chargebackNeedsManual: false,
    };
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
    return {
      id: order.id,
      status: order.status,
      createdAt: order.createdAt,
      settledAt: order.settledAt,
      breakdown,
      items: order.items.map((i) => ({
        inventoryItemId: i.inventoryItemId,
        card: i.cardSnapshot,
        unitPriceCents: i.unitPriceCents,
      })),
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
