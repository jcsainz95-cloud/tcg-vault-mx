import { ConfigService } from '@nestjs/config';
import { CardSet } from '@prisma/client';
import { PokemonTcgIoBulkProvider } from '../src/modules/pricing/providers/pokemontcg-io-bulk.provider';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { normalizeFinishAlias } from '../src/modules/pricing/pricing.types';

/**
 * WS-A (v1.14-price-ingest, §4.15b/§4.15d) — MAPEO DEFENSIVO (money-safe) de los BulkPriceProvider:
 * variante→Finish, OMISIÓN de entradas mal formadas (market<=0/NaN, variante desconocida), moneda.
 */

const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks' } as unknown as CardSet;

describe('normalizeFinishAlias — variante→Finish, desconocida→null (nunca "normal")', () => {
  it('mapea llaves reales de tcgplayer.prices y alias legibles', () => {
    expect(normalizeFinishAlias('normal')).toBe('normal');
    expect(normalizeFinishAlias('holofoil')).toBe('holofoil');
    expect(normalizeFinishAlias('reverseHolofoil')).toBe('reverse_holo');
    expect(normalizeFinishAlias('Reverse Holo')).toBe('reverse_holo');
    expect(normalizeFinishAlias('reverse_holo')).toBe('reverse_holo');
    expect(normalizeFinishAlias('Holo')).toBe('holofoil');
    expect(normalizeFinishAlias('1stEditionHolofoil')).toBe('first_edition_holofoil');
  });

  it('variante DESCONOCIDA → null (money-safe: no se atribuye a normal)', () => {
    expect(normalizeFinishAlias('mystery-foil')).toBeNull();
    expect(normalizeFinishAlias('')).toBeNull();
    expect(normalizeFinishAlias(undefined)).toBeNull();
    expect(normalizeFinishAlias(123)).toBeNull();
  });
});

describe('PokemonTcgIoBulkProvider (legacy) — extrae precios por acabado de tcgplayer.prices', () => {
  function clientWith(cards: unknown[]): PokemonTcgIoClient {
    return {
      getCardsBySet: jest.fn(async () => ({
        data: cards,
        page: 1,
        pageSize: 250,
        count: cards.length,
        totalCount: cards.length,
      })),
    } as unknown as PokemonTcgIoClient;
  }

  it('una fila por acabado con market>0; omite market<=0 y llaves no mapeadas', async () => {
    const client = clientWith([
      {
        id: 'sv8-1',
        number: '1',
        tcgplayer: {
          prices: {
            normal: { market: 1.5 }, // → normal, 150¢ USD
            holofoil: { market: 10 }, // → holofoil, 1000¢ USD
            reverseHolofoil: { market: 0 }, // market 0 → OMITE
            unlimitedHolofoil: { market: 9 }, // llave no mapeada → OMITE
          },
        },
      },
    ]);
    const provider = new PokemonTcgIoBulkProvider(client);
    const res = await provider.fetchPricesForSet({ set: SET });

    expect(res.rows).toHaveLength(2);
    expect(res.rows).toEqual(
      expect.arrayContaining([
        // v1.22-1: acabados de llaves REALES de tcgplayer.prices → finishAliasVerified true.
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 150, currency: 'USD', finishAliasVerified: true },
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 1000, currency: 'USD', finishAliasVerified: true },
      ]),
    );
    // reverse (market 0) y unlimited (no mapeada) contaron como omitidas.
    expect(res.skipped).toBe(2);
    // v1.22-1 (§4.22g): corrida exitosa → requestOk true (habilita el reemplazo de snapshots).
    expect(res.requestOk).toBe(true);
    // Todas las filas son USD (TCGPlayer Market) → el ingest aplicará FX.
    expect(res.rows.every((r) => r.currency === 'USD')).toBe(true);
  });

  it('carta sin tcgplayer.prices → no produce filas', async () => {
    const provider = new PokemonTcgIoBulkProvider(clientWith([{ id: 'sv8-2', number: '2' }]));
    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(0);
  });
});

