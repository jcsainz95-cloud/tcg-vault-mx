import 'reflect-metadata';
import { AuthController } from '../src/modules/auth/auth.controller';
import { WebhooksController } from '../src/modules/payments/webhooks.controller';

/**
 * SEC-C1: los endpoints de auth sensibles llevan rate-limit estrecho (@Throttle) para
 * frenar la fuerza bruta de login que era el vector de toma de cuenta admin. El webhook
 * de Stripe queda eximido del throttling (@SkipThrottle) por ser tráfico legítimo firmado.
 */
describe('Auth rate-limiting — SEC-C1', () => {
  const limit = (fn: unknown) => Reflect.getMetadata('THROTTLER:LIMITdefault', fn as object);
  const ttl = (fn: unknown) => Reflect.getMetadata('THROTTLER:TTLdefault', fn as object);

  it('login está limitado a 5 intentos por minuto', () => {
    expect(limit(AuthController.prototype.login)).toBe(5);
    expect(ttl(AuthController.prototype.login)).toBe(60_000);
  });

  it('register está limitado a 5 por minuto', () => {
    expect(limit(AuthController.prototype.register)).toBe(5);
  });

  it('refresh tiene un límite propio (más holgado que login)', () => {
    expect(limit(AuthController.prototype.refresh)).toBe(20);
  });

  it('el webhook de Stripe se exime del throttling global (@SkipThrottle)', () => {
    // SkipThrottle a nivel de clase → metadata THROTTLER:SKIPdefault=true en el constructor.
    const skip = Reflect.getMetadata('THROTTLER:SKIPdefault', WebhooksController);
    expect(skip).toBe(true);
  });
});
