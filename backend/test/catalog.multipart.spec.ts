import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * P-27 (v1.33-master-set-multipart, §4.31d) — STOREFRONT del master set combinado. Con fixtures:
 * `GET /catalog/sets` y `/catalog/facets` PLIEGAN el subset (cel25c) en su principal (cel25 aparece
 * UNA vez, gana `partSetIds`); `GET /catalog/cards?setId=cel25` EXPANDE a `setId IN partSetIds`.
 * Aditivo/money-safe: agrupar NO publica cartas sin precio (la Regla de Compra se respeta).
 */

function pricing(): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    loadSalesRules: jest.fn(async () => ({ rules: {}, fallbackPct: 15 })),
    getReferencesBatch: jest.fn(async () => new Map()),
    computeSalePriceForItem: jest.fn(async () => ({ salePriceCents: 11500, status: 'priced' })),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
    sealedMarketGradeKeyForItem: jest.fn(() => null),
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    gateSealedMarketCents: () => null,
    resolveSealedSalePrice: () => ({ salePriceCents: null, status: 'pending' }),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

const setRef = (id: string, externalId: string, name: string, releaseDate: string) => ({
  id,
  externalId,
  name,
  series: name,
  releaseDate,
});

function item(id: string, set: ReturnType<typeof setRef>) {
  return {
    id,
    cardId: `card-${id}`,
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    status: 'listed',
    finish: 'normal',
    listPriceCents: 11500, // override manual → sellable directo (sin depender de referencia)
    createdAt: new Date('2026-08-01'),
    card: {
      id: `card-${id}`,
      externalId: `${set.externalId}-${id}`,
      name: `Card ${id}`,
      number: '1',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      setId: set.id,
      imageSmallUrl: null,
      imageLargeUrl: null,
      set,
    },
  };
}

const CEL25 = setRef('cel25-local', 'cel25', 'Celebrations', '2021/10/08');
const CEL25C = setRef('cel25c-local', 'cel25c', 'Classic Collection', '2021/10/08');
const SV08 = setRef('sv08-local', 'sv08', 'Surging Sparks', '2024/11/08');

describe('CatalogService.listSets / facets — plegado del master set combinado', () => {
  it('listSets: cel25c se pliega en cel25 (una entrada) con partSetIds; el set normal intacto', async () => {
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async () => [item('a', CEL25), item('b', CEL25C), item('c', SV08)]),
      },
      cardSet: { findMany: jest.fn() },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const { data } = await svc.listSets();

    // El subset NO aparece como entrada propia.
    expect(data.find((s) => s.id === 'cel25c-local')).toBeUndefined();
    const cel = data.find((s) => s.id === 'cel25-local')! as any;
    expect(cel.name).toBe('Celebrations');
    expect(cel.partSetIds).toEqual(['cel25-local', 'cel25c-local']);
    // Set normal: sin partSetIds.
    const sv = data.find((s) => s.id === 'sv08-local')! as any;
    expect(sv.partSetIds).toBeUndefined();
    // Primario ya presente entre publicados → no hace falta traerlo aparte.
    expect(prisma.cardSet.findMany).not.toHaveBeenCalled();
  });

  it('facets: idéntico plegado (cel25 una vez, +partSetIds); orden por año desc', async () => {
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn(async () => [item('a', CEL25), item('b', CEL25C), item('c', SV08)]),
      },
      cardSet: { findMany: jest.fn() },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const f = await svc.facets();

    expect(f.sets.map((s) => s.id)).toEqual(['sv08-local', 'cel25-local']); // 2024 antes que 2021
    const cel = f.sets.find((s) => s.id === 'cel25-local')! as any;
    expect(cel.partSetIds).toEqual(['cel25-local', 'cel25c-local']);
  });

  it('solo el subset publicado (principal sin inventario): se trae el principal para nombrar la entrada', async () => {
    const prisma: any = {
      inventoryItem: { findMany: jest.fn(async () => [item('b', CEL25C)]) },
      // El principal cel25 no tiene inventario publicado → se resuelve por externalId.
      cardSet: {
        findMany: jest.fn(async () => [
          { id: 'cel25-local', externalId: 'cel25', name: 'Celebrations', series: 'Celebrations', releaseDate: '2021/10/08' },
        ]),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const { data } = await svc.listSets();

    expect(prisma.cardSet.findMany).toHaveBeenCalled();
    expect(data.find((s) => s.id === 'cel25c-local')).toBeUndefined();
    const cel = data.find((s) => s.id === 'cel25-local')! as any;
    expect(cel.name).toBe('Celebrations');
    expect(cel.partSetIds).toEqual(['cel25-local', 'cel25c-local']);
  });
});

describe('CatalogService.listCards — expansión de setId del principal', () => {
  it('setId=cel25 (principal) → where.card.setId IN [cel25, cel25c]', async () => {
    let captured: any;
    const prisma: any = {
      cardSet: {
        findUnique: jest.fn(async () => ({ externalId: 'cel25' })),
        findMany: jest.fn(async () => [{ id: 'cel25-local' }, { id: 'cel25c-local' }]),
      },
      inventoryItem: {
        findMany: jest.fn(async (args: any) => {
          captured = args.where;
          return [item('a', CEL25), item('b', CEL25C)];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    const res = await svc.listCards({ setId: 'cel25-local', page: 1, pageSize: 20 });

    expect(captured.card.setId).toEqual({ in: ['cel25-local', 'cel25c-local'] });
    // Ambas partes publicadas aparecen (inventario de cel25 + cel25c bajo el filtro del principal).
    expect(res.data).toHaveLength(2);
  });

  it('setId de un set NORMAL → filtro por ese set tal cual (sin expansión)', async () => {
    let captured: any;
    const prisma: any = {
      cardSet: { findUnique: jest.fn(async () => ({ externalId: 'sv08' })), findMany: jest.fn() },
      inventoryItem: {
        findMany: jest.fn(async (args: any) => {
          captured = args.where;
          return [item('c', SV08)];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricing());
    await svc.listCards({ setId: 'sv08-local', page: 1, pageSize: 20 });

    expect(captured.card.setId).toBe('sv08-local'); // string, no { in: [...] }
    expect(prisma.cardSet.findMany).not.toHaveBeenCalled();
  });
});
