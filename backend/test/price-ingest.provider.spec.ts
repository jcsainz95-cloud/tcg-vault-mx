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
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 150, currency: 'USD' },
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'holofoil', marketCents: 1000, currency: 'USD' },
      ]),
    );
    // reverse (market 0) y unlimited (no mapeada) contaron como omitidas.
    expect(res.skipped).toBe(2);
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
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'normal', marketCents: 150, currency: 'USD' },
        { externalId: 'sv8-1', setExternalId: 'sv8', number: '1', finish: 'reverse_holo', marketCents: 200, currency: 'USD' },
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
      { externalId: 'sv8-2', setExternalId: 'sv8', number: '2', finish: 'normal', marketCents: 1500, currency: 'USD' },
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
      { externalId: 'sv8-3', setExternalId: 'sv8', number: '3', finish: 'reverse_holo', marketCents: 1234, currency: 'MXN' },
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
