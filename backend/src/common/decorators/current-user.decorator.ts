import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  // v1.80.9 (§M6-U.2): claim del token; `null` en cuentas del equipo sin correo.
  email: string | null;
  role: string;
  // v1.80.9: ¿la cuenta tiene correo? Poblado por JwtAuthGuard DESDE LA BD; lo consume EmailVerifiedGuard.
  hasEmail?: boolean;
  // v1.5: poblado por JwtAuthGuard desde BD; lo consume EmailVerifiedGuard (gating sensible).
  emailVerified?: boolean;
  // v1.67: poblado por JwtAuthGuard desde BD (mismo `select`, cero consultas extra); lo consume
  // PasswordChangeRequiredGuard (403 PASSWORD_CHANGE_REQUIRED fuera de la allowlist).
  mustChangePassword?: boolean;
}

/** Inyecta el usuario autenticado (poblado por JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    return data && user ? user[data] : user;
  },
);
