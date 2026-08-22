import { readFileSync } from 'fs';
import { join } from 'path';
import {
  TcgcsvCatalogClient,
  deriveCardProductsFromTcgcsv,
  classifyCardProductKind,
} from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import {
  deriveStructuralFinishes,
  tcgcsvSubTypeToFinish,
  TcgcsvSingleProductRef,
  TcgcsvPriceRow,
} from '../src/modules/pricing/pricing.types';

/**
 * v1.26 (ARCHITECTURE §4.24a) — Resolver de la composición ESTRUCTURAL de variantes desde TCGCSV,
 * testeado EXCLUSIVAMENTE contra FIXTURES (`test/fixtures/tcgcsv/`): el egress a tcgcsv.com está
 * BLOQUEADO en dev/CI (403). Doctrina bajo prueba: DETECTAR la estructura de TCGCSV (`subTypeName`),
 * NUNCA inferirla de rareza/era ni de la presencia de precio. Estructura ≠ precio.
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

describe('TcgcsvCatalogClient — host fijo + validación de groupId (anti-SSRF, hereda de TcgcsvHttpClient)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('llama SOLO al host fijo https://tcgcsv.com/tcgplayer con la categoría Pokémon=3 (constante)', async () => {
    const spy = mockFetchWith(fixture('groups.json'));
    await new TcgcsvCatalogClient().listGroups();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://tcgcsv.com/tcgplayer/3/groups');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it('getProducts/getPrices con groupId NO entero positivo → lanza SIN tocar la red', async () => {
    const spy = mockFetchWith(fixture('products-23821.json'));
    const client = new TcgcsvCatalogClient();
    await expect(client.getProducts(-1)).rejects.toThrow(/groupId inválido/);
    await expect(client.getPrices(1.5)).rejects.toThrow(/groupId inválido/);
    await expect(client.getProducts(NaN)).rejects.toThrow(/groupId inválido/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('getProducts extrae extendedData.Number (o null si el producto no lo trae: sellado)', async () => {
    mockFetchWith(fixture('products-23821.json'));
    const products = await new TcgcsvCatalogClient().getProducts(23821);
    const byId = new Map(products.map((p) => [p.productId, p.number]));
    expect(byId.get(593245)).toBe('057/191'); // Pikachu ex single
    expect(byId.get(593301)).toBe('167/191'); // Alolan Exeggutor ex single
    expect(byId.get(610894)).toBeNull(); // Booster Box: sin Number
    expect(byId.get(610905)).toBeNull(); // Booster Bundle: extendedData null
  });

  it('getPrices conserva subTypeName y marketPrice=null (estructura ≠ precio)', async () => {
    mockFetchWith(fixture('prices-structural-sv8.json'));
    const prices = await new TcgcsvCatalogClient().getPrices(23821);
    const normalNull = prices.find((r) => r.productId === 700001);
    expect(normalNull).toEqual({ productId: 700001, subTypeName: 'Normal', marketPrice: null });
  });
});

describe('tcgcsvSubTypeToFinish / deriveStructuralFinishes (§4.24a paso 4) — mapeo estricto, anti-invención', () => {
  it('mapea los subTypeName conocidos (espejo de §3.7)', () => {
    expect(tcgcsvSubTypeToFinish('Normal')).toBe('normal');
    expect(tcgcsvSubTypeToFinish('Holofoil')).toBe('holofoil');
    expect(tcgcsvSubTypeToFinish('Reverse Holofoil')).toBe('reverse_holo');
    expect(tcgcsvSubTypeToFinish('1st Edition Holofoil')).toBe('first_edition_holofoil');
  });

  it('subTypeName DESCONOCIDO ⇒ null (se OMITE; jamás se atribuye a normal)', () => {
    expect(tcgcsvSubTypeToFinish('Poké Ball Reverse Holofoil')).toBeNull();
    expect(tcgcsvSubTypeToFinish('Master Ball Reverse Holofoil')).toBeNull();
    expect(tcgcsvSubTypeToFinish('Cosmos Holofoil')).toBeNull();
    expect(tcgcsvSubTypeToFinish(null)).toBeNull();
    expect(tcgcsvSubTypeToFinish(42)).toBeNull();
  });

  it('deriveStructuralFinishes une, OMITE los desconocidos y ordena en FINISH_ORDER', () => {
    expect(
      deriveStructuralFinishes(['Reverse Holofoil', 'Normal', 'Master Ball Reverse Holofoil']),
    ).toEqual(['normal', 'reverse_holo']);
    // Todos desconocidos ⇒ [] (el llamador NO escribe ⇒ conserva lo previo, money-safe).
    expect(deriveStructuralFinishes(['Master Ball Reverse Holofoil'])).toEqual([]);
  });
});

describe('classifyCardProductKind (§4.27d) — heurística de STRING (no de rareza)', () => {
  it('«Deck Exclusive(s)» ⇒ deck_exclusive', () => {
    expect(classifyCardProductKind('Voltaic Lightning Energy - Deck Exclusives')).toBe('deck_exclusive');
    expect(classifyCardProductKind('Charizard ex (Deck Exclusive)')).toBe('deck_exclusive');
  });
  it('«Promo»/«Staff»/«League»/«Prerelease»/«Jumbo» ⇒ promo', () => {
    expect(classifyCardProductKind('Pikachu - Staff Prerelease Promo')).toBe('promo');
    expect(classifyCardProductKind('Mewtwo League Promo')).toBe('promo');
    expect(classifyCardProductKind('Jumbo Charizard')).toBe('promo');
  });
  it('single de set normal ⇒ set_base; nombre vacío ⇒ other (fail-safe)', () => {
    expect(classifyCardProductKind('Pikachu ex - 057/191')).toBe('set_base');
    expect(classifyCardProductKind('')).toBe('other');
    expect(classifyCardProductKind(null)).toBe('other');
  });
});

describe('deriveCardProductsFromTcgcsv (§4.27d) — AGRUPA POR productId contra FIXTURES REALES (Surging Sparks sv8)', () => {
  it('un CardProduct por productId; Pikachu ex 593245 ⇒ [holofoil] SIN normal fantasma; precio por variante', () => {
    const products = (fixture('products-23821.json') as { results: any[] }).results.map(mapProduct);
    const prices = (fixture('prices-23821.json') as { results: any[] }).results.map(mapPrice);
    const derived = deriveCardProductsFromTcgcsv(products, prices);
    const byId = new Map(derived.map((d) => [d.productId, d]));

    expect(byId.get(593245)?.finishes).toEqual(['holofoil']);
    expect(byId.get(593245)?.finishes).not.toContain('normal');
    expect(byId.get(593245)?.kind).toBe('set_base');
    // Precio por variante leído del marketPrice del producto (ya no se TIRA).
    expect(byId.get(593245)?.pricesByFinish).toEqual([{ finish: 'holofoil', marketPrice: expect.any(Number) }]);
    // Alolan Exeggutor ex 593301: solo Reverse Holofoil.
    expect(byId.get(593301)?.finishes).toEqual(['reverse_holo']);
  });
});

describe('deriveCardProductsFromTcgcsv (§4.27d) — el FANTASMA es imposible: 2 productos comparten número', () => {
  // Caso Pitch Black (§4.27a): la energía especial se vende como DOS productos con el MISMO número:
  //  - 704841 = producto de set con {Holofoil, Reverse Holofoil}
  //  - 707029 = «Deck Exclusives non-holo» con {Normal}, precio PROPIO
  // La unión por NÚMERO (bug viejo) le atribuía un `normal` fantasma a la carta de set (3 casillas).
  // Con derive-por-productId son DOS CardProduct: la carta de set NO fusiona el `normal` del deck excl.
  const products: any[] = [
    { productId: 704841, name: 'Voltaic Lightning Energy - 084/084', number: '084/084' },
    { productId: 707029, name: 'Voltaic Lightning Energy - Deck Exclusives', number: '084/084' },
  ];
  const prices: any[] = [
    { productId: 704841, subTypeName: 'Holofoil', marketPrice: 0.5 },
    { productId: 704841, subTypeName: 'Reverse Holofoil', marketPrice: 0.75 },
    { productId: 707029, subTypeName: 'Normal', marketPrice: 1.25 },
  ];
  const derived = deriveCardProductsFromTcgcsv(products, prices);
  const byId = new Map(derived.map((d) => [d.productId, d]));

  it('el producto de set (704841) ⇒ EXACTAMENTE 2 acabados [holofoil, reverse_holo], NO 3 (sin normal fantasma)', () => {
    expect(byId.get(704841)?.finishes).toEqual(['reverse_holo', 'holofoil']);
    expect(byId.get(704841)?.finishes).not.toContain('normal');
    expect(byId.get(704841)?.kind).toBe('set_base');
  });

  it('el Deck Exclusive (707029) es un CardProduct APARTE (kind=deck_exclusive) con SU propio `normal` + precio', () => {
    expect(byId.get(707029)?.kind).toBe('deck_exclusive');
    expect(byId.get(707029)?.finishes).toEqual(['normal']);
    expect(byId.get(707029)?.pricesByFinish).toEqual([{ finish: 'normal', marketPrice: 1.25 }]);
  });
});

describe('deriveCardProductsFromTcgcsv (§4.27e) — estructura ≠ precio + anti-invención', () => {
  it('marketPrice:null declara el acabado (estructura) pero NO produce precio (money-safe)', () => {
    const products: any[] = [{ productId: 900, name: 'Card - 001/100', number: '001/100' }];
    const prices: any[] = [{ productId: 900, subTypeName: 'Normal', marketPrice: null }];
    const derived = deriveCardProductsFromTcgcsv(products, prices);
    expect(derived[0].finishes).toEqual(['normal']); // el acabado EXISTE (estructura)
    // pricesByFinish conserva la variante con marketPrice:null (estructura); el RESOLVER es quien NO
    // escribe PriceReference cuando el precio es null/≤0 (la celda queda «—»/PRICE_PENDING).
    expect(derived[0].pricesByFinish).toEqual([{ finish: 'normal', marketPrice: null }]);
  });

  it('producto con SOLO subTypeName desconocido ⇒ se OMITE del resultado (nada que colgar)', () => {
    const products: any[] = [{ productId: 901, name: 'Card - 002/100', number: '002/100' }];
    const prices: any[] = [{ productId: 901, subTypeName: 'Poké Ball Reverse Holofoil', marketPrice: 3 }];
    const derived = deriveCardProductsFromTcgcsv(products, prices);
    expect(derived.find((d) => d.productId === 901)).toBeUndefined();
  });
});

// --- helpers de mapeo crudo→typed (espejo de lo que hacen getProducts/getPrices del cliente) ---
function mapProduct(p: any): TcgcsvSingleProductRef {
  const ext = Array.isArray(p.extendedData) ? p.extendedData : [];
  const numEntry = ext.find((e: any) => e?.name === 'Number');
  const number = typeof numEntry?.value === 'string' ? numEntry.value : null;
  return { productId: p.productId, name: p.name, number };
}
function mapPrice(r: any): TcgcsvPriceRow {
  return {
    productId: r.productId,
    subTypeName: r.subTypeName ?? null,
    marketPrice: typeof r.marketPrice === 'number' ? r.marketPrice : null,
  };
}
