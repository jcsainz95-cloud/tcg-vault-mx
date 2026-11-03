import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EmailRequirement, REQUIRE_EMAIL_VERIFIED_KEY } from '../decorators/require-email-verified.decorator';
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
    // v1.117 (§CTA.5): modo `'present' | 'verified'`. Un `true` (metadato de antes, dobles de prueba) vale `'verified'`.
    const required = this.reflector.getAllAndOverride<EmailRequirement | boolean | undefined>(REQUIRE_EMAIL_VERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const mode: EmailRequirement = required === 'present' ? 'present' : 'verified';

    const req = context.switchToHttp().getRequest();
    const user = req.user as { emailVerified?: boolean; hasEmail?: boolean } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');
    // v1.80.9 (§M6-U.8 (c), criterio 269, P-STF-8): una cuenta del equipo SIN correo no compra ni vende. Va ANTES de
    // `emailVerified` (que en esa cuenta es siempre `false`, CHECK 4): «verifica tu correo» se lo diría a quien no
    // tiene correo. `=== false` estricto: un `req.user` sin la marca (dobles de prueba) cae a la regla de siempre.
    if (user.hasEmail === false) {
      throw BusinessException.forbidden(
        'ACCOUNT_WITHOUT_EMAIL',
        'Las cuentas del equipo sin correo no pueden comprar ni vender. Usa una cuenta de cliente.',
      );
    }
    // v1.117 (§CTA.5, D-CTA-2): comprar solo exige que haya correo; reclamar, retirar y vender exigen además verificarlo.
    if (mode === 'present') return true;
    if (!user.emailVerified) {
      throw BusinessException.forbidden(
        'EMAIL_NOT_VERIFIED',
        'Email must be verified for this action',
      );
    }
    return true;
  }
}
