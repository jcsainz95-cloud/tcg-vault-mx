import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { GuestOrderMailService } from '../orders/guest-order-mail.service';
import { AuditService } from '../audit/audit.service';

/**
 * H1 (money-safety) — DEFENSA EN PROFUNDIDAD al liquidar: `onPaymentSucceeded` recibe el
 * PaymentIntent completo y, ANTES de liquidar la Order, asevera que el monto CAPTURADO cuadra:
 * `(pi.amount_received ?? pi.amount) === order.totalCents` y `pi.currency === 'mxn'`. Se prefiere
 * `amount_received` (lo efectivamente capturado en un PI `succeeded`) sobre `amount` (lo
 * solicitado) porque con captura parcial `amount` seguiría cuadrando aunque entrara menos dinero.
 * Si NO cuadra: NO liquida, AUDITA `order.settle_amount_mismatch` y retorna (200, sin lanzar: un
 * evento que siempre discrepará no debe reintentar).
 */
const VAULT_ORDER = {
  id: 'o1',
  orderNumber: 'TCG-000900',
  fulfillmentMode: 'vault',
  status: 'pending',
  totalCents: 100000,
  items: [{ inventoryItemId: 'item1' }],
};

const pi = (over: { amount?: number; amount_received?: number; currency?: string } = {}) =>
  ({
    id: 'pi_1',
    amount: over.amount ?? 100000,
    ...(over.amount_received !== undefined ? { amount_received: over.amount_received } : {}),
    currency: over.currency ?? 'mxn',
  } as any);

function build(order: any = VAULT_ORDER) {
  const tx: any = {
    order: { update: jest.fn().mockResolvedValue({}) },
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue({ id: 'item1', status: 'reserved', ownerType: 'customer' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
    shipmentItem: { findFirst: jest.fn().mockResolvedValue(null) },
    shipmentRequest: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    _tx: tx,
    order: { findUnique: jest.fn(async () => order), update: jest.fn().mockResolvedValue({}) },
    shipmentRequest: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const svc = new PaymentsService(
    prisma as PrismaService,
    {} as StripeService,
    { sendConfirmation: jest.fn() } as unknown as GuestOrderMailService,
    audit as AuditService,
  );
  return { svc, prisma, tx, audit };
}

describe('H1 — asevera monto/moneda antes de liquidar', () => {
  it('amount y currency correctos → liquida (status settled escrito), sin auditar descuadre', async () => {
    const { svc, tx, audit } = build();
    await svc.onPaymentSucceeded(pi());
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'settled' }) }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('amount distinto → NO liquida, audita order.settle_amount_mismatch y no escribe settled', async () => {
    const { svc, prisma, tx, audit } = build();
    await svc.onPaymentSucceeded(pi({ amount: 999 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.settle_amount_mismatch',
        entityType: 'Order',
        entityId: 'o1',
        after: expect.objectContaining({
          expectedCents: 100000,
          receivedCents: 999,
          expectedCurrency: 'mxn',
          receivedCurrency: 'mxn',
        }),
      }),
    );
  });

  it('currency !== mxn → NO liquida (aunque el monto cuadre) y audita el descuadre', async () => {
    const { svc, prisma, tx, audit } = build();
    await svc.onPaymentSucceeded(pi({ amount: 100000, currency: 'usd' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.settle_amount_mismatch',
        after: expect.objectContaining({ receivedCurrency: 'usd' }),
      }),
    );
  });

  it('no lanza ante descuadre (200 + marcador de idempotencia queda): resuelve undefined', async () => {
    const { svc } = build();
    await expect(svc.onPaymentSucceeded(pi({ amount: 1 }))).resolves.toBeUndefined();
  });

  it('prefiere amount_received (capturado): captura PARCIAL con amount cuadrando → NO liquida', async () => {
    const { svc, prisma, tx, audit } = build();
    // `amount` (solicitado) cuadra, pero solo se capturaron 60000: el dinero que entró NO cuadra.
    await svc.onPaymentSucceeded(pi({ amount: 100000, amount_received: 60000 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.settle_amount_mismatch',
        after: expect.objectContaining({ expectedCents: 100000, receivedCents: 60000 }),
      }),
    );
  });

  it('amount_received cuadra aunque amount venga distinto → liquida (manda lo capturado)', async () => {
    const { svc, tx, audit } = build();
    await svc.onPaymentSucceeded(pi({ amount: 999999, amount_received: 100000 }));
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' }, data: expect.objectContaining({ status: 'settled' }) }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('amount_received = 0 NO cae al fallback (`??`, no `||`): NO liquida', async () => {
    const { svc, prisma, tx } = build();
    await svc.onPaymentSucceeded(pi({ amount: 100000, amount_received: 0 }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
