import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import {
  GUEST_ORDER_RESERVATION_TTL_MIN,
} from '../src/modules/orders/guest-checkout.constants';
import {
  ORDER_RESERVATION_TTL_MIN,
  RESERVATION_GATE_NAMESPACE,
  clearReservation,
  lockReservationGate,
  releaseReservationData,
  reservationGateKey,
  reservationGuard,
  reservedUntilFrom,
} from '../src/modules/orders/reservation';

/**
 * v1.68 «LA RESERVA TIENE DUEÑO» (API_CONTRACT §4-R, ARCHITECTURE §4.48.2) — unitarios de CADA guarda.
 * Los candados de conducta contra Postgres real (R-1..R-7, carrera 10/10) viven en
 * `test/integration/checkout-reservation-owner.e2e-spec.ts`; aquí se fija la FORMA de las guardas y
 * las decisiones sin escritura, que es lo que un refactor rompe sin darse cuenta.
 */
describe('orders/reservation.ts — el helper compartido', () => {
  it('el TTL es UNO para las dos rutas: la constante de invitado es un alias (§4-R.1)', () => {
    expect(ORDER_RESERVATION_TTL_MIN).toBe(60);
    expect(GUEST_ORDER_RESERVATION_TTL_MIN).toBe(ORDER_RESERVATION_TTL_MIN);
    const now = new Date('2026-09-11T12:00:00.000Z');
    expect(reservedUntilFrom(now).toISOString()).toBe('2026-09-11T13:00:00.000Z');
  });

  it('reservationGuard(orderId): `reserved` Y (dueño = orden O legada NULL) — la exclusión la da el motor (regla 2)', () => {
    expect(reservationGuard('o1')).toEqual({
      status: 'reserved',
      OR: [{ reservedByOrderId: 'o1' }, { reservedByOrderId: null }],
    });
  });

  it('toda salida de `reserved` LIMPIA dueño y vencimiento; la liberación devuelve la pieza a la plataforma', () => {
    expect(clearReservation).toEqual({ reservedByOrderId: null, reservedUntil: null });
    expect(releaseReservationData).toEqual({
      status: 'listed',
      ownerType: 'platform',
      ownerUserId: null,
      ownershipStatus: null,
      reservedByOrderId: null,
      reservedUntil: null,
    });
  });

  it('la puerta por cliente es un pg_advisory_xact_lock de DOS claves (namespace + hashtext(identidad)), distinta por cliente', async () => {
    const calls: { strings: string[]; values: unknown[] }[] = [];
    const tx = {
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ strings: [...strings], values });
        return 1;
      }),
    };
    await lockReservationGate(tx, { userId: 'u1' });
    await lockReservationGate(tx, { guestEmail: 'a@b.mx' });
    expect(calls[0].strings.join('?')).toContain('pg_advisory_xact_lock(?::int, hashtext(?))');
    expect(calls[0].values).toEqual([RESERVATION_GATE_NAMESPACE, 'user:u1']);
    expect(calls[1].values).toEqual([RESERVATION_GATE_NAMESPACE, 'guest:a@b.mx']);
    expect(reservationGateKey({ userId: 'x' })).not.toBe(reservationGateKey({ guestEmail: 'x' }));
  });
});

