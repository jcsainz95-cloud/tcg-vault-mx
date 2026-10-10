import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { ivaDialsStub } from './helpers/iva-dials';
import { releaseReservationData, reservationGuard } from '../src/modules/orders/reservation';

/**
 * 💰 v1.84 LIVE-4 · TD-4 (API_CONTRACT §14.4) — CAS en los TRES escritores de `failed`.
 *
 * Norma: dentro de la transacción, PRIMERO `order.updateMany({ where: { id, status: 'pending' }, data: { status:
 * 'failed' } })`; si `count === 0` ⇒ ⛔ no se liberan piezas ni apartados de accesorio (otro escritor —liquidación,
 * reembolso, contracargo— ya movió la orden). Solo con `count === 1` se libera con `reservationGuard`.
 *
 * Aquí, la FORMA y el orden (unidad, sin BD). La carrera contra Postgres real (TD4-1…3 con webhook firmado y
 * barrera de fila) vive en `test/integration/td4-failed-cas.e2e-spec.ts`.
 *
 * Mutación que estas pruebas cazan: volver a `order.update({ where: { id } })` (o quitar `status:'pending'` del
 * `where`) en cualquiera de los tres sitios.
 */

const CAS = (id: string) => ({ where: { id, status: 'pending' }, data: { status: 'failed' } });

function build(orderCasCount: number, stripe: Partial<Record<keyof StripeService, jest.Mock>> = {}) {
  const calls: string[] = [];
  const prisma: any = {
    order: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => (calls.push('order.update'), {})),
      updateMany: jest.fn(async () => (calls.push('order.cas'), { count: orderCasCount })),
    },
    inventoryItem: {
      updateMany: jest.fn(async () => (calls.push('items.release'), { count: 1 })),
      findMany: jest.fn(async () => []),
    },
    orderAccessoryLine: {
      findMany: jest.fn(async () => (calls.push('acc.read'), [])),
      updateMany: jest.fn(async () => (calls.push('acc.release'), { count: 0 })),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    // `auditAccessoryReservedDrift` (barrido) — best-effort; sin filas.
    $queryRaw: jest.fn(async () => []),
    accessory: { findMany: jest.fn(async () => []) },
  };
  const svc = new OrdersService(
    prisma as PrismaService,
    {} as never,
    ivaDialsStub() as unknown as SettingsService,
    stripe as unknown as StripeService,
    {} as never,
  );
  return { svc, prisma, calls };
}

const own = (status = 'pending') => ({
  order: {
    id: 'o1',
    orderNumber: 'TCG-000001',
    status,
    stripePaymentIntentId: 'pi_1',
    items: [{ inventoryItemId: 'x' }, { inventoryItemId: 'y' }],
  } as any,
  heldItemIds: ['x', 'y'],
  heldAlive: true,
});

describe('TD4-1 · releaseReservation — CAS `pending → failed`; si no casa, NO libera', () => {
  it('orden ya `settled` (CAS count 0) ⇒ cero liberación de piezas y de apartados, cero `update` por id', async () => {
    const { svc, prisma, calls } = build(0);
    await svc.releaseReservation('o1', ['x', 'y']);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(CAS('o1'));
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderAccessoryLine.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(calls).toEqual(['order.cas']);
  });

  it('control: orden `pending` (count 1) ⇒ CAS PRIMERO y luego libera con la guarda de dueño', async () => {
    const { svc, prisma, calls } = build(1);
    await svc.releaseReservation('o1', ['x', 'y']);
    expect(calls[0]).toBe('order.cas');
    expect(calls).toContain('items.release');
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x', 'y'] }, ...reservationGuard('o1') },
      data: releaseReservationData,
    });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('TD4-2 · supersedeOwnOrder — la vieja pasó a `settled`/`refunded` tras la lectura', () => {
  it('PI cancelado pero el CAS no casa ⇒ no libera, no reescribe, no lanza', async () => {
    const cancelPaymentIntent = jest.fn(async () => ({ status: 'canceled' }));
    const { svc, prisma, calls } = build(0, { cancelPaymentIntent });
    await expect(svc.supersedeOwnOrder(prisma, own())).resolves.toBeUndefined();
    expect(cancelPaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(prisma.order.updateMany).toHaveBeenCalledWith(CAS('o1'));
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderAccessoryLine.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(calls).toEqual(['order.cas']);
  });

  it('control: count 1 ⇒ CAS y liberación con la guarda', async () => {
    const cancelPaymentIntent = jest.fn(async () => ({ status: 'canceled' }));
    const { svc, prisma, calls } = build(1, { cancelPaymentIntent });
    await svc.supersedeOwnOrder(prisma, own());
    expect(calls[0]).toBe('order.cas');
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x', 'y'] }, ...reservationGuard('o1') },
      data: releaseReservationData,
    });
  });
});

describe('TD4-2 · sweepExpiredReservations — leída `pending`, escrita por otro antes de la tx', () => {
  function sweep(casCount: number, status = 'pending') {
    const ctx = build(casCount, {
      cancelPaymentIntent: jest.fn(async () => ({ status: 'canceled' })),
      getPaymentIntentStatus: jest.fn(async () => 'canceled'),
    });
    ctx.prisma.inventoryItem.findMany.mockResolvedValue([{ id: 'a', reservedByOrderId: 'o1' }]);
    ctx.prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      orderNumber: 'TCG-1',
      status,
      stripePaymentIntentId: 'pi_1',
      settledAt: null,
    });
    return ctx;
  }

  it('CAS count 0 ⇒ NO libera piezas ni apartados; `swept: 0`', async () => {
    const { svc, prisma, calls } = sweep(0);
    expect(await svc.sweepExpiredReservations()).toEqual({ swept: 0, skipped: 0, legacy: 0 });
    expect(prisma.order.updateMany).toHaveBeenCalledWith(CAS('o1'));
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderAccessoryLine.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(calls.filter((c) => c !== 'acc.read')).toEqual(['order.cas']);
  });

  it('control: CAS count 1 ⇒ CAS PRIMERO, luego libera; `swept: 1`', async () => {
    const { svc, prisma, calls } = sweep(1);
    expect(await svc.sweepExpiredReservations()).toEqual({ swept: 1, skipped: 0, legacy: 0 });
    expect(calls.filter((c) => c !== 'acc.read').slice(0, 2)).toEqual(['order.cas', 'items.release']);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('sin cambio: una orden YA `failed` con piezas aún reservadas por ella se libera sin CAS ni reescritura', async () => {
    const { svc, prisma } = sweep(0, 'failed');
    expect(await svc.sweepExpiredReservations()).toEqual({ swept: 1, skipped: 0, legacy: 0 });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
  });
});
