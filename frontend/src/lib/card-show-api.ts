/**
 * Cliente PÚBLICO de la landing del Card Show (API_CONTRACT §CARDSHOW.2/.3/.5).
 *
 * ⛔ NO usa `api-client.ts`: ese añade `Authorization: Bearer` y el ciclo de refresh de sesión. Los
 * endpoints del Card Show son `@Public`, sin cuenta y sin cookie. Se llaman DIRECTO a
 * `/api/v1/card-show/*` (sin `/es`: el matcher del middleware excluye `api`).
 *
 * Respuesta neutra (§CARDSHOW.3): el alta devuelve `202 { ok: true }` para TODO caso silencioso
 * (alta nueva, repetida, honeypot, buzón de baja, corte…). El frontend NO intenta distinguirlos: un
 * 202 siempre pinta la misma pantalla de éxito «revisa tu correo». Solo la validación de forma
 * (§CARDSHOW.11.v) responde 400/413, y el token caducado 400 FORM_EXPIRED.
 */
import { config } from './config';

export type FormPurpose = 'leads' | 'players';

/** Error tipado de la landing: status + código del contrato (`error.code`) + `details`. */
export class CardShowApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  /** `Retry-After` en segundos cuando el status es 429 (§CARDSHOW.4). */
  retryAfter?: number;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, retryAfter?: number) {
    super(message);
    this.name = 'CardShowApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

function url(path: string): string {
  return config.apiBaseUrl + '/card-show' + path;
}

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('Retry-After');
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * ⚠️ HUECO DE CONTRATO (para el arquitecto): §CARDSHOW.5 dice que `GET /card-show/form-token` emite
 * un token firmado con `iat` y propósito, pero NO fija el nombre del parámetro (`?purpose=`) ni la
 * forma exacta de la respuesta. Aquí se asume `?purpose=leads|players` y `{ token: string }`.
 */
export async function getFormToken(purpose: FormPurpose): Promise<string> {
  const res = await fetch(url(`/form-token?purpose=${purpose}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 429) throw new CardShowApiError(429, 'RATE_LIMITED', 'rate limited', undefined, parseRetryAfter(res));
  if (!res.ok) throw new CardShowApiError(res.status, 'FORM_TOKEN_ERROR', 'no se pudo emitir el token');
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) throw new CardShowApiError(res.status, 'FORM_TOKEN_ERROR', 'respuesta sin token');
  return body.token;
}

/** Cuerpo común a los dos formularios: token, consentimiento, honeypot y atribución. */
export interface BaseSubmitBody {
  token: string;
  consent: boolean;
  /**
   * ⚠️ HUECO DE CONTRATO: §CARDSHOW.13 pide honeypot pero no nombra el campo. Se usa `website`;
   * el backend debe leer ESE nombre. (Un bot que lo rellene ⇒ 202 silencioso, §CARDSHOW.3.)
   */
  website?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  referrerHost?: string;
}

export interface LeadSubmitBody extends BaseSubmitBody {
  /** Un chip ⇒ una fila (§CARDSHOW.1): el body lleva UN tipo; varios chips ⇒ varios POST. */
  type: 'merchant' | 'sponsor' | 'visitor';
  source: 'cta_hero' | 'cta_mesas' | 'cta_patrocinio' | 'header';
  email: string;
  mesaInteres?: number;
}

export interface PlayerSubmitBody extends BaseSubmitBody {
  day: 'sat' | 'sun';
  playerName: string;
  playerId: string;
  email: string;
  isMinor: boolean;
  /** Obligatorio ⇔ isMinor === true (§CARDSHOW.12). */
  guardianConsent?: boolean;
}

/** Lee el cuerpo de error del contrato (`{ error: { code, message, details? } }`) o un genérico. */
async function toError(res: Response): Promise<CardShowApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
  const err = payload?.error;
  return new CardShowApiError(
    res.status,
    err?.code ?? (res.status === 429 ? 'RATE_LIMITED' : res.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'ERROR'),
    err?.message ?? 'error',
    err?.details,
    res.status === 429 ? parseRetryAfter(res) : undefined,
  );
}

async function submit(path: string, body: unknown): Promise<void> {
  const res = await fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  // 202 { ok: true } = caso silencioso idéntico (§CARDSHOW.3). Cualquier 2xx = éxito neutro.
  if (res.ok) return;
  throw await toError(res);
}

export function submitLead(body: LeadSubmitBody): Promise<void> {
  return submit('/leads', body);
}

export function submitPlayer(body: PlayerSubmitBody): Promise<void> {
  return submit('/players', body);
}
