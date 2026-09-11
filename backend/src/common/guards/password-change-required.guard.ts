import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../decorators/allow-password-change-required.decorator';
import { BusinessException } from '../business.exception';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * PasswordChangeRequiredGuard — v1.67 (contrato §0 `PASSWORD_CHANGE_REQUIRED`, §1 «Contraseña temporal
 * obligatoria»; ARCHITECTURE §4.47.2). **Decisión del dueño (2026-09-11): la temporal OBLIGA.**
 *
 * Si la cuenta de la sesión tiene `mustChangePassword = true` (contraseña temporal puesta por el
 * admin: `POST /admin/users/:id/reset-password`, o alta admin sin `password`) y el handler NO lleva
 * `@AllowPasswordChangeRequired()`, responde **`403 PASSWORD_CHANGE_REQUIRED`** en todo endpoint
 * autenticado, de cualquier rol.
 *
 * - Va como `APP_GUARD` **inmediatamente después de `JwtAuthGuard`** (`app.module.ts`): lee
 *   `req.user.mustChangePassword`, que el Jwt puebla desde el MISMO `select` que ya hacía ⇒ cero
 *   consultas nuevas.
 * - Rutas `@Public()` no tienen `req.user` ⇒ pasan (`login`/`google`/`refresh` siguen funcionando:
 *   sin sesión no hay forma de cambiar la contraseña).
 * - ⛔ **No es un `401`**: la sesión es válida; lo que falta es un acto del usuario. El interceptor del
 *   cliente trata 401 como sesión muerta y aquí debe NAVEGAR a la pantalla de cambio.
 * - `details: {}` (contrato).
 */
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    // Sin sesión (ruta @Public) o sin flag ⇒ nada que imponer.
    if (!user || user.mustChangePassword !== true) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw BusinessException.forbidden(
      'PASSWORD_CHANGE_REQUIRED',
      'Your account has a temporary password. Change it to continue.',
      {},
    );
  }
}
