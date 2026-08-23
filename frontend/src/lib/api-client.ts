import { config } from './config';
import { setStoredUser } from './session';
import type { ApiError } from '@/types/contract';

export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(status: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

const TOKEN_KEY = 'tcg.accessToken';
// WS-B: el refresh token (TTL 30d, contrato §1) vive junto al access token (TTL 15m) para
// poder renovar la sesión sin re-login. Se persiste en persistSession y se limpia en logout
// (ambos en api.ts) y aquí en clearClientSession cuando el refresh falla.
const REFRESH_TOKEN_KEY = 'tcg.refreshToken';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
  else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Limpia por completo la sesión local (access token + refresh token + user) y notifica a
 * los `useSession` montados (vía setStoredUser). Se usa cuando el refresh falla / la sesión
 * ya no es de fiar: la app queda deslogueada y el flujo normal lleva al login.
 */
export function clearClientSession() {
  setToken(null);
  setRefreshToken(null);
  setStoredUser(null);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
}

/** Contrato §1: POST /auth/refresh { refreshToken } → { accessToken, refreshToken }. */
interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * WS-B: un 401 en un endpoint `/auth/*` es significativo por sí mismo (credenciales
 * inválidas, token de refresh vencido, etc.) y renovar-y-reintentar no tiene sentido ahí;
 * además el propio /auth/refresh NUNCA debe dispararse a sí mismo. Por eso el interceptor
 * de refresh se salta cualquier ruta de auth (evita bucles).
 */
function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/');
}

// WS-B: single-flight. Si varias requests reciben 401 a la vez, comparten UNA sola llamada a
// /auth/refresh. NO es por correctitud de invalidación: el backend firma el TokenPair nuevo con el
// tokenVersion VIGENTE y NO rota ni incrementa ni persiste nada (JWT stateless), así que el refresh
// token viejo sigue válido tras refrescar y dos refresh en paralelo NO se invalidan entre sí. El
// single-flight se mantiene para (a) evitar llamadas redundantes a /auth/refresh y (b) la carrera
// last-write-wins al persistir el par nuevo en localStorage (varios setToken/setRefreshToken
// pisándose). El resto reutiliza la misma promesa.
let refreshInFlight: Promise<TokenPair | null> | null = null;

/**
 * Canjea el refresh token por un TokenPair nuevo (contrato POST /auth/refresh) y lo persiste.
 * Usa `fetch` directo (NO apiRequest) para no re-entrar en el interceptor. Devuelve el par
 * nuevo, o `null` si no hay refresh token / el refresh es rechazado (401) / falla la red.
 */
async function refreshTokens(): Promise<TokenPair | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(config.apiBaseUrl + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null; // 401 → refresh inválido/expirado
    const payload = (await res.json().catch(() => null)) as Partial<TokenPair> | null;
    if (!payload?.accessToken || !payload?.refreshToken) return null;
    setToken(payload.accessToken);
    setRefreshToken(payload.refreshToken);
    return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
  } catch {
    return null; // error de red → tratar como fallo de refresh (no bloquear indefinidamente)
  }
}

/** Comparte una sola llamada de refresh entre requests concurrentes (single-flight). */
function refreshTokensShared(): Promise<TokenPair | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * v1.42 (menor, ruido 401): decodifica el `exp` (segundos epoch) del JWT de acceso SIN validar la
 * firma (solo para decidir REFRESH PROACTIVO en cliente; la autoridad sigue siendo el backend). El
 * access token dura 15m, así que tras un rato inactivo la PRIMERA request de cada navegación admin
 * llegaba garantizada a 401 (→ refresh → retry): funcionaba, pero el navegador pintaba el 401 en rojo
 * en consola en CADA navegación. Refrescar ANTES de disparar la request que de todos modos daría 401
 * elimina ese ruido en su origen (cliente), sin cambiar el fallback reactivo. Con `skewMs` de colchón
 * para tokens a punto de vencer. Token malformado/sin `exp` ⇒ `false` (no bloquea; cae al 401 reactivo).
 */
