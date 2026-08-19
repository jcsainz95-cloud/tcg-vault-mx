import { ConfigService } from '@nestjs/config';
import { PptApiClient, PptDailyLimitError, PptHttpError } from './ppt-api.client';

/**
 * WS-A fix-ppt (causa #3) — THROTTLE del cliente compartido PPT:
 *  - 429 `per_minute` → espera `Retry-After` y REINTENTA.
 *  - 429 `daily` → `PptDailyLimitError` (PARADA) + candado en memoria que corta lo siguiente.
 *  - presupuesto: trackea `X-RateLimit-Daily-Remaining`.
 * El egress del sandbox bloquea el proveedor → todo mockeado (global.fetch) + `sleep` espiado.
 */

function cfg(key: string | undefined = 'test-key'): ConfigService {
  return { get: (k: string) => (k === 'POKEMONPRICETRACKER_API_KEY' ? key : undefined) } as unknown as ConfigService;
}

function headers(map: Record<string, string> = {}) {
  return { get: (n: string) => map[n] ?? map[n.toLowerCase()] ?? null };
}

/** Respuesta fetch mock con status, cuerpo y headers. */
function resp(status: number, body: unknown, hdrs: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: headers(hdrs) };
}

describe('PptApiClient — throttle 429', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('429 per_minute → espera Retry-After (seg→ms) y reintenta; luego OK', async () => {
    const sleep = jest.spyOn(PptApiClient.prototype as any, 'sleep').mockResolvedValue(undefined);
    const bodies = [
      resp(429, { limitType: 'per_minute', retryAfter: 3 }, { 'retry-after': '3' }),
      resp(200, { data: [{ ok: 1 }] }, { 'X-RateLimit-Daily-Remaining': '18000' }),
    ];
    global.fetch = jest.fn(async () => bodies.shift()) as unknown as typeof fetch;

    const client = new PptApiClient(cfg());
    const res = await client.getJson<{ data: unknown[] }>('/api/v2/cards', { setId: '1' });

    expect((res.body as any).data).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(3000); // Retry-After = 3s → 3000ms
    expect(res.dailyRemaining).toBe(18000);
    expect(client.dailyRemaining()).toBe(18000);
  });

  it('429 daily → PptDailyLimitError (PARADA) y candado: la siguiente llamada corta SIN fetch', async () => {
    jest.spyOn(PptApiClient.prototype as any, 'sleep').mockResolvedValue(undefined);
    const fetchSpy = jest.fn(async () =>
      resp(429, { limitType: 'daily', resetsAt: '2999-01-01T00:00:00.000Z' }, { 'X-RateLimit-Daily-Remaining': '0' }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const client = new PptApiClient(cfg());
    await expect(client.getJson('/api/v2/cards', { setId: '1' })).rejects.toBeInstanceOf(PptDailyLimitError);
    expect(client.isDailyLimited()).toBe(true);

    // La 2ª llamada NO debe pegarle al proveedor (candado diario).
    await expect(client.getJson('/api/v2/cards', { setId: '2' })).rejects.toBeInstanceOf(PptDailyLimitError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('per_minute que nunca cede → agota reintentos y lanza PptHttpError(429)', async () => {
    jest.spyOn(PptApiClient.prototype as any, 'sleep').mockResolvedValue(undefined);
    global.fetch = jest.fn(async () => resp(429, { limitType: 'per_minute' })) as unknown as typeof fetch;
    const client = new PptApiClient(cfg());
    await expect(client.getJson('/api/v2/cards', { setId: '1' })).rejects.toMatchObject({ name: 'PptHttpError', status: 429 });
  });

  it('404 → PptHttpError con status y URL (sin credenciales); NO reintenta', async () => {
    const fetchSpy = jest.fn(async () => resp(404, {}, {}));
    global.fetch = fetchSpy as unknown as typeof fetch;
    const client = new PptApiClient(cfg());
    await expect(client.getJson('/api/v2/cards', { setId: 'sv8' })).rejects.toMatchObject({ name: 'PptHttpError', status: 404 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // La URL logueada/del error nunca lleva el token.
    try {
      await client.getJson('/api/v2/cards', { setId: 'sv8' });
    } catch (e) {
      expect((e as PptHttpError).url).toContain('setId=sv8');
      expect((e as PptHttpError).url).not.toContain('test-key');
    }
  });

  it('sin API key → PptHttpError(0) y NO llama a fetch', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const noKey = { get: () => undefined } as unknown as ConfigService;
    const client = new PptApiClient(noKey);
    await expect(client.getJson('/api/v2/sets', {})).rejects.toMatchObject({ name: 'PptHttpError', status: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.apiKey()).toBeNull();
  });

  it('el header Authorization lleva el Bearer; la URL no lleva la key', async () => {
    global.fetch = jest.fn(async () => resp(200, { data: [] }, {})) as unknown as typeof fetch;
    const client = new PptApiClient(cfg('secret-key'));
    const res = await client.getJson('/api/v2/cards', { setId: 'sv8' });
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(call[0])).not.toContain('secret-key');
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
    expect(res.url).toContain('https://www.pokemonpricetracker.com/api/v2/cards?setId=sv8');
  });
});
