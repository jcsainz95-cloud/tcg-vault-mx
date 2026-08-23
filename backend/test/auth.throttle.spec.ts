import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { AuthController } from '../src/modules/auth/auth.controller';
import { WebhooksController } from '../src/modules/payments/webhooks.controller';
import { AppThrottlerGuard } from '../src/common/guards/app-throttler.guard';

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

  // forgot-password tiene la VENTANA MÁS ESTRECHA de la app: 3 por HORA (ttl 3_600_000 ms),
  // no por minuto. Es el endpoint más frágil si el tracker del throttler no distingue clientes:
  // basta que la IP percibida colapse (proxy sin `trust proxy`, ver main.ts) para agotar el
  // cubo con tráfico mínimo y devolver 429 (que el front muestra como el 200 anti-enumeración
  // → el correo de reset nunca se intenta). Este candado documenta la fragilidad del límite.
  it('forgot-password está limitado a 3 por HORA (ventana más estrecha de la app)', () => {
    expect(limit(AuthController.prototype.forgotPassword)).toBe(3);
    expect(ttl(AuthController.prototype.forgotPassword)).toBe(60 * 60 * 1000);
  });

  it('el webhook de Stripe se exime del throttling global (@SkipThrottle)', () => {
    // SkipThrottle a nivel de clase → metadata THROTTLER:SKIPdefault=true en el constructor.
    const skip = Reflect.getMetadata('THROTTLER:SKIPdefault', WebhooksController);
    expect(skip).toBe(true);
  });
});

/**
 * AppThrottlerGuard (arreglo CI 2026-08-18): el guard se OMITE solo bajo `NODE_ENV=test` — los
 * límites de arriba siguen intactos y en cualquier entorno real el guard se comporta como el
 * `ThrottlerGuard` de Nest. El candado de que nada de esto aplica fuera de test está en
 * `test/test-env.spec.ts`; el 429 real se verifica en `test/integration/auth-throttle.e2e-spec.ts`.
 */
describe('AppThrottlerGuard — skip acotado al entorno de test', () => {
  const build = () => new AppThrottlerGuard({ throttlers: [] } as any, {} as any, {} as any);
  const shouldSkip = (g: AppThrottlerGuard) =>
    (g as unknown as { shouldSkip(c: ExecutionContext): Promise<boolean> }).shouldSkip(
      {} as ExecutionContext,
    );

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.E2E_ENABLE_THROTTLER;
  });

  it('bajo NODE_ENV=test omite el rate-limiting (suite determinista)', async () => {
    process.env.NODE_ENV = 'test';
    await expect(shouldSkip(build())).resolves.toBe(true);
  });

  it('en producción NO omite nada: delega en el ThrottlerGuard de Nest', async () => {
    process.env.NODE_ENV = 'production';
    // El super de Nest consulta metadata del handler; con un contexto vacío devuelve false
    // (= no se salta) o revienta, pero NUNCA true por nuestra causa.
    const skip = await shouldSkip(build()).catch(() => false);
    expect(skip).toBe(false);
  });
});
