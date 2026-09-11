import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBillingProfile, putBillingProfile } from './api';
import { setToken } from './api-client';
import { config } from './config';

/**
 * Contrato v1.67.1 «Perfil de facturación» (QA, ronda de gates 2026-09-11): sin perfil el backend
 * responde `404 NOT_FOUND` y el cliente devuelve `null` (vacío de §33.6d). Con perfil, el DTO de seis
 * campos con `rfcMasked`. Y la tolerancia D-CTA-7: un `200` con cuerpo vacío (backend anterior) NO se
 * afirma como perfil.
 */
describe('api (rama REAL) · GET/PUT /users/me/billing-profile (v1.67.1)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;
  const PROFILE = {
    rfcMasked: 'XAX**********',
    razonSocial: 'Ash Ketchum',
    regimenFiscal: '612',
    usoCfdi: 'G03',
    postalCode: '06600',
    email: 'ash@example.com',
  };

  function makeRes(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
  }
  /** `200` con cuerpo VACÍO: `res.json()` revienta y `api-client` lo convierte en `{}`. */
  function emptyOk() {
    return { status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } } as unknown as Response;
  }

  beforeEach(() => {
    config.useMocks = false;
    setToken('access-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = originalUseMocks;
    setToken(null);
    vi.unstubAllGlobals();
  });

  it('404 NOT_FOUND ⇒ null (sin perfil), sin lanzar', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(404, { error: { code: 'NOT_FOUND', message: 'No billing profile', details: {} } }));
    await expect(getBillingProfile()).resolves.toBeNull();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/users\/me\/billing-profile$/);
  });

  it('200 con el DTO de seis campos ⇒ el perfil tal cual (rfcMasked, nunca rfc)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, PROFILE));
    await expect(getBillingProfile()).resolves.toEqual(PROFILE);
  });

  it('D-CTA-7: 200 con cuerpo vacío o `null` (backend anterior a v1.67.1) ⇒ null, NO un perfil de «—»', async () => {
    fetchMock.mockResolvedValueOnce(emptyOk());
    await expect(getBillingProfile()).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(makeRes(200, null));
    await expect(getBillingProfile()).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(makeRes(200, {}));
    await expect(getBillingProfile()).resolves.toBeNull();
  });

  it('otros errores (500) SÍ propagan: la sección pinta su error con reintento', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(500, { error: { code: 'INTERNAL', message: 'boom' } }));
    await expect(getBillingProfile()).rejects.toMatchObject({ status: 500 });
  });

  it('PUT manda los seis campos con el RFC en claro y devuelve la MISMA forma que el GET (upsert, 200)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, PROFILE));
    const input = { rfc: 'XAXX010101000', razonSocial: 'Ash Ketchum', regimenFiscal: '612', usoCfdi: 'G03', postalCode: '06600', email: 'ash@example.com' };
    await expect(putBillingProfile(input)).resolves.toEqual(PROFILE);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/users\/me\/billing-profile$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});
