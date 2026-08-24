import { CardSet } from '@prisma/client';
import { TcgcsvSinglesBulkPriceProvider } from '../src/modules/pricing/providers/tcgcsv-singles-bulk.provider';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v1.44 (P-47, ARCHITECTURE §4.35) — TcgcsvSinglesBulkPriceProvider: barrido DIARIO de PRECIO
 * por-acabado de singles desde TCGCSV `tcgcsv_singles`.
 *
 * Money-safe (NORMATIVO §4.35), reafirmado aquí:
 *  - cada acabado toma SU `marketPrice` (Normal/Reverse Holofoil/Holofoil con markets DISTINTOS ⇒ 3
 *    filas con precios distintos por finish);
 *  - un acabado SIN `marketPrice` (null/≤0) ⇒ NO produce fila (jamás copia el de otro acabado);
 *  - `subTypeName` desconocido ⇒ OMITIDO (anti-invención);
 *  - un `productId` sin `CardProduct` local (estructura no resuelta) ⇒ OMITIDO (estructura ≠ precio);
 *  - fallo remoto ⇒ `requestOk:false` + 0 filas (precios previos STALE, no se borran);
 *  - NO escribe estructura (no toca `CardProduct`/`Card`): solo LEE `cardProduct.findMany`.
 */

const SET = {
  id: 'local-me05',
  externalId: 'me05',
  name: 'Pitch Black',
  pptSetId: '24688',
} as unknown as CardSet;

/** Cliente TCGCSV mockeado (getProducts/getPrices/listGroups). */
function catalogClient(over: Partial<Record<'products' | 'prices' | 'groups', unknown>> = {}) {
  return {
    listGroups: jest.fn(async () => (over.groups as unknown[]) ?? []),
    getProducts: jest.fn(async () => (over.products as unknown[]) ?? []),
    getPrices: jest.fn(async () => (over.prices as unknown[]) ?? []),
  } as unknown as TcgcsvCatalogClient;
}

/** Prisma mock — SOLO lectura de `cardProduct.findMany` (el provider NUNCA escribe estructura). */
function prismaWithCardProducts(rows: unknown[]) {
  const findMany = jest.fn(async () => rows);
  return {
    prisma: { cardProduct: { findMany } } as unknown as PrismaService,
    findMany,
  };
}

