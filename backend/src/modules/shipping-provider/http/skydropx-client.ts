/**
 * skydropx-client.ts — 💰🔒 el cliente servidor de la API de Skydropx (API_CONTRACT §M4-SHIP.19.19.3, que sustituye
 * las reglas 1–5 de §19.4 donde difieren; razones en ARCHITECTURE §4.60 (l)).
 *
 * Lo que garantiza, regla por regla (la numeración es la del contrato):
 *  (0) `User-Agent` propio en TODA petición; un `403` del borde (cuerpo no-JSON o con `1010` /
 *      `browser_signature_banned`) ⇒ `502 {reason:'edge_blocked'}`, cero reintentos, log `error` (PS-91).
 *  (1) Origen normalizado (`skydropxOrigin`): rutas `${origin}/api/v1/…` y `${origin}/api/v2/…` (PS-92).
 *  (2) Token OAuth en memoria, `expiresAt = created_at + expires_in − 300 s`; una sola petición de token en vuelo por
 *      proceso; ⛔ nunca en BD ni en log (PS-92).
 *  (3) `TokenBucket` delante de todo (PS-93).
 *  (4) Matriz de reintentos por clase de operación — `read` (lecturas, `POST /quotations`, token), `purchase`
 *      (compra y protección: gastan) y `cancel`. 💰 La compra NUNCA se reintenta salvo `401`/`429` (PS-93).
 *  (5) Timeouts: 10 s por llamada, 30 s la compra.
 *  (6) Puerta de mutación: `mutate()` es el ÚNICO camino a una ruta que gasta o cambia estado en Skydropx, y llama a
 *      `assertMutationAllowed` antes de tocar la red y antes de cada intento (PS-99 (a), C-SDX-8 (d)).
 *  (7) Log por llamada con la lista blanca (`op`, `status`, `ms`, ids, `providerCode`) — ⛔ sin cuerpo, sin token.
 *
 * ⛔ El cliente NO implementa ninguna otra escritura (`/pickups`, `/rate/shipments`, `/orders`, `/address_templates`
 * de escritura, `/settings/*`, `/external_shipments`, `/oauth/revoke`).
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { Logger } from '@nestjs/common';
import { assertMutationAllowed } from '../spend-gate';
import { ShippingProviderError, ShippingProviderPurchaseInFlightError } from '../shipping-provider.errors';
import { Clock, systemClock, TokenBucket } from './token-bucket';
import { skydropxApiHost, skydropxOrigin } from './skydropx-origin';

function packageVersion(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'tcg-marketplace-backend' && typeof pkg.version === 'string') return pkg.version;
      } catch {
        // sigue subiendo
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** §19.19.3 (0): constante, ⛔ no env (no es secreta ni configurable). */
export const SKYDROPX_USER_AGENT = `tcg-hunt/${packageVersion()} (+https://tcghunt.mx)`;

export const SKYDROPX_DEFAULT_TIMEOUT_MS = 10_000;
export const SKYDROPX_PURCHASE_TIMEOUT_MS = 30_000;
/** Renovar el token 5 min antes de que caduque (§19.4 (1)). */
const TOKEN_EARLY_RENEW_MS = 300_000;
const MAX_429_RETRIES = 3;
const MAX_TRANSIENT_RETRIES_READ = 2;
const RETRY_AFTER_CAP_MS = 60_000;

export interface TransportRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Transporte inyectable: en producción, `fetch`; en pruebas, un grabador (⛔ nunca la red, PS-99 (c)). */
export type SkydropxTransport = (req: TransportRequest) => Promise<TransportResponse>;

/** El único `fetch` del cliente: a `${origin}` (SKYDROPX_BASE_URL), sin seguir redirecciones (C-SDX-7). */
export const fetchTransport: SkydropxTransport = (req) =>
  fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: req.signal,
    redirect: 'manual',
  });

export interface ProviderLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SkydropxClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  rps?: number;
  transport?: SkydropxTransport;
  clock?: Clock;
  random?: () => number;
  logger?: ProviderLogger;
  timeouts?: { defaultMs?: number; purchaseMs?: number };
}

/** Clase de reintento (filas de la matriz §19.19.3 (4)). */
export type RetryClass = 'read' | 'purchase' | 'cancel';

export type MutationRequest =
  | { op: 'purchase'; body: unknown; idempotencyKey: string }
  | { op: 'cancel'; providerShipmentId: string; body: unknown }
  | { op: 'protect'; providerShipmentId: string; body: unknown };

export interface ProviderResponse {
  status: number;
  json: unknown;
}

