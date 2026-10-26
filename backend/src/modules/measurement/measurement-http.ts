/**
 * measurement-http.ts — el ÚNICO sitio por el que la medición sale a la red (GA4 Measurement Protocol y Meta CAPI).
 * Puerto inyectable: las pruebas lo sustituyen por un doble (⛔ no hay red a Google/Meta desde CI ni desde aquí).
 *
 * ⛔ Este módulo no registra nada: ni URL (lleva `api_secret`), ni cuerpo, ni error del proveedor.
 *  - `postJson` (drenador): devuelve solo el código HTTP; un fallo de red/timeout se devuelve como `null` (reintentable).
 *  - `postMetaDiagnostic` (evento de prueba, API_CONTRACT §MKT.H.12): devuelve el código y, del JSON de Meta, SOLO los
 *    campos de la lista cerrada (`sanitizeMetaDiagnostic`), cada texto redactado (token ⇒ `[token]`) y recortado.
 */
export const MEASUREMENT_HTTP = Symbol('MEASUREMENT_HTTP');

/** Lo único que se conserva de la respuesta de Meta (§MKT.H.12). `httpStatus: null` = red/timeout. */
export interface MetaDiagnostic {
  httpStatus: number | null;
  eventsReceived: number | null;
  fbtraceId: string | null;
  messages: string[];
  error: { code: number | null; subcode: number | null; type: string | null; message: string | null } | null;
}

export interface MeasurementHttp {
  /** POST JSON. Devuelve el código HTTP o `null` si no hubo respuesta (red, DNS, timeout). ⛔ Nunca lanza. */
  postJson(url: string, body: unknown, timeoutMs: number): Promise<number | null>;
  /**
   * POST JSON a Meta y lectura ACOTADA de la respuesta (evento de prueba). El token a redactar es `body.access_token`.
   * ⛔ Nunca lanza.
   */
  postMetaDiagnostic(url: string, body: unknown, timeoutMs: number): Promise<MetaDiagnostic>;
}

/** Tope de cada texto que sale de Meta (§MKT.H.12). */
export const META_TEXT_MAX = 300;
/** Tope de `messages` (§MKT.H.12). */
export const META_MESSAGES_MAX = 5;
/** Tope de lectura del cuerpo de Meta (defensa: no se parsea un cuerpo arbitrario). */
const META_BODY_MAX_BYTES = 64 * 1024;

const REDACTED = '[token]';

/**
 * Redacta y recorta. Orden: PRIMERO se redacta y DESPUÉS se recorta (al revés, un token partido por el corte dejaría su
 * prefijo en claro). Se redacta el token literal y cualquier `access_token=<valor>` (Meta puede citar la URL o el cuerpo).
 */
export function redactMetaText(text: string, token: string | null): string {
  let out = text;
  if (token) out = out.split(token).join(REDACTED);
  out = out.replace(/access_token=[^\s&"',;)]*/gi, REDACTED);
  return out.length > META_TEXT_MAX ? out.slice(0, META_TEXT_MAX) : out;
}

function str(v: unknown, token: string | null): string | null {
  return typeof v === 'string' ? redactMetaText(v, token) : null;
}
function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/** Del JSON de Meta toma SOLO `events_received`, `fbtrace_id`, `messages` (≤ 5) y `error.{code, error_subcode, type, message}`. */
export function sanitizeMetaDiagnostic(httpStatus: number | null, json: unknown, token: string | null): MetaDiagnostic {
  const j = json !== null && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const err = j.error !== null && typeof j.error === 'object' && !Array.isArray(j.error) ? (j.error as Record<string, unknown>) : null;
  const messages = Array.isArray(j.messages)
    ? j.messages
        .slice(0, META_MESSAGES_MAX)
        .map((m) => str(m, token))
        .filter((m): m is string => m !== null)
    : [];
  return {
    httpStatus,
    eventsReceived: int(j.events_received),
    fbtraceId: str(j.fbtrace_id, token) ?? (err ? str(err.fbtrace_id, token) : null),
    messages,
    error: err
      ? { code: int(err.code), subcode: int(err.error_subcode), type: str(err.type, token), message: str(err.message, token) }
      : null,
  };
}

function tokenOf(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const t = (body as { access_token?: unknown }).access_token;
  return typeof t === 'string' && t !== '' ? t : null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Implementación real sobre un `fetch` (por defecto el global de Node ≥ 18). Las pruebas pasan uno falso. */
export function makeFetchMeasurementHttp(fetchImpl: FetchLike = (u, i) => fetch(u, i)): MeasurementHttp {
  return {
    async postJson(url, body, timeoutMs) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        // El cuerpo de la respuesta no se lee ni se guarda (⛔ texto de error del proveedor).
        await res.body?.cancel().catch(() => undefined);
        return res.status;
      } catch {
        return null;
      }
    },

    async postMetaDiagnostic(url, body, timeoutMs) {
      const token = tokenOf(body);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return sanitizeMetaDiagnostic(null, null, token);
      }
      let json: unknown = null;
      try {
        const text = await res.text();
        if (text.length <= META_BODY_MAX_BYTES) json = JSON.parse(text);
      } catch {
        json = null;
      }
      return sanitizeMetaDiagnostic(res.status, json, token);
    },
  };
}

export const fetchMeasurementHttp: MeasurementHttp = makeFetchMeasurementHttp();
