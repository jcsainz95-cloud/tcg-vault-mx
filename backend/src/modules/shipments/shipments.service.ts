import { Injectable } from '@nestjs/common';
import { Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { computeShipmentBreakdown } from '../../common/money';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly stripe: StripeService,
  ) {}

  private async breakdown() {
    const shippingFeeCents = await this.settings.getNumber(SettingKey.SHIPPING_FEE_CENTS);
    const ivaPct = await this.settings.getNumber(SettingKey.IVA_PCT);
    const fee = await this.settings.getStripeFee();
    return computeShipmentBreakdown(shippingFeeCents, ivaPct, fee);
  }

  private async validateAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) throw BusinessException.notFound();
    if (address.country !== 'MX') {
      throw BusinessException.validation('ADDRESS_NOT_MX', 'Only MX addresses allowed');
    }
    return address;
  }

  /** Clasifica items en elegibles (settled del usuario) e inelegibles con razón. */
  private async classifyItems(userId: string, ids: string[]) {
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids } } });
    const eligibleItemIds: string[] = [];
    const ineligible: { inventoryItemId: string; reason: string }[] = [];
    for (const id of ids) {
      const item = items.find((i) => i.id === id);
      if (!item || item.ownerUserId !== userId) {
        ineligible.push({ inventoryItemId: id, reason: 'NOT_FOUND' });
        continue;
      }
      if (item.ownershipStatus !== 'settled') {
        ineligible.push({ inventoryItemId: id, reason: 'ITEM_NOT_SETTLED' });
        continue;
      }
      eligibleItemIds.push(id);
    }
    return { eligibleItemIds, ineligible };
  }

  async quote(userId: string, inventoryItemIds: string[], addressId: string) {
    await this.validateAddress(userId, addressId);
    const { eligibleItemIds, ineligible } = await this.classifyItems(userId, inventoryItemIds);
    const breakdown = await this.breakdown();
    return { breakdown, eligibleItemIds, ineligible };
  }

  /**
   * Crea la solicitud de retiro. Cobra envío+IVA+fee por Stripe ANTES (nace en
   * `solicitado` con el PaymentIntent). Solo items settled. ARCHITECTURE §10.6.
   */
  async create(
    userId: string,
    inventoryItemIds: string[],
    addressId: string,
    idempotencyKey?: string,
  ) {
    const address = await this.validateAddress(userId, addressId);
    const { ineligible } = await this.classifyItems(userId, inventoryItemIds);
    if (ineligible.length > 0) {
      const notSettled = ineligible.some((i) => i.reason === 'ITEM_NOT_SETTLED');
      throw BusinessException.validation(
        notSettled ? 'ITEM_NOT_SETTLED' : 'NOT_FOUND',
        'Some items are not eligible',
        { ineligible },
      );
    }
    // Un item no puede estar en dos envíos activos.
    const active = await this.prisma.shipmentItem.findFirst({
      where: {
        inventoryItemId: { in: inventoryItemIds },
        shipmentRequest: { status: { notIn: ['cancelado', 'entregado'] } },
      },
    });
    if (active) {
      throw BusinessException.conflict('ITEM_IN_ANOTHER_SHIPMENT', 'Item already in a shipment');
    }

    const breakdown = await this.breakdown();
    const shipment = await this.prisma.shipmentRequest.create({
      data: {
        userId,
        addressSnapshot: {
          line1: address.line1,
          line2: address.line2,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: address.country,
          phone: address.phone,
        },
        status: 'solicitado',
        shippingFeeCents: breakdown.subtotalCents,
        ivaCents: breakdown.ivaCents,
        processingFeeCents: breakdown.processingFeeCents,
        totalCents: breakdown.totalCents,
        items: { create: inventoryItemIds.map((id) => ({ inventoryItemId: id })) },
      },
    });

    // M3: idempotency-key derivada en servidor (`pi-shipment-<id>`); header del cliente = override.
    const idem = idempotencyKey ?? `pi-shipment-${shipment.id}`;

    // A2 (cierra BE-7): PaymentIntent transaccional con la "reserva" (la ShipmentRequest,
    // que bloquea los items vía ITEM_IN_ANOTHER_SHIPMENT). Si Stripe falla tras crearla,
    // compensamos borrando la solicitud (cascada a sus items) para no dejar los items
    // atrapados en un envío nunca cobrado, y devolvemos un error de reintento.
    let pi: { id: string; clientSecret: string };
    try {
      pi = await this.stripe.createPaymentIntent({
        amountCents: breakdown.totalCents,
        metadata: { shipmentId: shipment.id, userId, kind: 'shipment' },
        idempotencyKey: idem,
      });
    } catch (e) {
      await this.prisma.shipmentRequest
        .delete({ where: { id: shipment.id } })
        .catch(() => undefined);
      throw this.toRetryError(e);
    }

    await this.prisma.shipmentRequest.update({
      where: { id: shipment.id },
      data: { stripePaymentIntentId: pi.id },
    });

    return {
      shipmentId: shipment.id,
      status: 'solicitado' as const,
      breakdown,
      stripe: { paymentIntentId: pi.id, clientSecret: pi.clientSecret },
    };
  }

  /** A2: fallo del proveedor de pago → error de reintento (503); errores de negocio se propagan. */
  private toRetryError(e: unknown): unknown {
    if (e instanceof BusinessException) return e;
    return BusinessException.retriable(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payment provider unavailable; the shipment request was rolled back. Please retry.',
    );
  }

  async listMine(userId: string) {
    const data = await this.prisma.shipmentRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      include: { items: true },
    });
    return { data };
  }

  async getMine(userId: string, id: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { id },
      include: { items: { include: { inventoryItem: { include: { card: true } } } } },
    });
    if (!shipment || shipment.userId !== userId) throw BusinessException.notFound();
    return shipment;
  }

  // ---------------- Admin M4 ----------------

  async adminList(status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.ShipmentRequestWhereInput = {};
    if (status) where.status = status as never;
    const [data, total] = await Promise.all([
      this.prisma.shipmentRequest.findMany({
        where,
        orderBy: { requestedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: true },
      }),
      this.prisma.shipmentRequest.count({ where }),
    ]);
    return { data, page, pageSize, total };
  }

  async adminGet(id: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { id },
      include: { items: { include: { inventoryItem: { include: { card: true, location: true } } } } },
    });
    if (!shipment) throw BusinessException.notFound();
    return shipment;
  }

  /**
   * Lista de picking ordenada por ubicación (API_CONTRACT §M4).
   * Fix QA #3: SOLO envíos ya liquidados (status `picking`). Un envío `solicitado`
   * aún no está pagado (solo avanza a `picking` tras `payment_intent.succeeded`), así
   * que NO debe aparecer en la lista de picking (evita preparar retiros no cobrados).
   */
  async pickingList(date?: string) {
    const where: Prisma.ShipmentRequestWhereInput = { status: 'picking' };
    if (date) {
      const d = new Date(date);
      const next = new Date(d.getTime() + 24 * 3600 * 1000);
      where.requestedAt = { gte: d, lt: next };
    }
    const shipments = await this.prisma.shipmentRequest.findMany({
      where,
      include: { items: { include: { inventoryItem: { include: { location: true } } } } },
    });
    const rows = shipments.flatMap((s) =>
      s.items.map((si) => ({
        shipmentId: s.id,
        inventoryItemId: si.inventoryItemId,
        folio: si.inventoryItem.folio,
        location: si.inventoryItem.location?.label ?? 'UNASSIGNED',
      })),
    );
    rows.sort((a, b) => a.location.localeCompare(b.location));
    return { data: rows };
  }

  private static TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
    solicitado: ['picking', 'cancelado'],
    picking: ['guia', 'cancelado'],
    guia: ['enviado', 'cancelado'],
    enviado: ['entregado'],
    entregado: [],
    cancelado: [],
  };

  async updateStatus(id: string, to: ShipmentStatus) {
    const shipment = await this.prisma.shipmentRequest.findUnique({ where: { id } });
    if (!shipment) throw BusinessException.notFound();
    const allowed = ShipmentsService.TRANSITIONS[shipment.status] ?? [];
    if (!allowed.includes(to)) {
      throw BusinessException.conflict(
        'CONFLICT',
        `Invalid transition ${shipment.status} -> ${to}`,
      );
    }
    const data: Prisma.ShipmentRequestUpdateInput = { status: to };
    if (to === 'picking') data.pickingAt = new Date();
    if (to === 'enviado') data.shippedAt = new Date();
    if (to === 'entregado') data.deliveredAt = new Date();
    return this.prisma.shipmentRequest.update({ where: { id }, data });
  }

  async setTracking(id: string, carrier: string, trackingNumber: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({ where: { id } });
    if (!shipment) throw BusinessException.notFound();
    return this.prisma.shipmentRequest.update({
      where: { id },
      data: { carrier, trackingNumber, status: 'guia' },
    });
  }
}
