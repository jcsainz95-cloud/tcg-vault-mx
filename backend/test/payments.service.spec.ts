import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * Verifica el ciclo de titularidad pending→settled y la reversión por contracargo
 * (ARCHITECTURE §3.3), incluida la idempotencia por event.id.
 */
describe('PaymentsService — titularidad pending→settled y contracargo', () => {
  let prisma: any;
  let payments: PaymentsService;

  const makeTx = () => ({
    order: { update: jest.fn().mockResolvedValue({}) },
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue({ id: 'item1', status: 'in_custody' }),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
  });

  beforeEach(() => {
    const tx = makeTx();
    prisma = {
      _tx: tx,
      processedStripeEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      shipmentRequest: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    payments = new PaymentsService(prisma as unknown as PrismaService, {} as StripeService);
  });

  it('payment_intent.succeeded → Order settled + items ownershipStatus settled', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'pending',
      items: [{ inventoryItemId: 'item1' }],
    });
    await payments.onPaymentSucceeded('pi_1');
    const tx = prisma._tx;
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'settled' }) }),
    );
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ownershipStatus: 'settled' } }),
    );
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'settle' }) }),
    );
  });

  it('is idempotent: a processed event is skipped', async () => {
    prisma.processedStripeEvent.findUnique.mockResolvedValue({ id: 'evt_1' });
    const spy = jest.spyOn(payments, 'onPaymentSucceeded');
    await payments.handleEvent({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('already-settled order is not re-processed', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', status: 'settled', items: [] });
    await payments.onPaymentSucceeded('pi_1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('charge.dispute.created → Order chargeback + item revierte a plataforma', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'settled',
      items: [{ inventoryItemId: 'item1' }],
    });
    await payments.onChargeDispute({ payment_intent: 'pi_1' } as any);
    const tx = prisma._tx;
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'chargeback' } }),
    );
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerType: 'platform',
          ownerUserId: null,
          ownershipStatus: null,
          status: 'listed',
        }),
      }),
    );
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'chargeback_return' }) }),
    );
  });

  it('payment for a shipment advances solicitado → picking', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    prisma.shipmentRequest.findUnique.mockResolvedValue({ id: 's1', status: 'solicitado' });
    await payments.onPaymentSucceeded('pi_ship');
    expect(prisma.shipmentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ status: 'picking' }) }),
    );
  });
});
