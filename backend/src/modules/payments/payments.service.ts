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
        case 'charge.refunded':
          await this.onChargeRefunded(event.data.object as Stripe.Charge);
          break;
        case 'charge.dispute.created':
          await this.onChargeDispute(event.data.object as Stripe.Dispute);
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
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      include: { items: true },
    });
    if (!order || order.status !== 'pending') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'failed' } });
      for (const oi of order.items) {
        await tx.inventoryItem.update({
          where: { id: oi.inventoryItemId },
          data: {
            status: 'listed',
            ownerType: 'platform',
            ownerUserId: null,
            ownershipStatus: null,
          },
        });
      }
    });
  }

  async onChargeRefunded(charge: Stripe.Charge): Promise<void> {
    const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({ where: { stripePaymentIntentId: pi } });
    if (!order) return;
    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'refunded', refundedAt: new Date() },
    });
  }

  /** charge.dispute.created (contracargo) → Order chargeback + item revierte a plataforma. */
  async onChargeDispute(dispute: Stripe.Dispute): Promise<void> {
    const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
    if (!pi) return;
    const order = await this.prisma.order.findUnique({
      where: { stripePaymentIntentId: pi },
      include: { items: true },
    });
    if (!order) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'chargeback' } });
      for (const oi of order.items) {
        const item = await tx.inventoryItem.findUnique({ where: { id: oi.inventoryItemId } });
        if (!item) continue;
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
    });
  }
}
