import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  Address,
  Card,
  CardSet,
  FulfillmentMode,
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
import {
  PRICE_CONVENTION_OF_NEW_ROWS,
  computeShipmentBreakdown,
  shippingFeeDisplayCentsOf,
} from '../../common/money';
import { parseEnumFilter } from '../../common/enum-filter';
import { runSerializable } from '../../common/serializable-retry';
import { MAIL_PORT, MailMessage, MailPort } from '../mail/mail.port';
import {
  ShipmentNoticeParams,
  shipmentCancelledTemplate,
  shipmentGuideTemplate,
  shipmentShippedTemplate,
} from './mail/shipment-notice.templates';

/** `P-84` · clase **E** (§4.37): estados de envío filtrables, DERIVADOS del schema. */
const SHIPMENT_STATUS_FILTER_VALUES: readonly ShipmentStatus[] = Object.values(ShipmentStatus);

/** ShipmentItem con la carta (y su set) resueltos, para el ClientShipmentItemDTO (v1.17). */
type EnrichedShipmentItem = ShipmentItem & {
  inventoryItem: InventoryItem & { card: Card & { set: CardSet | null } };
};

/**
 * v2.1.9 (S49-R4) — **lista blanca de `ShipmentRequest` para las respuestas de BACK-OFFICE.**
 *
 * `withAdminKind` esparcía la fila entera (`...row`) y `setTracking`/`updateStatus` devolvían la
 * entidad Prisma directa. Ninguna columna de hoy es un secreto **para M4** —`shippingCostCents` es
 * costo interno y este rol SÍ debe verlo (§M4)— pero la fila cruda es justo lo que hace que una
 * columna futura se publique sola. Esta lista fija la forma ACTUAL: no cambia nada visible, y a
 * partir de aquí exponer algo nuevo exige escribirlo aquí a propósito.
 *
 * ⚠ `shippingCostCents` es **admin-only por contrato** (§M4: «no se expone al cliente»). Su ausencia
 * en `toClientShipment` es deliberada — no la "completes" por simetría.
 */
