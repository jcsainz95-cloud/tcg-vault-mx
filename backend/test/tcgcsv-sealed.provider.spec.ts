import { readFileSync } from 'fs';
import { join } from 'path';
import { TcgcsvSealedBulkProvider } from '../src/modules/pricing/providers/tcgcsv-sealed.provider';

/**
 * v1.19-sealed-tcgcsv (§4.19b/§4.19f) — Adapter TCGCSV del SELLADO, testeado EXCLUSIVAMENTE
 * contra FIXTURES (`test/fixtures/tcgcsv/`): ni dev ni CI llaman a tcgcsv.com (egress
 * bloqueado; el test no depende de red). La validación del esquema REAL es la 1ª corrida
 * manual acotada en staging (runbook devops).
 */

const FIXTURES = join(__dirname, 'fixtures', 'tcgcsv');
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

function mockFetchWith(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn(async () => ({ ok, status, json: async () => body }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('TcgcsvSealedBulkProvider — host fijo + validación de groupId (anti-SSRF)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('llama SOLO al host fijo https://tcgcsv.com con la categoría Pokémon=3 (constante)', async () => {
    const fetchSpy = mockFetchWith(fixture('groups.json'));
    const provider = new TcgcsvSealedBulkProvider();
    await provider.listGroups();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://tcgcsv.com/tcgplayer/3/groups');
    // Sin redirects fuera del host + Accept JSON (patrón PokemonTcgIoClient).
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('groupId NO entero positivo → lanza SIN tocar la red (nunca un string del cliente al path)', async () => {
    const fetchSpy = mockFetchWith(fixture('products-23821.json'));
    const provider = new TcgcsvSealedBulkProvider();
    await expect(provider.listSealedProducts(-1)).rejects.toThrow(/groupId inválido/);
    await expect(provider.listSealedProducts(1.5)).rejects.toThrow(/groupId inválido/);
    await expect(provider.listSealedProducts(NaN)).rejects.toThrow(/groupId inválido/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('TcgcsvSealedBulkProvider — listGroups (fixtures verbatim)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('mapea el wrapper results[] a TcgcsvGroupRef (groupId, name, abbreviation?, publishedOn?)', async () => {
    mockFetchWith(fixture('groups.json'));
    const provider = new TcgcsvSealedBulkProvider();
    const groups = await provider.listGroups();
    expect(groups).toHaveLength(5);
    expect(groups[0]).toEqual({
      groupId: 23821,
      name: 'SV08: Surging Sparks',
      abbreviation: 'SV08',
      publishedOn: '2024-11-08T00:00:00',
    });
  });

  it('payload sin results[] → lanza (el proxy M2 lo mapea a 502 UPSTREAM_ERROR)', async () => {
    mockFetchWith({ success: false });
    const provider = new TcgcsvSealedBulkProvider();
    await expect(provider.listGroups()).rejects.toThrow(/payload inesperado/);
  });

  it('HTTP no-ok → lanza (explorador de curación; el ingest NO usa este método)', async () => {
    mockFetchWith({}, false, 503);
    const provider = new TcgcsvSealedBulkProvider();
    await expect(provider.listGroups()).rejects.toThrow(/HTTP 503/);
  });
});

describe('TcgcsvSealedBulkProvider — listSealedProducts: heurística de sellado (§4.19b)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('filtra los SINGLES (extendedData con Number/Rarity); el sellado se queda', async () => {
    mockFetchWith(fixture('products-23821.json'));
    const provider = new TcgcsvSealedBulkProvider();
    const products = await provider.listSealedProducts(23821);
    const ids = products.map((p) => p.productId);
    // Sellado: booster box (con UPC), ETB, bundle (extendedData null), sleeved pack (extendedData []).
    expect(ids).toEqual([610894, 610903, 610905, 610910]);
    // Singles descartados: Pikachu ex (Number+Rarity) y Alolan Exeggutor (solo Number).
    expect(ids).not.toContain(593245);
    expect(ids).not.toContain(593301);
    expect(products[0]).toEqual({
      productId: 610894,
      name: 'Surging Sparks Booster Box',
      cleanName: 'Surging Sparks Booster Box',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/610894_200w.jpg',
    });
  });
});

describe('TcgcsvSealedBulkProvider — fetchSealedPricesForGroup: money-safe (§4.19b/d)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('marketPrice válido → fila en centavos USD; subTypeName≠Normal y market/mid inválidos → OMITE', async () => {
    mockFetchWith(fixture('prices-23821.json'));
    const provider = new TcgcsvSealedBulkProvider();
    const res = await provider.fetchSealedPricesForGroup(23821);

    expect(res.fetchedRaw).toBe(7);
    expect(res.rows).toEqual([
      // marketPrice directo (238.50 → 23850¢), sin fallback.
      { tcgplayerProductId: 610894, marketCents: 23850, usedFallbackMid: false, currency: 'USD' },
      { tcgplayerProductId: 610903, marketCents: 5531, usedFallbackMid: false, currency: 'USD' },
      // marketPrice null → FALLBACK midPrice (32.75 → 3275¢) con flag de observabilidad.
      { tcgplayerProductId: 610905, marketCents: 3275, usedFallbackMid: true, currency: 'USD' },
    ]);
    // OMITIDAS: 610910 (sin market NI mid), 593245 (Holofoil), 593301 (Reverse Holofoil),
    // 999999 (market y mid en 0 — nunca se emite un precio <= 0).
    expect(res.skipped).toBe(4);
    // TCGCSV es SIEMPRE USD → el ingest aplicará FX + colchón.
    expect(res.rows.every((r) => r.currency === 'USD')).toBe(true);
  });

  it('fallo de red → devuelve lo acumulado SIN lanzar (precios previos quedan STALE, no se borran)', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const provider = new TcgcsvSealedBulkProvider();
    const res = await provider.fetchSealedPricesForGroup(23821);
    expect(res).toEqual({ rows: [], fetchedRaw: 0, skipped: 0 });
  });

  it('HTTP no-ok / payload inválido → devuelve vacío SIN lanzar (dominio de fallo aislado)', async () => {
    mockFetchWith({}, false, 500);
    const provider = new TcgcsvSealedBulkProvider();
    await expect(provider.fetchSealedPricesForGroup(23821)).resolves.toEqual({
      rows: [],
      fetchedRaw: 0,
      skipped: 0,
    });
  });

  it('entrada sin productId entero → OMITE (no crea fila basura)', async () => {
    mockFetchWith({
      results: [
        { productId: 'abc', marketPrice: 5, subTypeName: 'Normal' },
        { marketPrice: 5, subTypeName: 'Normal' },
        { productId: 610894, marketPrice: 5, subTypeName: 'Normal' },
      ],
    });
    const provider = new TcgcsvSealedBulkProvider();
    const res = await provider.fetchSealedPricesForGroup(23821);
    expect(res.rows).toEqual([
      { tcgplayerProductId: 610894, marketCents: 500, usedFallbackMid: false, currency: 'USD' },
    ]);
    expect(res.skipped).toBe(2);
  });
});
