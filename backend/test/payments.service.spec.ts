import { Prisma } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * H1: `onPaymentSucceeded` recibe el PaymentIntent completo. Helper para construir uno que CUADRE
 * (monto/moneda) con la orden que se va a liquidar; la aserción de defensa en profundidad exige
 * `pi.amount === order.totalCents` y `pi.currency === 'mxn'`.
 */
const piOf = (id: string, amount = 0) => ({ id, amount, currency: 'mxn' } as any);

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
      findUnique: jest.fn().mockResolvedValue({ id: 'item1', status: 'in_custody', ownerType: 'customer' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
    // Fix 4: por defecto la carta NO tiene envío enviado/entregado (sigue en bóveda).
    shipmentItem: { findFirst: jest.fn().mockResolvedValue(null) },
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
    // v1.21-guest-checkout: 3ª dependencia (correo del invitado). Este bloque solo cubre la ruta
    // de BÓVEDA, que nunca la usa; se pasa un stub inerte.
    payments = new PaymentsService(
      prisma as unknown as PrismaService,
      {} as StripeService,
      { sendConfirmation: jest.fn() } as unknown as GuestOrderMailService,
      { log: jest.fn() } as unknown as AuditService,
    );
  });

  it('payment_intent.succeeded → Order settled + items ownershipStatus settled', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      // v1.21.2 (D4): el reverso del contracargo ramifica por `fulfillmentMode`; en BD la
      // columna es NOT NULL con default `vault`, así que el fixture lo hace explícito.
      fulfillmentMode: 'vault',
      status: 'pending',
      totalCents: 100000,
      items: [{ inventoryItemId: 'item1' }],
    });
    await payments.onPaymentSucceeded(piOf('pi_1', 100000));
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
      // v1.21.2 (D4): el reverso del contracargo ramifica por `fulfillmentMode`; en BD la
      // columna es NOT NULL con default `vault`, así que el fixture lo hace explícito.
      fulfillmentMode: 'vault',
      status: 'pending',
      totalCents: 100000,
      items: [{ inventoryItemId: 'item1' }],
    });
    const evt = {
      id: 'evt_dup',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount: 100000, currency: 'mxn' } },
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
      data: { object: { id: 'pi_1', amount: 100000, currency: 'mxn' } },
    } as any;

    await expect(payments.handleEvent(evt)).rejects.toThrow('DB down');
    // La marca de idempotencia se revirtió → el evento NO quedó como procesado.
    expect(processedIds.has('evt_fail')).toBe(false);
    expect(prisma.processedStripeEvent.delete).toHaveBeenCalledWith({ where: { id: 'evt_fail' } });

    // Reintento de Stripe: ahora sí procesa y liquida.
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      // v1.21.2 (D4): el reverso del contracargo ramifica por `fulfillmentMode`; en BD la
      // columna es NOT NULL con default `vault`, así que el fixture lo hace explícito.
      fulfillmentMode: 'vault',
      status: 'pending',
      totalCents: 100000,
      items: [{ inventoryItemId: 'item1' }],
    });
    await payments.handleEvent(evt);
    expect(processedIds.has('evt_fail')).toBe(true);
    expect(prisma._tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'settled' }) }),
    );
  });

  it('already-settled order is not re-processed', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', fulfillmentMode: 'vault', status: 'settled', items: [] });
    await payments.onPaymentSucceeded(piOf('pi_1'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('Fix 4: contracargo con carta EN BÓVEDA → chargeback + revierte a plataforma (no manual)', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      // v1.21.2 (D4): el reverso del contracargo ramifica por `fulfillmentMode`; en BD la
      // columna es NOT NULL con default `vault`, así que el fixture lo hace explícito.
      fulfillmentMode: 'vault',
      status: 'settled',
      items: [{ inventoryItemId: 'item1' }],
    });
    // No hay envío enviado/entregado → sigue en bóveda (shipmentItem.findFirst = null por defecto).
    await payments.onChargeDispute({ payment_intent: 'pi_1' } as any);
    const tx = prisma._tx;
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'chargeback', chargebackNeedsManual: false } }),
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

  it('Fix 4: contracargo con carta ENVIADA/ENTREGADA → NO re-agrega + flag manual', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      // v1.21.2 (D4): el reverso del contracargo ramifica por `fulfillmentMode`; en BD la
      // columna es NOT NULL con default `vault`, así que el fixture lo hace explícito.
      fulfillmentMode: 'vault',
      status: 'settled',
      items: [{ inventoryItemId: 'item1' }],
    });
    // La carta ya salió: existe un ShipmentItem con envío entregado.
    prisma._tx.shipmentItem.findFirst.mockResolvedValue({ id: 'si1' });
    await payments.onChargeDispute({ payment_intent: 'pi_1' } as any);
    const tx = prisma._tx;
    // NO se re-agrega al inventario (no la tenemos).
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    // Orden en chargeback + marcada para gestión manual.
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'chargeback', chargebackNeedsManual: true } }),
    );
  });

  it('Fix 5: charge.dispute.closed won → Order settled (item se queda en inventario)', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', fulfillmentMode: 'vault', status: 'chargeback', settledAt: new Date() });
    await payments.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'won' } as any);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({ status: 'settled', disputeOutcome: 'won', chargebackNeedsManual: false }),
      }),
    );
  });

  it('Fix 5: charge.dispute.funds_reinstated → tratado como won (settled)', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', fulfillmentMode: 'vault', status: 'chargeback', settledAt: null });
    // funds_reinstated fuerza 'won' aunque el status del objeto no sea 'won'.
    await payments.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'under_review' } as any, 'won');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'settled', disputeOutcome: 'won' }) }),
    );
  });

  it('Fix 5: charge.dispute.closed lost → Order chargeback terminal', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', fulfillmentMode: 'vault', status: 'chargeback' });
    await payments.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'lost' } as any);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'chargeback', disputeOutcome: 'lost' }),
      }),
    );
  });

  it('M2: reembolso PARCIAL no cambia el estado de la orden', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', fulfillmentMode: 'vault', status: 'settled' });
    await payments.onChargeRefunded({ payment_intent: 'pi_1', amount: 100000, amount_refunded: 40000 } as any);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('M2/A1: reembolso TOTAL → refunded, SIN re-agregar item al inventario', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', fulfillmentMode: 'vault', status: 'settled' });
    await payments.onChargeRefunded({ payment_intent: 'pi_1', amount: 100000, amount_refunded: 100000 } as any);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'refunded' }) }),
    );
    // A1: VENTAS FINALES → el item NO se revierte al inventario en el refund.
    expect(prisma._tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma._tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('B5: payment_intent.canceled → libera la reserva (reserved→listed) + Order failed', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      // v1.21.2 (D4): el reverso del contracargo ramifica por `fulfillmentMode`; en BD la
      // columna es NOT NULL con default `vault`, así que el fixture lo hace explícito.
      fulfillmentMode: 'vault',
      status: 'pending',
      items: [{ inventoryItemId: 'item1' }],
    });
    await payments.onPaymentCanceled('pi_1');
    const tx = prisma._tx;
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: { status: 'failed' } }),
    );
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'item1', status: 'reserved' },
        data: expect.objectContaining({ status: 'listed', ownershipStatus: null }),
      }),
    );
  });

  it('B5: payment_intent.canceled de un envío solicitado → lo cancela (libera items)', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    prisma.shipmentRequest.findUnique.mockResolvedValue({ id: 's1', status: 'solicitado' });
    await payments.onPaymentCanceled('pi_ship');
    expect(prisma.shipmentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: { status: 'cancelado' } }),
    );
  });

  it('payment for a shipment advances solicitado → picking', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    prisma.shipmentRequest.findUnique.mockResolvedValue({ id: 's1', status: 'solicitado' });
    await payments.onPaymentSucceeded(piOf('pi_ship'));
    expect(prisma.shipmentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: expect.objectContaining({ status: 'picking' }) }),
    );
  });
});
