import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { PasswordChangeRequiredGuard } from '../src/common/guards/password-change-required.guard';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import {
  ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
  AllowPasswordChangeRequired,
} from '../src/common/decorators/allow-password-change-required.decorator';
import { BusinessException } from '../src/common/business.exception';
import { AppModule } from '../src/app.module';
import { AuthController } from '../src/modules/auth/auth.controller';

/**
 * v1.67 (Stream A · B2, contrato §0 `PASSWORD_CHANGE_REQUIRED` / §1 «Contraseña temporal obligatoria»,
 * ARCHITECTURE §4.47.2) — **la temporal OBLIGA** (decisión del dueño 2026-09-11).
 *
 *  - `req.user.mustChangePassword === true` en ruta sin `@AllowPasswordChangeRequired()` ⇒ 403
 *    PASSWORD_CHANGE_REQUIRED con `details: {}`. ⛔ NO es 401 (el cliente cerraría la sesión).
 *  - Con el decorador ⇒ pasa. Sin flag ⇒ pasa. Sin `req.user` (ruta @Public) ⇒ pasa.
 *  - El decorador se lee por handler y por clase (`getAllAndOverride`), como sus hermanos.
 *  - Cadena `APP_GUARD`: Jwt → PasswordChangeRequired → Roles (orden normativo del contrato).
 *  - Allowlist del módulo `auth`: `change-password` y `logout` SÍ; `verify-email/resend` NO.
 */
function ctx(
  user: { mustChangePassword?: boolean } | undefined,
  handler: object = {},
  cls: object = {},
): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

describe('PasswordChangeRequiredGuard', () => {
  let reflector: Reflector;
  let guard: PasswordChangeRequiredGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PasswordChangeRequiredGuard(reflector);
  });

  it('flag activo + ruta NO exenta ⇒ 403 PASSWORD_CHANGE_REQUIRED, details {} (nunca 401)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    let err: unknown;
    try {
      guard.canActivate(ctx({ mustChangePassword: true }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BusinessException);
    const be = err as BusinessException;
    expect(be.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(be.getStatus()).toBe(403);
    expect(be.getStatus()).not.toBe(401);
    expect(be.details).toEqual({});
  });

  it('flag activo + ruta exenta (@AllowPasswordChangeRequired) ⇒ pasa', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(ctx({ mustChangePassword: true }))).toBe(true);
  });

  it('flag apagado ⇒ pasa sin consultar el decorador', () => {
    const spy = jest.spyOn(reflector, 'getAllAndOverride');
    expect(guard.canActivate(ctx({ mustChangePassword: false }))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sin `req.user` (ruta @Public: login/google/refresh) ⇒ pasa', () => {
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('flag ausente en req.user (undefined) ⇒ pasa (solo `=== true` bloquea)', () => {
    expect(guard.canActivate(ctx({}))).toBe(true);
  });

  it('lee la metadata REAL del decorador (handler y clase, en ese orden)', () => {
    // Sin mocks del reflector: un handler decorado de verdad debe pasar, uno sin decorar no.
    class Ctl {
      @AllowPasswordChangeRequired()
      exempt() {}
      plain() {}
    }
    expect(Reflect.getMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, Ctl.prototype.exempt)).toBe(true);
    expect(guard.canActivate(ctx({ mustChangePassword: true }, Ctl.prototype.exempt, Ctl))).toBe(true);
    expect(() => guard.canActivate(ctx({ mustChangePassword: true }, Ctl.prototype.plain, Ctl))).toThrow(
      BusinessException,
    );
  });
});

describe('Cadena APP_GUARD — orden normativo (contrato §1, app.module.ts)', () => {
  it('PasswordChangeRequiredGuard va INMEDIATAMENTE después de JwtAuthGuard y antes de RolesGuard', () => {
    const providers = (Reflect.getMetadata('providers', AppModule) ?? []) as Array<{
      provide?: unknown;
      useClass?: unknown;
    }>;
    const guards = providers.filter((p) => p && p.provide === APP_GUARD).map((p) => p.useClass);
    const jwt = guards.indexOf(JwtAuthGuard);
    const pcr = guards.indexOf(PasswordChangeRequiredGuard);
    const roles = guards.indexOf(RolesGuard);
    expect(jwt).toBeGreaterThanOrEqual(0);
    expect(pcr).toBe(jwt + 1);
    expect(roles).toBe(pcr + 1);
  });
});

describe('Allowlist cerrada — módulo `auth` (contrato §1: tres rutas exactas)', () => {
  const allowed = (fn: unknown) =>
    Reflect.getMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, fn as object) === true;

  it('POST /auth/change-password está exento (es la salida)', () => {
    expect(allowed(AuthController.prototype.changePassword)).toBe(true);
  });

  it('POST /auth/logout está exento (rendirse siempre se permite)', () => {
    expect(allowed(AuthController.prototype.logout)).toBe(true);
  });

  it('POST /auth/verify-email/resend NO está exento (fuera de la lista cerrada)', () => {
    expect(allowed(AuthController.prototype.resendVerification)).toBe(false);
  });

  it('el decorador NO está a nivel de clase en AuthController (se aplica por handler)', () => {
    expect(Reflect.getMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, AuthController)).toBeUndefined();
  });
});
