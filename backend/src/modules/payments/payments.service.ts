import { Injectable, Logger } from '@nestjs/common';
import { MovementReason, Order, OrderItem, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { GuestOrderMailService } from '../orders/guest-order-mail.service';
import { AuditService } from '../audit/audit.service';

/**
 * PaymentsService — Manejo idempotente de webhooks Stripe. ARCHITECTURE §3.3, §4.3.
 * Transiciones transaccionales de titularidad (pending→settled) y reversión por
 * contracargo, con InventoryMovement. Idempotencia por event.id (ProcessedStripeEvent).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    // v1.21-guest-checkout: correo + enlace tokenizado al liquidar un pedido de invitado.
    private readonly guestMail: GuestOrderMailService,
    // B3 (v1.21.2): las anomalías de inventario al liquidar quedan en la bitácora, no solo en logs.
    private readonly audit: AuditService,
  ) {}

  verifyAndParse(payload: Buffer, signature: string): Stripe.Event {
    return this.stripe.constructEvent(payload, signature);
  }

  /**
   * Punto de entrada del webhook. Idempotente por event.id.
   *
   * Idempotencia ATÓMICA (fix QA #2): se intenta `create` del registro PRIMERO y se
   * usa la violación de unique (P2002) como guardia de "ya procesado". Así, dos
   * entregas concurrentes del mismo event.id no pueden doble-procesar (solo una gana
   * el insert; la otra ve P2002 y hace no-op).
   *
   * "Procesado SOLO tras éxito" (fix QA #1): si el handler lanza, se BORRA el registro
   * de idempotencia y se RE-LANZA la excepción. El controller responde != 2xx y Stripe
   * reintenta; el evento NO queda marcado como procesado. Los eventos ya procesados o
   * no manejados retornan normalmente (el controller responde 200).
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    // Guardia de idempotencia atómica: intenta reservar el event.id.
    try {
      await this.prisma.processedStripeEvent.create({
        data: { id: event.id, type: event.type },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        this.logger.debug(`Stripe event ${event.id} ya procesado/en curso; ignorado.`);
        return;
      }
      throw e;
    }

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.onPaymentSucceeded((event.data.object as Stripe.PaymentIntent).id);
          break;
        case 'payment_intent.payment_failed':
          await this.onPaymentFailed((event.data.object as Stripe.PaymentIntent).id);
          break;
        // B5: PaymentIntent cancelado → libera la reserva (igual que un fallo de pago).
        case 'payment_intent.canceled':
          await this.onPaymentCanceled((event.data.object as Stripe.PaymentIntent).id);
          break;
        case 'charge.refunded':
          await this.onChargeRefunded(event.data.object as Stripe.Charge);
          break;
        case 'charge.dispute.created':
          await this.onChargeDispute(event.data.object as Stripe.Dispute);
          break;
        // M1/Fix 5: cierre de disputa (ganamos/perdimos) → estado terminal.
        case 'charge.dispute.closed':
          await this.onChargeDisputeClosed(event.data.object as Stripe.Dispute);
          break;
        case 'charge.dispute.funds_reinstated':
          // Fondos reinstalados = ganamos la disputa.
          await this.onChargeDisputeClosed(event.data.object as Stripe.Dispute, 'won');
          break;
        default:
          this.logger.debug(`Evento no manejado: ${event.type}`);
      }
    } catch (e) {
      // El handler falló (p. ej. DB transitoria): revierte la marca de idempotencia
      // para que Stripe pueda reintegrar el evento en un reintento, y propaga el error.
      await this.prisma.processedStripeEvent
        .delete({ where: { id: event.id } })
        .catch(() => undefined);
      throw e;
    }
  }

  /** payment_intent.succeeded → Order settled + items settled; o liquida envío → picking. */
  async onPaymentSucceeded(paymentIntentId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { items: true },
    });
    if (order) {
      if (order.status === 'settled') return;
      // v1.21-guest-checkout: SEGUNDA RUTA DE FULFILLMENT. Un pedido `direct_ship` NO deposita en
      // bóveda (el invitado no tiene): sus piezas siguen siendo de la plataforma y avanzan por
      // `status` hasta salir por la puerta. ARCHITECTURE §4.21c.
      if (order.fulfillmentMode === 'direct_ship') {
        await this.settleDirectShipOrder(order);
        return;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'settled', settledAt: new Date() },
        });
        for (const oi of order.items) {
          const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
          if (!item) continue;
          // Transición de reserva a custodia liquidada: reserved → in_custody, settled.
          await tx.inventoryItem.update({
            where: { id: oi.inventoryItemId },
            data: { status: 'in_custody', ownershipStatus: 'settled' },
          });
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'in_custody',
              reason: MovementReason.settle,
              note: `order ${order.id} settled`,
            },
          });
        }
      });
      return;
    }
    // ¿Es el pago de un envío? Avanza a picking.
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (shipment && shipment.status === 'solicitado') {
      await this.prisma.shipmentRequest.update({
        where: { id: shipment.id },
        data: { status: 'picking', pickingAt: new Date() },
      });
    }
  }

  /**
   * v1.21-guest-checkout — liquidación de un pedido con ENVÍO DIRECTO (§4-G.6, ARCHITECTURE §4.21c).
   *
   * Diferencias con la ruta de bóveda, todas deliberadas:
   *  - Los items NO cambian de dueño: siguen `ownerType='platform'`, `ownerUserId=null`,
   *    `ownershipStatus=null`. Solo avanza `status`: `reserved → picking` (vendida y en
   *    preparación, aún físicamente en el almacén).
   *  - Se CREA el `ShipmentRequest` de fulfillment (`userId=null`, `orderId`, `status='picking'`)
   *    ya pagado: nace en `picking` y NUNCA pasa por `solicitado`.
   *  - Sus montos van en CERO a propósito: el ingreso del envío vive en `Order.shippingFeeCents`
   *    (mismo PaymentIntent). Repetirlo aquí lo contaría DOS VECES en el P&L de M7 (§4.21b).
   *  - Se capturan marca + últimos 4 de la tarjeta (único dato de pago que se persiste).
   *
   * Idempotente: el early-return por `status==='settled'`, la guardia `status:'reserved'` de cada
   * pieza y la búsqueda del envío activo hacen que un reintento de Stripe no duplique nada.
   * El correo es POST-COMMIT y BEST-EFFORT: su fallo NO revierte el pago ni falla el webhook.
   */
  private async settleDirectShipOrder(order: Order & { items: OrderItem[] }): Promise<void> {
    const card = order.stripePaymentIntentId
      ? await this.stripe.getCardDetails(order.stripePaymentIntentId).catch(() => null)
      : null;
    const now = new Date();
    // B3: anomalías de inventario detectadas al liquidar (ver dentro del bucle). Se reportan FUERA
    // de la transacción para que el log y la auditoría no dependan de su commit.
    const anomalies: { inventoryItemId: string; was: string; recovered: boolean }[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'settled',
          settledAt: now,
          ...(card ? { paymentMethodBrand: card.brand, paymentMethodLast4: card.last4 } : {}),
        },
      });
      for (const oi of order.items) {
        const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
        if (!item) continue;
        // Guardia positiva: solo una pieza aún `reserved` avanza (idempotencia ante reintentos).
        const moved = await tx.inventoryItem.updateMany({
          where: { id: oi.inventoryItemId, status: 'reserved' },
          data: { status: 'picking' },
        });
        if (moved.count === 1) {
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'picking',
              reason: MovementReason.settle,
              note: `guest order ${order.orderNumber ?? order.id} settled (direct_ship)`,
            },
          });
          continue;
        }

        // B3 (v1.21.2) — la pieza NO estaba `reserved` al liquidar. Esto NO es un no-op: es una
        // ANOMALÍA. Así sobrevivió el bug del barrido: un `continue` mudo en el camino del dinero.
        // Un reintento del webhook la deja ya en `picking` (idempotencia legítima); cualquier otro
        // estado significa que la reserva se soltó por debajo (p. ej. el barrido liberó la pieza y
        // el pago se confirmó después).
        if (item.status === 'picking') continue;

        // Recuperación: si la pieza volvió al pool y NADIE la tomó, el pedido PAGADO manda — se
        // re-congela en `picking`, que es donde debía estar. Restaura el invariante «ShipmentItem
        // en envío no terminal ⇒ item fuera de {listed, in_stock}» y corta el double-sell ANTES de
        // que ocurra.
        const recovered = await tx.inventoryItem.updateMany({
          where: { id: oi.inventoryItemId, status: { in: ['listed', 'in_stock'] } },
          data: { status: 'picking' },
        });
        if (recovered.count === 1) {
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'picking',
              reason: MovementReason.settle,
              note:
                `ANOMALÍA: pieza no reservada al liquidar el pedido ` +
                `${order.orderNumber ?? order.id} (estaba ${item.status}); re-congelada por pago confirmado`,
            },
          });
          anomalies.push({ inventoryItemId: oi.inventoryItemId, was: item.status, recovered: true });
          continue;
        }

        // La pieza ya está en manos de otro flujo (reservada por otro checkout, enviada, perdida…):
        // NO se le quita a nadie automáticamente. Queda registrada para intervención humana.
        anomalies.push({ inventoryItemId: oi.inventoryItemId, was: item.status, recovered: false });
      }
      // A lo más UN envío activo por orden (invariante de aplicación, §4-G.10).
      const existing = await tx.shipmentRequest.findFirst({
        where: { orderId: order.id, status: { not: 'cancelado' } },
      });
      if (!existing) {
        await tx.shipmentRequest.create({
          data: {
            userId: null,
            orderId: order.id,
            addressSnapshot: (order.shippingAddressSnapshot ?? {}) as Prisma.InputJsonValue,
            status: 'picking',
            pickingAt: now,
            // CERO a propósito (ver arriba): el ingreso del envío ya está en Order.shippingFeeCents.
            shippingFeeCents: 0,
            ivaCents: 0,
            processingFeeCents: 0,
            totalCents: 0,
            items: { create: order.items.map((oi) => ({ inventoryItemId: oi.inventoryItemId })) },
          },
        });
      }
    });

    // B3 — las anomalías son RUIDOSAS: log de error + AuditLog consultable (M10). Nunca se
    // liquidan en silencio: cada una significa que una pieza única no estaba donde el pedido
    // pagado suponía, y las no recuperadas exigen intervención humana.
    if (anomalies.length > 0) {
      const unrecovered = anomalies.filter((a) => !a.recovered);
      const detail = anomalies
        .map((a) => `${a.inventoryItemId}:${a.was}${a.recovered ? '→picking' : ':SIN RECUPERAR'}`)
        .join(', ');
      this.logger.error(
        `ANOMALÍA al liquidar el pedido ${order.orderNumber ?? order.id}: ${anomalies.length} ` +
          `pieza(s) no estaban 'reserved' (${detail}). ` +
          (unrecovered.length > 0
            ? 'Requiere INTERVENCIÓN HUMANA: la pieza está comprometida con otro flujo.'
            : 'Recuperadas: el pago confirmado manda sobre una reserva liberada.'),
      );
      await this.audit
        .log({
          actorUserId: null,
          actorRole: null,
          action: 'order.settle_inventory_anomaly',
          entityType: 'Order',
          entityId: order.id,
          after: { anomalies, needsHumanReview: unrecovered.length > 0 },
        })
        .catch((e: unknown) =>
          this.logger.error(`No se pudo auditar la anomalía de settle: ${(e as Error).message}`),
        );
    }

    // POST-COMMIT, BEST-EFFORT (§4.21g): un fallo del correo se loguea; la red de seguridad es el
    // `checkoutToken` ya devuelto por el checkout + el reenvío self-service + el de soporte.
    await this.guestMail
      .sendConfirmation({
        id: order.id,
        orderNumber: order.orderNumber,
        guestEmail: order.guestEmail,
        locale: order.locale,
        totalCents: order.totalCents,
        items: order.items.map((oi) => {
          const snap = (oi.cardSnapshot ?? {}) as { name?: string; setName?: string; number?: string };
          return { name: snap.name ?? '', setName: snap.setName ?? '', number: snap.number ?? '' };
        }),
      })
      .catch((e: unknown) =>
        this.logger.error(`guest confirmation mail failed for ${order.id}: ${(e as Error).message}`),
      );
  }

  /** payment_intent.payment_failed → Order failed + libera reserva (reserved→listed). */
  async onPaymentFailed(paymentIntentId: string): Promise<void> {
    await this.failAndRelease(paymentIntentId, 'payment_failed');
  }

  /** B5: payment_intent.canceled → misma compensación que un fallo (libera la reserva). */
  async onPaymentCanceled(paymentIntentId: string): Promise<void> {
    await this.failAndRelease(paymentIntentId, 'canceled');
  }

  /**
   * Compensación común para pago fallido/cancelado: libera la reserva de una orden
   * (reserved→listed, item vuelve a plataforma) o cancela un envío `solicitado` (para
   * que sus items dejen de estar bloqueados por ITEM_IN_ANOTHER_SHIPMENT).
   */
  private async failAndRelease(paymentIntentId: string, cause: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { items: true },
    });
    if (order) {
      if (order.status !== 'pending') return;
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'failed' } });
        for (const oi of order.items) {
          await tx.inventoryItem.updateMany({
            where: { id: oi.inventoryItemId, status: 'reserved' },
            data: {
              status: 'listed',
              ownerType: 'platform',
              ownerUserId: null,
              ownershipStatus: null,
            },
          });
        }
      });
      return;
    }
    // ¿Es el pago de un envío aún no liquidado? Cancélalo para liberar los items.
    const shipment = await this.prisma.shipmentRequest.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (shipment && shipment.status === 'solicitado') {
      await this.prisma.shipmentRequest.update({
        where: { id: shipment.id },
        data: { status: 'cancelado' },
      });
      this.logger.debug(`Shipment ${shipment.id} cancelado por ${cause}.`);
    }
  }

  /**
   * charge.refunded → Order `refunded`. A1 (VENTAS FINALES): el reembolso NO re-agrega el
   * item al inventario (no auto-revert); es un remedio excepcional del super_admin ya
   * autorizado (money-out).
   * M2: distingue reembolso PARCIAL vs TOTAL (`amount_refunded` vs `amount`); solo el
   * reembolso total transiciona la orden a `refunded`.
   */
  async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({ where: { stripePaymentIntentId: pi } });
    if (!order) return;

    const amount = charge.amount ?? 0;
    const amountRefunded = charge.amount_refunded ?? 0;
    const fullyRefunded = amount > 0 && amountRefunded >= amount;
    if (!fullyRefunded) {
      // M2: reembolso parcial → no cambia el estado terminal de la orden (queda registrado
      // en Stripe; la conciliación fina de importes parciales es de M7/Finanzas).
      this.logger.log(
        `Order ${order.id}: reembolso PARCIAL (${amountRefunded}/${amount}); sin cambio de estado.`,
      );
      return;
    }
    if (order.status === 'refunded') return;
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded', refundedAt: new Date() },
    });
  }

  /**
   * charge.dispute.created (contracargo) → Order `chargeback`.
   *
   * v1.21.2 (T1) — **ramifica por `Order.fulfillmentMode`**, el único discriminador canónico de
   * ruta de fulfillment (D4, ARCHITECTURE §4.21d). El `switch` es EXHAUSTIVO y RUIDOSO: un modo
   * nuevo **lanza** en vez de comportarse como otro en silencio.
   *  - `vault`: comportamiento v1.21 sin cambio (abajo).
   *  - `direct_ship`: tabla normativa de §4-G.6 — **el envío manda** (§4.21c-bis).
   */
  async onChargeDispute(dispute: Stripe.Dispute): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: pi },
      include: { items: true },
    });
    if (!order) return;
    switch (order.fulfillmentMode) {
      case 'direct_ship':
        return this.onChargeDisputeDirectShip(order);
      case 'vault':
        return this.onChargeDisputeVault(order);
      default: {
        const mode: string = order.fulfillmentMode;
        this.logger.error(
          `Contracargo sobre un fulfillmentMode no soportado (${mode}) en la orden ${order.id}: ` +
            'no se aplica ningún reverso automático. Requiere decidir su regla de inventario.',
        );
        throw new Error(`Unsupported fulfillmentMode in chargeback: ${mode}`);
      }
    }
  }

  /**
   * v1.21.2 (T1, §4-G.6 / ARCHITECTURE §4.21c-bis) — contracargo de un pedido con **ENVÍO
   * DIRECTO**. La decisión la toma el **estado del envío**, no el del item:
   *
   * | Envío | ShipmentRequest | InventoryItem | needsManual |
   * |---|---|---|---|
   * | no existe / `cancelado` | — | `reserved\|picking → listed` + `chargeback_return` | `false` |
   * | `solicitado\|picking\|guia` | **→ `cancelado`** (misma tx) | **CONGELADO** en `picking` | `true` |
   * | `enviado\|entregado` | sin cambio | sin cambio | `true` |
   *
   * **Por qué NO se re-lista con envío vivo:** re-listar es una acción automática que vuelve a
   * VENDER, y el envío seguía en `pickingList()` ⇒ la misma pieza única podía venderse a un
   * segundo comprador mientras el operador la metía en la caja del contracargo (double-sell
   * físico). Además un contracargo no prueba nada todavía: podemos ganar la disputa. Por eso la
   * pieza se **congela** (doblemente fuera de venta: `picking ∉ {listed,in_stock}` y su envío sale
   * de la cola) y el desenlace lo confirma un humano con
   * `POST /admin/orders/:id/chargeback-inventory` (§M3).
   */
  private async onChargeDisputeDirectShip(order: Order & { items: OrderItem[] }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Envío de FULFILLMENT de esta orden (el más reciente). Un retiro de bóveda no lleva
      // `orderId`, así que esta consulta nunca lo confunde con el envío de la orden.
      const shipment = await tx.shipmentRequest.findFirst({
        where: { orderId: order.id },
        orderBy: { requestedAt: 'desc' },
      });
      const status = shipment?.status;
      const isLive = status === 'solicitado' || status === 'picking' || status === 'guia';
      const isShippedOut = status === 'enviado' || status === 'entregado';
      let needsManual = false;

      if (isLive) {
        // Sale de la cola de picking en la MISMA transacción (pickingList() filtra status:'picking').
        await tx.shipmentRequest.update({
          where: { id: shipment!.id },
          data: { status: 'cancelado' },
        });
        // La pieza NO se toca: queda CONGELADA en `picking` (fuera de venta) hasta que un humano
        // confirme dónde está físicamente.
        needsManual = true;
      } else if (isShippedOut) {
        // Ya salió: no la tenemos, no se re-agrega. Gestión manual (pelear la disputa con la guía).
        needsManual = true;
      } else {
        // Sin envío (orden `pending`) o envío ya cancelado: la pieza nunca salió del estante.
        for (const oi of order.items) {
          const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
          if (!item) continue;
          const reverted = await tx.inventoryItem.updateMany({
            where: { id: oi.inventoryItemId, status: { in: ['reserved', 'picking'] } },
            data: {
              status: 'listed',
              ownerType: 'platform',
              ownerUserId: null,
              ownershipStatus: null,
            },
          });
          if (reverted.count !== 1) continue;
          await tx.inventoryMovement.create({
            data: {
              itemId: oi.inventoryItemId,
              fromStatus: item.status,
              toStatus: 'listed',
              reason: MovementReason.chargeback_return,
              note: `chargeback order ${order.orderNumber ?? order.id}`,
            },
          });
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'chargeback', chargebackNeedsManual: needsManual },
      });
    });
  }

  /**
   * Contracargo de un pedido a BÓVEDA (comportamiento v1.21, sin cambio). Consciente del estado
   * FÍSICO de la carta:
   *  - Sigue en bóveda (no enviada/entregada) → revierte a plataforma (`listed`) +
   *    InventoryMovement `chargeback_return` (la tenemos, la recuperamos).
   *  - Ya enviada/entregada (retiro del cliente) → NO se re-agrega: gestión manual.
   *
   * Aquí SÍ es correcto preguntar por `ShipmentItem` en `enviado|entregado`: el retiro de bóveda
   * nace del cliente y **no** lleva `orderId`, así que no hay "envío de la orden" que consultar.
   * (En `direct_ship` ese criterio era el bug: un envío en `picking`/`guia` no coincidía.)
   */
  private async onChargeDisputeVault(order: Order & { items: OrderItem[] }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      let needsManual = false;
      for (const oi of order.items) {
        const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
        if (!item) continue;
        // ¿La carta ya salió físicamente (enviada/entregada)? En el RETIRO DE BÓVEDA el estado
        // del InventoryItem no se mueve hasta la entrega, así que la señal canónica es un
        // ShipmentItem cuyo ShipmentRequest esté en `enviado`/`entregado`.
        // (v1.21.2: esto vale SOLO aquí. En `direct_ship` el item sí avanza con el envío
        // —picking/shipped/delivered— y la decisión la toma el estado del envío, ver arriba.)
        const shippedOut = await tx.shipmentItem.findFirst({
          where: {
            inventoryItemId: oi.inventoryItemId,
            shipmentRequest: { status: { in: ['enviado', 'entregado'] } },
          },
        });
        if (shippedOut) {
          // Ya no la tenemos: no se re-agrega al inventario; gestión manual.
          needsManual = true;
          continue;
        }
        // Sigue en bóveda: revertir a inventario de plataforma.
        await tx.inventoryItem.update({
          where: { id: oi.inventoryItemId },
          data: {
            ownerType: 'platform',
            ownerUserId: null,
            ownershipStatus: null,
            status: 'listed',
          },
        });
        await tx.inventoryMovement.create({
          data: {
            itemId: oi.inventoryItemId,
            fromStatus: item.status,
            toStatus: 'listed',
            reason: MovementReason.chargeback_return,
            note: `chargeback order ${order.id}`,
          },
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'chargeback', chargebackNeedsManual: needsManual },
      });
    });
  }

  /**
   * Fix 5 (M1): cierre de disputa. `charge.dispute.closed` trae `dispute.status`
   * (`won`/`lost`); `charge.dispute.funds_reinstated` fuerza `won`.
   *  - Ganamos → estado terminal correcto: los fondos vuelven (Order `settled`). Si el item
   *    se revirtió y seguía en bóveda, se QUEDA en inventario (no se toca aquí).
   *  - Perdimos → `chargeback` terminal.
   *
   * **v1.21.2 (T1) — `direct_ship`: el flag `chargebackNeedsManual` NO se limpia aquí.** Ganar la
   * disputa **NO re-expide automáticamente**: el envío original ya fue `cancelado` y la pieza sigue
   * CONGELADA, así que el caso debe seguir visible en la cola de M3 hasta que un humano confirme
   * dónde está la carta y ejecute `POST /admin/orders/:id/chargeback-inventory` (`reexpedir` si
   * ganamos, `recuperada`/`no_recuperada` si no). Automatizarlo presupondría una realidad física
   * que nadie comprobó. **Lo mismo aplica al desenlace `lost`** por la misma razón: limpiar el flag
   * dejaría la pieza congelada para siempre y fuera de toda cola. En la ruta de **bóveda** no hay
   * pieza congelada, así que se conserva el comportamiento v1.21 (el flag se limpia).
   */
  async onChargeDisputeClosed(dispute: Stripe.Dispute, forced?: 'won' | 'lost'): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({ where: { stripePaymentIntentId: pi } });
    if (!order) return;

    // `undefined` = no se toca el flag (lo resolverá el humano en `chargeback-inventory`).
    const clearManualFlag = order.fulfillmentMode === 'direct_ship' ? undefined : false;

    const outcome = forced ?? (dispute.status === 'won' ? 'won' : dispute.status === 'lost' ? 'lost' : null);
    if (outcome === 'won') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'settled',
          settledAt: order.settledAt ?? new Date(),
          disputeOutcome: 'won',
          chargebackNeedsManual: clearManualFlag,
        },
      });
    } else if (outcome === 'lost') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'chargeback',
          disputeOutcome: 'lost',
          chargebackNeedsManual: clearManualFlag,
        },
      });
    } else {
      this.logger.debug(`dispute.closed status=${dispute.status}: sin cambio terminal.`);
    }
  }
}
