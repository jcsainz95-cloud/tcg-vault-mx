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
    const ref = await this.pricing.getReference(item.cardId, item.productType, gradeKey);
    if (ref.status !== 'priced' || ref.referenceMxnCents == null) {
      throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no price`);
    }
    return this.pricing.computeSalePrice(ref.referenceMxnCents);
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

  async quote(userId: string, inventoryItemIds: string[]) {
    const items = await this.loadItems(inventoryItemIds);
    const previews: { inventoryItemId: string; card: unknown; unitPriceCents: number }[] = [];
    let subtotal = 0;
    for (const item of items) {
      if (item.ownerType !== 'platform' || !['listed', 'in_stock'].includes(item.status)) {
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
      const price = await this.salePriceOf(item);
      subtotal += price;
      previews.push({
        inventoryItemId: item.id,
        card: this.cardSnapshot(item),
        unitPriceCents: price,
      });
    }
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    const breakdown = computeCartBreakdown(subtotal, ivaPct, fee);
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
    const items = await this.loadItems(inventoryItemIds);
    let subtotal = 0;
    const orderItemsData: { inventoryItemId: string; cardSnapshot: object; unitPriceCents: number }[] = [];
    for (const item of items) {
      if (item.ownerType !== 'platform' || !['listed', 'in_stock'].includes(item.status)) {
        throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
      }
      const price = await this.salePriceOf(item);
      subtotal += price;
      orderItemsData.push({
        inventoryItemId: item.id,
        cardSnapshot: this.cardSnapshot(item),
        unitPriceCents: price,
      });
    }
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    const breakdown = computeCartBreakdown(subtotal, ivaPct, fee);

    const billingSnapshot = billingProfileId
      ? await this.prisma.billingProfile.findFirst({ where: { id: billingProfileId, userId } })
      : await this.prisma.billingProfile.findUnique({ where: { userId } });

    // Reserva transaccional + creación de Order pending; items a customer/pending/in_custody.
    const order = await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const fresh = await tx.inventoryItem.findUnique({ where: { id: item.id } });
        if (!fresh || !['listed', 'in_stock'].includes(fresh.status)) {
          throw BusinessException.conflict('ITEM_UNAVAILABLE', `Item ${item.folio} unavailable`);
        }
      }
      const created = await tx.order.create({
        data: {
          userId,
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
      for (const item of items) {
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: {
            status: 'in_custody',
            ownerType: 'customer',
            ownerUserId: userId,
            ownershipStatus: 'pending',
          },
        });
      }
      return created;
    });

    const pi = await this.stripe.createPaymentIntent({
      amountCents: breakdown.totalCents,
      metadata: { orderId: order.id, userId, kind: 'order' },
      idempotencyKey,
    });
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
    };
  }

  async requestInvoice(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw BusinessException.notFound();
    await this.prisma.order.update({ where: { id: orderId }, data: { invoiceRequested: true } });
    return { orderId, invoiceRequested: true, instructions: 'SEND_FISCAL_DATA_BY_EMAIL' };
  }
}
