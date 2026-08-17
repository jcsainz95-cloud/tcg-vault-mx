import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.3 — Cotizador (API_CONTRACT §6): búsqueda pública sobre TODA la tabla `Card`
 * (`GET /buylist/cards`) y sets con cartas importadas (`GET /buylist/sets`). A diferencia
 * de "Compra" (`/catalog/*`), NO se filtra por inventario ni por precio: una carta que NO
 * tenemos en bóveda también es cotizable.
 */

function pricingStub(): PricingService {
  // El cotizador no usa pricing; se pasa un stub para el constructor de CatalogService.
  return {} as unknown as PricingService;
}

function cardRow(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-1',
    name: 'Pikachu',
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 'sv8',
    imageSmallUrl: 's',
    imageLargeUrl: 'l',
    set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    ...over,
  };
}

describe('CatalogService.searchAllCards — cotizador sobre TODO el catálogo', () => {
  it('consulta la tabla Card (no InventoryItem) → incluye cartas sin inventario, con CardDTO y paginación', async () => {
    let capturedWhere: any;
    let capturedArgs: any;
    const prisma: any = {
      card: {
        findMany: jest.fn(async (args: any) => {
          capturedArgs = args;
          capturedWhere = args.where;
          // Ninguna de estas cartas está en inventario: prueba que el cotizador no depende de bóveda.
          return [cardRow({ id: 'c1' }), cardRow({ id: 'c2', name: 'Raichu', number: '2' })];
        }),
        count: jest.fn(async () => 42),
      },
      // No debe tocar inventoryItem en absoluto.
      inventoryItem: { findMany: jest.fn() },
    };
    const svc = new CatalogService(prisma as PrismaService, pricingStub());

    const res = await svc.searchAllCards({ setId: 'sv8', rarity: 'Illustration Rare', page: 2, pageSize: 20 });

    // Filtra por set y rareza sobre Card; nunca consulta el inventario.
    expect(capturedWhere.setId).toBe('sv8');
    expect(capturedWhere.rarity).toBe('Illustration Rare');
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
    // Paginación: page 2 → skip = 20.
    expect(capturedArgs.skip).toBe(20);
    expect(capturedArgs.take).toBe(20);
    // Shape CardDTO (sin sellable/salePriceCents) + total del count.
    expect(res.data).toHaveLength(2);
    expect(res.data[0]).toMatchObject({
      id: 'c1',
      name: 'Pikachu',
      number: '1',
      rarity: 'Illustration Rare',
      setId: 'sv8',
      setName: 'Surging Sparks',
      imageSmallUrl: 's',
    });
    expect(res.data[0]).not.toHaveProperty('sellable');
    expect(res.data[0]).not.toHaveProperty('salePriceCents');
    expect(res).toMatchObject({ page: 2, pageSize: 20, total: 42 });
  });

  it('q busca por nombre O número (case-insensitive)', async () => {
    let capturedWhere: any;
    const prisma: any = {
      card: {
        findMany: jest.fn(async (args: any) => {
          capturedWhere = args.where;
          return [cardRow()];
        }),
        count: jest.fn(async () => 1),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricingStub());
    await svc.searchAllCards({ q: 'pika', page: 1, pageSize: 20 });

    expect(capturedWhere.OR).toEqual([
      { name: { contains: 'pika', mode: 'insensitive' } },
      { number: { contains: 'pika', mode: 'insensitive' } },
    ]);
  });

  it('sin filtros → where vacío (todo el catálogo), skip 0', async () => {
    let capturedArgs: any;
    const prisma: any = {
      card: {
        findMany: jest.fn(async (args: any) => {
          capturedArgs = args;
          return [];
        }),
        count: jest.fn(async () => 0),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricingStub());
    const res = await svc.searchAllCards({ page: 1, pageSize: 50 });
    expect(capturedArgs.where).toEqual({});
    expect(capturedArgs.skip).toBe(0);
    expect(capturedArgs.take).toBe(50);
    expect(res).toEqual({ data: [], page: 1, pageSize: 50, total: 0 });
  });
});

describe('CatalogService.listSetsWithImportedCards — sets del cotizador', () => {
  /** Prisma stub que devuelve los sets dados desde cardSet.findMany. */
  function prismaWithSets(rows: any[]): any {
    return { cardSet: { findMany: jest.fn(async () => rows) } };
  }

  it('devuelve solo sets con cartas importadas, con year derivado y orden desc', async () => {
    let capturedWhere: any;
    const prisma: any = {
      cardSet: {
        findMany: jest.fn(async (args: any) => {
          capturedWhere = args.where;
          return [
            { id: 'base1', name: 'Base', series: 'Base', releaseDate: '1999/01/09' },
            { id: 'sv8', name: 'Surging Sparks', series: 'Scarlet & Violet', releaseDate: '2024/11/08' },
          ];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, pricingStub());
    const res = await svc.listSetsWithImportedCards();

    // Solo sets con al menos una carta importada.
    expect(capturedWhere).toEqual({ cards: { some: {} } });
    // Ordenados por año desc; year derivado de releaseDate.
    expect(res.data.map((s) => s.id)).toEqual(['sv8', 'base1']);
    expect(res.data[0]).toMatchObject({ id: 'sv8', name: 'Surging Sparks', series: 'Scarlet & Violet', year: 2024 });
    expect(res.data[1].year).toBe(1999);
  });

  it('ordena por releaseDate COMPLETA desc, no solo por año (mismo año, distinta fecha)', async () => {
    const prisma = prismaWithSets([
      { id: 'sv6', name: 'Twilight Masquerade', series: 'SV', releaseDate: '2024/05/24' },
      { id: 'sv8', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08' },
      { id: 'sv7', name: 'Stellar Crown', series: 'SV', releaseDate: '2024/09/13' },
    ]);
    const svc = new CatalogService(prisma as PrismaService, pricingStub());
    const res = await svc.listSetsWithImportedCards();
    // Con orden solo-por-año los tres empatarían (2024); la fecha completa los distingue.
    expect(res.data.map((s) => s.id)).toEqual(['sv8', 'sv7', 'sv6']);
  });

  it('empate exacto de releaseDate → desempata por name asc', async () => {
    const prisma = prismaWithSets([
      { id: 'swsh9tg', name: 'Brilliant Stars Trainer Gallery', series: 'SWSH', releaseDate: '2022/02/25' },
      { id: 'swsh9', name: 'Brilliant Stars', series: 'SWSH', releaseDate: '2022/02/25' },
      { id: 'zx', name: 'Astral Radiance', series: 'SWSH', releaseDate: '2022/02/25' },
    ]);
    const svc = new CatalogService(prisma as PrismaService, pricingStub());
    const res = await svc.listSetsWithImportedCards();
    expect(res.data.map((s) => s.name)).toEqual([
      'Astral Radiance',
      'Brilliant Stars',
      'Brilliant Stars Trainer Gallery',
    ]);
  });

  it('sets sin releaseDate van al FINAL (no mezclados como antiguos), ordenados por nombre entre sí', async () => {
    const prisma = prismaWithSets([
      { id: 'nodate-b', name: 'Zeta Promos', series: null, releaseDate: null },
      { id: 'base1', name: 'Base', series: 'Base', releaseDate: '1999/01/09' },
      { id: 'nodate-a', name: 'Alpha Promos', series: null, releaseDate: null },
      { id: 'sv8', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08' },
    ]);
    const svc = new CatalogService(prisma as PrismaService, pricingStub());
    const res = await svc.listSetsWithImportedCards();
    // Con fecha primero (desc); sin fecha al final, entre sí por nombre asc.
    expect(res.data.map((s) => s.id)).toEqual(['sv8', 'base1', 'nodate-a', 'nodate-b']);
    expect(res.data[2]).toMatchObject({ releaseDate: null, year: null });
    expect(res.data[3]).toMatchObject({ releaseDate: null, year: null });
  });
});
