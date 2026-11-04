import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { accountSetup, registerEmailOnly, setPassword, updateMyEmail, verifyEmail } from './api';
import { getDeviceToken, getRefreshToken, getToken, setRefreshToken, setToken } from './api-client';
import { getStoredUser, setStoredUser } from './session';
import { config } from './config';

/**
 * §CTA (API_CONTRACT v1.117, rama REAL de `lib/api`): rutas, cuerpos y qué se guarda en la sesión.
 * La parte de CTA-F2 que solo se ve aquí: un `409 EMAIL_TAKEN` NO deja ni token ni usuario (970, I-1).
 */
describe('api (rama REAL) · §CTA', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;

  function res(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
  }
  function call(i = 0): { url: string; method: string; body: unknown } {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined };
  }

  beforeEach(() => {
    config.useMocks = false;
    window.localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = originalUseMocks;
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('registerEmailOnly: POST /auth/register/email-only con { email, locale } y guarda la sesión del 201', async () => {
    fetchMock.mockResolvedValueOnce(
      res(201, {
        user: { id: 'u1', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false },
        accessToken: 'acc',
        refreshToken: 'ref',
      }),
    );
    await registerEmailOnly({ email: 'ana@x.mx', locale: 'es' });
    const c = call();
    expect(c.url).toMatch(/\/auth\/register\/email-only$/);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ email: 'ana@x.mx', locale: 'es' });
    expect(getToken()).toBe('acc');
    expect(getRefreshToken()).toBe('ref');
    expect(getStoredUser()?.email).toBe('ana@x.mx');
  });

  it('registerEmailOnly: 409 EMAIL_TAKEN ⇒ lanza y NO guarda token ni usuario', async () => {
    fetchMock.mockResolvedValueOnce(res(409, { error: { code: 'EMAIL_TAKEN', message: 'taken', details: {} } }));
    await expect(registerEmailOnly({ email: 'juan@x.mx' })).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('accountSetup: POST /auth/account-setup { token, name, password }, sin sesión', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, deviceToken: 'dev' }));
    await accountSetup({ token: 't0k', name: 'Ana', password: 'longenough1' });
    const c = call();
    expect(c.url).toMatch(/\/auth\/account-setup$/);
    expect(c.body).toEqual({ token: 't0k', name: 'Ana', password: 'longenough1' });
    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it('setPassword: POST /auth/set-password sin la actual, reemplaza los dos tokens y parchea la sesión', async () => {
    setToken('old-acc');
    setRefreshToken('old-ref');
    setStoredUser({ id: 'u1', email: 'a@x.mx', name: 'a', role: 'customer', locale: 'es', accountSetupPending: true, hasPassword: false });
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, accessToken: 'new-acc', refreshToken: 'new-ref' }));
    await setPassword({ newPassword: 'longenough1', name: ' Ana ' });
    const c = call();
    expect(c.url).toMatch(/\/auth\/set-password$/);
    expect(c.body).toEqual({ newPassword: 'longenough1', name: 'Ana' });
    expect(c.body).not.toHaveProperty('currentPassword');
    expect(getToken()).toBe('new-acc');
    expect(getRefreshToken()).toBe('new-ref');
    expect(getStoredUser()).toMatchObject({ hasPassword: true, accountSetupPending: false, name: 'Ana' });
  });

  it('updateMyEmail: PATCH /users/me/email { email } y sincroniza la sesión con la respuesta', async () => {
    setToken('acc');
    fetchMock.mockResolvedValueOnce(
      res(200, { id: 'u1', email: 'bien@x.mx', name: 'a', role: 'customer', locale: 'es', accountSetupPending: true, emailVerified: false }),
    );
    await updateMyEmail('bien@x.mx');
    const c = call();
    expect(c.url).toMatch(/\/users\/me\/email$/);
    expect(c.method).toBe('PATCH');
    expect(c.body).toEqual({ email: 'bien@x.mx' });
    expect(getStoredUser()?.email).toBe('bien@x.mx');
  });

  /**
   * CTA-F9 (v1.117.2, §1 «Verificación de correo»): el cuerpo lleva EXACTAMENTE una prueba de la credencial; nunca
   * `{ token }` solo. Mutación: mandar `{ token }` (o los dos campos).
   */
  it('verifyEmail modo contraseña: POST /auth/verify-email { token, password } y re-lee GET /users/me (TL-CTA-17)', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    fetchMock.mockResolvedValueOnce(res(200, { verified: true }));
    fetchMock.mockResolvedValueOnce(
      res(200, { id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: true }),
    );
    await verifyEmail({ token: 't0k', password: 'clave-actual' });
    const c = call();
    expect(c.url).toMatch(/\/auth\/verify-email$/);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ token: 't0k', password: 'clave-actual' });
    expect(call(1).url).toMatch(/\/users\/me$/);
    expect(call(1).method).toBe('GET');
    expect(getStoredUser()?.emailVerified).toBe(true);
  });

  it('TL-CTA-17: la sesión de A canjea el token de B ⇒ el emailVerified guardado de A no cambia', async () => {
    const ana = { id: 'a', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false } as const;
    setStoredUser({ ...ana });
    fetchMock.mockResolvedValueOnce(res(200, { verified: true })); // el token era de B: el servidor verifica a B
    fetchMock.mockResolvedValueOnce(res(200, { ...ana })); // GET /users/me de A: sigue sin verificar
    await verifyEmail({ token: 'token-de-b', password: 'clave-de-b' });
    expect(getStoredUser()?.id).toBe('a');
    expect(getStoredUser()?.emailVerified).toBe(false);
  });

  it('TL-CTA-17: si la relectura de /users/me falla, la verificación no se vuelve error ni se parchea la sesión', async () => {
    setStoredUser({ id: 'a', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    fetchMock.mockResolvedValueOnce(res(200, { verified: true }));
    fetchMock.mockResolvedValueOnce(res(500, { code: 'INTERNAL', message: 'x' }));
    await expect(verifyEmail({ token: 't0k', password: 'clave' })).resolves.toEqual({ verified: true });
    expect(getStoredUser()?.emailVerified).toBe(false);
  });

  it('TL-CTA-17: sin sesión local no hay relectura de /users/me', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { verified: true }));
    await verifyEmail({ token: 't0k', password: 'clave' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getStoredUser()).toBeNull();
  });

  it('verifyEmail modo nueva: { token, newPassword }, guarda el deviceToken y NO toca la sesión local', async () => {
    setStoredUser({ id: 'u', email: 'ana@x.mx', name: 'ana', role: 'customer', locale: 'es', emailVerified: false });
    fetchMock.mockResolvedValueOnce(res(200, { verified: true, deviceToken: 'dev-vrf' }));
    await verifyEmail({ token: 't0k', newPassword: 'nueva-clave-1' });
    expect(call().body).toEqual({ token: 't0k', newPassword: 'nueva-clave-1' });
    expect(getDeviceToken()).toBe('dev-vrf');
    expect(getStoredUser()?.emailVerified).toBe(false);
  });

  it('verifyEmail: aunque el llamador mande los dos campos, sale UNO (los dos ⇒ 400 en el servidor)', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { verified: true, deviceToken: 'd' }));
    await verifyEmail({ token: 't0k', newPassword: 'nueva-clave-1', password: 'x' } as never);
    expect(Object.keys(call().body as object).sort()).toEqual(['newPassword', 'token']);
  });
});
