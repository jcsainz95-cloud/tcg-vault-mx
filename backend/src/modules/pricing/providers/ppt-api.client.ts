import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * PptApiClient — cliente HTTP COMPARTIDO del proveedor de PAGA PokemonPriceTracker (API v2), usado
 * tanto por el `PptSetMapper` (`GET /api/v2/sets`) como por el `PokemonPriceTrackerBulkProvider`
 * (`GET /api/v2/cards`). Centraliza en UN solo lugar el THROTTLE y la contabilidad de presupuesto,
 * que son la causa #3 del incidente de producción (114× HTTP 429).
 *
 * SEGURIDAD (idéntico patrón `PokemonTcgIoClient`):
 *  - **Host FIJO** (`https://www.pokemonpricetracker.com`, sin parte controlable) → sin SSRF. El
 *    cliente NUNCA acepta URLs arbitrarias; solo un `path` de allow-list y query params URL-encoded.
 *  - La API key se lee SOLO de `POKEMONPRICETRACKER_API_KEY` (ConfigService). NUNCA se hardcodea,
 *    se loguea ni viaja en la URL — va únicamente en el header `Authorization: Bearer …`.
 *
 * THROTTLE / 429 (contrato real del proveedor, doc del PO 2026-08-19). El cuerpo del 429 trae
 * `limitType: "daily" | "per_minute"`, y la respuesta trae `Retry-After` (segundos) + `resetsAt`:
 *  - **per_minute** → espera `Retry-After` (con jitter) y REINTENTA, hasta `maxPerMinuteRetries`.
 *  - **daily** → NO se reintenta (no resetea hasta 00:00 UTC): se lanza `PptDailyLimitError`, que es
 *    la señal de PARADA. Además el cliente marca `dailyLimited` en memoria → toda petición posterior
 *    en la MISMA corrida (mismo proceso/worker) corta de inmediato SIN pegarle al proveedor, para no
 *    quemar más cuota ni acumular 429. Se limpia solo tras `resetsAt` (o al reconstruir el proceso).
 *
 * PRESUPUESTO (money-safe, "parar antes de agotar"): se trackea `X-RateLimit-Daily-Remaining` de cada
 * respuesta y el `metadata.apiCallsConsumed`. El orquestador consulta `dailyRemaining()` y descuenta
 * un colchón antes de encolar el siguiente set. La concurrencia se acota fuera (fan-out), pero el
 * cliente además expone in-flight para que el presupuesto efectivo sea `remaining − inFlight`.
 */

/** Motivo de un 429 según `limitType` del cuerpo del proveedor. */
export type PptLimitType = 'daily' | 'per_minute' | 'unknown';

/** Resultado normalizado de un GET OK (cuerpo + metadatos de cuota para el presupuesto). */
export interface PptResponse<T> {
  body: T;
  /** `X-RateLimit-Daily-Remaining` de esta respuesta, o null si el proveedor no lo mandó. */
  dailyRemaining: number | null;
  /** `metadata.apiCallsConsumed` del cuerpo (si vino), para trackear el gasto real. */
  apiCallsConsumed: number | null;
  /** URL EXACTA (host+path+query, SIN credenciales) que respondió — observabilidad del log. */
  url: string;
}

/**
 * Error HTTP del proveedor con el CUERPO recortado y la URL (sin credenciales). Distingue un 4xx de
 * contrato (400/404) o auth (401/403) de un 5xx transitorio. NO cubre el 429 (ver errores de cuota).
 */
export class PptHttpError extends Error {
  constructor(
    readonly status: number,
    readonly bodySnippet: string,
    readonly url: string,
  ) {
    super(`HTTP ${status} en ${url}${bodySnippet ? ` — cuerpo: ${bodySnippet}` : ''}`);
    this.name = 'PptHttpError';
  }
}

/**
 * Límite DIARIO agotado (429 `limitType: "daily"`). Es la señal de PARADA: no se reintenta (no
 * resetea hasta 00:00 UTC). El llamador debe DETENER el barrido y reportar cuántos sets quedaron
 * pendientes. `resetsAt` (si vino) indica cuándo vuelve la cuota.
 */
export class PptDailyLimitError extends Error {
  constructor(
    readonly url: string,
    readonly resetsAt: string | null,
    readonly dailyRemaining: number | null,
  ) {
    super(`429 daily en ${url}${resetsAt ? ` — resetsAt=${resetsAt}` : ''}`);
    this.name = 'PptDailyLimitError';
  }
}

interface Parsed429 {
  limitType: PptLimitType;
  retryAfterMs: number | null;
  resetsAt: string | null;
}

