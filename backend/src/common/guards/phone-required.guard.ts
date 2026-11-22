import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PHONE_KEY } from '../decorators/require-phone.decorator';
import { BusinessException } from '../business.exception';
import { isValidMxPhone } from '../../modules/users/phone-mx';

/**
 * §CELULAR (API_CONTRACT_CELULAR §2): en rutas con `@RequirePhone()`, `!isValidMxPhone(user.phone)` ⇒ 422 PHONE_REQUIRED
 * antes de cualquier efecto. `req.user.phone` lo puebla JwtAuthGuard desde la BD (mismo select, cero consultas extra).
 */
@Injectable()
export class PhoneRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_PHONE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const user = context.switchToHttp().getRequest().user as { phone?: string | null } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');
    if (!isValidMxPhone(user.phone)) {
      throw BusinessException.validation('PHONE_REQUIRED', 'A valid mobile phone is required on the account', {
        field: 'phone',
      });
    }
    return true;
  }
}
