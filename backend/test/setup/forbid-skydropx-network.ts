/**
 * forbid-skydropx-network.ts — ⭐💰🔒 PS-99 (c): en TODA suite de jest, la red hacia `*.skydropx.com` está vetada
 * (API_CONTRACT §M4-SHIP.19.19.17). Se carga por `setupFiles` en `jest.config.js` (unitaria) y en
 * `test/jest-integration.config.js` (integración); `skydropx.no-real-purchase.spec.ts` comprueba las dos cosas: que
 * el veto muerde (canario) y que los dos ficheros de configuración lo cargan.
 *
 * Qué envuelve, y por qué cada cosa:
 *  - `globalThis.fetch` — el camino normal del cliente y del proxy de la etiqueta.
 *  - el despachador global de `undici` (el del paquete, si alguien lo usa directamente: `request`, `Agent`…).
 *  - `http.request/get` y `https.request/get` — un helper o un script que nadie previó.
 * En los tres, una petición a `skydropx.com` o a cualquier subdominio lanza `ForbiddenTestNetworkError` ANTES de
 * abrir conexión. Lo demás (Postgres, Redis, MinIO, `127.0.0.1`) pasa intacto.
 *
 * ⛔ No es la única capa: (a) el adaptador real no compra bajo jest, (b) `evaluateMutationGate` niega en
 * test/CI, (d) el CI no tiene las llaves. Esta capa protege del `fetch` directo que nadie relacionó con «comprar».
 */
/* eslint-disable @typescript-eslint/no-var-requires */
// `require` y no `import * as`: el espacio de nombres de `import *` es de solo lectura (getters) y aquí hay que
// sustituir `request`/`get` en el MÓDULO real, que es el que comparten todos los que lo importan.
const http = require('http') as typeof import('http');
const https = require('https') as typeof import('https');

export class ForbiddenTestNetworkError extends Error {
  constructor(readonly target: string) {
    super(`PS-99 (c): red a Skydropx vetada en pruebas (${target}). Usa el FakeShippingProvider o un transporte grabador.`);
    this.name = 'ForbiddenTestNetworkError';
  }
}

const FORBIDDEN_SUFFIX = 'skydropx.com';

export function isForbiddenHost(hostname: string | null | undefined): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  return h === FORBIDDEN_SUFFIX || h.endsWith(`.${FORBIDDEN_SUFFIX}`);
}

function hostOfUnknown(input: unknown): string | null {
  try {
    if (typeof input === 'string') return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === 'object') {
      const o = input as { url?: unknown; hostname?: unknown; host?: unknown; origin?: unknown };
      if (typeof o.url === 'string') return new URL(o.url).hostname;
      if (typeof o.origin === 'string') return new URL(o.origin).hostname;
      if (o.origin instanceof URL) return o.origin.hostname;
      if (typeof o.hostname === 'string') return o.hostname;
      if (typeof o.host === 'string') return o.host.split(':')[0] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

// ── 1. fetch ────────────────────────────────────────────────────────────────────────────────────────────────────
const MARK = Symbol.for('tcg.ps99.forbidSkydropx');
type Marked = { [MARK]?: unknown };

const currentFetch = globalThis.fetch as typeof fetch & Marked;
const originalFetch = ((currentFetch as Marked)[MARK] as typeof fetch | undefined) ?? currentFetch;
if (typeof originalFetch === 'function') {
  const guarded = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const host = hostOfUnknown(input);
    if (isForbiddenHost(host)) throw new ForbiddenTestNetworkError(String(host));
    return originalFetch(input, init);
  }) as typeof fetch & Marked;
  guarded[MARK] = originalFetch;
  globalThis.fetch = guarded;
}

// ── 2. el despachador global de undici (paquete) ────────────────────────────────────────────────────────────────
try {
  const undici = require('undici') as {
    getGlobalDispatcher(): object;
    setGlobalDispatcher(d: object): void;
  };
  const current = undici.getGlobalDispatcher() as Marked & { dispatch: (opts: unknown, handler: unknown) => unknown };
  const base = (current[MARK] as typeof current | undefined) ?? current;
  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === MARK) return base;
      if (prop === 'dispatch') {
        return (opts: unknown, handler: { onError?: (e: Error) => void }) => {
          const host = hostOfUnknown(opts);
          if (isForbiddenHost(host)) {
            const err = new ForbiddenTestNetworkError(String(host));
            if (handler && typeof handler.onError === 'function') {
              handler.onError(err);
              return false;
            }
            throw err;
          }
          return (target.dispatch as (o: unknown, h: unknown) => unknown).call(target, opts, handler);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  undici.setGlobalDispatcher(proxy);
} catch {
  // Sin el paquete undici no hay despachador que envolver: `fetch` y http(s) siguen vetados.
}

// ── 3. http / https ─────────────────────────────────────────────────────────────────────────────────────────────
function guardModule(mod: typeof import('http') | typeof import('https')): void {
  const m = mod as unknown as Record<string, unknown> & Marked;
  const originals = (m[MARK] as { request: unknown; get: unknown } | undefined) ?? { request: m.request, get: m.get };
  m[MARK] = originals;
  for (const name of ['request', 'get'] as const) {
    const orig = originals[name] as (...args: unknown[]) => unknown;
    m[name] = function guardedRequest(this: unknown, ...args: unknown[]) {
      const host = hostOfUnknown(args[0]) ?? hostOfUnknown(args[1]);
      if (isForbiddenHost(host)) throw new ForbiddenTestNetworkError(String(host));
      return orig.apply(this, args);
    };
  }
}
guardModule(http);
guardModule(https);
