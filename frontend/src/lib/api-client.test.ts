import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiRequest,
  ApiClientError,
  getToken,
  setToken,
  getRefreshToken,
  setRefreshToken,
} from './api-client';
import { getStoredUser, setStoredUser } from './session';
import type { UserDTO } from '@/types/contract';

// WS-B — pruebas del interceptor de refresh de apiRequest (api-client.ts). Se ejercita
// la rama REAL (apiRequest no consulta config.useMocks; el mock branching vive en api.ts),
// mockeando `fetch` y localStorage (jsdom). Verifican: 401 → refresh → reintento OK;
// refresh falla → sesión limpiada; y que NO hay bucle (un solo reintento).

const mockUser: UserDTO = {
  id: 'u1',
  email: 'cliente@example.com',
  name: 'Cliente Demo',
  role: 'customer',
  locale: 'es',
};

/** Response mínima compatible con lo que consume api-client (status/ok/json). */
function makeRes(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const UNAUTH = { error: { code: 'UNAUTHENTICATED', message: 'Access token expired' } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Estado limpio de sesión antes de cada caso.
  setToken(null);
  setRefreshToken(null);
  setStoredUser(null);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api-client · interceptor de refresh (WS-B)', () => {
  it('401 → refresh → reintenta UNA vez con el token nuevo y resuelve OK', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    fetchMock
      .mockResolvedValueOnce(makeRes(401, UNAUTH)) // request original (access token vencido)
      .mockResolvedValueOnce(makeRes(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })) // /auth/refresh
      .mockResolvedValueOnce(makeRes(200, { data: [], total: 0 })); // reintento

    const result = await apiRequest<{ data: unknown[]; total: number }>('/vault/holdings');
    expect(result).toEqual({ data: [], total: 0 });

    // 3 llamadas exactas: original + refresh + un solo reintento.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // La segunda llamada es POST /auth/refresh con el refresh token vigente en el body.
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
    expect(String(refreshUrl)).toContain('/auth/refresh');
    expect(refreshInit.method).toBe('POST');
    expect(JSON.parse(refreshInit.body as string)).toEqual({ refreshToken: 'old-refresh' });

    // El reintento usa el ACCESS TOKEN NUEVO en el header Authorization.
    const [, retryInit] = fetchMock.mock.calls[2];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer new-access');

    // El TokenPair nuevo quedó persistido (rotación de tokens).
    expect(getToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('new-refresh');
  });

  it('refresh falla (401) → limpia la sesión y propaga el 401 original (sin reintento)', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    setStoredUser(mockUser);
    fetchMock
      .mockResolvedValueOnce(makeRes(401, UNAUTH)) // request original
      .mockResolvedValueOnce(makeRes(401, { error: { code: 'UNAUTHENTICATED', message: 'bad refresh' } })); // refresh rechazado

    await expect(apiRequest('/vault/holdings')).rejects.toBeInstanceOf(ApiClientError);

    // Solo 2 llamadas: original + refresh. NO se reintenta la request original.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Sesión completamente limpiada (access + refresh + user) → deslogueado.
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('propaga el status 401 al caller cuando el refresh falla', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    fetchMock
      .mockResolvedValueOnce(makeRes(401, UNAUTH))
      .mockResolvedValueOnce(makeRes(401, UNAUTH));

    await expect(apiRequest('/vault/holdings')).rejects.toMatchObject({ status: 401 });
  });

  it('NO hace bucle: si el reintento sigue en 401, no refresca de nuevo (un solo reintento)', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    setStoredUser(mockUser);
    fetchMock
      .mockResolvedValueOnce(makeRes(401, UNAUTH)) // original
      .mockResolvedValueOnce(makeRes(200, { accessToken: 'new-access', refreshToken: 'new-refresh' })) // refresh OK
      .mockResolvedValueOnce(makeRes(401, UNAUTH)) // reintento SIGUE 401
      .mockResolvedValue(makeRes(200, { data: [] })); // red de seguridad: cualquier 4ª llamada NO debe ocurrir

    await expect(apiRequest('/vault/holdings')).rejects.toMatchObject({ status: 401 });

    // Exactamente 3: original + refresh + UN reintento. Nunca un 2º refresh ni un 2º reintento.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Con token fresco que igual da 401, la sesión local no es de fiar → se limpia.
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('sin refresh token: un 401 propaga tal cual, sin intentar refrescar', async () => {
    setToken('old-access');
    // sin refresh token en storage
    fetchMock.mockResolvedValueOnce(makeRes(401, UNAUTH));

    await expect(apiRequest('/vault/holdings')).rejects.toMatchObject({ status: 401 });
    // Una sola llamada: no hay refresh token que canjear.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rutas /auth/*: un 401 NO dispara refresh (evita bucle y no borra sesión por credenciales inválidas)', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    fetchMock.mockResolvedValueOnce(
      makeRes(401, { error: { code: 'INVALID_CREDENTIALS', message: 'nope' } }),
    );

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: { email: 'x@y.z', password: 'bad' } }),
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });

    // Ni refresh ni reintento: /auth/* se salta el interceptor.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // El refresh token NO se toca por un 401 de credenciales en login.
    expect(getRefreshToken()).toBe('old-refresh');
  });

  it('errores no-401 (p. ej. 422) propagan sin intentar refrescar', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    fetchMock.mockResolvedValueOnce(
      makeRes(422, { error: { code: 'VALIDATION_ERROR', message: 'bad' } }),
    );

    await expect(apiRequest('/buylist/requests', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Sesión intacta.
    expect(getToken()).toBe('old-access');
    expect(getRefreshToken()).toBe('old-refresh');
  });

  it('caso feliz: un 200 no dispara ningún refresh', async () => {
    setToken('acc');
    setRefreshToken('ref');
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true }));

    const res = await apiRequest<{ ok: boolean }>('/users/me');
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