/** Ids que SÍ pueden ir al log (lista blanca, §19.4 (7)). */
export interface LogIds {
  providerShipmentId?: string;
  quotationId?: string;
  rateId?: string;
}

interface SendSpec {
  op: string;
  method: 'GET' | 'POST';
  url: string;
  retry: RetryClass;
  auth: boolean;
  body?: string;
  contentType?: string;
  extraHeaders?: Record<string, string>;
  ids?: LogIds;
  /** Se invoca justo antes de CADA intento que toca la red (puerta de mutación). */
  guard?: () => void;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

class TransportFailure extends Error {
  constructor(readonly kind: 'timeout' | 'network') {
    super(kind);
  }
}

export class SkydropxClient {
  readonly origin: string;
  readonly apiHost: string;
  private readonly transport: SkydropxTransport;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly logger: ProviderLogger;
  private readonly bucket: TokenBucket;
  private readonly defaultTimeoutMs: number;
  private readonly purchaseTimeoutMs: number;
  private token: CachedToken | null = null;
  private tokenInFlight: Promise<CachedToken> | null = null;

  constructor(private readonly options: SkydropxClientOptions) {
    this.origin = skydropxOrigin(options.baseUrl);
    this.apiHost = skydropxApiHost(this.origin);
    this.transport = options.transport ?? fetchTransport;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.logger = options.logger ?? new Logger('SkydropxClient');
    this.bucket = new TokenBucket(options.rps ?? 2, this.clock);
    this.defaultTimeoutMs = options.timeouts?.defaultMs ?? SKYDROPX_DEFAULT_TIMEOUT_MS;
    this.purchaseTimeoutMs = options.timeouts?.purchaseMs ?? SKYDROPX_PURCHASE_TIMEOUT_MS;
  }

  /** `${origin}/api/v1${path}` */
  v1(path: string): string {
    return `${this.origin}/api/v1${path}`;
  }

  // ── Lecturas y la cotización (no gastan: PROD §0, ~120 peticiones con saldo intacto) ─────────────────────────

  async get(op: string, path: string, ids?: LogIds): Promise<ProviderResponse> {
    return this.send({ op, method: 'GET', url: this.v1(path), retry: 'read', auth: true, ids });
  }

  async createQuotation(body: unknown): Promise<ProviderResponse> {
    return this.send({
      op: 'quote',
      method: 'POST',
      url: this.v1('/quotations'),
      retry: 'read',
      auth: true,
      body: JSON.stringify(body),
      contentType: 'application/json',
    });
  }

  // ── 💰🔒 Las ÚNICAS llamadas que gastan o cambian estado en Skydropx (lista cerrada, §19.19.3 (6)) ──────────────

  async mutate(request: MutationRequest): Promise<ProviderResponse> {
    const op = request.op;
    const guard = () => assertMutationAllowed(op);
    guard();
    let url: string;
    let retry: RetryClass;
    const extraHeaders: Record<string, string> = {};
    const ids: LogIds = {};
    switch (request.op) {
      case 'purchase':
        url = `${this.origin}/api/v2/shipments`;
        retry = 'purchase';
        extraHeaders['Idempotency-Key'] = request.idempotencyKey;
        break;
      case 'cancel':
        url = this.v1(`/shipments/${encodeURIComponent(request.providerShipmentId)}/cancellations`);
        retry = 'cancel';
        ids.providerShipmentId = request.providerShipmentId;
        break;
      case 'protect':
        url = this.v1(`/shipments/${encodeURIComponent(request.providerShipmentId)}/protect`);
        retry = 'purchase';
        ids.providerShipmentId = request.providerShipmentId;
        break;
      default: {
        const never: never = request;
        throw new Error(`mutación desconocida ${(never as { op: string }).op}`);
      }
    }
    return this.send({
      op,
      method: 'POST',
      url,
      retry,
      auth: true,
      body: JSON.stringify(request.body),
      contentType: 'application/json',
      extraHeaders,
      ids,
      guard,
    });
  }

  // ── Para el proxy de la etiqueta (D1c) ────────────────────────────────────────────────────────────────────────

  /** Turno de la cubeta para una descarga al host de la API. */
  acquireSlot(): Promise<void> {
    return this.bucket.acquire();
  }

  /** El token vigente (o uno nuevo). ⛔ Solo para el host de la API (§19.19.9). */
  accessToken(): Promise<string> {
    return this.getToken().then((t) => t.value);
  }

  invalidateToken(): void {
    this.token = null;
  }

  // ── Token ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private async getToken(): Promise<CachedToken> {
    const cached = this.token;
    if (cached && this.clock.now() < cached.expiresAt) return cached;
    if (this.tokenInFlight) return this.tokenInFlight;
    const pending = this.requestToken().finally(() => {
      if (this.tokenInFlight === pending) this.tokenInFlight = null;
    });
    this.tokenInFlight = pending;
    return pending;
  }

