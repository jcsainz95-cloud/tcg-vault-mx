import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createGuestCheckoutSession,
  getAccessories,
  getAccessorySuggestions,
  getGuestCheckoutQuote,
  postAccessoryStock,
  refundAccessoryLineDelivered,
  setShipPrepAccessoryLine,
  uploadAccessoryPhoto,
} from './api';
import { setToken } from './api-client';
import { config } from './config';

/**
 * Rama REAL del cliente para §AC (`API_CONTRACT §AC.3/.4/.9/.10/.11`): rutas, métodos y cuerpos exactos.
 * ⛔ El `pullToken` viaja SOLO en el cuerpo (§AC.8); ⛔ ningún cuerpo de compra lleva importes (I-AC-3).
 */
describe('api (rama REAL) · accesorios', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalUseMocks = config.useMocks;
  const ok = (body: unknown, status = 200) =>
    ({ status, ok: true, json: async () => body, headers: new Headers() }) as unknown as Response;

  beforeEach(() => {
    config.useMocks = false;
    setToken('access-token');
    fetchMock = vi.fn().mockResolvedValue(ok({ items: [], page: 1, pageSize: 24, total: 0 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = originalUseMocks;
    setToken(null);
    vi.unstubAllGlobals();
  });

  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { url: new URL(url), init, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
  };

  it('GET /accessories con category, q, page y pageSize', async () => {
    await getAccessories({ category: 'sleeves', q: 'penny', page: 2 });
    const { url, init } = call();
    expect(url.pathname).toMatch(/\/accessories$/);
    expect(Object.fromEntries(url.searchParams)).toEqual({ category: 'sleeves', q: 'penny', page: '2', pageSize: '24' });
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('GET /accessories/suggestions?exclude=a,b (coma, como dice el contrato)', async () => {
    await getAccessorySuggestions(['a', 'b']);
    const { url } = call();
    expect(url.pathname).toMatch(/\/accessories\/suggestions$/);
    expect(url.searchParams.get('exclude')).toBe('a,b');
  });

  it('quote de invitado: accessoryLines y deckPulls en el CUERPO; el pullToken nunca en la URL', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await getGuestCheckoutQuote(['inv-1'], undefined, undefined, {
      accessoryLines: [{ accessoryId: 'acc-1', quantity: 2 }],
      deckPulls: [{ pullToken: 'secret.token', withEnergyBundle: true }],
    });
    const { url, body } = call();
    expect(url.pathname).toMatch(/\/checkout\/guest\/quote$/);
    expect(url.toString()).not.toContain('secret');
    expect(body).toEqual({
      inventoryItemIds: ['inv-1'],
      accessoryLines: [{ accessoryId: 'acc-1', quantity: 2 }],
      deckPulls: [{ pullToken: 'secret.token', withEnergyBundle: true }],
    });
  });

  it('sesión de invitado: viajan accessoryLines y deckPulls; ⛔ ninguna llave de importe', async () => {
    fetchMock.mockResolvedValue(ok({}, 201));
    await createGuestCheckoutSession({
      inventoryItemIds: [],
      email: 'a@b.mx',
      shippingAddress: { recipientName: 'A', line1: 'C', city: 'X', state: 'Y', postalCode: '01000', country: 'MX', phone: '5512345678' } as never,
      acceptedTerms: true,
      fulfillmentMode: 'direct_ship',
      accessoryLines: [{ accessoryId: 'acc-1', quantity: 1 }],
      deckPulls: [{ pullToken: 'tok', withEnergyBundle: true }],
    });
    const { body } = call();
    expect(body.accessoryLines).toEqual([{ accessoryId: 'acc-1', quantity: 1 }]);
    expect(body.deckPulls).toEqual([{ pullToken: 'tok', withEnergyBundle: true }]);
    expect(JSON.stringify(body)).not.toMatch(/priceCents|unitPriceCents|shippingFeeCents|totalCents/);
  });

  it('foto: multipart con el campo `file`, sin Content-Type JSON', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'acc-1' }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await uploadAccessoryPhoto('acc-1', file);
    const { url, init } = call();
    expect(url.pathname).toMatch(/\/admin\/accessories\/acc-1\/photo$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('existencias, palomeo de accesorio y reembolso por unidad: rutas y cuerpos del contrato', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await postAccessoryStock('acc-1', { kind: 'adjust', newStockQty: 3, expectedStockQty: 5, reason: 'merma' });
    await setShipPrepAccessoryLine('shp-1', 'sal-1', { status: 'missing', missingQty: 2, missingReason: 'damaged' });
    await refundAccessoryLineDelivered('ord-1', 'oal-1', { quantity: 1, reason: 'not_arrived', note: 'no llegó', expectedRefundCents: 9311 });
    expect(call(0).url.pathname).toMatch(/\/admin\/accessories\/acc-1\/stock$/);
    expect(call(0).body).toEqual({ kind: 'adjust', newStockQty: 3, expectedStockQty: 5, reason: 'merma' });
    expect(call(1).url.pathname).toMatch(/\/admin\/shipments\/shp-1\/prep-accessory-lines\/sal-1$/);
    expect(call(1).init.method).toBe('PATCH');
    expect(call(2).url.pathname).toMatch(/\/admin\/orders\/ord-1\/accessory-lines\/oal-1\/refund-delivered$/);
    expect(call(2).body).toEqual({ quantity: 1, reason: 'not_arrived', note: 'no llegó', expectedRefundCents: 9311 });
  });
});
