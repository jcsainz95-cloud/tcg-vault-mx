import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../payments/stripe.service';

/**
 * H2 (money-safety) — en rutas de dinero la idempotency-key del cliente se IGNORA: `attachPaymentIntent`
 * deriva SIEMPRE la clave en el servidor (`pi-order-<orderId>`). El parámetro `idempotencyKey` fue
 * ELIMINADO de la superficie del método, así que ni existe una vía para inyectarla.
 */
function build() {
  const createPaymentIntent = jest.fn().mockResolvedValue({ id: 'pi_x', clientSecret: 'cs_x' });
  const stripe = { createPaymentIntent } as unknown as StripeService;
  const prisma = { order: { update: jest.fn().mockResolvedValue({}) } } as unknown as PrismaService;
  const svc = new OrdersService(
    prisma,
    {} as never,
    {} as never,
    stripe,
    {} as never,
  );
  return { svc, createPaymentIntent, prisma };
}

describe('H2 — attachPaymentIntent usa SIEMPRE la key del servidor', () => {
  it('llama a stripe.createPaymentIntent con idempotencyKey === `pi-order-<orderId>`', async () => {
    const { svc, createPaymentIntent } = build();
    await svc.attachPaymentIntent({
      orderId: 'order-123',
      amountCents: 51812,
      metadata: { orderId: 'order-123', kind: 'order' },
      inventoryItemIds: ['it-1'],
    });
    expect(createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'pi-order-order-123', amountCents: 51812 }),
    );
  });

  it('la key server-derivada depende SOLO del orderId (no hay override del cliente)', async () => {
    const { svc, createPaymentIntent } = build();
    await svc.attachPaymentIntent({
      orderId: 'order-999',
      amountCents: 100,
      metadata: {},
      inventoryItemIds: ['it-9'],
    });
    expect(createPaymentIntent.mock.calls[0][0].idempotencyKey).toBe('pi-order-order-999');
  });
});
