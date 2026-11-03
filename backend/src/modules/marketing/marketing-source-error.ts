/**
 * marketing-source-error.ts — CLASE de un error de lectura externa (GA4 / Search Console) para el registro, sin filtrar nada.
 * PURO: sin red, sin Nest.
 *
 * Por qué existe: el registro de producción solo decía «lectura externa fallida (sc)» (15/15 líneas, 2026-11-03) y nadie
 * podía saber por qué. El mensaje del error NO se puede registrar (cita la URL, el sitio, el cuerpo o el correo de la
 * cuenta de servicio). Aquí se extrae solo lo que cae en una LISTA CERRADA:
 *   http=<100-599>            código HTTP numérico (`err.response.status` / `err.status` de gaxios);
 *   reason=<status>           `error.status` de Google (enum google.rpc.Code) si está en la lista blanca;
 *   detalle=<reason>          `error.details[].reason` (ErrorInfo) o `error.errors[].reason` (formato v3) en lista blanca;
 *   token=<error>             error OAuth del endpoint de token (`{error:'invalid_grant'}`) en lista blanca;
 *   red=<code>                código de error de red/TLS de Node en lista blanca (o TIMEOUT / ABORT);
 *   cripto=<code>             código OpenSSL al firmar el JWT (llave mal pegada) en lista blanca, si no `cripto=otro`;
 *   otro [tipo=<Name>]        nada de lo anterior (con el nombre de la clase si está en lista blanca).
 * Cualquier valor fuera de lista ⇒ `otro` (⛔ nunca se copia el texto recibido).
 */

const GOOGLE_STATUS = new Set([
  'CANCELLED', 'UNKNOWN', 'INVALID_ARGUMENT', 'DEADLINE_EXCEEDED', 'NOT_FOUND', 'ALREADY_EXISTS', 'PERMISSION_DENIED',
  'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'ABORTED', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'INTERNAL',
  'UNAVAILABLE', 'DATA_LOSS',
]);

const GOOGLE_DETAIL = new Set([
  // ErrorInfo.reason (googleapis.com)
  'SERVICE_DISABLED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'ACCESS_TOKEN_TYPE_UNSUPPORTED', 'ACCESS_TOKEN_EXPIRED',
  'RATE_LIMIT_EXCEEDED', 'CONSUMER_INVALID', 'USER_PROJECT_DENIED', 'API_KEY_SERVICE_BLOCKED', 'IAM_PERMISSION_DENIED',
  // errors[].reason (formato v3: Search Console webmasters/v3)
  'forbidden', 'insufficientPermissions', 'notFound', 'invalid', 'badRequest', 'required', 'rateLimitExceeded',
  'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'authError', 'accessNotConfigured', 'backendError',
]);

const OAUTH_ERROR = new Set([
  'invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied', 'invalid_request', 'invalid_scope',
  'unsupported_grant_type', 'server_error', 'temporarily_unavailable', 'invalid_token',
]);

const NET_CODE = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
  'EPIPE', 'EPROTO', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const CRYPTO_CODE = new Set([
  'ERR_OSSL_UNSUPPORTED', 'ERR_OSSL_PEM_NO_START_LINE', 'ERR_OSSL_PEM_BAD_END_LINE', 'ERR_OSSL_PEM_BAD_BASE64_DECODE',
  'ERR_OSSL_ASN1_WRONG_TAG', 'ERR_OSSL_ASN1_HEADER_TOO_LONG', 'ERR_OSSL_ASN1_NOT_ENOUGH_DATA', 'ERR_OSSL_BAD_DECRYPT',
  'ERR_INVALID_ARG_TYPE', 'ERR_CRYPTO_SIGN_KEY_REQUIRED',
]);

const ERROR_NAME = new Set(['TypeError', 'SyntaxError', 'RangeError', 'AbortError', 'FetchError', 'GaxiosError']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const pick = (v: unknown, allowed: Set<string>): string => (typeof v === 'string' && allowed.has(v) ? v : 'otro');

function bodyOf(err: Obj): Obj | null {
  const res = err.response;
  if (!isObj(res)) return null;
  let data = res.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return isObj(data) ? data : null;
}

function httpOf(err: Obj): number | null {
  const res = err.response;
  const s = isObj(res) ? res.status : err.status;
  return typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599 ? s : null;
}

function googleDetailOf(e: Obj): string | null {
  const details = Array.isArray(e.details) ? e.details : [];
  const errors = Array.isArray(e.errors) ? e.errors : [];
  const reasons = [...details, ...errors].filter(isObj).map((d) => d.reason).filter((r) => r !== undefined);
  if (reasons.length === 0) return null;
  return reasons.map((r) => pick(r, GOOGLE_DETAIL)).find((r) => r !== 'otro') ?? 'otro';
}

/** La clase del error en tokens `clave=valor` de lista cerrada. Nunca lanza. */
export function classifySourceError(err: unknown): string {
  try {
    if (!isObj(err)) return 'otro';
    const out: string[] = [];
    const http = httpOf(err);
    if (http !== null) out.push(`http=${http}`);

    const body = bodyOf(err);
    if (body) {
      if (isObj(body.error)) {
        // Formato de las APIs de Google: { error: { code, message, status, details|errors } }
        if (body.error.status !== undefined) out.push(`reason=${pick(body.error.status, GOOGLE_STATUS)}`);
        const det = googleDetailOf(body.error);
        if (det !== null) out.push(`detalle=${det}`);
      } else if (body.error !== undefined) {
        // Formato OAuth del endpoint de token: { error: 'invalid_grant', error_description }
        out.push(`token=${pick(body.error, OAUTH_ERROR)}`);
      }
    }

    const inner = isObj(err.error) ? err.error : null;
    const code = str(err.code) ?? (inner ? str(inner.code) : undefined);
    const type = str(err.type) ?? (inner ? str(inner.type) : undefined);
    const name = str(err.name);
    if (code !== undefined && NET_CODE.has(code)) out.push(`red=${code}`);
    else if (type === 'request-timeout') out.push('red=TIMEOUT');
    else if (name === 'AbortError' || (inner && str(inner.name) === 'AbortError')) out.push('red=ABORT');
    else if (code !== undefined && (code.startsWith('ERR_OSSL') || CRYPTO_CODE.has(code))) out.push(`cripto=${pick(code, CRYPTO_CODE)}`);

    if (out.length > 0) return out.join(' ');
    return name !== undefined && ERROR_NAME.has(name) ? `otro tipo=${name}` : 'otro';
  } catch {
    return 'otro';
  }
}
