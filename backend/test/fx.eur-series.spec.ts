import { ConfigService } from '@nestjs/config';
import {
  FxService,
  parseBanxicoEurRate,
  FX_EUR_SERIES_ID_DEFAULT,
  FX_EUR_RATE_MIN,
  FX_EUR_RATE_MAX,
} from '../src/modules/pricing/fx.service';
import { BANXICO_FX_WHERE } from '../src/common/fx-mode';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * 💰 M-75 §PRE (e) — SERIE EUR/MXN de Banxico en `fx-refresh`. Prueba de la BANDA (candado money-safe
 * ante un id de serie NO confirmado) y del refresco EUR (escribe `base='EUR'`, aislado del USD).
 *
 * ⚠️ El id `SF46410` NO se pudo confirmar contra la API SIE en vivo (sin `BANXICO_SIE_TOKEN` en el
 * contenedor; la SIE rechaza toda petición sin token de forma uniforme). El candado REAL no es el id
 * sino la banda EUR: un id equivocado que devuelva otra magnitud cae fuera de banda ⇒ no se escribe
 * fila ⇒ cardmarket no vota (degradación money-safe). Esto es lo que estas pruebas fijan.
 */
describe('parseBanxicoEurRate — banda EUR/MXN (candado del id de serie no confirmado)', () => {
  it('acepta un EUR/MXN sano (~21)', () => {
    expect(parseBanxicoEurRate('21.35')).toEqual({ ok: true, rate: 21.35 });
    expect(parseBanxicoEurRate('18.90')).toEqual({ ok: true, rate: 18.9 });
  });
  it('RECHAZA USD/EUR (~1.08) — el modo de fallo de un id equivocado (par al revés o cruzado)', () => {
    expect(parseBanxicoEurRate('1.08')).toEqual({ ok: false, why: 'out_of_band' });
  });
  it('RECHAZA el par invertido (~0.047 MXN→EUR) — formato válido pero fuera de banda', () => {
    expect(parseBanxicoEurRate('0.047')).toEqual({ ok: false, why: 'out_of_band' });
  });
  it('RECHAZA magnitudes absurdas (9999, 0)', () => {
    expect(parseBanxicoEurRate('9999').ok).toBe(false);
    expect(parseBanxicoEurRate('0').ok).toBe(false);
  });
  it('RECHAZA formato no-SIE', () => {
    expect(parseBanxicoEurRate('N/E')).toEqual({ ok: false, why: 'format' });
    expect(parseBanxicoEurRate(21)).toEqual({ ok: false, why: 'format' });
  });
  it('los límites de banda son más estrechos que USD ([1,1000])', () => {
    expect(FX_EUR_RATE_MIN).toBe(8);
    expect(FX_EUR_RATE_MAX).toBe(40);
    expect(FX_EUR_SERIES_ID_DEFAULT).toBe('SF46410');
  });
});

describe('BANXICO_FX_WHERE — el lector USD gana `base:USD` (la fila EUR no lo secuestra)', () => {
  it('filtra por source=banxico Y base=USD', () => {
    expect(BANXICO_FX_WHERE).toEqual({ source: 'banxico', base: 'USD' });
  });
});

describe('FxService.refreshFromBanxico — la serie EUR es best-effort e independiente del USD', () => {
  const USD_OK = { bmx: { series: [{ datos: [{ dato: '18.50' }] }] } };
  function buildFetch(eurResponse: { status: number; body?: unknown }) {
    let call = 0;
    return jest.fn(async (url: string) => {
      call++;
      // 1ª llamada = USD (SF63528); 2ª = EUR (la serie configurada).
      if (url.includes('SF63528')) {
        return { ok: true, json: async () => USD_OK } as unknown as Response;
      }
      return {
        ok: eurResponse.status === 200,
        status: eurResponse.status,
        json: async () => eurResponse.body ?? {},
      } as unknown as Response;
    });
  }
  function build() {
    const settings = { getNumber: jest.fn(async () => 2), getRaw: jest.fn(async () => null) } as unknown as SettingsService;
    const upsert = jest.fn(async (_args: unknown) => ({}));
    const prisma = { fxRate: { upsert, findFirst: jest.fn(async () => null) } } as unknown as PrismaService;
    const fx = new FxService(prisma, settings, new ConfigService({ BANXICO_SIE_TOKEN: 'tok' }));
    return { fx, upsert };
  }

  it('EUR sano ⇒ escribe UNA fila base=EUR además de la USD; el outcome USD es `updated`', async () => {
    const { fx, upsert } = build();
    global.fetch = buildFetch({ status: 200, body: { bmx: { series: [{ datos: [{ dato: '21.40' }] }] } } }) as unknown as typeof fetch;
    const res = await fx.refreshFromBanxico();
    expect(res.outcome).toBe('updated'); // el resultado USD NO cambia por EUR
    expect(res.fetchedRate).toBe(18.5);
    const eurCall = upsert.mock.calls.find((c) => ((c[0] as { create: { base?: string } }).create.base) === 'EUR');
    expect(eurCall).toBeDefined();
    expect((eurCall![0] as { create: { rate: number; quote: string } }).create).toMatchObject({ rate: 21.4, quote: 'MXN' });
  });

  it('EUR fuera de banda (id equivocado devuelve ~1.08) ⇒ NO escribe fila EUR; el USD sigue intacto', async () => {
    const { fx, upsert } = build();
    global.fetch = buildFetch({ status: 200, body: { bmx: { series: [{ datos: [{ dato: '1.08' }] }] } } }) as unknown as typeof fetch;
    const res = await fx.refreshFromBanxico();
    expect(res.outcome).toBe('updated'); // USD intacto
    expect(upsert.mock.calls.some((c) => (c[0] as { create: { base?: string } }).create.base === 'EUR')).toBe(false);
  });

  it('EUR falla (HTTP 500) ⇒ NO tumba el USD (best-effort)', async () => {
    const { fx, upsert } = build();
    global.fetch = buildFetch({ status: 500 }) as unknown as typeof fetch;
    const res = await fx.refreshFromBanxico();
    expect(res.outcome).toBe('updated');
    expect(upsert.mock.calls.some((c) => (c[0] as { create: { base?: string } }).create.base === 'EUR')).toBe(false);
  });

  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch;
  });
});
