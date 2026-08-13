import { Injectable, Logger } from '@nestjs/common';
import { MovementReason, Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';

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
   * charge.dispute.created (contracargo) → Order `chargeback`. Fix 4: consciente del estado
   * FÍSICO de la carta:
   *  - Sigue en bóveda (no enviada/entregada) → revierte a plataforma (`listed`) +
   *    InventoryMovement `chargeback_return` (la tenemos, la recuperamos).
   *  - Ya enviada/entregada → NO se re-agrega (no la tenemos): se marca la orden para
   *    gestión manual (`chargebackNeedsManual`) para pelear el contracargo con la guía.
   */
  async onChargeDispute(dispute: Stripe.Dispute): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: pi },
      include: { items: true },
    });
    if (!order) return;
    await this.prisma.$transaction(async (tx) => {
      let needsManual = false;
      for (const oi of order.items) {
        const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
        if (!item) continue;
        // ¿La carta ya salió físicamente (enviada/entregada)? El estado del InventoryItem no
        // se mueve en el flujo de envío, así que la señal canónica es un ShipmentItem cuyo
        // ShipmentRequest esté en `enviado`/`entregado`.
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
   */
  async onChargeDisputeClosed(dispute: Stripe.Dispute, forced?: 'won' | 'lost'): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({ where: { stripePaymentIntentId: pi } });
    if (!order) return;

    const outcome = forced ?? (dispute.status === 'won' ? 'won' : dispute.status === 'lost' ? 'lost' : null);
    if (outcome === 'won') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'settled',
          settledAt: order.settledAt ?? new Date(),
          disputeOutcome: 'won',
          chargebackNeedsManual: false,
        },
      });
    } else if (outcome === 'lost') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'chargeback', disputeOutcome: 'lost', chargebackNeedsManual: false },
      });
    } else {
      this.logger.debug(`dispute.closed status=${dispute.status}: sin cambio terminal.`);
    }
  }
}
