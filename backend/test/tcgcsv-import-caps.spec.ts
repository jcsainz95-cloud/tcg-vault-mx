/**
 * tcgcsv-import-caps.spec.ts — P-PROMOS (PRM-3): topes del import de cartas desde TCGCSV. Respuesta upstream ≤ 5 MB y
 * ≤ 2000 productos; si no, el cliente LANZA (el servicio lo traduce a 502 UPSTREAM_ERROR). Sin red: `fetch` simulado.
 */
import { TcgcsvCatalogClient, TCGCSV_IMPORT_MAX_BYTES, TCGCSV_IMPORT_MAX_PRODUCTS } from '../src/modules/pricing/providers/tcgcsv-singles.provider';

const original = global.fetch;
afterEach(() => {
  global.fetch = original;
});

function respond(body: string, headers: Record<string, string> = {}) {
  global.fetch = jest.fn(async () => new Response(body, { status: 200, headers })) as unknown as typeof fetch;
}
const products = (n: number) =>
  JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ productId: i + 1, name: `P${i}`, extendedData: [{ name: 'Number', value: String(i + 1) }] })) });

describe('P-PROMOS — topes de respuesta upstream (PRM-3)', () => {
  const client = new TcgcsvCatalogClient();

  it(`${TCGCSV_IMPORT_MAX_PRODUCTS} productos pasan; ${TCGCSV_IMPORT_MAX_PRODUCTS + 1} ⇒ lanza`, async () => {
    respond(products(TCGCSV_IMPORT_MAX_PRODUCTS));
    expect(await client.getCardProducts(24451)).toHaveLength(TCGCSV_IMPORT_MAX_PRODUCTS);
    respond(products(TCGCSV_IMPORT_MAX_PRODUCTS + 1));
    await expect(client.getCardProducts(24451)).rejects.toThrow(/productos/);
  });

  it('cuerpo > 5 MB ⇒ lanza aunque no declare content-length (lectura cortada)', async () => {
    respond(JSON.stringify({ results: [], pad: 'x'.repeat(TCGCSV_IMPORT_MAX_BYTES + 10) }));
    await expect(client.getCardProducts(24451)).rejects.toThrow(/tope/);
    respond(JSON.stringify({ results: [], pad: 'x'.repeat(TCGCSV_IMPORT_MAX_BYTES + 10) }));
    await expect(client.getPrices(24451)).rejects.toThrow(/tope/);
  });

  it('content-length declarado > 5 MB ⇒ lanza sin leer', async () => {
    respond('{"results":[]}', { 'content-length': String(TCGCSV_IMPORT_MAX_BYTES + 1) });
    await expect(client.getCardProducts(24451)).rejects.toThrow(/excede el tope/);
  });
});