function isAccessTokenExpired(token: string, skewMs = 5_000): boolean {
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return Date.now() >= payload.exp * 1000 - skewMs;
  } catch {
    return false; // no se pudo decodificar → no asumir nada; el 401 reactivo sigue cubriendo.
  }
}

/** Cliente REST/JSON tipado contra NEXT_PUBLIC_API_BASE_URL (contrato §0). */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return requestWithRefresh<T>(path, opts, true);
}

export interface BlobResponse {
  blob: Blob;
  /** Nombre sugerido por el backend (Content-Disposition), o null si no vino. */
  filename: string | null;
}

/** Extrae el `filename` de una cabecera Content-Disposition (soporta `filename` y `filename*`). */
function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      /* cae al filename plano */
    }
  }
  const plain = /filename=(?:"([^"]+)"|([^;]+))/i.exec(header);
  if (plain) return (plain[1] ?? plain[2] ?? '').trim() || null;
  return null;
}

/**
 * Descarga binaria autenticada (p. ej. `GET /admin/inventory/export.xlsx`, P-31). Devuelve el
 * Blob + el `filename` que sugiera el backend por Content-Disposition (para que el caller lo use
 * y sólo caiga a un nombre propio si no viene). No usa el interceptor de refresh (una exportación
 * puntual no justifica reintento de token); un 401 u otro no-ok se traduce al MISMO
 * `ApiClientError` que el resto (el error se lee del JSON de error si el backend lo manda).
 */
export async function requestBlob(path: string, opts: RequestOptions = {}): Promise<BlobResponse> {
  const url = new URL(config.apiBaseUrl + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const token = getToken();
  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const err: ApiError = payload?.error ?? { code: 'INTERNAL', message: 'Unexpected error' };
    throw new ApiClientError(res.status, err);
  }
  return {
    blob: await res.blob(),
    filename: parseContentDispositionFilename(res.headers.get('Content-Disposition')),
  };
}

/**
 * Núcleo de apiRequest con interceptor de refresh (WS-B). `allowRefresh` habilita el
 * ciclo 401 → refresh → reintento; el reintento se hace con `allowRefresh=false` para
 * garantizar UN SOLO reintento (nunca un bucle).
 */
async function requestWithRefresh<T>(
  path: string,
  opts: RequestOptions,
  allowRefresh: boolean,
): Promise<T> {
  const url = new URL(config.apiBaseUrl + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }

  // v1.42 (menor, ruido 401): si el access token ya venció y tenemos refresh, renovamos ANTES de
  // disparar la request (que si no daría un 401 garantizado y ruidoso en cada navegación admin). El
  // single-flight evita renovar N veces; si el refresh falla, seguimos con el token viejo y el 401
  // reactivo de más abajo hace su trabajo (limpia sesión → login). Solo en el primer intento
  // (`allowRefresh`) y fuera de rutas de auth.
  let token = getToken();
  if (allowRefresh && !isAuthPath(path) && token && getRefreshToken() && isAccessTokenExpired(token)) {
    const pair = await refreshTokensShared();
    token = pair?.accessToken ?? getToken();
  }
  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  // WS-B — interceptor: el access token dura 15m; al vencer, cualquier request da 401.
  // Si hay refresh token y no es una ruta de auth, renovamos y reintentamos UNA vez.
  if (res.status === 401 && allowRefresh && !isAuthPath(path) && getRefreshToken()) {
    const pair = await refreshTokensShared();
    if (pair) {
      try {
        // Reintento único (allowRefresh=false ⇒ sin recursión de refresh ⇒ sin bucle).
        return await requestWithRefresh<T>(path, opts, false);
      } catch (e) {
        // Si aun con token fresco sigue 401, la sesión local no es de fiar → limpiar.
        if (e instanceof ApiClientError && e.status === 401) clearClientSession();
        throw e;
      }
    }
    // El refresh falló (sin refresh token / 401 / red): sesión muerta. Limpiar y dejar
    // que el 401 original propague para que el flujo normal lleve al login.
    clearClientSession();
  }

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = payload?.error ?? { code: 'INTERNAL', message: 'Unexpected error' };
    throw new ApiClientError(res.status, err);
  }
  return payload as T;
}
