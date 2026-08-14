import { CatalogService, yearFromReleaseDate } from '../src/modules/catalog/catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.1 — "Compra" = inventario PUBLICADO con precio (API_CONTRACT §catalog). El comprador
 * NUNCA ve "precio pendiente": solo aparecen items `listed` con precio de venta RESOLUBLE
 * (listPriceCents fijado o referencia con la que calcular precio×markup). Facetas dinámicas.
 */

function pricing(): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    // Item con listPriceCents fijado → salePrice = listPrice; sin él y pending → no sellable.
    getReference: jest.fn(async (cardId: string) =>
      cardId === 'pending' ? { status: 'pending' } : { status: 'priced', referenceMxnCents: 10000 },
    ),
    computeSalePrice: jest.fn(async (ref: number) => Math.round(ref * 1.15)),
  } as unknown as PricingService;
}

function cardOf(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's-new',
    imageSmallUrl: null,
    imageLargeUrl: null,
    set: { id: 's-new', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    ...over,
  };
}

function itemOf(over: Partial<any> = {}) {
  return {
    id: 'i1',
    cardId: 'c1',
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    gradingCompany: null,
    gradeValue: null,
    status: 'listed',
    listPriceCents: 11500,
    frontPhotoKey: null,
    backPhotoKey: null,
    createdAt: new Date('2026-08-01'),
    card: cardOf(),
    ...over,
  };
}

describe('CatalogService.listCards — regla dura de "Compra"', () => {
  it('publica items listed + plataforma con precio de venta; excluye "precio pendiente"', async () => {
    let captured: any;
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async (args: any) => {
          captured = args.where;
          return [
            itemOf({ id: 'ok', listPriceCents: 11500 }),
            // Item pendiente: listPrice null + referencia pending → NO comprable → excluido.
            itemOf({ id: 'pending', listPriceCents: null, cardId: 'pending', card: cardOf({ id: 'pending' }) }),
          ];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const res = await svc.listCards({ page: 1, pageSize: 20 });

    expect(captured.ownerType).toBe('platform');
    expect(captured.status).toBe('listed');
    // El item sin precio resoluble queda fuera del listado.
    expect(res.data).toHaveLength(1);
    expect(res.data[0].inventoryItemId).toBe('ok');
    expect(res.data[0].sellable).toBe(true);
    expect(res.data[0].salePriceCents).toBe(11500);
    expect(res.total).toBe(1);
  });

  it('propaga filtros de tipo/sealedSubtype al where y aplica rango de precio', async () => {
    let captured: any;
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async (args: any) => {
          captured = args.where;
          return [itemOf({ productType: 'sealed', sealedSubtype: 'etb', listPriceCents: 11500 })];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    // Rango que excluye el único item (11500 < 20000) → lista vacía.
    const res = await svc.listCards({
      page: 1,
      pageSize: 20,
      productType: 'sealed',
      sealedSubtype: 'etb',
      minPriceCents: 20000,
    });
    expect(captured.productType).toBe('sealed');
    expect(captured.sealedSubtype).toBe('etb');
    expect(res.data).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});

describe('CatalogService.facets — facetas dinámicas sobre inventario publicado', () => {
  it('devuelve rarities distinct, sets con year desc, productTypes, sealedSubtypes y rango de precio', async () => {
    const items = [
      itemOf({ id: 'a', productType: 'raw', listPriceCents: 5000, card: cardOf({ rarity: 'Illustration Rare' }) }),
      itemOf({
        id: 'b',
        productType: 'sealed',
        sealedSubtype: 'etb',
        listPriceCents: 450000,
        card: cardOf({ id: 'c2', rarity: null, set: { id: 's-old', name: 'Base', releaseDate: '1999/01/09' } }),
      }),
      itemOf({ id: 'c', productType: 'sealed', sealedSubtype: 'box', listPriceCents: 300000, card: cardOf({ id: 'c3', rarity: 'Common' }) }),
    ];
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => items) } };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const f = await svc.facets();

    expect(f.rarities).toEqual(expect.arrayContaining(['Illustration Rare', 'Common']));
    expect(f.rarities).not.toContain(null);
    expect(f.sets.map((s) => s.id)).toEqual(['s-new', 's-old']); // año desc
    expect(f.sets[0].year).toBe(2024);
    expect(f.sets[1].year).toBe(1999);
    expect(f.productTypes).toEqual(expect.arrayContaining(['raw', 'sealed']));
    expect(f.sealedSubtypes).toEqual(expect.arrayContaining(['etb', 'box']));
    expect(f.price).toEqual({ minCents: 5000, maxCents: 450000, currency: 'MXN' });
  });
});

describe('CatalogService.getListing — 404 si no es visible en Compra', () => {
  it('item sin precio resoluble (pendiente) → 404', async () => {
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async () => [
          itemOf({ id: 'pending', listPriceCents: null, cardId: 'pending', card: cardOf({ id: 'pending' }) }),
        ]),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    await expect(svc.getListing('pending')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('yearFromReleaseDate', () => {
  it('deriva el año de yyyy/MM/dd', () => {
    expect(yearFromReleaseDate('2024/11/08')).toBe(2024);
    expect(yearFromReleaseDate(null)).toBeNull();
    expect(yearFromReleaseDate('bogus')).toBeNull();
  });
});
