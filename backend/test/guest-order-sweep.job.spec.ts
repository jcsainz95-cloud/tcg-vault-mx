import { GuestOrderSweepJobService } from '../src/jobs/guest-order-sweep.service';
import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { GUEST_ORDER_RESERVATION_TTL_MIN } from '../src/modules/orders/guest-checkout.constants';

/**
 * v1.21-guest-checkout — job `guest-order-sweep` (amenaza T9 de ARCHITECTURE §4.21e).
 *
 * Por qué existe: un pedido de invitado `pending` retiene PIEZAS ÚNICAS en `reserved`. Sin
 * barrido, un carrito abandonado tras el 3DS (o un atacante) deja inventario invendible hasta que
 * Stripe cancele el PaymentIntent. Sigue el patrón standalone de `auth-token-sweep`/`buylist-sweep`:
 * un `run()` sin estado que delega la REGLA DE NEGOCIO en `GuestCheckoutService`.
 */
describe('GuestOrderSweepJobService', () => {
  function build(swept = 0) {
    const guestCheckout = {
      sweepStaleGuestOrders: jest.fn().mockResolvedValue({ swept }),
    } as unknown as GuestCheckoutService;
    return { job: new GuestOrderSweepJobService(guestCheckout), guestCheckout };
  }

  it('delega en GuestCheckoutService.sweepStaleGuestOrders y devuelve el conteo', async () => {
    const { job, guestCheckout } = build(3);
    await expect(job.run()).resolves.toEqual({ swept: 3 });
    expect(guestCheckout.sweepStaleGuestOrders).toHaveBeenCalledTimes(1);
  });

  it('propaga el `now` inyectado (determinismo para tests y para un disparo puntual)', async () => {
    const { job, guestCheckout } = build();
    const now = new Date('2026-08-18T10:00:00.000Z');
    await job.run(now);
    expect(guestCheckout.sweepStaleGuestOrders).toHaveBeenCalledWith(now);
  });

  it('no duplica la regla de negocio en `jobs/`: el job no toca Prisma ni Stripe', () => {
    const { job } = build();
    // Única dependencia: el servicio dueño del ciclo del pedido de invitado.
    expect(GuestOrderSweepJobService.length).toBe(1);
    expect(Object.keys(job as unknown as Record<string, unknown>)).toEqual(
      expect.not.arrayContaining(['prisma', 'stripe']),
    );
  });

  it('la ventana de retención sigue siendo la constante de servidor del contrato (60 min)', () => {
    // El cron por defecto (cada 15 min) se elige contra esta ventana: la pieza vuelve a estar
    // vendible poco después de vencer, no al día siguiente.
    expect(GUEST_ORDER_RESERVATION_TTL_MIN).toBe(60);
  });

  it('un fallo del barrido se propaga (BullMQ lo marca `failed` y reintenta; no se traga)', async () => {
    const guestCheckout = {
      sweepStaleGuestOrders: jest.fn().mockRejectedValue(new Error('db caída')),
    } as unknown as GuestCheckoutService;
    const job = new GuestOrderSweepJobService(guestCheckout);
    await expect(job.run()).rejects.toThrow('db caída');
  });
});
