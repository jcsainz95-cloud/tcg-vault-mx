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

/** Cliente REST/JSON tipado contra NEXT_PUBLIC_API_BASE_URL (contrato §0). */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return requestWithRefresh<T>(path, opts, true);
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

  const token = getToken();
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
