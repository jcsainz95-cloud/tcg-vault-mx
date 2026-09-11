import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
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