describe('PokemonPriceTrackerBulkProvider (pago) — mapeo defensivo del payload crudo', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  // FAIL-CLOSED: la moneda/unidad la fija el operador con POKEMONPRICETRACKER_MARKET_FORMAT (sin
  // default). PO confirmó `usd_dollars` (= ×100 + FX + colchón, como el legacy USD).
  function cfg(key?: string, marketFormat?: string): ConfigService {
    return {
      get: (k: string) =>
        k === 'POKEMONPRICETRACKER_API_KEY'
          ? key
          : k === 'POKEMONPRICETRACKER_MARKET_FORMAT'
            ? marketFormat
            : undefined,
    } as unknown as ConfigService;
  }
  function mockFetchOnce(body: unknown) {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  }

  it('sin API key → { rows: [] } y NO llama a fetch (money-safe: precios STALE, no se borran)', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const provider = new PokemonPriceTrackerBulkProvider(cfg(undefined, 'usd_dollars'));
    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res).toEqual({ rows: [], fetchedRaw: 0, skipped: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: con key pero SIN MARKET_FORMAT → sample-only (fetch sí, persiste NADA)', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'sv8-1', number: '1', prices: { normal: { market: 1.5 } } }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    const provider = new PokemonPriceTrackerBulkProvider(cfg('test-key')); // sin formato
    const res = await provider.fetchPricesForSet({ set: SET });

    expect(fetchSpy).toHaveBeenCalledTimes(1); // sí hace el fetch (para loguear la muestra)
    expect(res.rows).toHaveLength(0); // pero NO persiste ninguna fila (candado money-safe)
    expect(res.fetchedRaw).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it('usd_dollars (confirmado PO): variante→finish, market×100 (=legacy USD), omite mal formado', async () => {
    mockFetchOnce({
      data: [
        {
          id: 'sv8-1',
          number: '1',
          prices: {
            normal: { market: 1.5 }, // → normal 150¢ (×100)
            reverseHolofoil: { market: 2 }, // → reverse_holo 200¢
            holofoil: { market: 0 }, // market 0 → OMITE
            weirdFoil: { market: 5 }, // variante desconocida → OMITE (no se atribuye a normal)
          },
        },
      ],
    });
    const provider = new PokemonPriceTrackerBulkProvider(cfg('test-key', 'usd_dollars'));
    const res = await provider.fetchPricesForSet({ set: SET });

    expect(res.rows).toEqual(
      expect.arrayContaining([
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 150, currency: 'USD', finishAliasVerified: true },
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'reverse_holo', marketCents: 200, currency: 'USD', finishAliasVerified: true },
      ]),
    );
    expect(res.rows).toHaveLength(2);
    expect(res.skipped).toBe(2); // holofoil (market 0) + weirdFoil (desconocida)
    // Nunca se atribuyó un market a `normal` por defecto (no hay normal fabricado).
    const normals = res.rows.filter((r) => r.finish === 'normal');
    expect(normals).toHaveLength(1);
    expect(normals[0].marketCents).toBe(150);
    // Moneda USD → el ingest aplicará FX+colchón aguas abajo (idéntico al legacy).
    expect(res.rows.every((r) => r.currency === 'USD')).toBe(true);
  });

  it('usd_cents: el payload YA da centavos → SIN ×100 (moneda USD)', async () => {
    mockFetchOnce({ data: [{ id: 'sv8-2', number: '2', prices: { normal: { market: 1500 } } }] });
    const provider = new PokemonPriceTrackerBulkProvider(cfg('test-key', 'usd_cents'));
    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows).toEqual([
      { externalId: 'sv8-2', setExternalId: 'sv8', number: '2', finish: 'normal', marketCents: 1500, currency: 'USD', finishAliasVerified: true },
    ]);
  });

  it('mxn_dollars: ×100 pero moneda MXN → el ingest NO convierte (sin FX)', async () => {
    // La moneda viene del FORMATO (no del payload): aquí el campo currency del payload se ignora.
    mockFetchOnce({
      cards: [
        { cardId: 'sv8-3', number: '3', variant: 'Reverse Holo', market: 12.34, currency: 'USD' },
        { cardId: 'sv8-4', number: '4', finish: 'unknown-thing', market: 99 }, // desconocida → OMITE
      ],
    });
    const provider = new PokemonPriceTrackerBulkProvider(cfg('test-key', 'mxn_dollars'));
    const res = await provider.fetchPricesForSet({ set: SET });

    expect(res.rows).toEqual([
      // v1.22-1 (§4.22g candado 2): `variant: 'Reverse Holo'` es un alias SUPUESTO (no el REAL
      // `reverseHolofoil`) → el PRECIO se persiste (finish reverse_holo) pero finishAliasVerified es
      // FALSE ⇒ NO alimentará `pricedFinishesSnapshot` ni la lista blanca (anti-invención).
      { externalId: 'sv8-3', setExternalId: 'sv8', number: '3', finish: 'reverse_holo', marketCents: 1234, currency: 'MXN', finishAliasVerified: false },
    ]);
    expect(res.skipped).toBe(1);
  });

  it('entrada sin variante ni market válido → OMITE (no crea fila basura)', async () => {
    mockFetchOnce({ data: [{ id: 'sv8-9', number: '9' }] });
    const provider = new PokemonPriceTrackerBulkProvider(cfg('test-key', 'usd_dollars'));
    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });

  it('fallo HTTP → devuelve lo acumulado sin reventar (precios previos quedan STALE)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const provider = new PokemonPriceTrackerBulkProvider(cfg('test-key', 'usd_dollars'));
    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(0);
  });
});

