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

/**
 * v1.80.9 (§M6-U.2): el login (y `forgot-password`) reciben un IDENTIFICADOR — correo **o** nombre de usuario —
 * y lo normalizan con **la misma** función que el correo (`trim().toLowerCase()`): un alias, no una segunda regla.
 * Para un correo, la clave del cubo C7 sale bit a bit igual que antes (§4.58.4).
 */
export const normalizeIdentifier = normalizeEmail;

/** Longitud del identificador del login, tras `trim()` (§M6-U.2): fuera de 1–254 ⇒ `400` estructural. */
export const LOGIN_IDENTIFIER_MAX_LENGTH = 254;

/**
 * v1.80.9 (§M6-U.1 CHECK `user_username_canonical`, criterio 257): forma canónica del nombre de usuario del staff.
 * 3–30, minúsculas, empieza con letra, solo `a-z 0-9 . _ -`. ⛔ El MISMO patrón que el CHECK de la migración M-63.
 */
export const USERNAME_CANONICAL_REGEX = /^[a-z][a-z0-9._-]{2,29}$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/** Regla que falla al validar un nombre de usuario, en el orden NORMATIVO de §M6-U.6 paso 3. */
export type UsernameRule = 'required' | 'length' | 'charset' | 'start';

/**
 * Valida y canoniza un nombre de usuario del alta de staff (§M6-U.6 paso 3): `u = trim(x).toLowerCase()`; reglas
 * evaluadas en este orden: `required` (vacío) → `length` (3–30) → `charset` (solo `a-z 0-9 . _ -`: cubre espacio,
 * `@`, acento, ñ) → `start` (empieza con letra). Devuelve el valor canónico a guardar, o la regla que falló.
 */
export function checkUsername(raw: unknown): { ok: true; value: string } | { ok: false; rule: UsernameRule } {
  if (typeof raw !== 'string') return { ok: false, rule: 'required' };
  const u = normalizeIdentifier(raw);
  if (u.length === 0) return { ok: false, rule: 'required' };
  if (u.length < USERNAME_MIN_LENGTH || u.length > USERNAME_MAX_LENGTH) return { ok: false, rule: 'length' };
  if (!/^[a-z0-9._-]+$/.test(u)) return { ok: false, rule: 'charset' };
  if (!/^[a-z]/.test(u)) return { ok: false, rule: 'start' };
  // Las cuatro reglas juntas SON el CHECK de la BD; si divergieran, el CHECK daría un 500 aquí.
  if (!USERNAME_CANONICAL_REGEX.test(u)) return { ok: false, rule: 'charset' };
  return { ok: true, value: u };
}

/** True si `value` es un string con formato de email válido. */
export function isValidEmailFormat(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}

/** True si `value` es un string que cumple la fortaleza mínima de contraseña. */
export function isStrongPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH;
}
