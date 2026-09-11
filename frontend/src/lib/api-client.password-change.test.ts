import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiRequest,
  ApiClientError,
  getToken,
  setToken,
  setRefreshToken,
  setPasswordChangeNavigatorForTests,
} from './api-client';
import { getStoredUser, setStoredUser } from './session';
import type { UserDTO } from '@/types/contract';

/**
 * v1.67 — interceptor GLOBAL de `403 PASSWORD_CHANGE_REQUIRED` (contrato «Contraseña temporal
 * OBLIGATORIA»; DESIGN_SYSTEM §33.8 paso 4). Cubre la sesión guardada que no pasó por el login de
 * hoy: cualquier endpoint fuera de la allowlist responde 403 y el cliente navega a la página de
 * contraseña del rol reenviando la ruta actual. ⛔ NO es un 401: la sesión se conserva.
 */
function makeRes(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

const customer: UserDTO = { id: 'u1', email: 'c@example.com', name: 'C', role: 'customer', locale: 'es' };
const operator: UserDTO = { id: 'u2', email: 'o@example.com', name: 'O', role: 'vault_operator', locale: 'es' };
const FORBIDDEN = { error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required', details: {} } };

let fetchMock: ReturnType<typeof vi.fn>;
let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  window.localStorage.clear();
  setToken('access.token');
  setRefreshToken('refresh.token');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  navigate = vi.fn<(url: string) => void>();
  setPasswordChangeNavigatorForTests(navigate);
  window.history.replaceState({}, '', '/es/vault?tab=retiros');
});
afterEach(() => {
  vi.unstubAllGlobals();
  setPasswordChangeNavigatorForTests(null);
});

describe('api-client · 403 PASSWORD_CHANGE_REQUIRED', () => {
  it('customer: marca la bandera en sesión, navega a /es/account/password con next + reason y conserva los tokens', async () => {
    setStoredUser(customer);
    fetchMock.mockResolvedValueOnce(makeRes(403, FORBIDDEN));
    await expect(apiRequest('/vault/holdings')).rejects.toMatchObject({ status: 403, code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/es/account/password?next=%2Fvault%3Ftab%3Dretiros&reason=required');
    expect(getStoredUser()?.mustChangePassword).toBe(true);
    // No es un 401: ni refresh ni limpieza de sesión.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken()).toBe('access.token');
    expect(getStoredUser()).not.toBeNull();
  });

  it('staff: navega a /admin/account/password del locale actual', async () => {
    window.history.replaceState({}, '', '/en/admin/m4');
    setStoredUser(operator);
    fetchMock.mockResolvedValueOnce(makeRes(403, FORBIDDEN));
    await expect(apiRequest('/admin/shipments')).rejects.toBeInstanceOf(ApiClientError);
    expect(navigate).toHaveBeenCalledWith('/en/admin/account/password?next=%2Fadmin%2Fm4&reason=required');
  });

  it('un segundo 403 concurrente no navega dos veces (single-flight)', async () => {
    setStoredUser(customer);
    fetchMock.mockResolvedValue(makeRes(403, FORBIDDEN));
    await Promise.allSettled([apiRequest('/a'), apiRequest('/b')]);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('ya en la página de contraseña NO navega (la propia página llama a GET /users/me)', async () => {
    window.history.replaceState({}, '', '/es/account/password?next=%2Fvault');
    setStoredUser(customer);
    fetchMock.mockResolvedValueOnce(makeRes(403, FORBIDDEN));
    await expect(apiRequest('/users/me/addresses')).rejects.toBeInstanceOf(ApiClientError);
    expect(navigate).not.toHaveBeenCalled();
    expect(getStoredUser()?.mustChangePassword).toBe(true);
  });

  it('otro 403 (FORBIDDEN por rol) no toca la sesión ni navega', async () => {
    setStoredUser(customer);
    fetchMock.mockResolvedValueOnce(makeRes(403, { error: { code: 'FORBIDDEN', message: 'nope' } }));
    await expect(apiRequest('/admin/x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(navigate).not.toHaveBeenCalled();
    expect(getStoredUser()?.mustChangePassword).toBeUndefined();
  });
});
