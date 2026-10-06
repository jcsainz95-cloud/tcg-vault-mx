/**
 * LIVE-3 · SEC-HDR-2 — Content-Security-Policy con nonce por petición (API_CONTRACT §14.3,
 * ARCHITECTURE §4.63.3).
 *
 * Por qué nonce: la sesión vive en `localStorage` (`lib/api-client.ts`), así que la CSP es la segunda
 * barrera ante un XSS. Next inyecta `<script>` en línea con datos de cada página; un hash por
 * script es inviable y `'unsafe-inline'` en `script-src` anularía la barrera.
 *
 * `'strict-dynamic'` hace válidos los scripts que inserta un script con nonce: Stripe.js
 * (`loadStripe`, `StripePaymentModal.tsx`) y Google Identity (`GoogleSignInButton.tsx`,
 * `createElement('script')`). `https:` en `script-src` solo lo leen navegadores sin CSP3.
 *
 * Fuente única del texto de la política: el middleware la genera aquí y nada más la escribe.
 * Pruebas: `csp.test.ts` (texto), `middleware.test.ts` (CSP-1/CSP-6), `e2e/csp.spec.ts`
 * (CSP-2/CSP-5 contra el artefacto construido).
 */

export type CspMode = 'report-only' | 'enforce';

/**
 * Fase de la CSP (§14.3). ⛔ Constante en código, NO variable de Vercel: queda en el diff y no
 * depende de un paso del dueño que se pueda olvidar.
 *
 * 1. `report-only` (HOY): se publica en modo prueba de Stripe ≥ 72 h con el recorrido §14.9 fase A
 *    pasado al menos una vez; los informes llegan a `POST /telemetry/csp` (log `CSP_VIOLATION`).
 *    Cada violación legítima se resuelve añadiendo el ORIGEN EXACTO aquí, nunca con comodín de
 *    esquema ni `'unsafe-inline'` en `script-src`.
 * 2. `enforce`: solo tras medir el TTFB de `/es` (N = 10 antes/después, p90 ≤ 800 ms y subida
 *    ≤ 300 ms) y EN EL MISMO CAMBIO en que devops sube ZAP 10038/10055 a FAIL en
 *    `security/baseline.conf`. El candado `csp.test.ts` («fase vigente») se cambia junto.
 */
export const CSP_MODE: CspMode = 'report-only';

/** Origen de subida por defecto (R2) si `NEXT_PUBLIC_UPLOAD_ORIGIN` no está o no es un origen. */
export const DEFAULT_UPLOAD_ORIGIN = 'https://*.r2.cloudflarestorage.com';

/** Cabecera de petición por la que el layout/servidor puede leer el nonce. */
export const NONCE_HEADER = 'x-nonce';

const VERCEL_LIVE = 'https://vercel.live';

/** Hoja de estilos del botón de Google (§14.3 v1.84.1, E-4). Ruta exacta: CSP casa ruta si la hay. */
export const GOOGLE_GSI_STYLE = 'https://accounts.google.com/gsi/style';

export function cspHeaderName(mode: CspMode): string {
  return mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
}

/** 16 bytes aleatorios en base64 (128 bits). Funciona en el runtime edge y en Node. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface CspEnv {
  /** `NEXT_PUBLIC_API_BASE_URL` (con su ruta `/api/v1`). */
  apiBaseUrl: string;
  /** `NEXT_PUBLIC_UPLOAD_ORIGIN`: origen de las URL prefirmadas de la INE. */
  uploadOrigin?: string | null;
  /** `VERCEL_ENV`: `production` | `preview` | `development`. */
  vercelEnv?: string | null;
  /** `NODE_ENV`. */
  nodeEnv?: string | null;
}

/** Origen (`esquema://host[:puerto]`) de una URL absoluta http(s); `null` si no lo es. */
function httpOrigin(url: string | null | undefined): URL | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * Un origen de subida aceptable: `http(s)://host[:puerto]`, con como mucho un `*.` delante del host,
 * sin ruta ni nada más. Lo que no case cae a {@link DEFAULT_UPLOAD_ORIGIN}: un valor mal escrito en
 * Vercel no puede abrir la política (ni inyectar otra directiva con `;`).
 */
const ORIGIN_RE = /^https?:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/i;

function uploadOriginOf(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  return ORIGIN_RE.test(v) ? v.toLowerCase() : DEFAULT_UPLOAD_ORIGIN;
}

/** Política completa para un documento HTML. Ver §14.3 para cada directiva. */
export function buildCsp(nonce: string, env: CspEnv, mode: CspMode = CSP_MODE): string {
  const api = httpOrigin(env.apiBaseUrl);
  const apiOrigin = api?.origin ?? null;
  const preview = env.vercelEnv === 'preview';
  const dev = env.nodeEnv === 'development';

  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", 'https:'];
  // ⛔ Nunca en producción: solo `next dev` necesita eval (React Refresh).
  if (dev) script.push("'unsafe-eval'");

  const connect = ["'self'"];
  if (apiOrigin) connect.push(apiOrigin);
  connect.push('https://api.stripe.com', 'https://accounts.google.com', uploadOriginOf(env.uploadOrigin));

  const frame = [
    'https://js.stripe.com',
    'https://*.js.stripe.com',
    'https://hooks.stripe.com',
    'https://accounts.google.com',
  ];

  if (preview) {
    script.push(VERCEL_LIVE);
    frame.push(VERCEL_LIVE);
    connect.push(VERCEL_LIVE);
  }

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    // v1.84.1 (§14.14 E-4): la hoja del botón de Google Identity, RUTA EXACTA (no el host entero).
    // Fuente: guía de CSP de GIS, NO MEDIDA; la cierra CSP-4 en la fase Report-Only (sin informe
    // `CSP_VIOLATION` de style-src). Otro origen de Google que aparezca ⇒ se añade el exacto.
    `style-src 'self' 'unsafe-inline' ${GOOGLE_GSI_STYLE}`,
    // Deliberado (§14.3): el arte viene de hosts de terceros abiertos por dato; una imagen no ejecuta.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  // `upgrade-insecure-requests` solo en `enforce` (FRONTEND_NOTES §LIVE): en una política
  // Report-Only el navegador la IGNORA y escribe un aviso en consola en cada página — ruido que se
  // confunde con una violación en el recorrido §14.9 (A3, «sin violaciones CSP en consola»).
  // Y con la API en http (stack local) la mejora a https rompería las llamadas. En producción
  // (https) y en `enforce`, siempre va.
  if (mode === 'enforce' && api?.protocol !== 'http:') directives.push('upgrade-insecure-requests');
  if (apiOrigin) directives.push(`report-uri ${apiOrigin}${api!.pathname.replace(/\/+$/, '')}/telemetry/csp`);
  return directives.join('; ');
}

/** Entorno real del proceso (las `NEXT_PUBLIC_*` se hornean en el build del middleware). */
export function cspEnvFromProcess(): CspEnv {
  return {
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1',
    uploadOrigin: process.env.NEXT_PUBLIC_UPLOAD_ORIGIN,
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  };
}

/** Parser mínimo (pruebas y diagnóstico): directiva ⇒ lista de valores. */
export function parseCsp(policy: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const [name, ...values] = tokens;
    out[name.toLowerCase()] = values;
  }
  return out;
}