@Injectable()
export class PptApiClient {
  private readonly logger = new Logger(PptApiClient.name);
  /** Host FIJO — no configurable por el usuario (anti-SSRF). */
  private readonly host = 'https://www.pokemonpricetracker.com';
  /** Reintentos ante un 429 `per_minute` (el `daily` NUNCA se reintenta). */
  private readonly maxPerMinuteRetries = 4;
  /** Backoff base cuando el 429 no trae `Retry-After`. */
  private readonly baseBackoffMs = 2000;

  /** Última lectura de `X-RateLimit-Daily-Remaining` (presupuesto vivo para el orquestador). */
  private lastDailyRemaining: number | null = null;
  /** Peticiones en vuelo (presupuesto efectivo = remaining − inFlight). */
  private inFlight = 0;
  /** Epoch ms hasta el que el límite DIARIO está agotado; corta las peticiones sin pegarle al server. */
  private dailyLimitedUntil: number | null = null;
  private dailyResetsAtIso: string | null = null;

  constructor(private readonly config: ConfigService) {}

  /** La API key configurada (o null/`CHANGE_ME` = sin key → el llamador degrada money-safe). */
  apiKey(): string | null {
    const key = this.config.get<string>('POKEMONPRICETRACKER_API_KEY');
    return key && key !== 'CHANGE_ME' ? key : null;
  }

  /** Presupuesto diario vivo restante (última respuesta), o null si el proveedor no lo reporta. */
  dailyRemaining(): number | null {
    return this.lastDailyRemaining;
  }

  /** Presupuesto EFECTIVO = remaining − inFlight (colchón para no pasarse por concurrencia). */
  effectiveRemaining(): number | null {
    return this.lastDailyRemaining == null ? null : this.lastDailyRemaining - this.inFlight;
  }

  /** ¿El límite DIARIO está agotado ahora mismo? (para cortar la corrida sin más requests). */
  isDailyLimited(): boolean {
    if (this.dailyLimitedUntil == null) return false;
    if (Date.now() >= this.dailyLimitedUntil) {
      // Ya pasó `resetsAt` → se limpia el candado y se puede volver a intentar.
      this.dailyLimitedUntil = null;
      this.dailyResetsAtIso = null;
      return false;
    }
    return true;
  }

  /** ISO de `resetsAt` del límite diario vigente (para el reporte de pendientes). */
  dailyResetsAt(): string | null {
    return this.dailyResetsAtIso;
  }

