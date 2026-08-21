import { ConfigService } from '@nestjs/config';
import { CardSet } from '@prisma/client';
import { PokemonPriceTrackerBulkProvider } from './pokemonpricetracker-bulk.provider';
import { PptApiClient } from './ppt-api.client';

/**
 * WS-A fix-ppt — comportamientos NUEVOS del provider de paga:
 *  1. `setId` REAL de PPT (providerSetId) en la URL; sin él → NO pide nada (causa raíz #1).
 *  2. Shape REAL v2 de la lista: `prices.{ market, primaryPrinting }` → market→finish(primaryPrinting).
 *  3. Modo `fetchPrintings`: un barrido por impresión (reverse holo).
 *  4. 429 daily → `dailyLimited: true` (señal de PARADA).
 */

const SET = { id: 'l', externalId: 'sv8', name: 'Surging Sparks' } as unknown as CardSet;

function cfg(marketFormat?: string): ConfigService {
  return {
    get: (k: string) =>
      k === 'POKEMONPRICETRACKER_API_KEY' ? 'test-key' : k === 'POKEMONPRICETRACKER_MARKET_FORMAT' ? marketFormat : undefined,
  } as unknown as ConfigService;
}
function make(marketFormat: string | undefined = 'usd_dollars'): PokemonPriceTrackerBulkProvider {
  const c = cfg(marketFormat);
  return new PokemonPriceTrackerBulkProvider(c, new PptApiClient(c));
}
function mockPages(pages: unknown[]): jest.Mock {
  const spy = jest.fn(async () => {
    const body = pages.shift() ?? { data: [], metadata: { total: 0, hasMore: false } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('PokemonPriceTrackerBulkProvider — fix-ppt', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('(1) sin providerSetId → NO llama a fetch y devuelve 0 filas (jamás usa externalId)', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    const res = await make().fetchPricesForSet({ set: SET, providerSetId: null });
    expect(res).toEqual({ rows: [], fetchedRaw: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('(1b) providerSetId numérico va como setId en la URL (no el externalId sv8)', async () => {
    const spy = mockPages([{ data: [], metadata: { total: 0, hasMore: false } }]);
    await make().fetchPricesForSet({ set: SET, providerSetId: '1407' });
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('setId=1407');
    expect(url).not.toContain('setId=sv8');
  });

  it('(2) shape REAL v2: prices.{market, primaryPrinting} → market×100 al finish primario', async () => {
    mockPages([
      {
        data: [
          { id: 'sv8-1', cardNumber: '1', prices: { market: 12.5, low: 9, primaryPrinting: 'Holofoil', lastUpdated: 'x' } },
          { id: 'sv8-2', cardNumber: '2', prices: { market: 3.0, primaryPrinting: 'Reverse Holofoil' } },
          { id: 'sv8-3', cardNumber: '3', prices: { market: 1.0, primaryPrinting: 'Normal' } },
        ],
        metadata: { total: 3, hasMore: false },
      },
    ]);
    const res = await make().fetchPricesForSet({ set: SET, providerSetId: '1407' });
    expect(res.rows).toEqual([
      { externalId: 'sv8-1', setExternalId: '1407', number: '1', finish: 'holofoil', marketCents: 1250, currency: 'USD', finishAliasVerified: true },
      { externalId: 'sv8-2', setExternalId: '1407', number: '2', finish: 'reverse_holo', marketCents: 300, currency: 'USD', finishAliasVerified: true },
      { externalId: 'sv8-3', setExternalId: '1407', number: '3', finish: 'normal', marketCents: 100, currency: 'USD', finishAliasVerified: true },
    ]);
  });

  it('(2b) primaryPrinting desconocido → OMITE (money-safe, nunca normal)', async () => {
    mockPages([{ data: [{ id: 'sv8-1', cardNumber: '1', prices: { market: 5, primaryPrinting: 'MysteryFoil' } }], metadata: { hasMore: false, total: 1 } }]);
    const res = await make().fetchPricesForSet({ set: SET, providerSetId: '1407' });
    expect(res.rows).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });

  it('(3) fetchPrintings → un barrido por impresión (Normal/Reverse/Holo), market→ese finish', async () => {
    // 3 respuestas (una por printing), cada carta con un market plano de esa impresión.
    const spy = mockPages([
      { data: [{ id: 'sv8-1', cardNumber: '1', prices: { market: 1 } }], metadata: { total: 1, hasMore: false } },
      { data: [{ id: 'sv8-1', cardNumber: '1', prices: { market: 2 } }], metadata: { total: 1, hasMore: false } },
      { data: [{ id: 'sv8-1', cardNumber: '1', prices: { market: 3 } }], metadata: { total: 1, hasMore: false } },
    ]);
    const res = await make().fetchPricesForSet({ set: SET, providerSetId: '1407', fetchPrintings: true });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(String(spy.mock.calls[0][0])).toContain('printing=Normal');
    expect(String(spy.mock.calls[1][0])).toContain('printing=Reverse+Holofoil');
    expect(String(spy.mock.calls[2][0])).toContain('printing=Holofoil');
    expect(res.rows.map((r) => [r.finish, r.marketCents])).toEqual([
      ['normal', 100],
      ['reverse_holo', 200],
      ['holofoil', 300],
    ]);
    // v1.27 (P-13.2, §4.25a-2): el finish del modo forzado viene de la ETIQUETA del request, NO del
    // dato de la carta ⇒ NUNCA alias-verificado (antes se auto-verificaba contra la propia etiqueta)
    // y marcado `forcedPrinting` para que el ingest lo EXCLUYA de `pricedFinishesSnapshot`.
    for (const row of res.rows) {
      expect(row.finishAliasVerified).toBe(false);
      expect(row.forcedPrinting).toBe(true);
    }
  });

  it('(3b) modo LISTA (sin fetchPrintings): las filas NO llevan forcedPrinting y SÍ pueden verificarse', async () => {
    mockPages([
      { data: [{ id: 'sv8-1', cardNumber: '1', prices: { market: 2, primaryPrinting: 'Reverse Holofoil' } }], metadata: { total: 1, hasMore: false } },
    ]);
    const res = await make().fetchPricesForSet({ set: SET, providerSetId: '1407' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].finishAliasVerified).toBe(true); // primaryPrinting ES dato de la carta
    expect(res.rows[0].forcedPrinting).toBeUndefined(); // el modo lista sigue alimentando el snapshot
  });

  it('(4) 429 daily → dailyLimited:true (señal de PARADA), 0 filas, no revienta', async () => {
    jest.spyOn(PptApiClient.prototype as any, 'sleep').mockResolvedValue(undefined);
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ limitType: 'daily', resetsAt: '2999-01-01T00:00:00Z' }),
      text: async () => 'daily',
      headers: { get: (n: string) => (n.toLowerCase() === 'x-ratelimit-daily-remaining' ? '0' : null) },
    })) as unknown as typeof fetch;

    const res = await make().fetchPricesForSet({ set: SET, providerSetId: '1407' });
    expect(res.dailyLimited).toBe(true);
    expect(res.rows).toHaveLength(0);
  });

  it('(scope) minPrice se pasa como query cuando viene (set parcial)', async () => {
    const spy = mockPages([{ data: [], metadata: { hasMore: false, total: 0 } }]);
    await make().fetchPricesForSet({ set: SET, providerSetId: '1407', minPrice: '1' });
    expect(String(spy.mock.calls[0][0])).toContain('minPrice=1');
  });
});
