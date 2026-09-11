import { OrderReservationSweepJobService } from '../src/jobs/order-reservation-sweep.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';

/**
 * v1.68 (§4-R.4) — job `order-reservation-sweep` (sustituye a `guest-order-sweep`, T9; cierra D-SB-1).
 * Encadena el barrido ÚNICO por `reservedUntil` (OrdersService) y la rama LEGADA de invitados sin
 * dueño (GuestCheckoutService). Sin estado; la regla de negocio no vive en `jobs/`.
 */
describe('OrderReservationSweepJobService', () => {
  function build(main = { swept: 0, skipped: 0 }, legacy = { swept: 0 }) {
    const orders = { sweepExpiredReservations: jest.fn().mockResolvedValue(main) } as unknown as OrdersService;
    const guest = { sweepStaleGuestOrders: jest.fn().mockResolvedValue(legacy) } as unknown as GuestCheckoutService;
    return { job: new OrderReservationSweepJobService(orders, guest), orders, guest };
  }

  it('corre el barrido por vencimiento y DESPUÉS la rama legada, con el mismo `now`', async () => {
    const { job, orders, guest } = build({ swept: 2, skipped: 1 }, { swept: 3 });
    const now = new Date('2026-09-11T10:00:00.000Z');
    await expect(job.run(now)).resolves.toEqual({ swept: 2, skipped: 1, legacySwept: 3 });
    expect(orders.sweepExpiredReservations).toHaveBeenCalledWith(now);
    expect(guest.sweepStaleGuestOrders).toHaveBeenCalledWith(now);
    const mainOrder = (orders.sweepExpiredReservations as jest.Mock).mock.invocationCallOrder[0];
    const legacyOrder = (guest.sweepStaleGuestOrders as jest.Mock).mock.invocationCallOrder[0];
    expect(mainOrder).toBeLessThan(legacyOrder);
  });

  it('no duplica la regla de negocio en `jobs/`: el job no toca Prisma ni Stripe', () => {
    const { job } = build();
    expect(Object.keys(job as unknown as Record<string, unknown>)).toEqual(
      expect.not.arrayContaining(['prisma', 'stripe']),
    );
  });

  it('un fallo del barrido se propaga (BullMQ lo marca `failed` y reintenta; no se traga)', async () => {
    const { job, orders } = build();
    (orders.sweepExpiredReservations as jest.Mock).mockRejectedValue(new Error('db caída'));
    await expect(job.run()).rejects.toThrow('db caída');
  });
});
