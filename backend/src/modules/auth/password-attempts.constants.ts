/**
 * password-attempts.constants.ts — C7 (v1.80): los NÚMEROS del límite de intentos de contraseña
 * por cuenta, con nombre. Fuente normativa: `API_CONTRACT §1` «Límite de intentos por cuenta»
 * (`#auth-password-attempts`); razón de cada número: `ARCHITECTURE §4.57.2` #3.
 *
 * ⛔ No hay nada aquí que dependa del rol ni de `NODE_ENV`: umbrales idénticos para todos
 * (§4.57.2 #6) y el candado NO se apaga bajo la suite (§4.57.6).
 */

/** Intentos libres. El 5.º ya deja puesto el candado. */
export const PASSWORD_FREE_ATTEMPTS = 5;

/** Candado tras el intento `f = PASSWORD_FREE_ATTEMPTS`: 60 s. Se duplica en cada intento posterior. */
export const PASSWORD_LOCK_BASE_MS = 60_000;

/** Tope del candado: 60 min. */
export const PASSWORD_LOCK_MAX_MS = 60 * 60_000;

/**
 * Olvido del contador: 2 h sin intentos (TTL deslizante, renovado en cada intento).
 * ⚠️ Tiene que ser MAYOR que `PASSWORD_LOCK_MAX_MS`: si fuera menor, el contador moriría durante el
 * candado y el atacante recuperaría sus 5 libres (prueba C7-6).
 */
export const PASSWORD_FAILURES_TTL_MS = 2 * 60 * 60_000;

/** Plazo por operación contra Redis (§4.57.2 #11). */
export const LOGIN_ATTEMPT_REDIS_TIMEOUT_MS = 250;

/** Tras un fallo de Redis, las operaciones siguientes van a memoria durante este tiempo. */
export const LOGIN_ATTEMPT_REDIS_FALLBACK_MS = 30_000;

/** Tope de claves del almacén en memoria (§4.57.5). */
export const LOGIN_ATTEMPT_MEMORY_MAX_KEYS = 50_000;

/** Correo de aviso a staff: como mucho uno cada 24 h por cuenta (§4.57.2 #10). */
export const PASSWORD_LOCK_MAIL_EVERY_MS = 24 * 60 * 60_000;

/** Prefijos de cubo (separación de dominios; `API_CONTRACT §1`). */
export const ACCOUNT_KEY_DOMAIN = 'auth-pw:v1:';
export const CHANGE_PASSWORD_KEY_PREFIX = 'auth-cp:v1:';
export const DEVICE_KEY_PREFIX = 'auth-pwdev:v1:';
export const LOCK_MAIL_KEY_PREFIX = 'auth-pwmail:v1:';

/** Prefijo de las claves en Redis (`tcg:auth:f:<k>` / `tcg:auth:l:<k>`, §4.57.5). */
export const LOGIN_ATTEMPT_REDIS_PREFIX = 'tcg:auth:';

/**
 * Duración del candado que deja el intento número `failures` (≥ 5):
 * `min(60 s · 2^(f−5), 3600 s)` ⇒ 60 s, 2, 4, 8, 16, 32, 60 min, 60 min…  Con `f < 5`, 0 (sin candado).
 * Es LA fórmula; el script Lua de Redis recibe estos mismos números por `ARGV` (no los repite).
 */
export function lockMsForFailures(failures: number): number {
  if (failures < PASSWORD_FREE_ATTEMPTS) return 0;
  const exp = failures - PASSWORD_FREE_ATTEMPTS;
  // 2^6 · 60 s ya supera el tope: cortar el exponente evita `Infinity` con contadores enormes.
  if (exp >= 6) return PASSWORD_LOCK_MAX_MS;
  return Math.min(PASSWORD_LOCK_BASE_MS * 2 ** exp, PASSWORD_LOCK_MAX_MS);
}