function buildOrders(stripe: Partial<Record<keyof StripeService, jest.Mock>> = {}) {
  const prisma: any = {
    order: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    inventoryItem: { updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const svc = new OrdersService(
    prisma as PrismaService,
    {} as never,
    {} as SettingsService,
    stripe as unknown as StripeService,
    {} as never,
  );
  return { svc, prisma };
}

const own = (over: Partial<{ items: string[]; held: string[]; alive: boolean; pi: string | null }> = {}) => ({
  order: {
    id: 'o1',
    orderNumber: 'TCG-000001',
    status: 'pending',
    stripePaymentIntentId: over.pi === undefined ? 'pi_1' : over.pi,
    items: (over.items ?? ['x']).map((inventoryItemId) => ({ inventoryItemId })),
  } as any,
  heldItemIds: over.held ?? over.items ?? ['x'],
  heldAlive: over.alive ?? true,
});

describe('OrdersService.isReusable — REUSO solo con el MISMO carrito, retenido entero y vivo (§4-R.2)', () => {
  const { svc } = buildOrders();
  it('mismo conjunto (en cualquier orden) ⇒ reusable', () => {
    expect(svc.isReusable(own({ items: ['x', 'y'] }), ['y', 'x'])).toBe(true);
  });
  it('carrito con más o menos piezas ⇒ NO (sustitución)', () => {
    expect(svc.isReusable(own({ items: ['x'] }), ['x', 'y'])).toBe(false);
    expect(svc.isReusable(own({ items: ['x', 'y'] }), ['x'])).toBe(false);
  });
  it('alguna pieza de la orden ya no está reservada por ella, o venció ⇒ NO', () => {
    expect(svc.isReusable(own({ items: ['x', 'y'], held: ['x'] }), ['x', 'y'])).toBe(false);
    expect(svc.isReusable(own({ alive: false }), ['x'])).toBe(false);
  });
  it('ids repetidos en el carrito ⇒ NO (conducta de hoy: 404 en loadItems)', () => {
    expect(svc.isReusable(own(), ['x', 'x'])).toBe(false);
  });
});

describe('OrdersService.supersedeOwnOrder — cancelar ANTES de liberar; sin `canceled` no se escribe (R-4)', () => {
  it('PI cancelado ⇒ libera con la guarda de dueño (releaseReservationData) y marca la vieja failed', async () => {
    const cancelPaymentIntent = jest.fn(async () => ({ status: 'canceled' }));
    const { svc, prisma } = buildOrders({ cancelPaymentIntent });
    const calls: string[] = [];
    prisma.inventoryItem.updateMany.mockImplementation(async () => (calls.push('release'), { count: 1 }));
    cancelPaymentIntent.mockImplementation(async () => (calls.push('cancel'), { status: 'canceled' }));
    await svc.supersedeOwnOrder(prisma, own({ items: ['x', 'y'] }));
    expect(calls).toEqual(['cancel', 'release']);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['x', 'y'] }, ...reservationGuard('o1') },
      data: releaseReservationData,
    });
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'failed' } });
  });

  it.each(['processing', 'succeeded', 'requires_capture'])(
    'Stripe reporta %s ⇒ 409 PAYMENT_IN_PROGRESS {orderId, orderNumber} y CERO escritura',
    async (status) => {
      const { svc, prisma } = buildOrders({
        cancelPaymentIntent: jest.fn(async () => {
          throw new Error(`cannot cancel: ${status}`);
        }),
        getPaymentIntentStatus: jest.fn(async () => status),
      });
      await expect(svc.supersedeOwnOrder(prisma, own())).rejects.toMatchObject({
        code: 'PAYMENT_IN_PROGRESS',
        details: { orderId: 'o1', orderNumber: 'TCG-000001' },
      });
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    },
  );

  it('estado indeterminable ⇒ 503 PAYMENT_PROVIDER_UNAVAILABLE y CERO escritura (ante la duda, nada)', async () => {
    const { svc, prisma } = buildOrders({
      cancelPaymentIntent: jest.fn(async () => {
        throw new Error('network');
      }),
      getPaymentIntentStatus: jest.fn(async () => null),
    });
    await expect(svc.supersedeOwnOrder(prisma, own())).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('cancel LANZA pero el PI ya estaba canceled ⇒ sí sustituye', async () => {
    const { svc, prisma } = buildOrders({
      cancelPaymentIntent: jest.fn(async () => {
        throw new Error('already canceled');
      }),
      getPaymentIntentStatus: jest.fn(async () => 'canceled'),
    });
    await svc.supersedeOwnOrder(prisma, own());
    expect(prisma.order.update).toHaveBeenCalled();
  });

  it('orden pending SIN PI (Stripe falló al crearlo) ⇒ se sustituye sin llamar a Stripe', async () => {
    const cancelPaymentIntent = jest.fn();
    const { svc, prisma } = buildOrders({ cancelPaymentIntent });
    await svc.supersedeOwnOrder(prisma, own({ pi: null }));
    expect(cancelPaymentIntent).not.toHaveBeenCalled();
    expect(prisma.order.update).toHaveBeenCalled();
  });
});

