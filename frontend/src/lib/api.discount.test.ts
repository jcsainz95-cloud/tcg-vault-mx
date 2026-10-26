import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCheckoutSession,
  createGuestCheckoutSession,
  createShipment,
  getCheckoutQuote,
  getGuestCheckoutQuote,
  getShipmentQuote,
  listDiscountCodes,
  setDiscountCodeBatchPaused,
} from './api';
import { config } from './config';
import { setToken } from './api-client';

/**
 * 💰 §DSC.6 / I-1 (criterio 915) — rama REAL: SIN código, el cuerpo de cada petición es EXACTAMENTE el de hoy (la
 * llave `discountCode` no viaja: ni `null` ni `''`); CON código viaja en los seis endpoints del contrato. Y las rutas
 * del panel son las de §DSC.7.
 */
describe('api (rama REAL) · §DSC.6 `discountCode` en quote y sesión', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const original = config.useMocks;
  const ok = (body: unknown) => ({ status: 200, ok: true, json: async () => body }) as unknown as Response;
  const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
  const lastUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]));

  beforeEach(() => {
    config.useMocks = false;
    setToken('access-token');
    fetchMock = vi.fn().mockResolvedValue(ok({ breakdown: {}, stripe: {} }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = original;
    setToken(null);
    vi.unstubAllGlobals();
  });

  it('sin código (o vacío): cuerpos idénticos a los de hoy', async () => {
    await getCheckoutQuote(['inv-1']);
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'] });
    await getCheckoutQuote(['inv-1'], '  ');
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'] });
    await createCheckoutSession(['inv-1']);
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'] });
    await getGuestCheckoutQuote(['inv-1']);
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'] });
    await getShipmentQuote(['inv-1'], 'addr-1');
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'], addressId: 'addr-1' });
    await createShipment(['inv-1'], 'addr-1');
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'], addressId: 'addr-1' });
  });

  it('con código: viaja `discountCode` en los seis endpoints', async () => {
    await getCheckoutQuote(['inv-1'], 'SEPT10');
    expect(lastUrl().pathname).toMatch(/\/checkout\/quote$/);
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'], discountCode: 'SEPT10' });
    await createCheckoutSession(['inv-1'], undefined, 'SEPT10');
    expect(lastBody()).toMatchObject({ discountCode: 'SEPT10' });
    await getGuestCheckoutQuote(['inv-1'], undefined, undefined, undefined, 'SEPT10');
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'], discountCode: 'SEPT10' });
    await createGuestCheckoutSession({
      inventoryItemIds: ['inv-1'],
      email: 'a@b.mx',
      shippingAddress: { line1: 'x', neighborhood: 'x', city: 'x', state: 'x', postalCode: '06000', country: 'MX' } as never,
      acceptedTerms: true,
      discountCode: 'SEPT10',
    });
    expect(lastUrl().pathname).toMatch(/\/checkout\/guest\/session$/);
    expect(lastBody()).toMatchObject({ discountCode: 'SEPT10' });
    await getShipmentQuote(['inv-1'], 'addr-1', 'ENVIO25');
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'], addressId: 'addr-1', discountCode: 'ENVIO25' });
    await createShipment(['inv-1'], 'addr-1', 'ENVIO25');
    expect(lastUrl().pathname).toMatch(/\/shipments$/);
    expect(lastBody()).toEqual({ inventoryItemIds: ['inv-1'], addressId: 'addr-1', discountCode: 'ENVIO25' });
  });

  it('panel: rutas y query de §DSC.7', async () => {
    fetchMock.mockResolvedValue(ok({ data: [], page: 1, pageSize: 50, total: 0 }));
    await listDiscountCodes({ state: 'expired' });
    expect(lastUrl().pathname).toMatch(/\/admin\/discount-codes$/);
    expect(lastUrl().searchParams.get('state')).toBe('expired');
    await listDiscountCodes({ status: 'paused' });
    expect(lastUrl().searchParams.get('status')).toBe('paused');
    await setDiscountCodeBatchPaused('b-1', true);
    expect(lastUrl().pathname).toMatch(/\/admin\/discount-code-batches\/b-1\/pause$/);
  });
});
