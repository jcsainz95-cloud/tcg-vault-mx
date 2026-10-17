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
 * `GET /card-show/form-token?purpose=leads|players` emite un token firmado (§CARDSHOW.5). El backend
 * responde `{ formToken: string }` (ver `card-show.controller.ts`), NO `{ token }`: por eso se lee
 * `formToken`. El parámetro de consulta es `?purpose=`.
 * NOTA al arquitecto: §CARDSHOW.5 no fija por escrito el nombre del campo de respuesta; aquí se
 * sigue la implementación del backend (`formToken`).
 */
export async function getFormToken(purpose: FormPurpose): Promise<string> {
  const res = await fetch(url(`/form-token?purpose=${purpose}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 429) throw new CardShowApiError(429, 'RATE_LIMITED', 'rate limited', undefined, parseRetryAfter(res));
  if (!res.ok) throw new CardShowApiError(res.status, 'FORM_TOKEN_ERROR', 'no se pudo emitir el token');
  const body = (await res.json().catch(() => null)) as { formToken?: string } | null;
  if (!body?.formToken) throw new CardShowApiError(res.status, 'FORM_TOKEN_ERROR', 'respuesta sin token');
  return body.formToken;
}

/** Cuerpo común a los dos formularios: token, consentimiento, honeypot y atribución. */
export interface BaseSubmitBody {
  /** Token de formulario firmado (§CARDSHOW.5). El DTO del backend exige la clave `formToken`. */
  formToken: string;
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

/** Juego del torneo / interés (enum `CardShowGame`, §Enums; +`shardbugs` M-85/v1.97). */
export type CardShowGame = 'pokemon' | 'riftbound' | 'lorcana' | 'shardbugs';

/**
 * Cuerpo de `POST /card-show/leads` (§CARDSHOW.1/.1b, v1.96 M-84). DTO único; las reglas
 * condicionales por `type` las valida el backend (⇒ `400 {field}` si se violan). El frontend sólo
 * envía los campos que corresponden al tipo:
 *  - `visitor`: `name`, `email`, `gameInterest?`, `raffleOptIn?` (+ `raffleTermsVersion` ⇔ opt-in).
 *    ⛔ `phone`/`sellsWhat` PROHIBIDOS.
 *  - `merchant`/`sponsor`: `name` (nombre o marca), `phone`, `email`, `sellsWhat?`.
 *    ⛔ `gameInterest`/`raffleOptIn`/`raffleTermsVersion` PROHIBIDOS.
 */
export interface LeadSubmitBody extends BaseSubmitBody {
  /** Un tipo ⇒ una fila (§CARDSHOW.1). */
  type: 'merchant' | 'sponsor' | 'visitor';
  source: 'cta_hero' | 'cta_mesas' | 'cta_patrocinio' | 'header';
  /** Nombre o MARCA — obligatorio en todos los tipos (§CARDSHOW.1b). */
  name: string;
  email: string;
  /** Teléfono MX — SOLO merchant/sponsor (⛔ prohibido visitor). */
  phone?: string;
  /** Juego de interés — SOLO visitor, opcional (⛔ prohibido merchant/sponsor). */
  gameInterest?: CardShowGame;
  /** Participa en la rifa — SOLO visitor (⛔ prohibido merchant/sponsor). */
  raffleOptIn?: boolean;
  /** Versión de BASES de la rifa — obligatorio ⇔ `raffleOptIn=true`. */
  raffleTermsVersion?: string;
  /** «¿Qué vendes / qué marca?» — opcional merchant/sponsor (⛔ prohibido visitor). */
  sellsWhat?: string;
}

/**
 * Cuerpo de `POST /card-show/players` (§CARDSHOW.1/.12, v1.96 M-84). `game` obligatorio:
 *  - `pokemon` = FORMAL ⇒ `playerId` OBLIGATORIO (solo dígitos).
 *  - `riftbound`/`lorcana`/`shardbugs` = LIGERA ⇒ `playerId` PROHIBIDO (no se envía).
 */
export interface PlayerSubmitBody extends BaseSubmitBody {
  game: CardShowGame;
  day: 'sat' | 'sun';
  playerName: string;
  /** Solo cuando `game==='pokemon'`; ⛔ ausente para los demás juegos (§CARDSHOW.12). */
  playerId?: string;
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

/**
 * Acciones del doble opt-in (Diseño A, §CARDSHOW.6 / ARCHITECTURE §4.CARDSHOW.f). La PÁGINA con
 * botón la sirve el frontend fuera del i18n (`/card-show/{confirm|cancel|unsubscribe}`); el GET ⛔ NO
 * muta (C4): el cambio de estado ocurre SOLO cuando el humano pulsa el botón y se dispara este POST.
 */
export type LinkAction = 'confirm' | 'cancel' | 'unsubscribe';

/**
 * Desglose POR DÍA de la confirmación de GRUPO «los dos días» (§CARDSHOW.12 ⭐M-88). `state` es un
 * `CardShowSignupStatus` (`confirmed | waitlist | …`). ADITIVO sobre `ConfirmResult`: ausente para
 * leads (no-torneo) y para la preinscripción de 1 solo día ⇒ en esos casos el copy no cambia.
 */
export interface ConfirmDayResult {
  day: 'sat' | 'sun';
  state: string;
}

/** Éxito: `200 { ok:true, state, days? }` — `state` es el nuevo estado de la fila (§CARDSHOW.1/.6). */
export interface LinkActionSuccess {
  ok: true;
  state?: string;
  /** Solo en `confirm` de un GRUPO de 2 días (§CARDSHOW.12 ⭐M-88); ausente en el resto. */
  days?: ConfirmDayResult[];
}
/**
 * Rechazo con mensaje (torneo lleno / Player ID ya preinscrito ese día, §CARDSHOW.12): el backend
 * devuelve `{ ok:false, message }` y la página muestra ESE `message` tal cual.
 */
export interface LinkActionRejected {
  ok: false;
  message: string;
}
export type LinkActionResult = LinkActionSuccess | LinkActionRejected;

/**
 * Normaliza el `days[]` del desglose por día (§CARDSHOW.12 ⭐M-88), defensivo ante formas inesperadas:
 * solo conserva entradas con `day ∈ {sat, sun}` y `state` string. Array vacío o ausente ⇒ `undefined`
 * (⇒ el copy de 1 día / leads no cambia).
 */
function parseConfirmDays(raw: unknown): ConfirmDayResult[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const days: ConfirmDayResult[] = [];
  for (const d of raw) {
    if (typeof d !== 'object' || d === null) continue;
    const { day, state } = d as { day?: unknown; state?: unknown };
    if ((day === 'sat' || day === 'sun') && typeof state === 'string') days.push({ day, state });
  }
  return days.length > 0 ? days : undefined;
}

/**
 * Ejecuta el cambio de estado del doble opt-in: `POST application/json { token }` a
 * `/api/v1/card-show/{confirm|cancel|unsubscribe}` (⚠️ JSON, NO `x-www-form-urlencoded`; §CARDSHOW.2).
 * Token de un solo uso (§CARDSHOW.6):
 *  - `200 { ok:true, state }` ⇒ éxito.
 *  - `200/4xx { ok:false, message }` ⇒ rechazo con mensaje a la vista (torneo lleno, §CARDSHOW.12).
 *  - `410` (token usado o caducado) ⇒ `CardShowApiError(410, 'GONE')`.
 *  - `429` ⇒ `CardShowApiError(429, 'RATE_LIMITED')` con `retryAfter` del `Retry-After`.
 *  - `400`/resto ⇒ `CardShowApiError` genérico.
 */
export async function postLinkAction(action: LinkAction, token: string): Promise<LinkActionResult> {
  const res = await fetch(url(`/${action}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ token }),
  });

  // Casos neutros por status (cuerpo irrelevante): token gastado/caducado y throttle.
  if (res.status === 410) throw new CardShowApiError(410, 'GONE', 'enlace usado o caducado');
  if (res.status === 429) {
    throw new CardShowApiError(429, 'RATE_LIMITED', 'rate limited', undefined, parseRetryAfter(res));
  }

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; state?: string; days?: unknown; message?: string; error?: { code?: string; message?: string; details?: Record<string, unknown> } }
    | null;

  // Rechazo con mensaje para la vista (torneo lleno / ya preinscrito): se muestra tal cual, venga en
  // un 2xx o en un 4xx.
  if (body && body.ok === false && typeof body.message === 'string') {
    return { ok: false, message: body.message };
  }
  if (res.ok) {
    return {
      ok: true,
      state: typeof body?.state === 'string' ? body.state : undefined,
      days: parseConfirmDays(body?.days),
    };
  }

  // 400 u otro error de forma: código del contrato si viene, genérico si no.
  const err = body?.error;
  throw new CardShowApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'error', err?.details);
}
