import { Prisma } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/** Error P2002 (unique violation) tal como lo lanza Prisma. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

/**
 * Verifica el ciclo de titularidad pending→settled y la reversión por contracargo
 * (ARCHITECTURE §3.3), incluida la idempotencia ATÓMICA por event.id (fix QA #1 y #2).
 */
describe('PaymentsService — titularidad pending→settled y contracargo', () => {
  let prisma: any;
  let payments: PaymentsService;
  let processedIds: Set<string>;

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
    processedIds = new Set<string>();
    prisma = {
      _tx: tx,
      processedStripeEvent: {
        // Guardia atómica: create inserta; si el id ya existe, lanza P2002.
        create: jest.fn(async ({ data }: any) => {
          if (processedIds.has(data.id)) throw uniqueViolation();
          processedIds.add(data.id);
          return data;
        }),
        delete: jest.fn(async ({ where }: any) => {
          processedIds.delete(where.id);
          return {};
        }),
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
      expect.objectContaining({ data: { status: 'in_custody', ownershipStatus: 'settled' } }),
    );
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reason: 'settle', toStatus: 'in_custody' }) }),
    );
  });

  it('is idempotent: an already-processed event is skipped (no re-processing)', async () => {
    processedIds.add('evt_1'); // ya procesado previamente
    const spy = jest.spyOn(payments, 'onPaymentSucceeded');
    await payments.handleEvent({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fix QA #2: double concurrent delivery of the same event → a single settled', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'pending',
      items: [{ inventoryItemId: 'item1' }],
    });
    const evt = {
      id: 'evt_dup',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    } as any;
    const spy = jest.spyOn(payments, 'onPaymentSucceeded');

    // Dos entregas del MISMO event.id: la 2ª ve P2002 en el create y hace no-op.
    await Promise.all([payments.handleEvent(evt), payments.handleEvent(evt)]);

    expect(spy).toHaveBeenCalledTimes(1);
    // El transaccional de settled corre una sola vez.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma._tx.order.update).toHaveBeenCalledTimes(1);
  });

  it('fix QA #1: handler failure deletes idempotency mark and rethrows (Stripe retries)', async () => {
    // Primer intento: onPaymentSucceeded falla (p. ej. DB transitoria).
    prisma.order.findUnique.mockRejectedValueOnce(new Error('DB down'));
    const evt = {
      id: 'evt_fail',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1' } },
    } as any;

    await expect(payments.handleEvent(evt)).rejects.toThrow('DB down');
    // La marca de idempotencia se revirtió → el evento NO quedó como procesado.
    expect(processedIds.has('evt_fail')).toBe(false);
    expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { id: 'evt_fail' } });

    // Reintento de Stripe: ahora sí procesa y liquida.
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      status: 'pending',
      items: [{ inventoryItemId: 'item1' }],
    });
    await payments.handleEvent(evt);
    expect(processedIds.has('evt_fail')).toBe(true);
    expect(prisma._tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'settled' }) }),
    );
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
