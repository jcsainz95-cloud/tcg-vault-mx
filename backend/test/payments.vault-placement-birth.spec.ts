import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * ⭐⭐ M-59 · §M4-VAULT.2-bis / .6 — el NACIMIENTO de la colocación (unidad, con dobles).
 *
 * Qué fija este archivo (la mitad «forma»; la mitad «Postgres real» —idempotencia bajo carrera
 * forzada, atomicidad y CHECKs— vive en `test/integration/vault-placement-birth.e2e-spec.ts`):
 *
 *  1. La rama `vault` de `onPaymentSucceeded` crea la colocación DENTRO del mismo `$transaction`
 *     que liquida, DESPUÉS del bucle de piezas, con `createMany … skipDuplicates` (⇒ `ON CONFLICT DO
 *     NOTHING`), ⛔ nunca `create` a secas ni `findFirst`+`create`.
 *  2. `VaultPlacement.createdAt` es EL MISMO instante que `Order.settledAt` (un hecho, un instante).
 *  3. El id para las filas por carta sale de `findUniqueOrThrow({ where: { orderId } })` —⛔ no del
 *     retorno de `createMany`—, y hay UNA fila por `OrderItem`, TODAS (⛔ sin filtrar por el estado
 *     de la pieza: una anomalía de settle también tiene su fila), también con `skipDuplicates`.
 *  4. `direct_ship` ⇒ CERO escrituras de colocación.
 *  5. Contracargo `vault` ⇒ `updateMany({ orderId, status:'pending' } → cancelled/chargeback)` en su
 *     MISMA tx, `cancelledByUserId: null`; `count===0` no es error.
 *  6. Contracargo GANADO y reembolso ⇒ ⛔ no crean ni tocan colocación.
 *  7. ⛔ CERO DINERO: la escritura de la orden sigue siendo exactamente `{status, settledAt}`.
 */
const piOf = (id: string, amount = 0) => ({ id, amount, currency: 'mxn' }) as any;

type Call = { op: string; args: any };

function makeHarness() {
  const calls: Call[] = [];
  const rec =
    (op: string, impl: (args: any) => any = () => ({})) =>
    jest.fn(async (args: any) => {
      calls.push({ op, args });
      return impl(args);
    });

  const tx = {
    order: { update: rec('order.update') },
    inventoryItem: {
      findUnique: rec('inventoryItem.findUnique', ({ where }) => ({
        id: where.id,
        status: 'reserved',
        ownerType: 'customer',
        ownerUserId: 'u1',
      })),
      updateMany: rec('inventoryItem.updateMany', () => ({ count: 1 })),
    },
    inventoryMovement: { create: rec('inventoryMovement.create') },
    shipmentItem: { findFirst: rec('shipmentItem.findFirst', () => null) },
    shipmentRequest: {
      findFirst: rec('shipmentRequest.findFirst', () => null),
      create: rec('shipmentRequest.create'),
    },
    vaultPlacement: {
      createMany: rec('vaultPlacement.createMany', () => ({ count: 1 })),
      findUniqueOrThrow: rec('vaultPlacement.findUniqueOrThrow', () => ({ id: 'vp1' })),
      updateMany: rec('vaultPlacement.updateMany', () => ({ count: 1 })),
      create: rec('vaultPlacement.create'),
      findFirst: rec('vaultPlacement.findFirst'),
      upsert: rec('vaultPlacement.upsert'),
    },
    vaultPlacementItem: {
      createMany: rec('vaultPlacementItem.createMany', ({ data }) => ({ count: data.length })),
      create: rec('vaultPlacementItem.create'),
    },
  };
  let inTx = false;
  const prisma: any = {
    order: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    shipmentRequest: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
    // Si algo escribe colocación FUERA de la transacción, esto lo delata.
    vaultPlacement: {
      createMany: rec('OUTSIDE_TX:vaultPlacement.createMany'),
      create: rec('OUTSIDE_TX:vaultPlacement.create'),
      updateMany: rec('OUTSIDE_TX:vaultPlacement.updateMany'),
    },
    vaultPlacementItem: { createMany: rec('OUTSIDE_TX:vaultPlacementItem.createMany') },
    $transaction: jest.fn(async (cb: any) => {
      inTx = true;
      calls.push({ op: 'BEGIN', args: null });
      try {
        return await cb(tx);
      } finally {
        calls.push({ op: 'COMMIT', args: null });
        inTx = false;
      }
    }),
  };
  const payments = new PaymentsService(
    prisma as unknown as PrismaService,
    { getCardDetails: jest.fn().mockResolvedValue(null) } as unknown as StripeService,
    { sendConfirmation: jest.fn().mockResolvedValue(undefined) } as unknown as GuestOrderMailService,
    { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
  );
  // El correo post-commit (AV-2) no es objeto de este archivo.
  jest.spyOn(payments as any, 'notifyOrderSettled').mockResolvedValue(undefined);
  return { calls, tx, prisma, payments, isInTx: () => inTx };
}

const vaultOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  orderNumber: 'TCG-000001',
  userId: 'u1',
  fulfillmentMode: 'vault',
  status: 'pending',
  totalCents: 100000,
  settledAt: null,
  items: [
    { id: 'oi1', inventoryItemId: 'item1' },
    { id: 'oi2', inventoryItemId: 'item2' },
  ],
  ...over,
});

