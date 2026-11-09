/**
 * tcgcsv-import-caps.spec.ts — P-PROMOS (PRM-3): topes del import de cartas desde TCGCSV. Respuesta upstream ≤ 5 MB y
 * ≤ 2000 productos; si no, el cliente LANZA (el servicio lo traduce a 502 UPSTREAM_ERROR). Sin red: `fetch` simulado.
 */
import { TcgcsvCatalogClient, TCGCSV_GROUP_NAME_MAX_LENGTH, TCGCSV_IMPORT_MAX_BYTES, TCGCSV_IMPORT_MAX_PRODUCTS } from '../src/modules/pricing/providers/tcgcsv-singles.provider';

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

describe('AUTO-S3 — entrada externa de `listGroups`/`getProducts` (tipo, longitud, bytes)', () => {
  const client = new TcgcsvCatalogClient();

  it('un `name` que no es string (numero, objeto, arreglo) se DESCARTA; el resto de grupos sigue', async () => {
    respond(JSON.stringify({ results: [{ groupId: 1, name: 123 }, { groupId: 2, name: { x: 1 } }, { groupId: 3, name: ['a'] }, { groupId: 4, name: '   ' }, { groupId: 5, name: 'Promos OK' }] }));
    expect((await client.listGroups()).map((g) => g.groupId)).toEqual([5]);
  });

  it('el nombre de grupo se acota a TCGCSV_GROUP_NAME_MAX_LENGTH (va a CardSet.name y a la bitacora)', async () => {
    respond(JSON.stringify({ results: [{ groupId: 7, name: `  ${'N'.repeat(5000)}  ` }] }));
    const [g] = await client.listGroups();
    expect(g.name).toHaveLength(TCGCSV_GROUP_NAME_MAX_LENGTH);
  });

  it('listGroups y getProducts tienen tope de bytes como getCardProducts/getPrices', async () => {
    respond(JSON.stringify({ results: [], pad: 'x'.repeat(TCGCSV_IMPORT_MAX_BYTES + 10) }));
    await expect(client.listGroups()).rejects.toThrow(/tope/);
    respond(JSON.stringify({ results: [], pad: 'x'.repeat(TCGCSV_IMPORT_MAX_BYTES + 10) }));
    await expect(client.getProducts(24451)).rejects.toThrow(/tope/);
  });
});
