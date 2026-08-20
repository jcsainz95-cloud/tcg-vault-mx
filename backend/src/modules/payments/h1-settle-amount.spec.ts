import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { GuestOrderMailService } from '../orders/guest-order-mail.service';
import { AuditService } from '../audit/audit.service';

/**
 * H1 (money-safety) — DEFENSA EN PROFUNDIDAD al liquidar: `onPaymentSucceeded` recibe el
 * PaymentIntent completo y, ANTES de liquidar la Order, asevera `pi.amount === order.totalCents`
 * y `pi.currency === 'mxn'`. Si NO cuadra: NO liquida, AUDITA `order.settle_amount_mismatch` y
 * retorna (200, sin lanzar: un evento que siempre discrepará no debe reintentar).
 */
const VAULT_ORDER = {
  id: 'o1',
  orderNumber: 'TCG-000900',
  fulfillmentMode: 'vault',
  status: 'pending',
  totalCents: 100000,
  items: [{ inventoryItemId: 'item1' }],
};

const pi = (over: { amount?: number; currency?: string } = {}) =>
  ({ id: 'pi_1', amount: over.amount ?? 100000, currency: over.currency ?? 'mxn' } as any);

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
});