  private async requestToken(): Promise<CachedToken> {
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
    }).toString();
    const res = await this.send({
      op: 'token',
      method: 'POST',
      url: this.v1('/oauth/token'),
      retry: 'read',
      auth: false,
      body: form,
      contentType: 'application/x-www-form-urlencoded',
    });
    const json = res.json as Record<string, unknown> | null;
    const value = json && typeof json.access_token === 'string' ? json.access_token : '';
    const expiresIn = json && typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : null;
    if (!value || expiresIn === null) throw ShippingProviderError.error('token', res.status, 'bad_token_response');
    const now = this.clock.now();
    const createdAtMs = json && typeof json.created_at === 'number' ? json.created_at * 1000 : now;
    let expiresAt = createdAtMs + expiresIn * 1000 - TOKEN_EARLY_RENEW_MS;
    // Reloj del proveedor muy desfasado (ya «caducado» al nacer): se cuenta desde el reloj local para no pedir un
    // token por llamada.
    if (expiresAt <= now) expiresAt = now + expiresIn * 1000 - TOKEN_EARLY_RENEW_MS;
    const token = { value, expiresAt };
    this.token = token;
    return token;
  }

  // ── El motor: una petición con la matriz de reintentos ───────────────────────────────────────────────────────

  private async send(spec: SendSpec): Promise<ProviderResponse> {
    let authRetried = false;
    let rateLimitedRetries = 0;
    let transientRetries = 0;
    for (;;) {
      const token = spec.auth ? await this.getToken() : null;
      await this.bucket.acquire();
      spec.guard?.();
      const headers: Record<string, string> = {
        'User-Agent': SKYDROPX_USER_AGENT,
        Accept: 'application/json',
        ...(spec.contentType ? { 'Content-Type': spec.contentType } : {}),
        ...(spec.extraHeaders ?? {}),
      };
      if (token) headers.Authorization = `Bearer ${token.value}`;

      const started = this.clock.now();
      let res: TransportResponse;
      try {
        res = await this.callTransport(spec, headers);
      } catch (err) {
        const kind = err instanceof TransportFailure ? err.kind : 'network';
        this.logCall(spec, kind, started, 'warn');
        if (spec.retry === 'read' && transientRetries < MAX_TRANSIENT_RETRIES_READ) {
          await this.clock.sleep(500 * 2 ** transientRetries);
          transientRetries += 1;
          continue;
        }
        const busy = ShippingProviderError.busy(spec.op);
        if (spec.retry === 'purchase') throw new ShippingProviderPurchaseInFlightError(busy);
        throw busy;
      }

      const status = res.status;
      if (status >= 200 && status < 300) {
        const text = await safeText(res);
        const json = parseJson(text);
        this.logCall(spec, status, started, 'log');
        if (json === undefined) {
          const e = ShippingProviderError.error(spec.op, status, 'unparseable');
          if (spec.retry === 'purchase') throw new ShippingProviderPurchaseInFlightError(e);
          throw e;
        }
        return { status, json };
      }

      if (status === 401) {
        this.logCall(spec, status, started, 'warn');
        if (!spec.auth) throw ShippingProviderError.error(spec.op, 401);
        if (token && this.token === token) this.token = null;
        if (!authRetried) {
          authRetried = true;
          continue;
        }
        throw ShippingProviderError.error(spec.op, 401);
      }

      if (status === 429) {
        this.logCall(spec, status, started, 'warn');
        if (rateLimitedRetries < MAX_429_RETRIES) {
          const wait =
            retryAfterMs(res.headers.get('retry-after'), this.clock.now()) ??
            500 * 2 ** rateLimitedRetries + Math.floor(this.random() * 250);
          rateLimitedRetries += 1;
          await this.clock.sleep(wait);
          continue;
        }
        throw ShippingProviderError.busy(spec.op);
      }

      if (status === 403) {
        const text = await safeText(res);
        const edge = isEdgeBlock(text);
        this.logCall(spec, status, started, 'error', edge ? 'edge_blocked' : undefined);
        // El borde (Cloudflare) corta ANTES de la aplicación: la compra no se procesó ⇒ `502 edge_blocked`, reclamo deshecho.
        // ⭐ v1.80.12.1 (§M4-SHIP.19.21.4): un `403` JSON que NO es del borde viene de la aplicación (cuenta, permiso,
        // saldo — semántica NO MEDIDA) y no prueba que no se procesó ⇒ en la COMPRA es «en vuelo». En lecturas,
        // cotización y cancelación sigue `502` sin reintento.
        const e = ShippingProviderError.error(spec.op, 403, edge ? 'edge_blocked' : undefined);
        if (!edge && spec.retry === 'purchase') throw new ShippingProviderPurchaseInFlightError(e);
        throw e;
      }

      if (status === 400 || status === 422) {
        const text = await safeText(res);
        const { providerCode, providerMessage } = rejectionOf(parseJson(text));
        this.logCall(spec, status, started, 'warn', undefined, providerCode);
        throw ShippingProviderError.rejected(spec.op, providerCode, providerMessage);
      }

      if (status >= 500) {
        this.logCall(spec, status, started, 'warn');
        if (spec.retry === 'read' && transientRetries < MAX_TRANSIENT_RETRIES_READ) {
          await this.clock.sleep(500 * 2 ** transientRetries);
          transientRetries += 1;
          continue;
        }
        const busy = ShippingProviderError.busy(spec.op);
        if (spec.retry === 'purchase') throw new ShippingProviderPurchaseInFlightError(busy);
        throw busy;
      }

      // 404, 3xx y cualquier otro 4xx: `502`. En la compra, no sabemos si se creó ⇒ «en vuelo» (conservador:
      // liberar el reclamo de una guía que sí existe es la guía duplicada; retenerlo de más solo cuesta una nota).
      this.logCall(spec, status, started, 'warn');
      const e = ShippingProviderError.error(spec.op, status);
      if (spec.retry === 'purchase') throw new ShippingProviderPurchaseInFlightError(e);
      throw e;
    }
  }

  private async callTransport(spec: SendSpec, headers: Record<string, string>): Promise<TransportResponse> {
    const timeoutMs = spec.retry === 'purchase' && spec.op === 'purchase' ? this.purchaseTimeoutMs : this.defaultTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    (timer as { unref?: () => void }).unref?.();
    try {
      return await this.transport({
        method: spec.method,
        url: spec.url,
        headers,
        body: spec.body,
        signal: controller.signal,
      });
    } catch {
      throw new TransportFailure(timedOut ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  private logCall(
    spec: SendSpec,
    status: number | string,
    started: number,
    level: 'log' | 'warn' | 'error',
    reason?: string,
    providerCode?: string | null,
  ): void {
    const parts = [`skydropx op=${spec.op}`, `status=${status}`, `ms=${Math.max(0, this.clock.now() - started)}`];
    if (spec.ids?.providerShipmentId) parts.push(`providerShipmentId=${spec.ids.providerShipmentId}`);
    if (spec.ids?.quotationId) parts.push(`quotationId=${spec.ids.quotationId}`);
    if (spec.ids?.rateId) parts.push(`rateId=${spec.ids.rateId}`);
    if (providerCode) parts.push(`providerCode=${providerCode}`);
    if (reason) parts.push(`reason=${reason}`);
    this.logger[level](parts.join(' '));
  }
}

async function safeText(res: TransportResponse): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/** `undefined` ⇔ no es JSON. */
function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** §19.19.3 (0): `403` cuyo cuerpo no es JSON o contiene `1010`/`browser_signature_banned` ⇒ borde. */
export function isEdgeBlock(body: string): boolean {
  if (/1010|browser_signature_banned/i.test(body)) return true;
  return parseJson(body) === undefined;
}

function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, at - now), RETRY_AFTER_CAP_MS);
}

/** Código y mensaje del rechazo, cortos y sin el cuerpo entero (la pantalla los muestra en llano, T.4.5). */
function rejectionOf(json: unknown): { providerCode: string | null; providerMessage: string | null } {
  if (!json || typeof json !== 'object') return { providerCode: null, providerMessage: null };
  const o = json as Record<string, unknown>;
  const code =
    (typeof o.error_code === 'string' && o.error_code) ||
    (typeof o.code === 'string' && o.code) ||
    (typeof o.error === 'string' && o.error) ||
    null;
  let message =
    (typeof o.message === 'string' && o.message) ||
    (typeof o.error_description === 'string' && o.error_description) ||
    null;
  if (!message && o.errors && typeof o.errors === 'object') message = flattenErrors(o.errors, '');
  return { providerCode: code, providerMessage: message ? message.slice(0, 300) : null };
}

function flattenErrors(node: unknown, prefix: string): string {
  if (Array.isArray(node)) return `${prefix}: ${node.filter((x) => typeof x === 'string').join(', ')}`;
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>)
      .map(([k, v]) => flattenErrors(v, prefix ? `${prefix}.${k}` : k))
      .join('; ');
  }
  return typeof node === 'string' ? `${prefix}: ${node}` : '';
}