function toAdminShipmentRow(s: ShipmentRequest) {
  return {
    id: s.id,
    userId: s.userId,
    orderId: s.orderId,
    addressSnapshot: s.addressSnapshot,
    status: s.status,
    shippingFeeCents: s.shippingFeeCents,
    // ⚠️ Los DOS, y en pareja: `shippingCostCents` es **BRUTO** (el total de la factura) y
    // `shippingCostIvaCents` su **IVA acreditable congelado**. Publicar solo el bruto dejaba al
    // operador sin poder comprobar la resta que el P&L hace con su captura. Admin-only (§M4).
    shippingCostCents: s.shippingCostCents,
    shippingCostIvaCents: s.shippingCostIvaCents,
    ivaCents: s.ivaCents,
    processingFeeCents: s.processingFeeCents,
    totalCents: s.totalCents,
    stripePaymentIntentId: s.stripePaymentIntentId,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber,
    requestedAt: s.requestedAt,
    pickingAt: s.pickingAt,
    shippedAt: s.shippedAt,
    deliveredAt: s.deliveredAt,
  };
}

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly stripe: StripeService,
    // v1.74 (§R) — el correo de los avisos `AV-4`/`AV-5`/`AV-6`. `@Optional()` por el MISMO motivo
    // que en `buylist` y en `orders`: los tests unitarios legacy construyen el servicio a mano, y el
    // envío es **best-effort** (⛔ jamás puede hacer fallar el `PATCH`/`POST` que lo dispara).
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  /**
   * ⭐ El desglose del retiro de bóveda. La tarifa EXHIBIDA `E = round(F × (1 + t·r))` lleva su IVA
   * dentro (§4.44.f); `F` (el dial `shipping_fee_cents`) sigue siendo NETO y no cambia de valor.
   * **Money-neutral con el dial en 100 %:** `round(17500 × 1.16) = 20300 = 17500 + 2800`.
   */
  private async breakdown() {
    const dials = await this.settings.getIvaDials();
    const shippingFeeCents = shippingFeeDisplayCentsOf(
      await this.settings.getNumber(SettingKey.SHIPPING_FEE_CENTS),
      dials,
    );
    const fee = await this.settings.getStripeFee();
    return computeShipmentBreakdown(shippingFeeCents, dials.ivaRatePct, fee);
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
   * v1.67 (M-52, contrato §0 `RECIPIENT_NAME_REQUIRED` / §5; ARCHITECTURE §4.47.4) — sin destinatario
   * no hay etiqueta. Una dirección anterior a la migración tiene `recipientName IS NULL`: se rechaza
   * con `422 RECIPIENT_NAME_REQUIRED` en LECTURA (`quote`) y en ESCRITURA (`create`) — read y write
   * comparten regla, como `withdrawable` ↔ elegibilidad. En `create` corre ANTES de la transacción
   * serializable y ANTES del PaymentIntent: un retiro nunca nace sin destinatario.
   * ⛔ Prohibido el fallback a `User.name` (puede ser fabricado, `nameSource='derived'`; y aunque no
   * lo fuera, el nombre de cuenta y el de quien recibe el paquete son hechos distintos). Remedio del
   * cliente: `PATCH /users/me/addresses/:id { recipientName }` y reintentar — hermano exacto de
   * `PHONE_REQUIRED` / `PICKUP_ADDRESS_REQUIRED`.
   */
  private assertRecipientName(address: Address): string {
    const name = address.recipientName?.trim() ?? '';
    if (name.length === 0) {
      throw BusinessException.validation(
        'RECIPIENT_NAME_REQUIRED',
        'The selected address has no recipient name; add one and retry',
        { field: 'recipientName', addressId: address.id },
      );
    }
    return name;
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
    const address = await this.validateAddress(userId, addressId);
    this.assertRecipientName(address); // v1.67: misma regla que `create` (lectura y escritura)
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
    // v1.67: rechazo ANTES de la tx serializable y ANTES del PaymentIntent (contrato §5).
    const recipientName = this.assertRecipientName(address);
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
    const shipment = await runSerializable(
      this.prisma,
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
        // PROJECTION-EXEMPT: return DENTRO de la `$transaction`; el caller (`create`) proyecta a
        // `{ shipmentId, status, breakdown, stripe }` (contrato §5).
        return tx.shipmentRequest.create({
          data: {
            userId,
            // v1.67 (M-52, contrato §5): NUEVE campos, los MISMOS que `Order.shippingAddressSnapshot`
            // del invitado. `recipientName` se copia de `Address.recipientName` TAL CUAL (jamás de
            // `User.name`). Un snapshot no se reescribe (§5.2): los retiros anteriores conservan ocho.
            addressSnapshot: {
              recipientName,
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
            // ⭐⭐ D56 / criterio **214** — el envío entra en la convención igual que una carta
            // (§4.44.f, criterio 189): `shippingFeeCents` ES `E` y **lleva su IVA dentro**, así que
            // la fila nace `IVA_INCLUSIVE`. ⛔ Ya no se apila `round(envío × r)` detrás.
            priceConvention: PRICE_CONVENTION_OF_NEW_ROWS,
            items: { create: inventoryItemIds.map((id) => ({ inventoryItemId: id })) },
          },
        });
      },
      { label: 'createShipmentRequest', logger: this.logger },
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
    // `P-84` — aquí había un `status as never`: valor crudo al `where`, Prisma revienta y el filtro
    // global lo convierte en **`500 INTERNAL`** (medido por HTTP: `?status=banana` ⇒ `500`).
    // Clase **E**: derivado de `ShipmentStatus`.
    const statusFilter = parseEnumFilter('status', status, SHIPMENT_STATUS_FILTER_VALUES);
    if (statusFilter) where.status = statusFilter;
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
        include: {
          items: true,
          order: { select: { orderNumber: true, guestEmail: true, fulfillmentMode: true } },
        },
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
        order: { select: { orderNumber: true, guestEmail: true, fulfillmentMode: true } },
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
    T extends ShipmentRequest & {
      order?: {
        orderNumber: string | null;
        guestEmail: string | null;
        fulfillmentMode: FulfillmentMode;
      } | null;
    },
  >(s: T) {
    const snapshot = (s.addressSnapshot ?? {}) as { recipientName?: string };
    const { order } = s;
    return {
      ...toAdminShipmentRow(s),
      // v1.21.2 (D4): `orderId == null` ⇒ retiro de bóveda; con orden vinculada, el `kind` se
      // resuelve LEYENDO `Order.fulfillmentMode` (nunca asumiendo `direct_ship` por tener orderId).
      kind:
        s.orderId == null
          ? ('vault_withdrawal' as const)
          : this.kindForFulfillment(order?.fulfillmentMode, s.id),
      orderNumber: order?.orderNumber ?? undefined,
      guestEmail: order?.guestEmail ?? undefined,
      recipientName: snapshot.recipientName ?? undefined,
    };
  }

  /**
   * v1.21.2 (D4, ARCHITECTURE §4.21d) — ¿este envío fulfilla una orden de ENVÍO DIRECTO?
   *
   * `ShipmentRequest.orderId` responde solo "¿de dónde viene?" (null ⇒ retiro de bóveda). El
   * COMPORTAMIENTO lo decide `Order.fulfillmentMode`, el único discriminador canónico de ruta de
   * fulfillment. El `switch` es EXHAUSTIVO y RUIDOSO: un modo nuevo (p. ej. `pickup_in_store`)
   * **rompe visiblemente aquí**, en el punto exacto donde falta decidir su transición terminal, en
   * vez de comportarse como un envío directo en silencio — que es el peor tipo de fallo.
   *
   * `vault` con `orderId != null` es una combinación IMPOSIBLE por invariante (un pedido a bóveda
   * no genera envío de fulfillment; su retiro nace del cliente y va sin `orderId`): si aparece es
   * corrupción de datos y se trata como error, NO se "arregla" en silencio.
   */
  private async isDirectShipFulfillment(shipment: ShipmentRequest): Promise<boolean> {
    if (shipment.orderId == null) return false; // retiro de bóveda
    const order = await this.prisma.order.findUnique({
      where: { id: shipment.orderId },
      select: { fulfillmentMode: true },
    });
    return this.kindForFulfillment(order?.fulfillmentMode, shipment.id) === 'guest_direct_ship';
  }

  /** Traduce `fulfillmentMode` → `kind` de §M4. Lanza ante un modo no soportado (D4). */
  private kindForFulfillment(
    mode: FulfillmentMode | undefined,
    shipmentId: string,
  ): 'guest_direct_ship' {
    switch (mode) {
      case 'direct_ship':
        return 'guest_direct_ship';
      case 'vault':
      case undefined:
      default: {
        const seen = mode ?? 'ORDEN_INEXISTENTE';
        this.logger.error(
          `ShipmentRequest ${shipmentId} tiene orderId pero su orden es '${seen}': combinación ` +
            'imposible por invariante (un pedido a bóveda no genera envío de fulfillment). Es ' +
            'corrupción de datos o un modo de fulfillment nuevo sin terminal definida.',
        );
        throw BusinessException.conflict(
          'CONFLICT',
          `Unsupported fulfillmentMode for shipment ${shipmentId}: ${seen}`,
        );
      }
    }
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
   *
   * ### ⭐⭐ `REL-B` (pentester, ALTA, 2026-09-14) — LA TRANSICIÓN SE RECLAMA, NO SE ESCRIBE
   *
   * **El defecto, medido en vivo por el pentester y reproducido aquí:** este método validaba
   * `TRANSITIONS` sobre una lectura **previa** y después escribía con
   * `update({ where: { id } })` — **sin el estado en el `WHERE`**. Bajo `READ COMMITTED`, N
   * `PATCH {to:'enviado'}` simultáneos leen los N el mismo `guia`, los N pasan la validación, los
   * N escriben y **los N llaman a `notifyStatus`** ⇒ N correos «tu paquete va en camino» por **una
   * sola** transición. *La máquina de estados vivía en un `if` de JavaScript, y un `if` sobre un
   * dato caduco no es una máquina de estados: es una opinión sobre el pasado.*
   *
   * | medición | antes (`0e22415`) | después |
   * |---|---|---|
   * | `AV-5`, 25 tiradas de 10 `PATCH` simultáneos | **25/25 con duplicado** (hasta 10 correos) | **0/25** |
   * | `AV-6`, 25 tiradas de 10 `PATCH` simultáneos | **25/25 con duplicado** (10 correos) | **0/25** |
   * | entrelazado FORZADO (`avisos-sellos`, bloque B) | **ROJO 10/10** | **VERDE 10/10** |
   *
   * **El arreglo es el que ya vivía 130 líneas más abajo** (`setTracking`, `D-AVISO-2`): la
   * precondición **baja al motor**. `updateMany({ where: { id, status: <el que leí> } })` y
   * `count === 1` ⇔ *esta* petición fue la que hizo la transición. Bajo `READ COMMITTED` Postgres
   * re-evalúa el `WHERE` contra la versión ya actualizada de la fila (`EvalPlanQual`) cuando dos
   * `UPDATE` compiten por ella ⇒ **exactamente una** puede ganar. La perdedora ve `count === 0` y
   * recibe el mismo **409** que habría recibido si hubiera llegado un milisegundo después —
   * que es, literalmente, lo que le pasó.
   *
   * ⛔ **`notifyStatus` queda DETRÁS de esa reclamación**, así que «quién avisa» dejó de ser una
   * carrera y pasó a ser un hecho del motor. Ver el docstring de `notifyStatus` para el porqué
   * de que `AV-5`/`AV-6` **no estrenen columna de sello**.
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
    const data: Prisma.ShipmentRequestUpdateManyMutationInput = { status: to };
    if (to === 'picking') data.pickingAt = new Date();
    if (to === 'enviado') data.shippedAt = new Date();
    if (to === 'entregado') data.deliveredAt = new Date();

    // v1.21-guest-checkout (§M4) — RAMIFICACIÓN OBLIGATORIA por RUTA DE FULFILLMENT. La máquina de
    // estados, el picking list y la captura de guía son IDÉNTICOS para los dos tipos; lo único que
    // cambia es qué le pasa al `InventoryItem` en las transiciones terminales:
    //   · Retiro de bóveda: v1.17 SIN CAMBIO ALGUNO — solo `entregado` toca el item
    //     (`in_custody → withdrawn`, reason `withdrawal`).
    //   · Envío directo: DOS transiciones, ambas por `status` (el item es `ownerType='platform'`
    //     todo el tiempo): `enviado` ⇒ `picking → shipped`; `entregado` ⇒ `shipped → delivered`.
    //     NUNCA `withdrawn` (nunca estuvo en bóveda).
    //
    // v1.21.2 (D4): el discriminador es `Order.fulfillmentMode`, NO `orderId != null`. `orderId`
    // dice de DÓNDE VIENE el envío; el COMPORTAMIENTO lo decide el modo de fulfillment, que es el
    // único discriminador canónico del sistema (ARCHITECTURE §4.21d).
    const isDirectShip = await this.isDirectShipFulfillment(shipment);

    const result = await this.prisma.$transaction(async (tx) => {
      // ⭐⭐ `REL-B` — LA PRECONDICIÓN DE ESTADO VIVE EN EL `WHERE`, no en el `if` de arriba.
      // `count === 1` ⇔ esta petición fue la que movió el envío de `shipment.status` a `to`.
      // ⛔ Nunca `update({ where: { id } })`: eso escribe aunque otro ya haya hecho la transición,
      // y entonces el aviso de más abajo sale N veces por un hecho que ocurrió UNA.
      const claimed = await tx.shipmentRequest.updateMany({
        where: { id, status: shipment.status },
        data,
      });
      if (claimed.count !== 1) {
        // Otra petición ganó la misma transición mientras ésta validaba. Es el MISMO 409 que
        // habría dado llegar un milisegundo más tarde — y el motor lo dice sin ambigüedad.
        throw BusinessException.conflict(
          'CONFLICT',
          `Invalid transition ${shipment.status} -> ${to}`,
        );
      }
      const updated = await tx.shipmentRequest.findUniqueOrThrow({ where: { id } });

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
        return toAdminShipmentRow(updated); // S49-R4
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
      return toAdminShipmentRow(updated); // S49-R4
    });
    // v1.74 (§R) — `AV-5`/`AV-6`, POST-COMMIT y best-effort: el correo cuelga del hecho, y el hecho
    // no cuelga del correo. ⛔ Un fallo del proveedor no revierte la transición ni tumba el `PATCH`.
    await this.notifyStatus(shipment, to);
    return result;
  }

  /**
   * ⭐⭐ v1.74 — **`D-AV-1` CERRADA: la captura de guía ya NO REGRESA EL ESTADO** (`ARCHITECTURE §9`).
   *
   * ### El defecto, medido
   * Este método escribía `data: { carrier, trackingNumber, status: 'guia', … }`
   * **incondicionalmente**: no consultaba `TRANSITIONS`, no comparaba el estado actual y no tenía
   * guarda de motor — a diferencia de su hermano `updateStatus`, que sí la tiene. ⇒ capturar una
   * guía sobre un envío **`entregado`** o **`cancelado`** lo **devolvía a `guia`**.
   * **Y no era solo una omisión del código:** `API_CONTRACT §M4` afirma de este endpoint, desde
   * v1.4-finance, que es *«idempotente sobre carrier/tracking; **no regresa el estado si ya está en
   * `guia`/posterior**»*. Era una línea de contrato que el código no cumplía.
   * *Un envío entregado que reaparece en la cola de guías es una **cola falsa**, y el fallo se ve
   * mientras que la cola falsa no.*
   *
   * ### La regla, entera, y de dónde sale cada mitad
   * | estado actual | qué hace | de dónde sale |
   * |---|---|---|
   * | `solicitado`, `picking` | escribe etiqueta **y** `status:'guia'` | `TRANSITIONS` (avance legal) |
   * | `guia`, `enviado`, `entregado` | escribe etiqueta, ⛔ **NO toca `status`** | §M4, literal |
   * | `cancelado` | **`409 CONFLICT`**, cero escritura | `TRANSITIONS['cancelado'] = []` |
   *
   * ⚠️ **Las dos decisiones que NO son mías y se declaran** (`ARCHITECTURE §9` las enruta al
   * arquitecto, y este pase toma la lectura **más conservadora** de cada una):
   *  1. **`entregado` responde `200` y no `409`** porque el contrato dice *«no regresa el estado»*,
   *     no *«rechaza»*: corregir el número de una guía de un paquete ya entregado es legítimo (una
   *     devolución, una reclamación al transportista) y lo único prohibido era **el retroceso**.
   *  2. **`cancelado` sí responde `409`**, por paridad con `updateStatus` y porque de `cancelado` no
   *     sale ninguna transición: escribirle una etiqueta a un envío que no va a salir es la cola
   *     falsa otra vez. ⚠️ **Es el único rechazo NUEVO de este pase**, y ⛔ no cierra un camino que
   *     la pantalla ofrezca: medido, `M4View.tsx` **oculta el botón de captura** en `cancelado` y en
   *     `entregado`. Si el arquitecto prefiere otro código, es una línea.
   *
   * ### `AV-4` — el correo de la guía, y por qué cuelga de AQUÍ (§R.3.a)
   * Éste es el **único** camino que garantiza `carrier` **y** `trackingNumber`. El `PATCH /status
   * { to:'guia' }` es legal desde `picking` y los deja en `null` (`D-AV-2`, abierta) ⇒ colgar el
   * correo del **estado** mandaría una guía **sin número**.
   * **Una sola vez (`D-AVISO-2`):** el sello `trackingNoticeSentAt`, que se **limpia en esta misma
   * escritura** si y solo si el par `(carrier, trackingNumber)` queda **DISTINTO** (§R.4.b) ⇒
   * re-capturar el mismo número **no reenvía**; corregirlo **sí avisa**.
   *
   * ### ⭐⭐ `D-AVISO-2` bajo CONCURRENCIA — la decisión vive en el MOTOR, no en una lectura previa
   * **El defecto que esto cierra, medido (2026-09-14, `f8c7040`, BD propia, `N=25` tiradas de `8`
   * capturas simultáneas del MISMO número sobre un envío nuevo): **8/25 tiradas mandaban 2 correos**.
   * El mecanismo era un *comprobar-y-actuar* de manual:
   * ```ts
   * const shipment = await prisma.findUnique(...);              // lectura
   * const labelChanged = shipment.carrier !== carrier || …;     // decisión sobre un estado CADUCO
   * await prisma.update({ data: { …, trackingNoticeSentAt: null } });   // escritura
   * ```
   * Las N peticiones leen el valor **anterior**, las N concluyen «la etiqueta cambió» y las N
   * escriben `trackingNoticeSentAt: null` ⇒ una **borra el pestillo que otra acababa de echar** y
   * vuelve a haber derecho a avisar. *El sello de `claimAndNotify` funcionaba; lo que fallaba es que
   * se le podía quitar el cerrojo desde fuera.*
   *
   * **La forma correcta, y es la misma de `jobs/buylist-sweep.service.ts` y la del propio sello:** la
   * comparación se **baja al `WHERE`**, así que decidir y escribir son **UNA sola operación**:
   * ```sql
   * UPDATE "ShipmentRequest" SET carrier=…, "trackingNumber"=…, "trackingNoticeSentAt"=NULL
   *  WHERE id=… AND (carrier IS NULL OR carrier <> … OR "trackingNumber" IS NULL OR "trackingNumber" <> …)
   * ```
   * Bajo `READ COMMITTED`, Postgres **re-evalúa el `WHERE` sobre la versión ya actualizada** de la
   * fila (`EvalPlanQual`) cuando dos `UPDATE` compiten por ella ⇒ **exactamente UNA** de las N puede
   * devolver `count === 1`; para el resto la etiqueta **ya coincide** y no borran nada.
   * `labelChanged` deja de ser una opinión sobre el pasado y pasa a ser **lo que el motor hizo**.
   *
   * ⚠️ **`carrier IS NULL OR …` NO es defensivo, es obligatorio** (medido: Prisma 5 traduce
   * `{ not: v }` a `col <> $1` **a secas**). En SQL, `NULL <> 'DHL'` es `NULL`, o sea **falso** ⇒ sin
   * la rama explícita de `null` la **primera** captura de un envío recién creado (que es justo el
   * caso donde ambas columnas son `NULL`) no casaría con el `WHERE`, no limpiaría el sello y **no
   * avisaría nunca**. El defecto cambiado de signo: de dos correos a **cero**.
   *
   * ⛔ **El segundo `update` no puede fusionarse con el condicional.** Cuando la etiqueta **no**
   * cambia, el `WHERE` no casa —por diseño— y aun así hay que escribir `status`/costos (una
   * re-captura idempotente que trae el costo del transportista es legítima). Por eso son dos
   * escrituras y no una, y por eso el sello viaja **solo** en la condicional.
   */
  async setTracking(
    id: string,
    carrier: string,
    trackingNumber: string,
    shippingCostCents?: number,
    /**
     * ⭐ §M10-IVA.8 — el **IVA acreditable** de la factura del carrier. Opcional y editable, igual
     * que el bruto; omitirlo **no modifica** la columna (default `0` ⇒ `neto = bruto`, dirección
     * conservadora). ⛔ No se deriva del bruto: se **captura**.
     */
    shippingCostIvaCents?: number,
  ) {
    const shipment = await this.prisma.shipmentRequest.findUnique({ where: { id } });
    if (!shipment) throw BusinessException.notFound();
    const allowed = ShipmentsService.TRANSITIONS[shipment.status] ?? [];
    // `guia` alcanzable ⇒ la captura AVANZA. Ya en `guia`/posterior ⇒ se conserva el estado. De un
    // terminal del que no sale nada y que no es `guia`/posterior (`cancelado`) ⇒ 409.
    const advances = allowed.includes('guia');
    const alreadyAtOrPastGuia = ShipmentsService.GUIA_OR_LATER.includes(shipment.status);
    if (!advances && !alreadyAtOrPastGuia) {
      throw BusinessException.conflict(
        'CONFLICT',
        `Cannot capture a tracking label on a ${shipment.status} shipment`,
        { status: shipment.status },
      );
    }
    // Lo que se escribe SIEMPRE, cambie o no la etiqueta. ⛔ **`status` ya NO va aquí** (`REL-C`):
    // el avance de estado tiene su propia escritura, con su propia precondición en el motor. El
    // sello tampoco: va solo en la escritura condicional de abajo, la que reinicia el ciclo.
    const data = {
      carrier,
      trackingNumber,
      // v1.4-finance: opcional y editable; si se omite, no se modifica (default de columna 0).
      ...(shippingCostCents !== undefined ? { shippingCostCents } : {}),
      // ⭐ §M10-IVA.8 / `IVA-11(c)`: el crédito se CAPTURA junto al bruto y se congela con él.
      ...(shippingCostIvaCents !== undefined ? { shippingCostIvaCents } : {}),
    };
    // ⭐⭐ `REL-C` — **EL AVANCE DE ESTADO, Y SU PRECONDICIÓN ES UN CONJUNTO, NO UNA LECTURA.**
    // `advances` se calculó sobre `shipment.status`, leído ANTES y sin candado: si entre la lectura
    // y la escritura otro operador completó `guia → enviado`, escribir `status:'guia'` dentro de
    // `data` **REGRESABA EL ESTADO** y volvía a abrir el camino a `enviado` — o sea, un **segundo
    // `AV-5`**. *(El pentester lo marcó BAJA con `0/25` porque su arnés serializaba la cadena; con
    // el entrelazado forzado sale **ROJO 10/10**: un `0/25` no era una defensa, era un instrumento
    // que no llegaba.)*
    //
    // El `WHERE` no lleva «el estado que leí» sino **los estados desde los que este avance es
    // legal**, que es un predicado estable y lo evalúa el motor en el instante de escribir. ⇒ esta
    // escritura **no puede retroceder nada**: `guia`, `enviado`, `entregado` y `cancelado` no casan.
    // Y eso es justo lo que hace cierta la premisa de `notifyStatus`: el grafo de estados es
    // ACÍCLICO, así que `guia → enviado` ocurre **como mucho una vez** en la vida de la fila.
    if (advances) {
      await this.prisma.shipmentRequest.updateMany({
        where: { id, status: { in: [...ShipmentsService.PRE_GUIA] } },
        data: { status: 'guia' },
      });
    }
    // ⭐⭐ §R.4.b + `D-AVISO-2` bajo concurrencia — el ciclo del aviso se reinicia por VALOR, no por
    // evento, y **la comparación la hace el MOTOR en el mismo `UPDATE`** que escribe la etiqueta
    // (ver el docstring): `count === 1` ⇔ *esta* petición fue la que dejó la etiqueta distinta, y
    // por tanto la única con derecho a limpiar el pestillo. ⛔ Nunca un `if` sobre una lectura
    // previa: bajo N concurrentes las N leerían el valor viejo y las N se creerían «el cambio».
    // ⚠️ Las ramas `: null` son obligatorias — Prisma traduce `{ not: v }` a `col <> v`, que en SQL
    // NO casa con `NULL`, y el primer `setTracking` de un envío tiene las dos columnas en `NULL`.
    // ⚠️ `status: { not: 'cancelado' }` (`REL-C`): el 409 de arriba se decidió sobre la lectura
    // previa, así que una cancelación simultánea se le colaba. Sin esta rama, la etiqueta aterrizaba
    // sobre un envío que ya no sale — la **cola falsa** que este método dice impedir.
    const relabelled = await this.prisma.shipmentRequest.updateMany({
      where: {
        id,
        status: { not: 'cancelado' },
        OR: [
          { carrier: null },
          { carrier: { not: carrier } },
          { trackingNumber: null },
          { trackingNumber: { not: trackingNumber } },
        ],
      },
      data: { ...data, trackingNoticeSentAt: null },
    });
    if (relabelled.count !== 1) {
      // La etiqueta no cambió (o la cambió otra petición simultánea): se escriben los costos del
      // transportista igual —una re-captura idempotente que los trae es legítima— ⛔ SIN tocar el
      // sello y ⛔ sin tocar el estado.
      await this.prisma.shipmentRequest.updateMany({
        where: { id, status: { not: 'cancelado' } },
        data,
      });
    }
    // S49-R4: proyectado (antes devolvía la entidad `ShipmentRequest` cruda).
    const row = toAdminShipmentRow(
      await this.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } }),
    );
    // ⛔ POST-COMMIT y best-effort: el sello se reclama FUERA de la escritura de negocio. Meterlo
    // dentro haría que un fallo del correo pudiera revertir la captura de una etiqueta ya comprada.
    // ⚠️ Y **solo avisa quien escribió la etiqueta** (`relabelled.count === 1`). Antes se llamaba
    // siempre y el sello lo filtraba; ya no basta, porque con la guarda de `cancelado` una captura
    // puede no escribir NADA — y entonces el correo anunciaría una guía que no está en la fila.
    if (relabelled.count === 1) {
      await this.claimAndNotify(id, 'trackingNoticeSentAt', shipment, (l, p) =>
        shipmentGuideTemplate({ ...p, carrier, trackingNumber }, l),
      );
    }
    return row;
  }

  // ===============================================================================================
  // §R — LOS TRES AVISOS DE ENVÍO. **Best-effort, post-commit, y jamás propagan** (§R.4).
  // ===============================================================================================

  /** Estados en los que el envío **ya está en `guia` o más allá** (§M4: «no regresa el estado»). */
  private static readonly GUIA_OR_LATER: readonly ShipmentStatus[] = ['guia', 'enviado', 'entregado'];

  /**
   * ⭐ `REL-C` — Estados **anteriores** a `guia`: los únicos desde los que capturar una etiqueta
   * puede AVANZAR el envío. Es el `WHERE` del avance de `setTracking`, y por eso es un conjunto
   * derivado de `TRANSITIONS` y no una lista suelta: `s ∈ PRE_GUIA ⇔ 'guia' ∈ TRANSITIONS[s]`.
   * ⛔ Que sea un predicado sobre el estado REAL (y no sobre el que se leyó) es lo que hace
   * imposible que una captura retroceda un `enviado`.
   */
  private static readonly PRE_GUIA: readonly ShipmentStatus[] = (
    Object.keys(ShipmentsService.TRANSITIONS) as ShipmentStatus[]
  ).filter((s) => ShipmentsService.TRANSITIONS[s].includes('guia'));

  /**
   * ⭐ **§R.5 — RESOLUCIÓN DEL DESTINATARIO.** *Un correo mandado al inbox equivocado no es un aviso:
   * es una fuga.* El orden es exacto y no es negociable:
   * ```
   * 1. shipment.userId != null  →  User.email                             // retiro de BÓVEDA
   * 2. shipment.orderId != null →  order.guestEmail ?? order.user.email   // fulfillment de un pedido
   * 3. ninguno                  →  ⛔ NADA + log.warn                      // estado imposible
   * ```
   * - ⭐ **`guestEmail` GANA cuando existe, incluso si el pedido fue RECLAMADO** (`claimedAt != null`):
   *   es la dirección con la que compró y a la que ya le llegó la confirmación. Precedente idéntico y
   *   deliberado: el reenvío del enlace de seguimiento ya va *siempre* a `Order.guestEmail`.
   * - ⛔ **Jamás se toma la dirección del `addressSnapshot`, ni del body, ni de una sesión**: se
   *   resuelve **por id**.
   * - ⛔ **No se escribe a un `User` con `anonymizedAt != null`** (§R.5.a): una cuenta anonimizada ya
   *   no es de nadie, y escribirle es mandar datos de una persona a una dirección que el borrado
   *   debía cerrar.
   */
  private async resolveRecipient(
    shipment: Pick<ShipmentRequest, 'id' | 'userId' | 'orderId'>,
  ): Promise<{ email: string; locale: string | null; orderNumber: string | null } | null> {
    if (shipment.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: shipment.userId },
        select: { email: true, locale: true, anonymizedAt: true },
      });
      if (!user || user.anonymizedAt) return null;
      return { email: user.email, locale: user.locale, orderNumber: null };
    }
    if (shipment.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: shipment.orderId },
        select: {
          orderNumber: true,
          guestEmail: true,
          locale: true,
          user: { select: { email: true, locale: true, anonymizedAt: true } },
        },
      });
      if (!order) return null;
      if (order.guestEmail) {
        return {
          email: order.guestEmail,
          locale: order.locale ?? order.user?.locale ?? null,
          orderNumber: order.orderNumber,
        };
      }
      if (!order.user || order.user.anonymizedAt) return null;
      return {
        email: order.user.email,
        locale: order.locale ?? order.user.locale,
        orderNumber: order.orderNumber,
      };
    }
    return null;
  }

  /**
   * `D-AVISO-2` — **SE SELLA Y LUEGO SE ENVÍA.** La reclamación es una escritura condicional y solo
   * la ganadora manda el correo:
   * ```
   * UPDATE … SET <sello> = now() WHERE id = :id AND <sello> IS NULL  →  count === 1 ⇒ mandar
   *                                                                  →  count === 0 ⇒ ⛔ salir
   * ```
   * ⚠️ **El precio se dice entero:** si el envío falla **después** de sellar, ese correo **no vuelve
   * a salir**. Se acepta a propósito —es la misma decisión que el barrido ya tomó— y la red de
   * seguridad es **la pantalla**, que siempre tiene el dato.
   *
   * ### ⭐⭐ `sealField = null` — POR QUÉ `AV-5`/`AV-6` NO ESTRENAN COLUMNA (decisión `REL-B`)
   * Esta línea decía ya *«su una sola vez la da el MOTOR»* y **era falsa cuando se escribió**: el
   * motor no decidía nada, porque `updateStatus` escribía con `where: { id }` a secas. El pentester
   * lo midió: `13/13` tiradas con duplicado. ⇒ la frase no era una garantía, era una intención.
   *
   * **Ahora es cierta, y se sostiene en DOS hechos, no en uno** (los dos se cerraron en este pase):
   *  1. **La transición se RECLAMA** — `updateMany({ where: { id, status: <el leído> } })` +
   *     `count === 1`. De N peticiones simultáneas, **una** hace la transición; las demás reciben
   *     `409` **antes** de llegar al correo.
   *  2. **El grafo de `TRANSITIONS` es ACÍCLICO y nadie lo retrocede** — `enviado` solo se alcanza
   *     desde `guia`, de `enviado` solo se sale a `entregado`, y de `cancelado` no se sale. Así que
   *     `→ enviado` y `→ cancelado` ocurren **como mucho una vez en la vida de la fila**.
   *     ⚠️ Este segundo hecho es el frágil, y **era falso hasta este pase**: `setTracking` (`REL-C`)
   *     y `payments.settle` podían **regresar** el estado con una escritura sin precondición,
   *     reabriendo el camino a `enviado` ⇒ un segundo `AV-5` legítimo. Por eso el arreglo de
   *     `REL-B` **no está completo sin el de `REL-C`**: la premisa del sello es la monotonía.
   *
   * **⇒ La columna no aporta nada que el motor no dé ya, y sí cuesta**: una migración en una zona
   * compartida (`prisma/schema.prisma`), dos campos más que un DTO puede filtrar (hay un candado
   * entero, `avisos.seals-out-of-dto`, vigilando justo eso), y **una segunda fuente para un mismo
   * hecho** — la fila diría «ya avisé» y el estado diría «la transición ya ocurrió», y el día que
   * discrepen habrá que decidir cuál manda. *Un sello se estrena cuando el ciclo puede REPETIRSE
   * (`trackingNoticeSentAt`: recapturar una etiqueta distinta es un hecho nuevo). `AV-5`/`AV-6` no
   * repiten: son aristas de un grafo sin ciclos.*
   *
   * ⛔ **Y la premisa se vigila**, no se confía: `shipments.state-monotonic.spec.ts` pone rojo si
   * alguien añade un ciclo a `TRANSITIONS` o escribe `status` de un `ShipmentRequest` sin llevar la
   * precondición al `WHERE`. Si esa premisa se cae, la decisión correcta pasa a ser la columna.
   */
  private async claimAndNotify(
    id: string,
    sealField: 'trackingNoticeSentAt' | null,
    shipment: Pick<ShipmentRequest, 'id' | 'userId' | 'orderId'>,
    build: (locale: string | null, params: ShipmentNoticeParams) => Omit<MailMessage, 'to'>,
  ): Promise<void> {
    try {
      if (!this.mail) {
        this.logger.warn(`shipment mail skipped for ${id}: MAIL_PORT unavailable`);
        return;
      }
      const to = await this.resolveRecipient(shipment);
      if (!to) {
        // §R.5.a — se loggea y se sale. ⛔ No se sustituye por un destinatario «parecido».
        this.logger.warn(`shipment mail skipped for ${id}: no recipient email`);
        return;
      }
      if (sealField) {
        const sealed = await this.prisma.shipmentRequest.updateMany({
          where: { id, [sealField]: null },
          data: { [sealField]: new Date() },
        });
        if (sealed.count !== 1) return; // ya se avisó de este hecho: ⛔ no se manda un segundo correo.
      }
      const msg = build(to.locale, {
        shipmentId: id,
        orderNumber: to.orderNumber,
      });
      await this.mail.send({ ...msg, to: to.email });
    } catch (e) {
      // ⛔ NUNCA propaga: un fallo de correo no revierte una transición ni tumba el endpoint.
      this.logger.error(
        `shipment mail failed for ${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * ⭐⭐ **Criterio 210, y se verifica POR EXCESO Y POR DEFECTO: DOS correos de envío y NINGUNO al
   * entregar.** Este `switch` es la forma verificable de esa frase — `entregado` **no tiene rama**, y
   * su ausencia es la mitad que falla por exceso. *No se añade «porque parecía razonable»:
   * el dueño lo confirmó explícitamente (pregunta 74) con el contraargumento delante.*
   *
   * **Una sola vez, sin estrenar columna:** la da el MOTOR, y desde `REL-B` eso es verdad literal y
   * no una intención — se llega aquí **solo** si `updateStatus` ganó la reclamación de la transición
   * (`updateMany … count === 1`), y el grafo de `TRANSITIONS` es acíclico. El argumento entero, con
   * lo que costaría la alternativa, está en el docstring de `claimAndNotify`.
   */
  private async notifyStatus(
    shipment: Pick<ShipmentRequest, 'id' | 'userId' | 'orderId' | 'carrier' | 'trackingNumber'>,
    to: ShipmentStatus,
  ): Promise<void> {
    if (to === 'enviado') {
      await this.claimAndNotify(shipment.id, null, shipment, (l, p) =>
        shipmentShippedTemplate(
          { ...p, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber },
          l,
        ),
      );
      return;
    }
    if (to === 'cancelado') {
      await this.claimAndNotify(shipment.id, null, shipment, (l, p) =>
        shipmentCancelledTemplate(p, l),
      );
    }
    // ⛔ `entregado`, `picking`, `guia`, `solicitado`: CERO correos (criterio 210 / §R.7).
  }
}
