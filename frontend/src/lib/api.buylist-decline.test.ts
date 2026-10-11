import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cancelBuylistOffer, declineBuylistRequest } from './api';
import { ApiClientError, setToken } from './api-client';
import { config } from './config';

/**
 * P-M5-DECLINE · los dos verbos de cierre de M5 por la rama REAL (contrato §M5):
 * - `POST /admin/buylist/:id/decline` `{ reason? }` (D39) — `409 DECLINE_NOT_ALLOWED` fuera de `cotizada` abierta.
 * - `POST /admin/buylist/:id/offer/cancel` `{ reason? }` (criterio 145) — `409 OFFER_NOT_CANCELLABLE`.
 * El motivo es INTERNO: va recortado, y vacío ⇒ cuerpo `{}` (válido según el contrato).
 */
describe('api (rama REAL) · declinar y cancelar la oferta de una solicitud de venta', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;
  const ROW = { id: 'sr-9', userId: 'u-1', status: 'expirada', expiredReason: 'no_offer', isTerminal: true, quotedTotalCents: 1000, createdAt: '2026-10-01T00:00:00Z', items: [] };

  function makeRes(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
  }
  function call(i = 0) {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
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

  it('declinar: POST …/sr-9/decline con el motivo recortado', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, ROW));
    await expect(declineBuylistRequest('sr-9', { reason: '  sin interés  ' })).resolves.toMatchObject({ status: 'expirada' });
    const c = call();
    expect(c.url).toMatch(/\/admin\/buylist\/sr-9\/decline$/);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ reason: 'sin interés' });
  });

  it('declinar sin motivo (o en blanco) ⇒ cuerpo `{}`', async () => {
    fetchMock.mockResolvedValue(makeRes(200, ROW));
    await declineBuylistRequest('sr-9');
    await declineBuylistRequest('sr-9', { reason: '   ' });
    expect(call(0).body).toEqual({});
    expect(call(1).body).toEqual({});
  });

  it('declinar: el `409 DECLINE_NOT_ALLOWED` llega como `ApiClientError` con su código y `details`', async () => {
    fetchMock.mockResolvedValueOnce(
      makeRes(409, { error: { code: 'DECLINE_NOT_ALLOWED', message: 'not allowed', details: { status: 'ofertada', offerState: 'sent' } } }),
    );
    const err = await declineBuylistRequest('sr-9').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(409);
    expect((err as ApiClientError).code).toBe('DECLINE_NOT_ALLOWED');
  });

  it('cancelar la oferta: POST …/sr-9/offer/cancel (y NO /decline)', async () => {
    fetchMock.mockResolvedValueOnce(makeRes(200, { ...ROW, status: 'cotizada', isTerminal: false }));
    await cancelBuylistOffer('sr-9', { reason: 'número mal puesto' });
    const c = call();
    expect(c.url).toMatch(/\/admin\/buylist\/sr-9\/offer\/cancel$/);
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ reason: 'número mal puesto' });
  });
});