describe('M-59 · nacimiento de la colocación en la rama `vault` de onPaymentSucceeded', () => {
  it('⭐⭐ crea UNA colocación con createMany+skipDuplicates, DENTRO de la tx y DESPUÉS del bucle de piezas', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));

    const ops = h.calls.map((c) => c.op);
    expect(ops.filter((o) => o.startsWith('OUTSIDE_TX'))).toEqual([]);
    // ⛔ ni `create` a secas, ni `findFirst`+`create`, ni `upsert`.
    expect(h.tx.vaultPlacement.create).not.toHaveBeenCalled();
    expect(h.tx.vaultPlacement.findFirst).not.toHaveBeenCalled();
    expect(h.tx.vaultPlacement.upsert).not.toHaveBeenCalled();
    expect(h.tx.vaultPlacementItem.create).not.toHaveBeenCalled();

    expect(h.tx.vaultPlacement.createMany).toHaveBeenCalledTimes(1);
    const arg = h.tx.vaultPlacement.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([{ orderId: 'o1', createdAt: expect.any(Date) }]);

    // Orden de sentencias: BEGIN · order.update · (bucle de piezas) · createMany · findUniqueOrThrow · items · COMMIT
    const iBegin = ops.indexOf('BEGIN');
    const iOrder = ops.indexOf('order.update');
    const iLastMovement = ops.lastIndexOf('inventoryMovement.create');
    const iVp = ops.indexOf('vaultPlacement.createMany');
    const iFind = ops.indexOf('vaultPlacement.findUniqueOrThrow');
    const iItems = ops.indexOf('vaultPlacementItem.createMany');
    const iCommit = ops.indexOf('COMMIT');
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iOrder).toBeGreaterThan(iBegin);
    expect(iLastMovement).toBeGreaterThan(iOrder);
    expect(iVp).toBeGreaterThan(iLastMovement);
    expect(iFind).toBeGreaterThan(iVp);
    expect(iItems).toBeGreaterThan(iFind);
    expect(iCommit).toBeGreaterThan(iItems);
  });

  it('⭐ `createdAt` de la colocación === `settledAt` de la orden (el MISMO instante, no dos `new Date()`)', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));
    const settledAt: Date = h.tx.order.update.mock.calls[0][0].data.settledAt;
    const createdAt: Date = h.tx.vaultPlacement.createMany.mock.calls[0][0].data[0].createdAt;
    expect(settledAt).toBeInstanceOf(Date);
    // Identidad del objeto: la misma constante `now`, no dos relojes que casualmente coinciden.
    expect(createdAt).toBe(settledAt);
  });

  it('⛔ CERO DINERO: la escritura de la orden sigue siendo EXACTAMENTE {status, settledAt}', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));
    expect(h.tx.order.update).toHaveBeenCalledTimes(1);
    expect(h.tx.order.update.mock.calls[0][0]).toEqual({
      where: { id: 'o1' },
      data: { status: 'settled', settledAt: expect.any(Date) },
    });
  });

  it('⭐ filas por carta: el id sale de findUniqueOrThrow por orderId, UNA por OrderItem, con skipDuplicates', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    // El retorno de `createMany` NO sirve para el id: aunque dijera count 0 (fila ya existente), se lee.
    h.tx.vaultPlacement.createMany.mockImplementationOnce(async (args: any) => {
      h.calls.push({ op: 'vaultPlacement.createMany', args });
      return { count: 0 };
    });
    h.tx.vaultPlacement.findUniqueOrThrow.mockImplementationOnce(async (args: any) => {
      h.calls.push({ op: 'vaultPlacement.findUniqueOrThrow', args });
      return { id: 'vp-existente' };
    });
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));

    expect(h.tx.vaultPlacement.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { orderId: 'o1' },
      select: { id: true },
    });
    expect(h.tx.vaultPlacementItem.createMany).toHaveBeenCalledTimes(1);
    expect(h.tx.vaultPlacementItem.createMany.mock.calls[0][0]).toEqual({
      data: [
        { placementId: 'vp-existente', orderItemId: 'oi1', inventoryItemId: 'item1' },
        { placementId: 'vp-existente', orderItemId: 'oi2', inventoryItemId: 'item2' },
      ],
      skipDuplicates: true,
    });
  });

  it('⭐ TODAS las cartas tienen fila, también la que fue anomalía de settle (no se filtra por estado de la pieza)', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    // item2 NO estaba reservada por esta orden: el settle no la mueve (anomalía auditada).
    h.tx.inventoryItem.updateMany.mockImplementation(async (args: any) => {
      h.calls.push({ op: 'inventoryItem.updateMany', args });
      return { count: args.where.id === 'item2' ? 0 : 1 };
    });
    h.tx.inventoryItem.findUnique.mockImplementation(async (args: any) => {
      h.calls.push({ op: 'inventoryItem.findUnique', args });
      return args.where.id === 'item2'
        ? { id: 'item2', status: 'listed', ownerType: 'platform', ownerUserId: null }
        : { id: 'item1', status: 'reserved', ownerType: 'customer', ownerUserId: 'u1' };
    });
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));
    const data = h.tx.vaultPlacementItem.createMany.mock.calls[0][0].data;
    expect(data.map((d: any) => d.orderItemId)).toEqual(['oi1', 'oi2']);
  });

  it('una orden ya `settled` (reintento secuencial) no abre transacción ni toca colocación', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder({ status: 'settled' }));
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.tx.vaultPlacement.createMany).not.toHaveBeenCalled();
  });

  it('descuadre de monto (H1) ⇒ no liquida y NO crea colocación', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    await h.payments.onPaymentSucceeded(piOf('pi_1', 99999));
    expect(h.tx.vaultPlacement.createMany).not.toHaveBeenCalled();
  });

  it('si crear la colocación FALLA, la excepción sube (la tx revierte: no hay liquidación sin colocación)', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder());
    h.tx.vaultPlacementItem.createMany.mockRejectedValueOnce(new Error('boom'));
    await expect(h.payments.onPaymentSucceeded(piOf('pi_1', 100000))).rejects.toThrow('boom');
  });
});

