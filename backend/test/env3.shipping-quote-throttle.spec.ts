import 'reflect-metadata';
import { GuestOrdersController } from '../src/modules/orders/guest-orders.controller';

/** §ENV3 (DECISIONES punto 4): `POST /checkout/shipping-quote` es público y lleva throttle propio 20/min por IP. */
describe('§ENV3 shipping-quote — throttle público', () => {
  it('20/min', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', GuestOrdersController.prototype.shippingQuote)).toBe(20);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', GuestOrdersController.prototype.shippingQuote)).toBe(60_000);
  });
  it('es @Public (sin JWT) y NO rechaza sesiones válidas (lo pide también el checkout con cuenta)', () => {
    expect(Reflect.getMetadata('isPublic', GuestOrdersController.prototype.shippingQuote)).toBe(true);
    expect(Reflect.getMetadata('__guards__', GuestOrdersController.prototype.shippingQuote)).toBeUndefined();
  });
});
