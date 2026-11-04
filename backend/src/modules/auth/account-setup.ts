import { Prisma, Role, User, UserStatus } from '@prisma/client';

/**
 * v1.117⟨cuenta-correo⟩ (API_CONTRACT §CTA.2/§CTA.3) — la cuenta nacida con solo el correo.
 *
 * `setupPending(u) = role='customer' ∧ status='active' ∧ email ≠ null ∧ passwordHash = null ∧ googleId = null`. Sin columna
 * (D-CTA-5): hoy solo la cumple la cuenta de `POST /auth/register/email-only`. UNA función, usada por el alta, `account-setup`,
 * `set-password`, `PATCH /users/me/email`, `forgot-password`, `verify-email/resend` y `GET /users/me.accountSetupPending`.
 * ⛔ La escritura condicional de `set-password` y `PATCH /users/me/email` repite el predicado EN EL `where` (`setupPendingWhere`):
 * una lectura previa no basta (dos peticiones a la vez, I-4).
 */
export type SetupPendingFields = Pick<User, 'role' | 'status' | 'email' | 'passwordHash' | 'googleId'>;

export function isAccountSetupPending(u: SetupPendingFields): boolean {
  return (
    u.role === Role.customer &&
    u.status === UserStatus.active &&
    u.email !== null &&
    u.email !== undefined &&
    u.passwordHash == null &&
    u.googleId == null
  );
}

/** El mismo predicado como `where` de Prisma, para la escritura condicional (una sentencia). */
export function setupPendingWhere(userId: string): Prisma.UserWhereInput {
  return {
    id: userId,
    role: Role.customer,
    status: UserStatus.active,
    email: { not: null },
    passwordHash: null,
    googleId: null,
  };
}

/** Caducidad del enlace «Termina tu cuenta» (CTA.3). Constante de código, no dial. */
export const ACCOUNT_SETUP_TTL_HOURS = 24;