describe('M-59 · `direct_ship` NUNCA tiene colocación', () => {
  it('liquidar un `direct_ship` no escribe VaultPlacement ni VaultPlacementItem', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(
      vaultOrder({ fulfillmentMode: 'direct_ship', userId: null, stripePaymentIntentId: 'pi_1' }),
    );
    await h.payments.onPaymentSucceeded(piOf('pi_1', 100000));
    expect(h.tx.shipmentRequest.create).toHaveBeenCalledTimes(1); // sí liquidó (control)
    expect(h.calls.filter((c) => c.op.includes('vaultPlacement'))).toEqual([]);
  });
});

describe('M-59 · §M4-VAULT.6 — contracargo y otros cierres', () => {
  it('⭐⭐ contracargo `vault` ⇒ cancela la colocación PENDIENTE en su MISMA tx, al final, sin actor', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder({ status: 'settled' }));
    h.tx.inventoryItem.findUnique.mockImplementation(async (args: any) => {
      h.calls.push({ op: 'inventoryItem.findUnique', args });
      return { id: args.where.id, status: 'in_custody', ownerType: 'customer', ownerUserId: 'u1' };
    });
    await h.payments.onChargeDispute({ payment_intent: 'pi_1' } as any);

    expect(h.calls.filter((c) => c.op.startsWith('OUTSIDE_TX'))).toEqual([]);
    expect(h.tx.vaultPlacement.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.vaultPlacement.updateMany.mock.calls[0][0]).toEqual({
      where: { orderId: 'o1', status: 'pending' },
      data: {
        status: 'cancelled',
        cancelledAt: expect.any(Date),
        cancelledByUserId: null,
        cancelReason: 'chargeback',
      },
    });
    const ops = h.calls.map((c) => c.op);
    const iCancel = ops.indexOf('vaultPlacement.updateMany');
    expect(iCancel).toBeGreaterThan(ops.lastIndexOf('inventoryItem.updateMany'));
    expect(iCancel).toBeLessThan(ops.indexOf('COMMIT'));
  });

  it('contracargo cuando ya no hay colocación pendiente (count 0) NO es error', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder({ status: 'settled' }));
    h.tx.vaultPlacement.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.payments.onChargeDispute({ payment_intent: 'pi_1' } as any)).resolves.toBeUndefined();
    expect(h.tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'chargeback' }) }),
    );
  });

  it('contracargo `direct_ship` ⇒ ⛔ no toca colocaciones', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(
      vaultOrder({ status: 'settled', fulfillmentMode: 'direct_ship', userId: null, shipmentRequests: [] }),
    );
    await h.payments.onChargeDispute({ payment_intent: 'pi_1' } as any).catch(() => undefined);
    expect(h.calls.filter((c) => c.op.includes('vaultPlacement'))).toEqual([]);
  });

  it('contracargo GANADO ⇒ ⛔ no crea ni reabre la colocación', async () => {
    const h = makeHarness();
    h.prisma.order.findUnique.mockResolvedValue(vaultOrder({ status: 'chargeback', settledAt: new Date() }));
    await h.payments.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'won' } as any);
    expect(h.calls.filter((c) => c.op.includes('vaultPlacement'))).toEqual([]);
  });
});