describe('TcgcsvSinglesBulkPriceProvider.fetchPricesForSet', () => {
  it('MONEY-SAFE por-acabado: Normal/Reverse Holofoil/Holofoil con markets DISTINTOS ⇒ 3 filas con SU precio', async () => {
    const client = catalogClient({
      products: [{ productId: 704841, name: 'Voltaic Lightning Energy', number: '084/084' }],
      prices: [
        { productId: 704841, subTypeName: 'Normal', marketPrice: 1.0 },
        { productId: 704841, subTypeName: 'Reverse Holofoil', marketPrice: 2.5 },
        { productId: 704841, subTypeName: 'Holofoil', marketPrice: 3.75 },
      ],
    });
    const { prisma, findMany } = prismaWithCardProducts([
      { id: 'cp-1', tcgplayerProductId: 704841, cardId: 'card-A', card: { externalId: 'ext-A' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });

    expect(res.requestOk).toBe(true);
    // 3 filas, una por acabado, cada una con SU marketCents (distinto) y su cardProductId.
    const byFinish = Object.fromEntries(res.rows.map((r) => [r.finish, r]));
    expect(res.rows).toHaveLength(3);
    expect(byFinish.normal.marketCents).toBe(100);
    expect(byFinish.reverse_holo.marketCents).toBe(250);
    expect(byFinish.holofoil.marketCents).toBe(375);
    for (const r of res.rows) {
      expect(r).toMatchObject({ cardId: 'card-A', cardProductId: 'cp-1', currency: 'USD', externalId: 'ext-A' });
    }
    // El join se hizo por productId EXACTO (no por número).
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tcgplayerProductId: { in: [704841] } } }),
    );
  });

  it('acabado SIN marketPrice (null/≤0) ⇒ NO produce fila (jamás copia el precio de otro acabado)', async () => {
    const client = catalogClient({
      products: [{ productId: 900, name: 'Common Mon', number: '10' }],
      prices: [
        { productId: 900, subTypeName: 'Normal', marketPrice: 4.2 },
        { productId: 900, subTypeName: 'Reverse Holofoil', marketPrice: null }, // estructura sí, precio NO
        { productId: 900, subTypeName: 'Holofoil', marketPrice: 0 }, // 0 ⇒ omitido (nunca 0 inventado)
      ],
    });
    const { prisma } = prismaWithCardProducts([
      { id: 'cp-9', tcgplayerProductId: 900, cardId: 'card-C', card: { externalId: 'ext-C' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });

    // Solo `normal` tiene precio: reverse_holo/holofoil NO se emiten (celda «—»/PRICE_PENDING aguas abajo).
    expect(res.rows.map((r) => r.finish)).toEqual(['normal']);
    expect(res.rows[0].marketCents).toBe(420);
    expect(res.skipped).toBe(2);
  });

  it('P47-1: market=Infinity/NaN ⇒ fila OMITIDA (no se clampa a MAX_CENTS en silencio)', async () => {
    const client = catalogClient({
      products: [{ productId: 700, name: 'Corrupt Feed Mon', number: '7' }],
      prices: [
        { productId: 700, subTypeName: 'Normal', marketPrice: Infinity },
        { productId: 700, subTypeName: 'Reverse Holofoil', marketPrice: 3.5 }, // finito normal ⇒ sí emite
      ],
    });
    const { prisma } = prismaWithCardProducts([
      { id: 'cp-7', tcgplayerProductId: 700, cardId: 'card-7', card: { externalId: 'ext-7' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });
    // El Infinity NO produce fila; el acabado finito sí, intacto.
    expect(res.rows.map((r) => r.finish)).toEqual(['reverse_holo']);
    expect(res.rows[0].marketCents).toBe(350);
    expect(res.skipped).toBe(1);
  });

  it('P47-1: market sobre la cota de cordura ⇒ fila OMITIDA + warn (dato de feed corrupto)', async () => {
    const client = catalogClient({
      products: [{ productId: 701, name: 'Absurd Price Mon', number: '8' }],
      prices: [
        { productId: 701, subTypeName: 'Normal', marketPrice: 999_999 }, // > 50k USD ⇒ absurdo
        { productId: 701, subTypeName: 'Holofoil', marketPrice: 12.0 }, // dentro de cota ⇒ sí emite
      ],
    });
    const { prisma } = prismaWithCardProducts([
      { id: 'cp-8', tcgplayerProductId: 701, cardId: 'card-8', card: { externalId: 'ext-8' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);
    const warn = jest.spyOn((provider as any).logger, 'warn').mockImplementation(() => {});

    const res = await provider.fetchPricesForSet({ set: SET });
    // El precio absurdo NO se emite (no se clampa a MAX_CENTS); el normal sí.
    expect(res.rows.map((r) => r.finish)).toEqual(['holofoil']);
    expect(res.rows[0].marketCents).toBe(1200);
    expect(res.skipped).toBe(1);
    // Se auditó el dato anómalo (visible, no silencioso) con productId/finish/market.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('market ANÓMALO omitido'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('productId=701'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('999999'));
  });

  it('P47-1: market normal (3.50 USD) sigue emitiéndose idéntico (sin regresión)', async () => {
    const client = catalogClient({
      products: [{ productId: 702, name: 'Normal Mon', number: '9' }],
      prices: [{ productId: 702, subTypeName: 'Normal', marketPrice: 3.5 }],
    });
    const { prisma } = prismaWithCardProducts([
      { id: 'cp-2', tcgplayerProductId: 702, cardId: 'card-2', card: { externalId: 'ext-2' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ finish: 'normal', marketCents: 350, currency: 'USD' });
    expect(res.skipped).toBe(0);
  });

  it('subTypeName DESCONOCIDO ⇒ OMITIDO (anti-invención): no se atribuye a normal', async () => {
    const client = catalogClient({
      products: [{ productId: 555, name: 'X', number: '1' }],
      prices: [
        { productId: 555, subTypeName: 'Unlimited', marketPrice: 9.9 }, // no mapeable
        { productId: 555, subTypeName: 'Holofoil', marketPrice: 5.0 },
      ],
    });
    const { prisma } = prismaWithCardProducts([
      { id: 'cp-5', tcgplayerProductId: 555, cardId: 'card-X', card: { externalId: 'ext-X' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows.map((r) => r.finish)).toEqual(['holofoil']);
  });

  it('varios productos de la MISMA carta (set_base + deck_exclusive) ⇒ filas con cardProductId DISTINTO', async () => {
    const client = catalogClient({
      products: [
        { productId: 704841, name: 'Voltaic Lightning Energy', number: '084/084' },
        { productId: 707029, name: 'Voltaic Lightning Energy - Deck Exclusives', number: '084/084' },
      ],
      prices: [
        { productId: 704841, subTypeName: 'Holofoil', marketPrice: 3.75 },
        { productId: 707029, subTypeName: 'Normal', marketPrice: 1.1 },
      ],
    });
    const { prisma } = prismaWithCardProducts([
      { id: 'cp-base', tcgplayerProductId: 704841, cardId: 'card-A', card: { externalId: 'ext-A' } },
      { id: 'cp-deck', tcgplayerProductId: 707029, cardId: 'card-A', card: { externalId: 'ext-A' } },
    ]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });
    const byCp = Object.fromEntries(res.rows.map((r) => [r.cardProductId, r]));
    expect(byCp['cp-base']).toMatchObject({ finish: 'holofoil', marketCents: 375 });
    expect(byCp['cp-deck']).toMatchObject({ finish: 'normal', marketCents: 110 });
  });

  it('productId SIN CardProduct local (estructura no resuelta) ⇒ OMITIDO (estructura ≠ precio)', async () => {
    const client = catalogClient({
      products: [{ productId: 111, name: 'Nuevo', number: '1' }],
      prices: [{ productId: 111, subTypeName: 'Holofoil', marketPrice: 5.0 }],
    });
    const { prisma } = prismaWithCardProducts([]); // ningún CardProduct existe aún
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res.rows).toHaveLength(0);
    expect(res.requestOk).toBe(true); // el fetch fue OK; simplemente no hay estructura a la que colgar
    expect(res.skipped).toBe(1);
  });

  it('fallo remoto (getPrices lanza) ⇒ requestOk:false + 0 filas (precios previos STALE, no se borran)', async () => {
    const client = {
      listGroups: jest.fn(async () => []),
      getProducts: jest.fn(async () => [{ productId: 1, name: 'A', number: '1' }]),
      getPrices: jest.fn(async () => {
        throw new Error('tcgcsv.com -> HTTP 503');
      }),
    } as unknown as TcgcsvCatalogClient;
    const { prisma, findMany } = prismaWithCardProducts([]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);
    jest.spyOn((provider as any).logger, 'warn').mockImplementation(() => {});

    const res = await provider.fetchPricesForSet({ set: SET });
    expect(res).toMatchObject({ requestOk: false, rows: [], skipped: 0 });
    // No se intentó siquiera resolver estructura (fetch falló antes).
    expect(findMany).not.toHaveBeenCalled();
  });

  it('resuelve el groupId por pptSetId entero (S-D3) sin consultar listGroups', async () => {
    const client = catalogClient({ products: [], prices: [] });
    const { prisma } = prismaWithCardProducts([]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    await provider.fetchPricesForSet({ set: SET });
    expect(client.getProducts).toHaveBeenCalledWith(24688);
    expect(client.getPrices).toHaveBeenCalledWith(24688);
    expect(client.listGroups).not.toHaveBeenCalled();
  });

  it('sin pptSetId numérico ⇒ resuelve por nombre ÚNICO vía listGroups', async () => {
    const client = catalogClient({
      groups: [
        { groupId: 24688, name: 'Pitch Black' },
        { groupId: 999, name: 'Some Other Set' },
      ],
      products: [],
      prices: [],
    });
    const { prisma } = prismaWithCardProducts([]);
    const provider = new TcgcsvSinglesBulkPriceProvider(client, prisma);

    await provider.fetchPricesForSet({ set: { ...SET, pptSetId: null } as unknown as CardSet });
    expect(client.getProducts).toHaveBeenCalledWith(24688);
  });
});
