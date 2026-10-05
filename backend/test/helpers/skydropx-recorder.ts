/**
 * skydropx-recorder.ts — dobles para probar el cliente REAL de Skydropx sin red (PS-91…PS-95, PS-99 (a)).
 *
 *  - `RecorderTransport`: transporte grabador con respuestas programadas por ruta. ⛔ Nunca abre red: el origen de
 *    prueba es `https://api.recorder.invalid` (no es Skydropx; y aunque lo fuera, PS-99 (c) lo vetaría).
 *  - `FakeClock`: reloj virtual; `sleep` se resuelve en orden de vencimiento con un bombeo por `setImmediate`, así
 *    que N llamadas concurrentes ven tiempos coherentes.
 *  - `CapturedLogger`: captura lo que el cliente loguea (para asertar que no salen token ni secreto).
 *  - `withSpendGateOpen`: abre el candado de ejecución SOLO dentro del callback y SOLO con un transporte grabador
 *    (lo comprueba) — para probar la matriz de la COMPRA contra el doble. Restaura el entorno siempre.
 */
import type {
  SkydropxTransport,
  TransportRequest,
  TransportResponse,
} from '../../src/modules/shipping-provider/http/skydropx-client';
import type { Clock } from '../../src/modules/shipping-provider/http/token-bucket';

export const RECORDER_ORIGIN = 'https://api.recorder.invalid';
export const FAKE_SECRET = 'fake-client-secret-0123456789';
export const FAKE_CLIENT_ID = 'fake-client-id-abcdef';

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  at: number;
}

export type Responder = (call: RecordedCall, n: number) => TransportResponse | Promise<TransportResponse> | 'timeout' | 'network';

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse {
  const h = new Map(Object.entries({ 'content-type': 'application/json', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n) => h.get(n.toLowerCase()) ?? null }, text: async () => JSON.stringify(body) };
}

export function textResponse(status: number, body: string, headers: Record<string, string> = {}): TransportResponse {
  const h = new Map(Object.entries({ 'content-type': 'text/html', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n) => h.get(n.toLowerCase()) ?? null }, text: async () => body };
}

export const TOKEN_VALUE = 'tok-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export class RecorderTransport {
  readonly calls: RecordedCall[] = [];
  private readonly routes: { match: (c: RecordedCall) => boolean; respond: Responder; count: number }[] = [];
  tokenIssued = 0;
  /** `created_at` (epoch s) que devuelve el token; por omisión, el reloj. */
  tokenCreatedAt: (() => number) | null = null;

  constructor(private readonly clock: Clock) {
    // Token por omisión: 200 con expires_in 7200.
    this.on('POST', '/api/v1/oauth/token', () => {
      this.tokenIssued += 1;
      return jsonResponse(200, {
        access_token: `${TOKEN_VALUE}-${this.tokenIssued}`,
        token_type: 'Bearer',
        expires_in: 7200,
        scope: 'default',
        created_at: this.tokenCreatedAt ? this.tokenCreatedAt() : Math.floor(this.clock.now() / 1000),
      });
    });
  }

  /** Registra (con prioridad sobre las anteriores) una respuesta para método + ruta (prefijo o RegExp). */
  on(method: string, path: string | RegExp, respond: Responder): this {
    this.routes.unshift({
      match: (c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)),
      respond,
      count: 0,
    });
    return this;
  }

  callsTo(method: string, path: string | RegExp): RecordedCall[] {
    return this.calls.filter(
      (c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)),
    );
  }

  readonly transport: SkydropxTransport = async (req: TransportRequest) => {
    const u = new URL(req.url);
    if (u.origin !== RECORDER_ORIGIN) throw new Error(`RecorderTransport: origen inesperado ${u.origin}`);
    const call: RecordedCall = {
      method: req.method,
      url: req.url,
      path: u.pathname + u.search,
      headers: { ...req.headers },
      body: req.body,
      at: this.clock.now(),
    };
    this.calls.push(call);
    const route = this.routes.find((r) => r.match(call));
    if (!route) return jsonResponse(404, { message: 'no route in recorder' });
    route.count += 1;
    const out = await route.respond(call, route.count);
    if (out === 'network') throw new TypeError('fetch failed');
    if (out === 'timeout') {
      // Espera al aborto del cliente (su temporizador real).
      await new Promise<never>((_, reject) => {
        req.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return out as TransportResponse;
  };
}

export class FakeClock implements Clock {
  private t: number;
  private readonly timers: { at: number; resolve: () => void; seq: number }[] = [];
  private seq = 0;
  private pumping = false;
  readonly sleeps: number[] = [];

  constructor(start = Date.UTC(2026, 9, 4, 4, 0, 0)) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  set(ms: number): void {
    this.t = ms;
  }

  advance(ms: number): void {
    this.t += ms;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return new Promise((resolve) => {
      this.timers.push({ at: this.t + Math.max(0, ms), resolve, seq: (this.seq += 1) });
      this.schedulePump();
    });
  }

  private schedulePump(): void {
    if (this.pumping) return;
    this.pumping = true;
    setImmediate(() => this.pump());
  }

  private pump(): void {
    this.pumping = false;
    if (this.timers.length === 0) return;
    this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = this.timers.shift()!;
    this.t = Math.max(this.t, next.at);
    next.resolve();
    if (this.timers.length > 0) this.schedulePump();
  }
}

export class CapturedLogger {
  readonly lines: string[] = [];
  log(m: string): void {
    this.lines.push(`log ${m}`);
  }
  warn(m: string): void {
    this.lines.push(`warn ${m}`);
  }
  error(m: string): void {
    this.lines.push(`error ${m}`);
  }
  text(): string {
    return this.lines.join('\n');
  }
}

/**
 * Abre el candado de ejecución (§19.19.7) SOLO durante `fn`, para probar la matriz de la COMPRA contra un transporte
 * GRABADOR. ⛔ No usar con otro transporte: la función lo exige recibiendo el grabador.
 */
export async function withSpendGateOpen<T>(recorder: RecorderTransport, fn: () => Promise<T>): Promise<T> {
  if (!(recorder instanceof RecorderTransport)) throw new Error('withSpendGateOpen exige un RecorderTransport');
  const keys = ['NODE_ENV', 'CI', 'JEST_WORKER_ID', 'SKYDROPX_ALLOW_SPEND'] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.CI;
    delete process.env.JEST_WORKER_ID;
    process.env.SKYDROPX_ALLOW_SPEND = 'true';
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
