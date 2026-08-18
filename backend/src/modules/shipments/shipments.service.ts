import { Injectable } from '@nestjs/common';
import {
  Card,
  CardSet,
  InventoryItem,
  MovementReason,
  Prisma,
  ShipmentItem,
  ShipmentRequest,
  ShipmentStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { ErrorCodeType } from '../../common/error-codes';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { StripeService } from '../payments/stripe.service';
import { computeShipmentBreakdown } from '../../common/money';

/** ShipmentItem con la carta (y su set) resueltos, para el ClientShipmentItemDTO (v1.17). */
type EnrichedShipmentItem = ShipmentItem & {
  inventoryItem: InventoryItem & { card: Card & { set: CardSet | null } };
};

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

  /**
   * Clasifica items en elegibles (settled + EN CUSTODIA, del usuario) e inelegibles con razón.
   *
   * SEC-H1 (WS-H): la elegibilidad exige `status === 'in_custody'` como criterio POSITIVO —
   * cualquier otro `status` (incl. `withdrawn`) es INELEGIBLE. La transición terminal de un
   * envío entregado deja `status='withdrawn'` CONSERVANDO `ownershipStatus='settled'`; sin este
   * gate un item ya entregado (fuera de la bóveda) pasaría los checks y se le cobraría un nuevo
   * envío por Stripe (doble-retiro). Así el criterio de creación queda IDÉNTICO al flag de
   * lectura `withdrawable` del HoldingDTO (settled && status==='in_custody' && sin envío activo).
   */
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
      // SEC-H1: criterio positivo — solo un item EN CUSTODIA es retirable. Un `withdrawn`
      // (settled preservado) o cualquier otro estado no lo es.
      if (item.status !== 'in_custody') {
        ineligible.push({ inventoryItemId: id, reason: 'ITEM_NOT_IN_CUSTODY' });
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
      // Prioridad de reporte: settled → in_custody → not_found. Todos 422 (validación).
      // SEC-H1: `ITEM_NOT_IN_CUSTODY` cubre el intento de re-retirar un item ya `withdrawn`.
      const reasons = new Set(ineligible.map((i) => i.reason));
      const code: ErrorCodeType = reasons.has('ITEM_NOT_SETTLED')
        ? 'ITEM_NOT_SETTLED'
        : reasons.has('ITEM_NOT_IN_CUSTODY')
          ? 'ITEM_NOT_IN_CUSTODY'
          : 'NOT_FOUND';
      throw BusinessException.validation(code, 'Some items are not eligible', { ineligible });
    }

    const breakdown = await this.breakdown();

    // SEC-H2 (WS-H): el chequeo anti-doble-envío + la creación de la ShipmentRequest/items
    // van en UNA transacción SERIALIZABLE (mismo patrón atómico que la reserva de checkout,
    // orders.service, y el tope AML de buylist). Cierra la ventana TOCTOU: dos POST /shipments
    // concurrentes del mismo item ya no pueden pasar ambos el `findFirst` y crear dos envíos
    // (+ dos PaymentIntents) — el aislamiento serializable aborta a uno por conflicto de
    // lectura/escritura. La creación del PaymentIntent (Stripe) queda FUERA de la tx a
    // propósito (A2/BE-7: no bloquear una conexión de DB en una llamada de red; el rollback
    // compensatorio borra la ShipmentRequest si Stripe falla). Nota: el índice único parcial
    // sobre ShipmentItem.inventoryItemId (defensa en profundidad) queda como deuda BE-42.
    const shipment = await this.prisma.$transaction(
      async (tx) => {
        // Un item no puede estar en dos envíos activos (re-verificado DENTRO de la tx).
        const active = await tx.shipmentItem.findFirst({
          where: {
            inventoryItemId: { in: inventoryItemIds },
            shipmentRequest: { status: { notIn: ['cancelado', 'entregado'] } },
          },
        });
        if (active) {
          throw BusinessException.conflict(
            'ITEM_IN_ANOTHER_SHIPMENT',
            'Item already in a shipment',
          );
        }
        return tx.shipmentRequest.create({
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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

  /**
   * SEC-C1: proyección de CLIENTE. Allowlist explícita de los campos que el contrato
   * declara para el comprador (API_CONTRACT §5). Excluye `shippingCostCents` (costo
   * interno del carrier / dato de margen, marcado "no se expone al cliente" en §M4) y
   * cualquier campo no declarado. Es allowlist (no denylist/omit) a propósito: si el
   * modelo gana un campo interno futuro, NO se filtra por accidente. Los endpoints
   * ADMIN (`adminGet`/`adminList`) siguen devolviendo la fila cruda con el costo.
   */
  private toClientShipment<
    T extends ShipmentRequest & { items: EnrichedShipmentItem[] },
  >(s: T) {
    return {
      id: s.id,
      status: s.status,
      addressSnapshot: s.addressSnapshot,
      shippingFeeCents: s.shippingFeeCents,
      ivaCents: s.ivaCents,
      processingFeeCents: s.processingFeeCents,
      totalCents: s.totalCents,
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      // Timestamps por etapa que existen en el modelo (no hay guiaAt; la etapa `guia`
      // se refleja por status + carrier/trackingNumber). API_CONTRACT §5.
      requestedAt: s.requestedAt,
      pickingAt: s.pickingAt,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
      // v1.17: items enriquecidos (folio + acabado + carta) para la vista de rastreo.
      items: s.items.map((si) => this.toClientShipmentItem(si)),
    };
  }

  /** v1.17 — ClientShipmentItemDTO (API_CONTRACT §5). Sin costos internos ni PII. */
  private toClientShipmentItem(si: EnrichedShipmentItem) {
    const card = si.inventoryItem.card;
    return {
      inventoryItemId: si.inventoryItemId,
      folio: si.inventoryItem.folio,
      finish: si.inventoryItem.finish,
      card: {
        id: card.id,
        name: card.name,
        setName: card.set?.name ?? null,
        number: card.number,
        imageSmallUrl: card.imageSmallUrl,
      },
    };
  }

  /**
   * SEC (riesgo #1 de M-25): filtro POSITIVO por `userId = :sessionUser`. Con
   * `ShipmentRequest.userId` nullable, un envío de invitado (`userId=null`) JAMÁS debe aparecer en
   * la lista de nadie; una consulta del tipo `{ userId: { not: X } }` sí lo expondría. La guardia
   * explícita evita además que un `userId` vacío degenere en "traer todo".
   */
  async listMine(userId: string) {
    if (!userId) throw BusinessException.notFound();
    const rows = await this.prisma.shipmentRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      include: {
        items: { include: { inventoryItem: { include: { card: { include: { set: true } } } } } },
      },
    });
    return { data: rows.map((r) => this.toClientShipment(r)) };
  }

  async getMine(userId: string, id: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { id },
      include: {
        items: { include: { inventoryItem: { include: { card: { include: { set: true } } } } } },
      },
    });
    // Comparación de dueño POSITIVA: `null !== :sessionUser` siempre, así que un envío directo de
    // invitado no es legible por ningún cliente (riesgo #1 de M-25).
    if (!userId || !shipment || shipment.userId !== userId) throw BusinessException.notFound();
    return this.toClientShipment(shipment);
  }

  // ---------------- Admin M4 ----------------

  async adminList(
    status: string | undefined,
    page: number,
    pageSize: number,
    userId?: string,
    kind?: string,
  ) {
    const where: Prisma.ShipmentRequestWhereInput = {};
    if (status) where.status = status as never;
    // v1.7-admin-users: filtro opcional por ShipmentRequest.userId (simetría con /admin/orders).
    // Nota v1.21: un envío directo de invitado tiene `userId=null`, así que este filtro
    // simplemente no lo devuelve (comportamiento correcto para la ficha 360° de un usuario).
    if (userId) where.userId = userId;
    // v1.21-guest-checkout (§M4): filtro opcional por naturaleza del envío.
    if (kind === 'guest_direct_ship') where.orderId = { not: null };
    if (kind === 'vault_withdrawal') where.orderId = null;
    const [data, total] = await Promise.all([
      this.prisma.shipmentRequest.findMany({
        where,
        orderBy: { requestedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: true, order: { select: { orderNumber: true, guestEmail: true } } },
      }),
      this.prisma.shipmentRequest.count({ where }),
    ]);
    return { data: data.map((s) => this.withAdminKind(s)), page, pageSize, total };
  }

  async adminGet(id: string) {
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { id },
      include: {
        items: { include: { inventoryItem: { include: { card: true, location: true } } } },
        order: { select: { orderNumber: true, guestEmail: true } },
      },
    });
    if (!shipment) throw BusinessException.notFound();
    return this.withAdminKind(shipment);
  }

  /**
   * v1.21-guest-checkout (§M4, ADITIVO): la cola de M4 pasa a tener DOS tipos de envío. `kind` se
   * DERIVA de `orderId == null` (discriminador único); `orderNumber`/`guestEmail`/`recipientName`
   * dan al operador el contexto del pedido de invitado. Back-office protegido por rol: el correo
   * es dato de contacto operativo (mismo criterio que `AdminSellerRef.email` de §M5).
   */
  private withAdminKind<
    T extends ShipmentRequest & { order?: { orderNumber: string | null; guestEmail: string | null } | null },
  >(s: T) {
    const snapshot = (s.addressSnapshot ?? {}) as { recipientName?: string };
    const { order, ...row } = s;
    return {
      ...row,
      kind: s.orderId == null ? ('vault_withdrawal' as const) : ('guest_direct_ship' as const),
      orderNumber: order?.orderNumber ?? undefined,
      guestEmail: order?.guestEmail ?? undefined,
      recipientName: snapshot.recipientName ?? undefined,
    };
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

  /**
   * v1.17 — Máquina de estados M4. La ÚNICA escritura persistente del ciclo de retiro
   * sobre el `InventoryItem` es la transición terminal al pasar a `entregado`: cada item
   * de sus `ShipmentItem` pasa `in_custody → withdrawn` (+ InventoryMovement
   * reason='withdrawal'), CONSERVANDO ownerType/ownerUserId/ownershipStatus (histórico
   * intacto). Idempotente: un item ya `withdrawn` no duplica movimiento. Todo en UNA
   * transacción con la actualización del envío. API_CONTRACT §M4, ARCHITECTURE §3.3/§9.
   */
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

    // v1.21-guest-checkout (§M4) — RAMIFICACIÓN OBLIGATORIA por tipo de envío. La máquina de
    // estados, el picking list y la captura de guía son IDÉNTICOS para los dos tipos; lo único que
    // cambia es qué le pasa al `InventoryItem` en las transiciones terminales:
    //   · Retiro de bóveda (`orderId == null`): v1.17 SIN CAMBIO ALGUNO — solo `entregado` toca el
    //     item (`in_custody → withdrawn`, reason `withdrawal`).
    //   · Envío directo de invitado (`orderId != null`): DOS transiciones, ambas por `status` (el
    //     item es `ownerType='platform'` todo el tiempo): `enviado` ⇒ `picking → shipped`;
    //     `entregado` ⇒ `shipped → delivered`. NUNCA `withdrawn` (nunca estuvo en bóveda).
    const isDirectShip = shipment.orderId != null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.shipmentRequest.update({ where: { id }, data });

      if (isDirectShip && (to === 'enviado' || to === 'entregado')) {
        const fromStatus = to === 'enviado' ? 'picking' : 'shipped';
        const toStatus = to === 'enviado' ? 'shipped' : 'delivered';
        const shipmentItems = await tx.shipmentItem.findMany({
          where: { shipmentRequestId: id },
          select: { inventoryItemId: true },
        });
        for (const si of shipmentItems) {
          // Guardia POSITIVA + idempotente: solo avanza la pieza que está en el estado previo
          // esperado (un reintento o una pieza ya movida por otro flujo no duplica movimiento).
          const moved = await tx.inventoryItem.updateMany({
            where: { id: si.inventoryItemId, status: fromStatus },
            data: { status: toStatus },
          });
          if (moved.count !== 1) continue;
          await tx.inventoryMovement.create({
            data: {
              itemId: si.inventoryItemId,
              fromStatus,
              toStatus,
              // `sale`: la pieza sale por una VENTA con envío directo, no por un retiro de bóveda
              // (`withdrawal` mentiría en los reportes de custodia).
              reason: MovementReason.sale,
              note: `guest shipment ${id} ${to}`,
            },
          });
        }
        return updated;
      }

      if (!isDirectShip && to === 'entregado') {
        const shipmentItems = await tx.shipmentItem.findMany({
          where: { shipmentRequestId: id },
          select: { inventoryItemId: true },
        });
        for (const si of shipmentItems) {
          const item = await tx.inventoryItem.findUnique({
            where: { id: si.inventoryItemId },
          });
          if (!item) continue;
          // Idempotencia: si ya está retirado, no dupliques el movimiento.
          if (item.status === 'withdrawn') continue;
          await tx.inventoryItem.update({
            where: { id: si.inventoryItemId },
            // Solo cambia `status`; conserva ownerType/ownerUserId/ownershipStatus.
            data: { status: 'withdrawn' },
          });
          await tx.inventoryMovement.create({
            data: {
              itemId: si.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'withdrawn',
              reason: MovementReason.withdrawal,
              note: `shipment ${id} delivered`,
            },
          });
        }
      }
      return updated;
    });
  }

  async setTracking(
    id: string,
    carrier: string,
    trackingNumber: string,
    shippingCostCents?: number,
  ) {
    const shipment = await this.prisma.shipmentRequest.findUnique({ where: { id } });
    if (!shipment) throw BusinessException.notFound();
    return this.prisma.shipmentRequest.update({
      where: { id },
      data: {
        carrier,
        trackingNumber,
        status: 'guia',
        // v1.4-finance: opcional y editable; si se omite, no se modifica (default de columna 0).
        ...(shippingCostCents !== undefined ? { shippingCostCents } : {}),
      },
    });
  }
}