describe('OrdersService.releaseReservation — la compensación solo libera lo PROPIO (regla 2)', () => {
  it('el where lleva reservationGuard(orderId) y el data limpia dueño/vencimiento', async () => {
    const { svc, prisma } = buildOrders();
    await svc.releaseReservation('o9', ['a', 'b']);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, ...reservationGuard('o9') },
      data: releaseReservationData,
    });
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o9' }, data: { status: 'failed' } });
  });
});

describe('OrdersService.sweepExpiredReservations — barrido ÚNICO por reservedUntil, B3 primero (§4-R.4)', () => {
  function buildSweep(orders: Record<string, any>, expired: { id: string; reservedByOrderId: string }[]) {
    const calls: string[] = [];
    const cancelPaymentIntent = jest.fn(async () => (calls.push('cancel'), { status: 'canceled' }));
    const { svc, prisma } = buildOrders({
      cancelPaymentIntent,
      getPaymentIntentStatus: jest.fn(async () => 'succeeded'),
    });
    prisma.inventoryItem.findMany.mockImplementation(async ({ where }: any) => {
      expect(where).toMatchObject({ status: 'reserved', reservedByOrderId: { not: null } });
      expect(where.reservedUntil.lt).toBeInstanceOf(Date);
      return expired;
    });
    prisma.inventoryItem.updateMany.mockImplementation(async () => (calls.push('release'), { count: 1 }));
    prisma.order.findUnique.mockImplementation(async ({ where }: any) => orders[where.id] ?? null);
    return { svc, prisma, calls, cancelPaymentIntent };
  }

  it('agrupa por orden (bóveda E invitado por igual): cancela el PI, libera con la guarda y marca failed', async () => {
    const { svc, prisma, calls } = buildSweep(
      {
        o1: { id: 'o1', orderNumber: 'TCG-1', status: 'pending', stripePaymentIntentId: 'pi_1' },
        o2: { id: 'o2', orderNumber: 'TCG-2', status: 'pending', stripePaymentIntentId: 'pi_2' },
      },
      [
        { id: 'a', reservedByOrderId: 'o1' },
        { id: 'b', reservedByOrderId: 'o1' },
        { id: 'c', reservedByOrderId: 'o2' },
      ],
    );
    expect(await svc.sweepExpiredReservations()).toEqual({ swept: 2, skipped: 0 });
    expect(calls).toEqual(['cancel', 'release', 'cancel', 'release']);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, ...reservationGuard('o1') },
      data: releaseReservationData,
    });
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'failed' } });
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o2' }, data: { status: 'failed' } });
  });

  it('B3: si el PI no queda canceled, esa orden NO se libera (skipped) y las demás sí', async () => {
    const { svc, prisma, cancelPaymentIntent } = buildSweep(
      {
        o1: { id: 'o1', orderNumber: 'TCG-1', status: 'pending', stripePaymentIntentId: 'pi_1' },
        o2: { id: 'o2', orderNumber: 'TCG-2', status: 'pending', stripePaymentIntentId: 'pi_2' },
      },
      [
        { id: 'a', reservedByOrderId: 'o1' },
        { id: 'c', reservedByOrderId: 'o2' },
      ],
    );
    cancelPaymentIntent.mockImplementationOnce(async () => {
      throw new Error('already succeeded');
    });
    expect(await svc.sweepExpiredReservations()).toEqual({ swept: 1, skipped: 1 });
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c'] }, ...reservationGuard('o2') } }),
    );
  });

  it('una orden ya `failed` con piezas aún reservadas por ella se libera sin volver a marcarla', async () => {
    const { svc, prisma } = buildSweep(
      { o1: { id: 'o1', orderNumber: 'TCG-1', status: 'failed', stripePaymentIntentId: null } },
      [{ id: 'a', reservedByOrderId: 'o1' }],
    );
    expect(await svc.sweepExpiredReservations()).toEqual({ swept: 1, skipped: 0 });
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});
