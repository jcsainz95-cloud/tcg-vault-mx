import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_EMAIL_VERIFIED_KEY } from '../decorators/require-email-verified.decorator';
import { BusinessException } from '../business.exception';

/**
 * EmailVerifiedGuard — AUTORIDAD server-side del gating de correo (v1.5). ARCHITECTURE §4.11, §7.
 * Corre DESPUÉS de JwtAuthGuard (que puebla `req.user.emailVerified` desde BD). En rutas marcadas
 * con @RequireEmailVerified(), si `emailVerified=false` → 403 EMAIL_NOT_VERIFIED. La UI solo
 * muestra el banner "verifica tu correo"; el bloqueo real lo hace SIEMPRE este guard.
 * Google entra verificado (no afectado); el staff se siembra verificado (v1.5-6).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_EMAIL_VERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { emailVerified?: boolean } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');
    if (!user.emailVerified) {
      throw BusinessException.forbidden(
        'EMAIL_NOT_VERIFIED',
        'Email must be verified for this action',
      );
    }
    return true;
  }
}
