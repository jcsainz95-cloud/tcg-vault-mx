import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * A2 (cierra BE-7): en retiros, la "reserva" es la ShipmentRequest (bloquea los items vía
 * ITEM_IN_ANOTHER_SHIPMENT). Si Stripe falla tras crearla, se compensa borrando la solicitud
 * (cascada a sus items) para no dejar los items atrapados, y se devuelve un error de reintento.
 */
describe('ShipmentsService.create — rollback del PaymentIntent (A2 / BE-7)', () => {
  function buildService(stripeReject: unknown) {
    const address = { id: 'addr1', userId: 'userA', country: 'MX', line1: 'x', city: 'c', state: 's', postalCode: '00000', phone: '1' };
    const prisma: any = {
      address: { findUnique: jest.fn().mockResolvedValue(address) },
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'item1', ownerUserId: 'userA', ownershipStatus: 'settled' },
        ]),
      },
      shipmentItem: { findFirst: jest.fn().mockResolvedValue(null) },
      shipmentRequest: {
        create: jest.fn().mockResolvedValue({ id: 'ship1' }),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const settings: any = {
      getNumber: jest.fn().mockResolvedValue(17500),
      getStripeFee: jest
        .fn()
        .mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
    };
    const stripe: any = { createPaymentIntent: jest.fn().mockRejectedValue(stripeReject) };
    const svc = new ShipmentsService(
      prisma as PrismaService,
      settings as SettingsService,
      stripe as StripeService,
    );
    return { svc, prisma };
  }

  it('deletes the shipment request and returns a retriable error on PI failure', async () => {
    const { svc, prisma } = buildService(new Error('stripe down'));
    await expect(svc.create('userA', ['item1'], 'addr1')).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
    // La solicitud recién creada se borra (libera los items).
    expect(prisma.shipmentRequest.delete).toHaveBeenCalledWith({ where: { id: 'ship1' } });
    // Nunca se persiste el paymentIntentId (el update de PI no corre).
    expect(prisma.shipmentRequest.update).not.toHaveBeenCalled();
  });

  it('derives the idempotency-key server-side (pi-shipment-<id>) as override base', async () => {
    // Éxito: verifica que se usa la key derivada cuando el cliente no envía una.
    const { svc, prisma } = buildService(new Error('unused'));
    const stripe: any = { createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_1', clientSecret: 'cs' }) };
    (svc as any).stripe = stripe;
    await svc.create('userA', ['item1'], 'addr1');
    expect(stripe.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'pi-shipment-ship1' }),
    );
    expect(prisma.shipmentRequest.delete).not.toHaveBeenCalled();
  });
});
