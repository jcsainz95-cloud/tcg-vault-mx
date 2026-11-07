import { ConfigService } from '@nestjs/config';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';

/**
 * QA-PRM-FLAKY / QA-PRM-EMPTY — `getSetsBounded` (lista de sets del import de promos):
 * 3 intentos, ≤2 s entre intentos, presupuesto 10 s, sin reintentos tras responder, caché 24 h del último BUENO,
 * y un 200 sin datos NO es respuesta.
 */
class FastClient extends PokemonTcgIoClient {
  slept: number[] = [];
  protected override readonly boundedMaxWaitMs = 5;
  protected override readonly baseBackoffMs = 1;
  constructor() {
    super({ get: () => undefined } as unknown as ConfigService);
  }
}

const ok = (data: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data }) }) as unknown as Response;
const bad = (status: number, ra?: string) =>
  ({ ok: false, status, headers: new Headers(ra ? { 'retry-after': ra } : {}), json: async () => ({}) }) as unknown as Response;

describe('PokemonTcgIoClient.getSetsBounded', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('parámetros de producción: 3 intentos, ≤2 s entre ellos, presupuesto 10 s, caché 24 h', () => {
    const c = new PokemonTcgIoClient({ get: () => undefined } as unknown as ConfigService) as unknown as Record<string, number>;
    expect([c.boundedAttempts, c.boundedMaxWaitMs, c.boundedBudgetMs, c.setsCacheTtlMs]).toEqual([3, 2000, 10000, 86_400_000]);
  });

  it('503, 503, 200 ⇒ 3 intentos y devuelve la lista', async () => {
    fetchMock.mockResolvedValueOnce(bad(503)).mockResolvedValueOnce(bad(503)).mockResolvedValueOnce(ok([{ id: 'sv1', name: 'X' }]));
    await expect(new FastClient().getSetsBounded()).resolves.toEqual([{ id: 'sv1', name: 'X' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('siempre 503 sin caché ⇒ lanza tras EXACTAMENTE 3 intentos y no hay más llamadas después', async () => {
    fetchMock.mockResolvedValue(bad(503));
    await expect(new FastClient().getSetsBounded()).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(3); // nada en segundo plano
  });

  it('Retry-After 60 s > presupuesto restante ⇒ se corta en el 1.er intento', async () => {
    fetchMock.mockResolvedValue(bad(503, '60'));
    await expect(new FastClient().getSetsBounded()).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('4xx no transitorio ⇒ sin reintentos', async () => {
    fetchMock.mockResolvedValue(bad(404));
    await expect(new FastClient().getSetsBounded()).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('el presupuesto aborta el fetch colgado (la señal se cancela)', async () => {
    class Tiny extends FastClient {
      protected override readonly boundedBudgetMs = 30;
    }
    let sig: AbortSignal | undefined;
    fetchMock.mockImplementation((_u: string, init: RequestInit) => {
      sig = init.signal as AbortSignal;
      return new Promise((_res, rej) => sig!.addEventListener('abort', () => rej(new Error('aborted'))));
    });
    await expect(new Tiny().getSetsBounded()).rejects.toThrow(/aborted/);
    expect(sig!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caída + caché vigente ⇒ usa la caché; caché vencida ⇒ lanza', async () => {
    const c = new FastClient();
    fetchMock.mockResolvedValueOnce(ok([{ id: 'sv1', name: 'X' }]));
    await c.getSetsBounded();
    fetchMock.mockResolvedValue(bad(503));
    await expect(c.getSetsBounded()).resolves.toEqual([{ id: 'sv1', name: 'X' }]);
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 3600_000);
    await expect(c.getSetsBounded()).rejects.toThrow(/503/);
    spy.mockRestore();
  });

  it.each([[undefined], [null], [{}], [[]]])('QA-PRM-EMPTY: 200 con data=%p ⇒ «no responde» (no cuenta como lista vacía)', async (data) => {
    fetchMock.mockResolvedValue(ok(data));
    await expect(new FastClient().getSetsBounded()).rejects.toThrow(/sin datos/);
    fetchMock.mockResolvedValue(ok(data));
    await expect(new FastClient().getSets()).rejects.toThrow(/sin datos/);
  });

  it('un 200 vacío NO pisa la caché buena', async () => {
    const c = new FastClient();
    fetchMock.mockResolvedValueOnce(ok([{ id: 'a', name: 'A' }]));
    await c.getSetsBounded();
    fetchMock.mockResolvedValue(ok([]));
    await expect(c.getSetsBounded()).resolves.toEqual([{ id: 'a', name: 'A' }]);
  });
});
