import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { login, loginWithGoogle, logout, resetPassword, getMe } from './api';
import {
  apiRequest,
  clearClientSession,
  getDeviceToken,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
  storeDeviceToken,
} from './api-client';
import { setStoredUser } from './session';
import { config } from './config';

/**
 * v1.80 (C7, contrato §1 «Límite de intentos por cuenta», prueba F-C7-2; ARCHITECTURE §4.57.4).
 *
 * El `deviceToken` («dispositivo conocido») se guarda desde las CUATRO respuestas que lo traen
 * (`login`, `google`, `refresh`, `reset-password`), se manda en el cuerpo de CADA `POST /auth/login`,
 * y SOBREVIVE a `logout` y a la limpieza de sesión por `401`: no es credencial de sesión, y borrarlo
 * al salir le quitaría al dueño su puerta justo antes de volver a entrar.
 *
 * Mutación del contrato: borrar el token en `logout` (o en `clearClientSession`) ⇒ rojo aquí.
 * Se ejercita la rama REAL (`config.useMocks = false`) con `fetch` falso.
 */

const DEVICE_KEY = 'tcg.deviceToken';
const USER = { id: 'u1', email: 'owner@example.com', name: 'Owner', role: 'customer', locale: 'es' };

function makeRes(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}
function authOk(deviceToken: string) {
  return makeRes(200, { user: USER, accessToken: 'acc', refreshToken: 'ref', deviceToken });
}
function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('deviceToken (v1.80, C7) · F-C7-2', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;

  beforeEach(() => {
    config.useMocks = false;
    window.localStorage.clear();
    setStoredUser(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = originalUseMocks;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('login lo guarda, y el siguiente login lo manda en el cuerpo', async () => {
    fetchMock.mockResolvedValueOnce(authOk('dev.1'));
    await login({ email: 'owner@example.com', password: 'secret123' });
    // Primer login de este navegador: no había token ⇒ el cuerpo NO lleva la clave.
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ email: 'owner@example.com', password: 'secret123' });
    expect(getDeviceToken()).toBe('dev.1');

    fetchMock.mockResolvedValueOnce(authOk('dev.2'));
    await login({ email: 'owner@example.com', password: 'secret123' });
    expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/login');
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({
      email: 'owner@example.com',
      password: 'secret123',
      deviceToken: 'dev.1',
    });
    // Una entrada por navegador, se sobrescribe.
    expect(getDeviceToken()).toBe('dev.2');
  });

  it('google lo guarda', async () => {
    fetchMock.mockResolvedValueOnce(authOk('dev.google'));
    await loginWithGoogle('id-token');
    expect(getDeviceToken()).toBe('dev.google');
  });

  it('refresh (interceptor 401 → /auth/refresh) lo guarda', async () => {
    setToken('old-access');
    setRefreshToken('old-refresh');
    fetchMock
      .mockResolvedValueOnce(makeRes(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(
        makeRes(200, { accessToken: 'new-access', refreshToken: 'new-refresh', deviceToken: 'dev.refresh' }),
      )
      .mockResolvedValueOnce(makeRes(200, { ok: true }));
    await apiRequest('/users/me');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/auth/refresh');
    expect(getDeviceToken()).toBe('dev.refresh');
  });

  it('reset-password lo guarda', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ok: true, deviceToken: 'dev.reset' }));
    await resetPassword({ token: 'tok', password: 'nueva-larga' });
    expect(getDeviceToken()).toBe('dev.reset');
  });

  it('una respuesta SIN deviceToken (register, backend anterior) no borra el que había', async () => {
    storeDeviceToken('dev.keep');
    fetchMock.mockResolvedValueOnce(makeRes(200, { user: USER, accessToken: 'a', refreshToken: 'r' }));
    await login({ email: 'owner@example.com', password: 'secret123' });
    expect(getDeviceToken()).toBe('dev.keep');
  });

  it('SOBREVIVE a logout (y el login siguiente lo manda)', async () => {
    fetchMock.mockResolvedValueOnce(authOk('dev.owner'));
    await login({ email: 'owner@example.com', password: 'secret123' });
    fetchMock.mockResolvedValueOnce(makeRes(204, null));
    await logout();
    // La sesión sí se fue…
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    // …el dispositivo conocido no.
    expect(window.localStorage.getItem(DEVICE_KEY)).toBe('dev.owner');

    fetchMock.mockResolvedValueOnce(authOk('dev.owner.2'));
    await login({ email: 'owner@example.com', password: 'secret123' });
    expect(bodyOf(fetchMock.mock.calls[2]).deviceToken).toBe('dev.owner');
  });

  it('SOBREVIVE a logout aunque el backend falle', async () => {
    storeDeviceToken('dev.owner');
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await expect(logout()).rejects.toThrow();
    expect(getDeviceToken()).toBe('dev.owner');
  });

  it('SOBREVIVE a la limpieza de sesión por 401 (refresh rechazado)', async () => {
    storeDeviceToken('dev.owner');
    setToken('old-access');
    setRefreshToken('dead-refresh');
    fetchMock
      .mockResolvedValueOnce(makeRes(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }))
      .mockResolvedValueOnce(makeRes(401, { error: { code: 'UNAUTHENTICATED', message: 'dead' } }));
    await expect(getMe()).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getDeviceToken()).toBe('dev.owner');
  });

  it('clearClientSession directo tampoco lo toca', () => {
    storeDeviceToken('dev.owner');
    clearClientSession();
    expect(getDeviceToken()).toBe('dev.owner');
  });

  it('localStorage que lanza no rompe el login (try/catch): se entra sin dispositivo', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === DEVICE_KEY) throw new DOMException('denied', 'SecurityError');
      return null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string) => {
      if (k === DEVICE_KEY) throw new DOMException('quota', 'QuotaExceededError');
    });
    fetchMock.mockResolvedValueOnce(authOk('dev.x'));
    await expect(login({ email: 'owner@example.com', password: 'secret123' })).resolves.toMatchObject({
      accessToken: 'acc',
    });
    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty('deviceToken');
    expect(getDeviceToken()).toBeNull();
  });
});