/**
 * P-7 (2026-08-19) — El barrido por set usa la **API v2** (`GET /api/v2/cards?setId=…&fetchAllInSet=true`
 * → envelope `{ data, total, count, limit, offset, hasMore }`, paginación por `offset`). Los
 * endpoints `/api/prices` y `/api/v1/prices` (P-6) estaban MUERTOS → 404 sistemático → catálogo sin
 * precios. La cobertura exhaustiva del shape v2 (tcgplayer.prices, URL, offset, 404) vive en el spec
 * co-localizado `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.spec.ts`.
 *
 * Como el egress del sandbox bloquea el dominio del proveedor, estos casos van contra FIXTURES. Aquí
 * se conservan además los shapes de FALLBACK tolerante (entrada PLANA `printing`+`marketPrice`,
 * listas de `printings`, `cardNumber` con formato distinto, error 4xx que debe dar 0 filas sin romper).
 */
describe('PokemonPriceTrackerBulkProvider — barrido por set (API v2, P-7)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function cfg(marketFormat: string | undefined = 'usd_dollars'): ConfigService {
    return {
      get: (k: string) =>
        k === 'POKEMONPRICETRACKER_API_KEY'
          ? 'test-key'
          : k === 'POKEMONPRICETRACKER_MARKET_FORMAT'
            ? marketFormat
            : undefined,
    } as unknown as ConfigService;
  }

  /**
   * Fila cruda en el shape FALLBACK PLANO (`printing` + `marketPrice` al nivel de la entrada), NO
   * el shape PRIMARIO v2 (`tcgplayer.prices` por acabado — ese vive en el spec co-localizado). Aquí
   * ejercita el mapeo defensivo de los fallbacks tolerantes (B/C) que el adapter conserva.
   */
  function entry(over: Record<string, unknown> = {}) {
    return {
      id: 'sv8-104',
      name: 'Pikachu ex',
      setId: 'sv8',
      setName: 'Surging Sparks',
      cardNumber: '104',
      rarity: 'Double Rare',
      printing: 'Normal',
      marketPrice: 12.34,
      lowPrice: 9.99,
      lastPriceUpdate: '2026-08-18T03:00:00.000Z',
      ...over,
    };
  }

  /** fetch mockeado: una respuesta OK por llamada, en orden. */
  function mockPages(pages: unknown[]) {
    const spy = jest.fn(async () => {
      const body = pages.shift() ?? { data: [], total: 0, count: 0, limit: 200, offset: 0, hasMore: false };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    global.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  /** Argumentos de la n-ésima llamada a fetch (las tuplas de jest.Mock vienen sin tipar). */
  function callArgs(spy: jest.Mock, call: number): unknown[] {
    return spy.mock.calls[call] as unknown[];
  }
  function urlOf(spy: jest.Mock, call: number): string {
    return String(callArgs(spy, call)[0]);
  }

  it('hace GET /api/v2/cards?setId=…&fetchAllInSet=true con Bearer y SIN cuerpo (ya no /api/prices)', async () => {
    const spy = mockPages([{ data: [entry()], total: 1, count: 1, limit: 200, offset: 0, hasMore: false }]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });

    expect(spy).toHaveBeenCalledTimes(1);
    const url = urlOf(spy, 0);
    expect(url).toContain('https://www.pokemonpricetracker.com/api/v2/cards?');
    expect(url).toContain('setId=sv8');
    expect(url).toContain('fetchAllInSet=true');
    // Endpoints MUERTOS que causaban el 404: nunca más se tocan.
    expect(url).not.toContain('/api/prices');
    expect(url).not.toContain('/api/v1/prices');
    expect(url).not.toContain('bulk-price');
    expect(url).not.toContain('page=');
    const init = callArgs(spy, 0)[1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');

    expect(res.rows).toEqual([
      {
        externalId: 'sv8-104',
        setExternalId: 'sv8',
        number: '104',
        finish: 'normal',
        marketCents: 1234,
        currency: 'USD',
        finishAliasVerified: true,
      },
    ]);
  });

  it('pagina por `offset` cuando el envelope v2 señala hasMore (campos al nivel raíz)', async () => {
    const spy = mockPages([
      {
        data: [entry({ id: 'sv8-1', cardNumber: '1' }), entry({ id: 'sv8-2', cardNumber: '2' })],
        total: 3,
        count: 2,
        limit: 2,
        offset: 0,
        hasMore: true,
      },
      {
        data: [entry({ id: 'sv8-3', cardNumber: '3' })],
        total: 3,
        count: 1,
        limit: 2,
        offset: 2,
        hasMore: false,
      },
    ]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(urlOf(spy, 0)).not.toContain('offset='); // 1er request sin offset
    expect(urlOf(spy, 1)).toContain('offset=2'); // 2º arranca en lo ya recibido
    expect(res.rows.map((r) => r.externalId)).toEqual(['sv8-1', 'sv8-2', 'sv8-3']);
    expect(res.fetchedRaw).toBe(3);
  });

  it('sin objeto `pagination`: página incompleta = última (no bucle infinito)', async () => {
    const spy = mockPages([{ data: [entry()] }]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.rows).toHaveLength(1);
  });

  it('404 del endpoint v2 → money-safe: 0 filas, NO lanza, sin reintentar rutas muertas', async () => {
    const spy = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
      json: async () => ({}),
    }));
    global.fetch = spy as unknown as typeof fetch;

    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    // Un solo endpoint v2: ya NO se prueban `/api/prices` ni `/api/v1/prices`.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(urlOf(spy, 0)).toContain('/api/v2/cards?');
    expect(res).toEqual({ rows: [], fetchedRaw: 0, skipped: 0, requestOk: false });
  });

  it('mapea los acabados documentados (`printing`) a nuestros Finish canónicos', async () => {
    mockPages([
      {
        data: [
          entry({ id: 'sv8-1', cardNumber: '1', printing: 'Normal', marketPrice: 1 }),
          entry({ id: 'sv8-1', cardNumber: '1', printing: 'Reverse Holofoil', marketPrice: 2 }),
          entry({ id: 'sv8-1', cardNumber: '1', printing: 'Holofoil', marketPrice: 3 }),
          entry({ id: 'sv8-1', cardNumber: '1', printing: '1st Edition Holofoil', marketPrice: 4 }),
          entry({ id: 'sv8-1', cardNumber: '1', printing: 'Unlimited', marketPrice: 5 }), // → OMITE
        ],
        pagination: { total: 5, page: 1, limit: 1000 },
      },
    ]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });

    expect(res.rows.map((r) => [r.finish, r.marketCents])).toEqual([
      ['normal', 100],
      ['reverse_holo', 200],
      ['holofoil', 300],
      ['first_edition_holofoil', 400],
    ]);
    expect(res.skipped).toBe(1); // "Unlimited" no tiene enum propio → se OMITE (no se vuelve normal)
  });

  it('acabado AUSENTE con precio válido → OMITE (nunca se atribuye a `normal`)', async () => {
    mockPages([{ data: [entry({ printing: undefined })], pagination: { total: 1, page: 1, limit: 1000 } }]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(0);
    expect(res.fetchedRaw).toBe(1); // el request SÍ pasó: la señal de "no mapeó" queda en el log
    expect(res.skipped).toBe(1);
  });

  it('`cardNumber` con el total del set ("104/159") se propaga tal cual para el fallback del ingest', async () => {
    mockPages([{ data: [entry({ cardNumber: '104/159' })], pagination: { total: 1, page: 1, limit: 1000 } }]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    expect(res.rows[0].number).toBe('104/159');
    expect(res.rows[0].externalId).toBe('sv8-104');
  });

  it('entrada de OTRO set → se DESCARTA (el fallback (set,number) casaría la carta equivocada)', async () => {
    mockPages([
      {
        data: [entry(), entry({ id: 'sv7-104', setId: 'sv7' })],
        pagination: { total: 2, page: 1, limit: 1000 },
      },
    ]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].externalId).toBe('sv8-104');
    expect(res.skipped).toBe(1);
  });

  it('marketPrice <= 0 o no numérico → OMITE la fila (money-safe)', async () => {
    mockPages([
      {
        data: [entry({ marketPrice: 0 }), entry({ id: 'sv8-2', cardNumber: '2', marketPrice: null })],
        pagination: { total: 2, page: 1, limit: 1000 },
      },
    ]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(0);
    expect(res.skipped).toBe(2);
  });

  it('4xx del proveedor → 0 filas, sin excepción y sin borrar nada', async () => {
    const spy = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => '{"error":"bad request"}',
    }));
    global.fetch = spy as unknown as typeof fetch;

    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    // v1.22-1 (§4.22g): fallo total → requestOk FALSE ⇒ price-ingest NO tocará ningún snapshot.
    expect(res).toEqual({ rows: [], fetchedRaw: 0, skipped: 0, requestOk: false });
    expect(spy).toHaveBeenCalledTimes(1); // endpoint v2 único: un solo request
  });

  it('soporta el shape con una lista de printings anidada por carta', async () => {
    mockPages([
      {
        data: [
          {
            id: 'sv8-9',
            setId: 'sv8',
            cardNumber: '9',
            printings: [
              { printing: 'Normal', marketPrice: 1.5 },
              { printing: 'Reverse Holofoil', marketPrice: 2.5 },
            ],
          },
        ],
        pagination: { total: 1, page: 1, limit: 1000 },
      },
    ]);
    const res = await new PokemonPriceTrackerBulkProvider(cfg()).fetchPricesForSet({ set: SET });
    expect(res.rows.map((r) => [r.finish, r.marketCents])).toEqual([
      ['normal', 150],
      ['reverse_holo', 250],
    ]);
  });
});
