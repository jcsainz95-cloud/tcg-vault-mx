import { Injectable } from '@nestjs/common';
import { InventoryItem, Card, CardSet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { CatalogService } from '../catalog/catalog.service';
import { computeCartBreakdown, BreakdownDTO } from '../../common/money';

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

    // Reserva ATÓMICA de cada pieza única + creación de la Order pending (ARCHITECTURE §8).
    // Se usa updateMany con guardia de estado vendible (listed/in_stock) y se exige
    // count===1: si dos checkouts concurrentes compiten por el mismo item, solo uno gana
    // la transición a `reserved`; el otro recibe ITEM_UNAVAILABLE. Transición de estados:
    //   listed/in_stock → reserved (aquí) → in_custody (settle) | listed (pago falla/contracargo).
    const order = await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const reserved = await tx.inventoryItem.updateMany({
          where: { id: item.id, status: { in: ['listed', 'in_stock'] } },
          data: {
            status: 'reserved',
            ownerType: 'customer',
            ownerUserId: userId,
            ownershipStatus: 'pending',
          },
        });
        if (reserved.count !== 1) {
          // Otro checkout ya reservó/vendió esta pieza (o cambió de estado).
          throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
        }
      }
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

    // M3: la idempotency-key se deriva en el SERVIDOR (`pi-order-<id>`); el header del
    // cliente es solo un override. Así, reintentos del mismo checkout no crean PIs dobles.
    const idem = idempotencyKey ?? `pi-order-${order.id}`;

    // A2 (cierra BE-7): el PaymentIntent es transaccional con la reserva. Si Stripe falla
    // TRAS reservar, compensamos —liberamos la reserva (items → vendibles) y marcamos la
    // orden `failed`— y devolvemos un error de reintento en vez de dejar la pieza única
    // atrapada en `reserved` con una orden `pending` sin PaymentIntent.
    let pi: { id: string; clientSecret: string };
    try {
      pi = await this.stripe.createPaymentIntent({
        amountCents: breakdown.totalCents,
        metadata: { orderId: order.id, userId, kind: 'order' },
        idempotencyKey: idem,
      });
    } catch (e) {
      await this.releaseReservation(
        order.id,
        orderItemsData.map((oi) => oi.inventoryItemId),
      );
      throw this.toRetryError(e);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: pi.id },
    });

    return {
      orderId: order.id,
      breakdown,
      stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret },
    };
  }

  /**
   * A2: compensación de la reserva ante fallo del PaymentIntent. Devuelve cada pieza a
   * estado vendible (`listed`, `ownerType=platform`) y marca la orden `failed`. La guardia
   * `status: 'reserved'` evita liberar items que otro flujo ya movió.
   */
  private async releaseReservation(orderId: string, itemIds: string[]): Promise<void> {
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
   * A2: convierte un fallo del proveedor de pago en un error de reintento (503). Los
   * errores de negocio ya legibles (p. ej. `AMOUNT_TOO_LOW`, `CARD_DECLINED`) se propagan
   * tal cual para que el cliente no reintente ciegamente.
   */
  private toRetryError(e: unknown): unknown {
    if (e instanceof BusinessException) return e;
    return BusinessException.retriable(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payment provider unavailable; the reservation was released. Please retry.',
    );
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
