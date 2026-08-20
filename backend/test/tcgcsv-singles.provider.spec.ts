import { readFileSync } from 'fs';
import { join } from 'path';
import {
  TcgcsvCatalogClient,
  unionStructuralFinishesByCardNumber,
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

describe('unionStructuralFinishesByCardNumber (§4.24a paso 3) — GROUP-BY-CARTA contra FIXTURES REALES (Surging Sparks sv8)', () => {
  it('une subTypeName por número de carta; Pikachu ex 057/191 (DR, Holofoil) ⇒ [holofoil] SIN normal fantasma', () => {
    const products = (fixture('products-23821.json') as { results: any[] }).results.map(mapProduct);
    const prices = (fixture('prices-23821.json') as { results: any[] }).results.map(mapPrice);
    const union = unionStructuralFinishesByCardNumber(products, prices);

    // El secret/single premium de UNA impresión: SOLO holofoil, sin `normal` de relleno (VAR-1).
    expect(union.get('057/191')?.finishes).toEqual(['holofoil']);
    expect(union.get('057/191')?.finishes).not.toContain('normal');
    // Alolan Exeggutor ex 167/191: solo Reverse Holofoil.
    expect(union.get('167/191')?.finishes).toEqual(['reverse_holo']);
    // Los productos SELLADOS (sin Number) NO producen ninguna entrada de carta.
    expect(union.has('057/191') && union.has('167/191')).toBe(true);
    expect(union.size).toBe(2);
  });
});

describe('unionStructuralFinishesByCardNumber (§4.24a paso 3) — casos del open-question (S-D1) + estructura≠precio (S-D2)', () => {
  const products = (fixture('products-structural-sv8.json') as { results: any[] }).results.map(mapProduct);
  const prices = (fixture('prices-structural-sv8.json') as { results: any[] }).results.map(mapPrice);
  const union = unionStructuralFinishesByCardNumber(products, prices);

  it('representación A — productIds SEPARADOS por impresión, MISMO número ⇒ se UNEN (025/191 ⇒ [normal, reverse_holo])', () => {
    expect(union.get('025/191')?.finishes).toEqual(['normal', 'reverse_holo']);
    expect(union.get('025/191')?.productIds.sort()).toEqual([700001, 700002]);
  });

  it('estructura ≠ precio: la fila Normal de 025/191 tiene marketPrice:null y AÚN ASÍ aporta el `normal`', () => {
    // 700001 (Normal) tiene marketPrice:null en la fixture; el union igual incluye `normal`.
    expect(prices.find((r) => r.productId === 700001)?.marketPrice).toBeNull();
    expect(union.get('025/191')?.finishes).toContain('normal');
  });

  it('representación B — VARIAS filas bajo UN productId (030/191) ⇒ se UNEN ([normal, reverse_holo])', () => {
    expect(union.get('030/191')?.finishes).toEqual(['normal', 'reverse_holo']);
    expect(union.get('030/191')?.productIds).toEqual([700003]);
  });

  it('subTypeName DESCONOCIDO se OMITE, los conocidos sobreviven (099/191: Normal + "Poké Ball…" ⇒ [normal])', () => {
    expect(union.get('099/191')?.finishes).toEqual(['normal']);
  });

  it('carta con SOLO subTypeName desconocido (100/191) ⇒ NO entra al mapa (nada mapeable que escribir)', () => {
    expect(union.has('100/191')).toBe(false);
  });

  it('fila de precio de un producto SELLADO (sin Number, 800001) NO aporta estructura a ninguna carta', () => {
    // Ninguna entrada del mapa contiene el productId 800001.
    const anyHas800001 = [...union.values()].some((v) => v.productIds.includes(800001));
    expect(anyHas800001).toBe(false);
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
