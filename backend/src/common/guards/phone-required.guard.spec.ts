import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PhoneRequiredGuard } from './phone-required.guard';
import { RequirePhone } from '../decorators/require-phone.decorator';
import { BusinessException } from '../business.exception';

class Plain {
  handler() {}
}
class WithHandler {
  @RequirePhone()
  handler() {}
}
@RequirePhone()
class WithClass {
  handler() {}
}

const ctx = (cls: new () => { handler(): void }, user: unknown): ExecutionContext =>
  ({
    getHandler: () => cls.prototype.handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PhoneRequiredGuard (§CELULAR, SC-1)', () => {
  const guard = new PhoneRequiredGuard(new Reflector());

  it('ruta sin @RequirePhone ⇒ pasa aunque no haya celular ni usuario', () => {
    expect(guard.canActivate(ctx(Plain, { phone: null }))).toBe(true);
    expect(guard.canActivate(ctx(Plain, undefined))).toBe(true);
  });

  it.each([null, undefined, '', 'abc', '5555555555', '1234567890', '0123456789', '12345'])(
    'con @RequirePhone y celular %j ⇒ 422 PHONE_REQUIRED',
    (phone) => {
      for (const cls of [WithHandler, WithClass]) {
        let err: unknown;
        try {
          guard.canActivate(ctx(cls, { phone }));
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(BusinessException);
        expect((err as BusinessException).getStatus()).toBe(422);
        expect((err as BusinessException).code).toBe('PHONE_REQUIRED');
      }
    },
  );

  it('con @RequirePhone y celular válido (también con +52) ⇒ pasa', () => {
    expect(guard.canActivate(ctx(WithHandler, { phone: '5512345678' }))).toBe(true);
    expect(guard.canActivate(ctx(WithClass, { phone: '+52 55 1234 5678' }))).toBe(true);
  });

  it('con @RequirePhone y sin usuario ⇒ 401 UNAUTHENTICATED', () => {
    let err: unknown;
    try {
      guard.canActivate(ctx(WithHandler, undefined));
    } catch (e) {
      err = e;
    }
    expect((err as BusinessException).getStatus()).toBe(401);
    expect((err as BusinessException).code).toBe('UNAUTHENTICATED');
  });
});
