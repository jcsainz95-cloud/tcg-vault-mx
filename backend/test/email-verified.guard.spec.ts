import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EmailVerifiedGuard } from '../src/common/guards/email-verified.guard';
import { BusinessException } from '../src/common/business.exception';

/**
 * v1.5 — EmailVerifiedGuard: gating server-side de acciones sensibles (comprar/retirar/vender).
 *  - emailVerified=false en ruta marcada → 403 EMAIL_NOT_VERIFIED.
 *  - emailVerified=true → pasa.
 *  - ruta NO marcada → pasa (no restringe).
 */
function ctx(user: { emailVerified?: boolean } | undefined): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('EmailVerifiedGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  it('bloquea con 403 EMAIL_NOT_VERIFIED si el usuario no está verificado', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new EmailVerifiedGuard(reflector);
    try {
      guard.canActivate(ctx({ emailVerified: false }));
      fail('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(BusinessException);
      expect((e as BusinessException).code).toBe('EMAIL_NOT_VERIFIED');
      expect((e as BusinessException).getStatus()).toBe(403);
    }
  });

  it('deja pasar a un usuario verificado', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new EmailVerifiedGuard(reflector);
    expect(guard.canActivate(ctx({ emailVerified: true }))).toBe(true);
  });

  it('no restringe rutas sin @RequireEmailVerified()', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new EmailVerifiedGuard(reflector);
    expect(guard.canActivate(ctx({ emailVerified: false }))).toBe(true);
  });
});