  /** Espera cancelable, aislada para poder mockear timers en test. */
  protected async sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * GET con throttle. `path` es de allow-list (`/api/v2/sets`, `/api/v2/cards`); `query` se
   * URL-encodea. Devuelve el cuerpo + metadatos de cuota. Lanza:
   *  - `PptDailyLimitError` si el límite diario está agotado (señal de PARADA; NO reintenta).
   *  - `PptHttpError` ante 4xx/5xx no-429 (tras agotar reintentos de per_minute no aplica aquí).
   *  El llamador es responsable del money-safe (no borrar precios ante fallo).
   */
  async getJson<T>(path: string, query: Record<string, string>): Promise<PptResponse<T>> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      throw new PptHttpError(0, 'sin POKEMONPRICETRACKER_API_KEY', `${this.host}${path}`);
    }
    const qs = new URLSearchParams(query);
    // URL sin credenciales: el token va SOLO en el header Authorization, jamás en el query.
    const url = `${this.host}${path}?${qs.toString()}`;

    // Candado diario: si ya sabemos que la cuota está agotada, cortamos SIN pegarle al proveedor.
    if (this.isDailyLimited()) {
      throw new PptDailyLimitError(url, this.dailyResetsAtIso, this.lastDailyRemaining);
    }

    this.inFlight += 1;
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });

        // Presupuesto: registra el remaining de CUALQUIER respuesta (incluida 429).
        this.captureDailyRemaining(res);

        if (res.status === 429) {
          const parsed = await this.parse429(res);
          if (parsed.limitType === 'daily') {
            // Candado en memoria hasta `resetsAt` (o +1h por defecto) → corta el resto de la corrida.
            this.dailyResetsAtIso = parsed.resetsAt;
            this.dailyLimitedUntil = this.resetEpoch(parsed.resetsAt);
            this.logger.warn(
              `PPT ${path}: 429 DAILY (cuota diaria agotada) → PARADA. resetsAt=${parsed.resetsAt ?? 'n/d'}, ` +
                `remaining=${this.lastDailyRemaining ?? 'n/d'}. No se reintenta hasta 00:00 UTC.`,
            );
            throw new PptDailyLimitError(url, parsed.resetsAt, this.lastDailyRemaining);
          }
          // per_minute (o desconocido): espera Retry-After (o backoff con jitter) y reintenta.
          if (attempt >= this.maxPerMinuteRetries) {
            const body = truncate(await safeText(res), 300);
            throw new PptHttpError(429, `per_minute agotó reintentos — ${body}`, url);
          }
          const waitMs = parsed.retryAfterMs ?? this.backoffWithJitter(attempt);
          this.logger.warn(
            `PPT ${path}: 429 ${parsed.limitType} → espera ${waitMs}ms y reintenta ` +
              `(${attempt + 1}/${this.maxPerMinuteRetries}).`,
          );
          await this.sleep(waitMs);
          continue;
        }

        if (!res.ok) {
          // 4xx/5xx no-429: NO se reintenta aquí (el foco del throttle es el 429). Un 5xx transitorio
          // se trata como fallo → el llamador es money-safe (0 filas, no borra precios).
          const body = truncate(await safeText(res), 300);
          throw new PptHttpError(res.status, body, url);
        }

        const body = (await res.json()) as T;
        return {
          body,
          dailyRemaining: this.lastDailyRemaining,
          apiCallsConsumed: extractApiCallsConsumed(body),
          url,
        };
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  /** Lee `X-RateLimit-Daily-Remaining` (tolerante a variantes de nombre) y lo guarda. */
  private captureDailyRemaining(res: { headers: { get(name: string): string | null } }): void {
    for (const name of ['X-RateLimit-Daily-Remaining', 'x-ratelimit-daily-remaining', 'X-Daily-Remaining']) {
      const raw = res.headers?.get?.(name);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n)) {
        this.lastDailyRemaining = n;
        return;
      }
    }
  }

  /** Parsea el 429: `limitType`, `Retry-After` (header o cuerpo, en segundos), `resetsAt`. */
  private async parse429(res: {
    headers: { get(name: string): string | null };
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }): Promise<Parsed429> {
    let bodyObj: Record<string, unknown> = {};
    try {
      const parsed = typeof res.json === 'function' ? await res.json() : null;
      if (parsed && typeof parsed === 'object') bodyObj = parsed as Record<string, unknown>;
    } catch {
      /* cuerpo no-JSON: se ignora, se cae a los headers */
    }
    const rawType = String(bodyObj['limitType'] ?? bodyObj['type'] ?? '').toLowerCase();
    const limitType: PptLimitType =
      rawType === 'daily' ? 'daily' : rawType === 'per_minute' || rawType === 'perminute' ? 'per_minute' : 'unknown';

    const headerRetry = Number(res.headers?.get?.('retry-after'));
    const bodyRetry = Number(bodyObj['retryAfter'] ?? bodyObj['retry_after']);
    const retrySec = Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : Number.isFinite(bodyRetry) && bodyRetry > 0 ? bodyRetry : null;

    const resetsAt =
      typeof bodyObj['resetsAt'] === 'string'
        ? (bodyObj['resetsAt'] as string)
        : res.headers?.get?.('x-ratelimit-reset') ?? null;

    return { limitType, retryAfterMs: retrySec == null ? null : retrySec * 1000, resetsAt };
  }

  /** Backoff exponencial con jitter (±25%) para no sincronizar reintentos entre sets. */
  private backoffWithJitter(attempt: number): number {
    const base = this.baseBackoffMs * 2 ** attempt;
    // Jitter DETERMINISTA por intento (no usa Math.random, prohibido en algunos runtimes): ±25%
    // en función del intento, suficiente para escalonar sin depender de aleatoriedad real.
    const factor = 0.75 + ((attempt % 4) / 4) * 0.5;
    return Math.round(base * factor);
  }

  /** Epoch ms del `resetsAt` (o +1h por defecto si el proveedor no lo mandó). */
  private resetEpoch(resetsAt: string | null): number {
    if (resetsAt) {
      const t = Date.parse(resetsAt);
      if (Number.isFinite(t) && t > Date.now()) return t;
    }
    return Date.now() + 60 * 60 * 1000;
  }
}

/** `metadata.apiCallsConsumed` del cuerpo v2 (si vino), para trackear el gasto real de créditos. */
function extractApiCallsConsumed(body: unknown): number | null {
  if (body && typeof body === 'object') {
    const meta = (body as Record<string, unknown>)['metadata'];
    if (meta && typeof meta === 'object') {
      const n = Number((meta as Record<string, unknown>)['apiCallsConsumed']);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function safeText(res: { text?: () => Promise<string> }): Promise<string> {
  try {
    return typeof res.text === 'function' ? await res.text() : '';
  } catch {
    return '';
  }
}
