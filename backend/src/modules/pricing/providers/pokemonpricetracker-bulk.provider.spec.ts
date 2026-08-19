import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { CardSet } from '@prisma/client';
import { PokemonPriceTrackerBulkProvider } from './pokemonpricetracker-bulk.provider';
import { PptApiClient } from './ppt-api.client';

/** WS-A fix-ppt: el provider ahora toma (ConfigService, PptApiClient con throttle). Helper DI. */
function makeProvider(c: ConfigService): PokemonPriceTrackerBulkProvider {
  return new PokemonPriceTrackerBulkProvider(c, new PptApiClient(c));
}

/**
 * P-7 (2026-08-19) — BUG P0: el adapter pegaba a `/api/prices` y `/api/v1/prices` (endpoints
 * MUERTOS → 404 sistemático → catálogo sin precios todo el día). El endpoint REAL vigente es la
 * **API v2**: `GET /api/v2/cards?setId=<externalId>&fetchAllInSet=true` con el envelope
 * `{ data, total, count, limit, offset, hasMore }` (campos al NIVEL RAÍZ, paginación por `offset`),
 * y los precios TCGplayer POR ACABADO bajo `tcgplayer.prices` (mirror de pokemontcg.io).
 *
 * El egress del sandbox bloquea el dominio del proveedor → todo va contra fixtures con el shape v2
 * REAL, mockeando `global.fetch`. Se cubre: URL correcta, mapeo de acabados (incl. `reverse_holo`
 * como regresión), 404 money-safe con la URL en el log, sample-only, y paginación por offset.
 */

const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks' } as unknown as CardSet;

function cfg(key: string | undefined, marketFormat?: string): ConfigService {
  return {
    get: (k: string) =>
      k === 'POKEMONPRICETRACKER_API_KEY'
        ? key
        : k === 'POKEMONPRICETRACKER_MARKET_FORMAT'
          ? marketFormat
          : undefined,
  } as unknown as ConfigService;
}

/** Una carta en el shape v2 REAL: precios por acabado bajo `tcgplayer.prices`. */
function card(over: Record<string, unknown> = {}) {
  return {
    id: 'base1-4',
    name: 'Charizard',
    setId: 'sv8',
    setName: 'Surging Sparks',
    cardNumber: '4',
    number: '4',
    rarity: 'Rare Holo',
    tcgplayer: {
      prices: {
        holofoil: { market: 329.99, low: 250, mid: 300, high: 500 },
        reverseHolofoil: { market: 45.5, low: 30, mid: 40 },
        normal: { market: 12.0 },
      },
    },
    tcgPlayerId: 12345,
    lastUpdated: '2026-08-18T00:00:00.000Z',
    ...over,
  };
}

