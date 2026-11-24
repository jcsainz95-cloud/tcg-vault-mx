import { useSyncExternalStore } from 'react';
import { ApiClientError } from '../api-client';

/** §BUYLIST-429: espera por defecto si el 429 no trae `Retry-After` legible, y tope de espera. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 15_000;
export const RATE_LIMIT_MAX_WAIT_MS = 60_000;
export const RATE_LIMIT_MIN_WAIT_MS = 1_000;
export const RATE_LIMIT_MAX_RETRIES = 3;

/** `Retry-After` (segundos o fecha HTTP) → ms acotados a [1 s, 60 s]; ilegible/ausente → 15 s. */
export function retryAfterToMs(header: string | undefined, now = Date.now()): number {
  let ms = RATE_LIMIT_DEFAULT_WAIT_MS;
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) ms = secs * 1000;
    else {
      const at = Date.parse(header);
      if (Number.isFinite(at)) ms = at - now;
    }
  }
  return Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(RATE_LIMIT_MIN_WAIT_MS, ms));
}

/** Cabecera `Retry-After` o, si falta, `details.retryAfterSeconds` del cuerpo (m-4). */
function retryAfterOf(e: ApiClientError): string | undefined {
  if (e.retryAfter) return e.retryAfter;
  const d = e.details?.retryAfterSeconds;
  return typeof d === 'number' || typeof d === 'string' ? String(d) : undefined;
}

/**
 * Esperas vigentes por clave (modo+set), FUERA del componente: sobreviven a desmontar/remontar el binder
 * mientras la consulta sigue durmiendo (I-1). Valor = instante (ms epoch) en que se reanuda.
 */
const waits = new Map<string, number>();
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
export function setRateLimitWait(key: string, until: number | null) {
  if (until == null) waits.delete(key);
  else waits.set(key, until);
  emit();
}
/** Instante de reanudación de la espera de `key`, o `null`. Reactivo. */
export function useRateLimitWaitUntil(key: string): number | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => waits.get(key) ?? null,
    () => null,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Ejecuta `fn`; ante `429` (y solo 429) espera `Retry-After` y reintenta (máx. `RATE_LIMIT_MAX_RETRIES`).
 * `onWait(until)` avisa el instante de reanudación al empezar a esperar y `onWait(null)` al reanudar o abortar.
 * `signal` cancela la espera y evita lanzar más peticiones. Agotados los reintentos (o con cualquier otro
 * error) se relanza el error original.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: { onWait?: (until: number | null) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const { onWait, signal } = opts;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiClientError) || e.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) throw e;
      const ms = retryAfterToMs(retryAfterOf(e));
      onWait?.(Date.now() + ms);
      try {
        await sleep(ms, signal);
      } finally {
        onWait?.(null);
      }
    }
  }
}
