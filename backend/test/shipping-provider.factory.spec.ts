/**
 * Selección del adaptador (API_CONTRACT §19.19.7): bajo `NODE_ENV=test` solo `Fake`/`Noop`; `fake` con la llave de
 * gasto girada ⇒ el proceso NO arranca (parte de PS-98 que vive en `shipping-provider`); sin credenciales ⇒ `Noop`.
 */
import { FakeShippingProvider } from '../src/modules/shipping-provider/fake-shipping-provider';
import { NoopShippingProviderAdapter } from '../src/modules/shipping-provider/noop-shipping-provider.adapter';
import { SkydropxAdapter } from '../src/modules/shipping-provider/skydropx.adapter';
import { selectShippingProvider } from '../src/modules/shipping-provider/shipping-provider.factory';
import { ShippingProviderError } from '../src/modules/shipping-provider/shipping-provider.errors';

const CREDS = {
  SKYDROPX_BASE_URL: 'https://api.recorder.invalid/api/v1',
  SKYDROPX_CLIENT_ID: 'id',
  SKYDROPX_CLIENT_SECRET: 'secret',
};

describe('selectShippingProvider', () => {
  const saved = process.env.SKYDROPX_ALLOW_SPEND;
  afterEach(() => {
    if (saved === undefined) delete process.env.SKYDROPX_ALLOW_SPEND;
    else process.env.SKYDROPX_ALLOW_SPEND = saved;
  });

  it('NODE_ENV=test con credenciales ⇒ Noop (el real NUNCA por inyección bajo pruebas)', () => {
    const s = selectShippingProvider({ NODE_ENV: 'test', ...CREDS });
    expect(s.kind).toBe('noop');
    expect(s.port).toBeInstanceOf(NoopShippingProviderAdapter);
  });

  it("SHIPPING_PROVIDER_ADAPTER='fake' ⇒ Fake", () => {
    const s = selectShippingProvider({ NODE_ENV: 'test', SHIPPING_PROVIDER_ADAPTER: 'fake' });
    expect(s.port).toBeInstanceOf(FakeShippingProvider);
  });

  it("'fake' con la llave de gasto girada ⇒ el arranque FALLA", () => {
    process.env.SKYDROPX_ALLOW_SPEND = 'true';
    expect(() => selectShippingProvider({ NODE_ENV: 'production', SHIPPING_PROVIDER_ADAPTER: 'fake' })).toThrow(/no arranca/);
  });

  it('valor desconocido ⇒ el arranque falla', () => {
    expect(() => selectShippingProvider({ SHIPPING_PROVIDER_ADAPTER: 'sandbox' })).toThrow(/desconocido/);
  });

  it('producción sin credenciales ⇒ Noop, que responde 409 {missing:[env]} sin red', async () => {
    const s = selectShippingProvider({ NODE_ENV: 'production', SKYDROPX_BASE_URL: CREDS.SKYDROPX_BASE_URL });
    expect(s.kind).toBe('noop');
    const err = await s.port.balance().catch((e) => e);
    expect(err).toBeInstanceOf(ShippingProviderError);
    expect(err.httpStatus).toBe(409);
    expect(err.details).toEqual({ missing: ['env'] });
  });

  it('producción con credenciales ⇒ adaptador real; hosts de URL = el de la API si falta SKYDROPX_URL_HOSTS', () => {
    const s = selectShippingProvider({ NODE_ENV: 'production', ...CREDS });
    expect(s.kind).toBe('skydropx');
    expect(s.port).toBeInstanceOf(SkydropxAdapter);
    expect(s.urlHosts).toEqual(['api.recorder.invalid']);
    expect(selectShippingProvider({ NODE_ENV: 'production', ...CREDS, SKYDROPX_URL_HOSTS: 'a.example,*.b.example' }).urlHosts).toEqual([
      'a.example',
      '*.b.example',
    ]);
  });
});
