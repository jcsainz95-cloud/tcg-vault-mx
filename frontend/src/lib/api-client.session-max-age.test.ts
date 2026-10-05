import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiClientError, getRefreshToken, getToken, setRefreshToken, setToken } from './api-client';
import {
  consumeSessionMaxAgeLogout,
  getStoredUser,
  resetSessionMaxAgeLogoutForTests,
  setStoredUser,
} from './session';
import type { UserDTO } from '@/types/contract';

/**
 * LIVE-2 pantalla (API_CONTRACT v1.84 §14.2 «Frontend» + v1.84.2 §14.15 E2-4; DESIGN_SYSTEM §81.5 F-3,
 * candados UX-SMA-2/3 del lado del interceptor). El `401` de `POST /auth/refresh` con
 * `details.reason === 'session_max_age'` deja una marca de UN SOLO USO que el login lee para pintar
 * «Tu sesión caducó por seguridad». Sin `reason` (o con otro) ⇒ ninguna marca: el flujo de hoy.
 *
 * Mutaciones que este fichero debe cazar: (a) ignorar `details` en `refreshTokens` (no marcar nunca)
 * ⇒ rojo el primer caso; (b) marcar a todo `401` del refresh ⇒ rojos los casos «sin reason» y
 * «otro reason»; (c) no consumir (leer sin borrar) ⇒ rojo «un solo uso».
 */

const user: UserDTO = { id: 'u1', email: 'c@example.com', name: 'C', role: 'customer', locale: 'es' };

function res(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}
const UNAUTH = { error: { code: 'UNAUTHENTICATED', message: 'Access token expired' } };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setToken('old.access');
  setRefreshToken('old.refresh');
  setStoredUser(user);
  resetSessionMaxAgeLogoutForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function callAndFail() {
  await expect(apiRequest('/users/me')).rejects.toBeInstanceOf(ApiClientError);
}

describe('LIVE-2 · 401 del refresh con reason=session_max_age (DS §81 F-3)', () => {
  it('UX-SMA-2 · deja la marca, y la sesión se limpia como hoy', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, UNAUTH))
      .mockResolvedValueOnce(
        res(401, { error: { code: 'UNAUTHENTICATED', message: 'Session max age', details: { reason: 'session_max_age' } } }),
      );
    await callAndFail();
    // Mismo cierre de sesión que cualquier refresh rechazado (contrato: «sin cambio de lógica»).
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(consumeSessionMaxAgeLogout()).toBe(true);
  });

  it('la marca es de un solo uso', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, UNAUTH))
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: 'session_max_age' } } }));
    await callAndFail();
    expect(consumeSessionMaxAgeLogout()).toBe(true);
    expect(consumeSessionMaxAgeLogout()).toBe(false);
  });

  it('caduca: pasada la ventana ya no se afirma (otra visita al login no la hereda)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, UNAUTH))
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: 'session_max_age' } } }));
    await callAndFail();
    expect(consumeSessionMaxAgeLogout(Date.now() + 60_000)).toBe(false);
  });

  it('UX-SMA-3 · 401 del refresh SIN reason ⇒ sin marca (el flujo de hoy)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, UNAUTH))
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHENTICATED', message: 'bad refresh' } }));
    await callAndFail();
    expect(getStoredUser()).toBeNull();
    expect(consumeSessionMaxAgeLogout()).toBe(false);
  });

  it('UX-SMA-3 · 401 del refresh con OTRO reason ⇒ sin marca', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, UNAUTH))
      .mockResolvedValueOnce(res(401, { error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: 'token_version' } } }));
    await callAndFail();
    expect(consumeSessionMaxAgeLogout()).toBe(false);
  });

  it('cuerpo ilegible o error de red en el refresh ⇒ sin marca', async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, UNAUTH))
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => { throw new Error('no json'); } } as unknown as Response);
    await callAndFail();
    expect(consumeSessionMaxAgeLogout()).toBe(false);

    setToken('a');
    setRefreshToken('r');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(res(401, UNAUTH)).mockRejectedValueOnce(new TypeError('network'));
    await callAndFail();
    expect(consumeSessionMaxAgeLogout()).toBe(false);
  });
});
