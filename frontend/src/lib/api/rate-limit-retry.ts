import { ApiClientError } from '../api-client';

/** §BUYLIST-429: espera por defecto si el 429 no trae `Retry-After` legible, y tope de espera. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 15_000;
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;
export const RATE_LIMIT_MAX_RETRIES = 3;

/** `Retry-After` (segundos o fecha HTTP) → ms acotados a [1 s, 60 s]; ilegible/ausente → 15 s. */
export function retryAfterToMs(header: string | undefined, now = Date.now()): number {
  let ms = RATE_LIMIT_DEFAULT_WAIT_MS;
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) ms = secs * 1000;
    else {
      const at = Date.parse(header);
      if (Number.isFinite(at)) ms = at - now;
    }
  }
  return Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(1000, ms));
}

/**
 * Ejecuta `fn`; ante `429` espera `Retry-After` y reintenta (máx. `RATE_LIMIT_MAX_RETRIES`).
 * `onWait(true)` se avisa al empezar a esperar y `onWait(false)` al reanudar. Agotados los reintentos
 * (o cualquier otro error) se relanza el error original.
 */
export async function withRateLimitRetry<T>(fn: () => Promise<T>, onWait?: (waiting: boolean) => void): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiClientError) || e.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) throw e;
      onWait?.(true);
      await new Promise((r) => setTimeout(r, retryAfterToMs(e.retryAfter)));
      onWait?.(false);
    }
  }
}
