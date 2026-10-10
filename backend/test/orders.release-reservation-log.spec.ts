import { Logger } from '@nestjs/common';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * 💰 v1.84 LIVE-4 · condición C-2 (d) del techlead (D-2): `releaseReservation` sigue tragándose el fallo de su
 * transacción (conducta SIN cambiar: la compensación A2 es best-effort y el barrido la reintenta), pero ⛔ ya no en
 * silencio: deja un log estructurado (`event`, `orderId`, `itemCount`, `error`) a nivel `error`.
 *
 * Mutación que esto caza: volver a `.catch(() => undefined)`.
 */
function build(tx: jest.Mock) {
  const prisma: any = { $transaction: tx };
  const svc = new OrdersService(
    prisma as PrismaService,
    {} as never,
    ivaDialsStub() as unknown as SettingsService,
    {} as unknown as StripeService,
    {} as never,
  );
  return svc;
}

describe('D-2 · releaseReservation — el fallo se registra, la conducta no cambia', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('la tx falla ⇒ resuelve sin lanzar y deja UN log estructurado con orderId, itemCount y el error', async () => {
    const svc = build(jest.fn(async () => Promise.reject(new Error('P1001: Can\'t reach database server'))));
    await expect(svc.releaseReservation('o1', ['x', 'y'])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(payload).toEqual({
      event: 'orders.release_reservation_failed',
      orderId: 'o1',
      itemCount: 2,
      error: "P1001: Can't reach database server",
    });
  });

  it('control: la tx va bien ⇒ cero logs de error', async () => {
    const svc = build(jest.fn(async () => undefined));
    await svc.releaseReservation('o1', ['x']);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
