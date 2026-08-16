/**
 * Reglas de credenciales COMPARTIDAS (BE-9). Fuente única para el formato de email y la fortaleza
 * mínima de contraseña, para que el auto-registro (`auth` DTO `RegisterDto`) y el alta por admin
 * (`admin.service.createUser`) no divergan. La `RegisterDto` valida por decoradores class-validator
 * (`@IsEmail`, `@MinLength(MIN_PASSWORD_LENGTH)`); el alta por admin recibe `unknown` y valida aquí.
 */

/** Longitud mínima de contraseña (misma política que `RegisterDto.password` → MinLength). */
export const MIN_PASSWORD_LENGTH = 8;

/** Formato de email aceptado (paridad con el `@IsEmail` del registro para el camino admin). */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza el email: trim + lowercase (paridad con /auth/register antes de persistir). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True si `value` es un string con formato de email válido. */
export function isValidEmailFormat(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}

/** True si `value` es un string que cumple la fortaleza mínima de contraseña. */
export function isStrongPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH;
}