/** fetch mockeado: una respuesta OK por llamada, en orden (envelope v2 al nivel raíz). */
function mockPages(pages: unknown[]): jest.Mock {
  const spy = jest.fn(async () => {
    const body = pages.shift() ?? { data: [], total: 0, count: 0, limit: 200, offset: 0, hasMore: false };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

function callArgs(spy: jest.Mock, call: number): unknown[] {
  return spy.mock.calls[call] as unknown[];
}
function urlOf(spy: jest.Mock, call: number): string {
  return String(callArgs(spy, call)[0]);
}

describe('PokemonPriceTrackerBulkProvider — API v2 (P-7)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // (a) URL correcta + auth ------------------------------------------------------------------
  it('(a) llama a GET https://www.pokemonpricetracker.com/api/v2/cards con setId, fetchAllInSet y Bearer', async () => {
    const spy = mockPages([{ data: [card()], total: 1, count: 1, limit: 200, offset: 0, hasMore: false }]);
    await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({ set: SET, providerSetId: 'sv8' });

    expect(spy).toHaveBeenCalledTimes(1);
    const url = urlOf(spy, 0);
    expect(url).toContain('https://www.pokemonpricetracker.com/api/v2/cards?');
    expect(url).toContain('setId=sv8');
    expect(url).toContain('fetchAllInSet=true');
    // El endpoint muerto NO se toca nunca más y no hay page= (paginación por offset).
    expect(url).not.toContain('/api/prices');
    expect(url).not.toContain('/api/v1/prices');
    expect(url).not.toContain('page=');

    const init = callArgs(spy, 0)[1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers.Accept).toBe('application/json');
    // La key JAMÁS viaja en la URL (solo en el header).
    expect(url).not.toContain('test-key');
  });

  it('(a2) el externalId va URL-encoded como query param (anti-SSRF; host fijo)', async () => {
    const weirdSet = { id: 'x', externalId: 'sv8 & evil', name: 'x' } as unknown as CardSet;
    const spy = mockPages([{ data: [], total: 0, count: 0, hasMore: false }]);
    await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({ set: weirdSet, providerSetId: 'sv8 & evil' });
    const url = urlOf(spy, 0);
    expect(url.startsWith('https://www.pokemonpricetracker.com/api/v2/cards?')).toBe(true);
    expect(url).toContain('setId=sv8+%26+evil');
  });

  // (b) Mapeo de precios y acabados ----------------------------------------------------------
  it('(b) mapea tcgplayer.prices por acabado: holofoil/reverse_holo/normal, market×100, USD, verified', async () => {
    mockPages([{ data: [card()], total: 1, count: 1, hasMore: false }]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });

    expect(res.requestOk).toBe(true);
    expect(res.rows).toEqual(
      expect.arrayContaining([
        { externalId: 'base1-4', setExternalId: 'sv8', number: '4', finish: 'holofoil', marketCents: 32999, currency: 'USD', finishAliasVerified: true },
        { externalId: 'base1-4', setExternalId: 'sv8', number: '4', finish: 'reverse_holo', marketCents: 4550, currency: 'USD', finishAliasVerified: true },
        { externalId: 'base1-4', setExternalId: 'sv8', number: '4', finish: 'normal', marketCents: 1200, currency: 'USD', finishAliasVerified: true },
      ]),
    );
    expect(res.rows).toHaveLength(3);
    // REGRESIÓN explícita: `reverseHolofoil` DEBE preservarse como reverse_holo (no perderse ni
    // colapsar a holofoil/normal) — el bug del proveedor lo dejó fuera del catálogo.
    const reverse = res.rows.filter((r) => r.finish === 'reverse_holo');
    expect(reverse).toHaveLength(1);
    expect(reverse[0].marketCents).toBe(4550);
    // Money-safe: nunca se fabrica un `normal` extra; solo el que trae precio propio.
    expect(res.rows.every((r) => r.currency === 'USD')).toBe(true);
  });

  it('(b2) money-safe: acabado desconocido y market<=0 se OMITEN (nunca se atribuyen a normal)', async () => {
    mockPages([
      {
        data: [
          card({
            tcgplayer: {
              prices: {
                normal: { market: 1.5 }, // → normal 150¢
                weirdFoil: { market: 5 }, // acabado desconocido → OMITE
                holofoil: { market: 0 }, // market 0 → OMITE
              },
            },
          }),
        ],
        total: 1,
        count: 1,
        hasMore: false,
      },
    ]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(res.rows).toEqual([
      { externalId: 'base1-4', setExternalId: 'sv8', number: '4', finish: 'normal', marketCents: 150, currency: 'USD', finishAliasVerified: true },
    ]);
    expect(res.skipped).toBe(2); // weirdFoil (desconocido) + holofoil (market 0)
  });

  it('(b3) entrada de OTRO set → se DESCARTA (el fallback (set,number) casaría la carta equivocada)', async () => {
    mockPages([
      { data: [card(), card({ id: 'sv7-4', setId: 'sv7' })], total: 2, count: 2, hasMore: false },
    ]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(res.rows.every((r) => r.externalId === 'base1-4')).toBe(true);
    expect(res.rows).toHaveLength(3); // solo la carta del set sv8
  });

  // (c) 404 money-safe + observabilidad de la URL --------------------------------------------
  it('(c) 404 → rows:[], requestOk falsy, NO lanza, y el log de fallo incluye la URL + 404', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not Found',
    })) as unknown as typeof fetch;

    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });

    expect(res.rows).toEqual([]);
    expect(res.requestOk).toBeFalsy();

    const failLog = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('EL REQUEST FALLÓ'));
    expect(failLog).toBeDefined();
    expect(failLog).toContain('HTTP 404');
    expect(failLog).toContain('https://www.pokemonpricetracker.com/api/v2/cards?');
    expect(failLog).toContain('setId=sv8');
    // Nunca se filtra la key en el log.
    expect(failLog).not.toContain('test-key');
  });

  // (d) sample-only --------------------------------------------------------------------------
  it('(d) sin MARKET_FORMAT → sample-only: fetch sí, rows:[] pero requestOk:true (no persiste)', async () => {
    const spy = mockPages([{ data: [card()], total: 1, count: 1, hasMore: false }]);
    const res = await makeProvider(cfg('test-key' /* sin formato */)).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(spy).toHaveBeenCalledTimes(1); // hace el fetch (para loguear la muestra)
    expect(res.rows).toHaveLength(0); // pero NO persiste ninguna fila
    expect(res.requestOk).toBe(true); // la corrida SÍ respondió OK
    expect(res.fetchedRaw).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('(d2) sin API key → { rows: [] } y NO llama a fetch (precios STALE, no se borran)', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    const res = await makeProvider(cfg(undefined, 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(res).toEqual({ rows: [], fetchedRaw: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  // (e) paginación por offset ----------------------------------------------------------------
  it('(e) hasMore:true → segundo request con offset avanzado; filas de ambas páginas acumuladas', async () => {
    const spy = mockPages([
      {
        data: [card({ id: 'sv8-1', cardNumber: '1', number: '1', tcgplayer: { prices: { normal: { market: 1 } } } })],
        total: 2,
        count: 1,
        limit: 1,
        offset: 0,
        hasMore: true,
      },
      {
        data: [card({ id: 'sv8-2', cardNumber: '2', number: '2', tcgplayer: { prices: { normal: { market: 2 } } } })],
        total: 2,
        count: 1,
        limit: 1,
        offset: 1,
        hasMore: false,
      },
    ]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });

    expect(spy).toHaveBeenCalledTimes(2);
    // 1er request sin offset; 2º con offset avanzado (= recibidas hasta ahora).
    expect(urlOf(spy, 0)).not.toContain('offset=');
    expect(urlOf(spy, 1)).toContain('offset=1');
    expect(urlOf(spy, 1)).toContain('limit=200');
    expect(res.rows.map((r) => r.externalId)).toEqual(['sv8-1', 'sv8-2']);
    expect(res.rows.map((r) => r.marketCents)).toEqual([100, 200]);
    expect(res.fetchedRaw).toBe(2);
  });

  it('(e2) paginación por `total` sin hasMore explícito: se detiene al alcanzar el total', async () => {
    const spy = mockPages([
      {
        data: [card({ id: 'sv8-1', cardNumber: '1', tcgplayer: { prices: { normal: { market: 1 } } } })],
        total: 1,
        count: 1,
        limit: 200,
        offset: 0,
      },
    ]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(spy).toHaveBeenCalledTimes(1); // recibió 1 == total → no pide más
    expect(res.rows.map((r) => r.externalId)).toEqual(['sv8-1']);
  });

  it('(e3) sin metadatos de paginación (fetchAllInSet devolvió todo) → una sola página, sin bucle', async () => {
    const spy = mockPages([{ data: [card()] }]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.rows).toHaveLength(3);
  });

  // Money-safe transversal: soporta el envelope anidado `{ pagination: {...} }` por robustez.
  it('(f) tolera el envelope anidado { pagination: { hasMore } } además del nivel raíz', async () => {
    const spy = mockPages([
      { data: [card({ id: 'sv8-1', tcgplayer: { prices: { normal: { market: 1 } } } })], pagination: { total: 2, hasMore: true, limit: 1 } },
      { data: [card({ id: 'sv8-2', tcgplayer: { prices: { normal: { market: 2 } } } })], pagination: { total: 2, hasMore: false } },
    ]);
    const res = await makeProvider(cfg('test-key', 'usd_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.rows.map((r) => r.externalId)).toEqual(['sv8-1', 'sv8-2']);
  });

  // usd_cents y mxn_dollars: la moneda/unidad viene del FORMATO, no del payload (portado de la
  // cobertura previa para no perder los candados de formato tras el cambio de endpoint).
  it('(g) usd_cents: el payload YA da centavos → SIN ×100 (moneda USD)', async () => {
    mockPages([
      { data: [card({ id: 'sv8-2', number: '2', cardNumber: '2', tcgplayer: { prices: { normal: { market: 1500 } } } })], total: 1, count: 1, hasMore: false },
    ]);
    const res = await makeProvider(cfg('test-key', 'usd_cents')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(res.rows).toEqual([
      { externalId: 'sv8-2', setExternalId: 'sv8', number: '2', finish: 'normal', marketCents: 1500, currency: 'USD', finishAliasVerified: true },
    ]);
  });

  it('(g2) mxn_dollars con alias SUPUESTO: precio se persiste pero finishAliasVerified=false (anti-invención)', async () => {
    // Shape (C) fallback: lista de printings con un alias legible SUPUESTO ("Reverse Holo").
    mockPages([
      {
        data: [
          {
            id: 'sv8-3',
            setId: 'sv8',
            cardNumber: '3',
            number: '3',
            printings: [{ printing: 'Reverse Holo', marketPrice: 12.34 }],
          },
        ],
        total: 1,
        count: 1,
        hasMore: false,
      },
    ]);
    const res = await makeProvider(cfg('test-key', 'mxn_dollars')).fetchPricesForSet({
      set: SET,
      providerSetId: 'sv8',
    });
    expect(res.rows).toEqual([
      { externalId: 'sv8-3', setExternalId: 'sv8', number: '3', finish: 'reverse_holo', marketCents: 1234, currency: 'MXN', finishAliasVerified: false },
    ]);
  });
});
