import { Role } from '@prisma/client';

/**
 * LIVE-2 (API_CONTRACT §14.2, v1.84 · S5-1) — tope ABSOLUTO de vida de una sesión, contado desde `sat`
 * (segundos epoch del login / Google / registro / cambio de contraseña que creó el `sid`).
 *
 * Decisión del dueño: `HECHOS.md` fila «Listo para dinero real — respuestas del dueño (2026-10-05) a §4.63.9»,
 * P-6 «Cada 7 días»: 7 días para el panel (personal y dueño), 30 días para clientes.
 *
 * ⛔ Constantes en código, NO dial de M10: un tope de seguridad no se afloja desde el panel.
 */
export const SESSION_MAX_AGE_CUSTOMER_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_MAX_AGE_STAFF_SECONDS = 7 * 24 * 60 * 60;

/** Tope por rol ACTUAL (leído de BD en el refresh): `customer` ⇒ 30 d; cualquier otro rol ⇒ 7 d. */
export function sessionMaxAgeSeconds(role: Role): number {
  return role === Role.customer ? SESSION_MAX_AGE_CUSTOMER_SECONDS : SESSION_MAX_AGE_STAFF_SECONDS;
}

/** `details.reason` del `401 UNAUTHENTICATED` del refresh pasado el tope (el frontend elige el texto). */
export const SESSION_MAX_AGE_REASON = 'session_max_age';

/**
 * Segundos de un TTL con el formato de `expiresIn` de `jsonwebtoken` (número = segundos; texto = timespan de
 * `ms`: `"30d"`, `"15m"`, `"2 hours"`, `"1.5h"`…; texto sin unidad = MILISEGUNDOS, como `ms`). Mismo redondeo
 * que `jsonwebtoken/lib/timespan.js` (`floor(ms / 1000)`). Formato inválido ⇒ lanza, igual que lanzaba
 * `jsonwebtoken` con un `expiresIn` inválido (⛔ nunca un TTL «por defecto» silencioso).
 *
 * Existe porque el refresh se firma con `exp` explícito (`min(now + TTL, sat + tope)`, §14.2 paso 4) y
 * `jsonwebtoken` prohíbe `exp` en el payload junto con `expiresIn`.
 */
export function ttlSeconds(ttl: string | number): number {
  if (typeof ttl === 'number') {
    if (!Number.isFinite(ttl)) throw new Error(`TTL inválido: ${ttl}`);
    return Math.floor(ttl);
  }
  const m = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
    ttl.trim(),
  );
  if (!ttl.trim() || ttl.length > 100 || !m) throw new Error(`TTL inválido: ${JSON.stringify(ttl)}`);
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const S = 1000;
  const MIN = 60 * S;
  const H = 60 * MIN;
  const D = 24 * H;
  let ms: number;
  if (/^(years?|yrs?|y)$/.test(unit)) ms = n * 365.25 * D;
  else if (/^(weeks?|w)$/.test(unit)) ms = n * 7 * D;
  else if (/^(days?|d)$/.test(unit)) ms = n * D;
  else if (/^(hours?|hrs?|h)$/.test(unit)) ms = n * H;
  else if (/^(minutes?|mins?|m)$/.test(unit)) ms = n * MIN;
  else if (/^(seconds?|secs?|s)$/.test(unit)) ms = n * S;
  else ms = n;
  return Math.floor(ms / 1000);
}
