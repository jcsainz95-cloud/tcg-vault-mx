import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * Robustez del sync de catálogo (bugs de producción):
 *  1) remote-sets degrada con GRACIA a la lista LOCAL cuando pokemontcg.io falla/rate-limitea
 *     (nada de 500 crudo; el shape del contrato se mantiene).
 *  2) el import AÍSLA cada carta: una carta mala NO aborta el set (ya no queda en 1 carta).
 *  3) el import PAGINA todas las páginas (usa totalCount/pageSize).
 */
function remoteCard(id: string) {
  return {
    id,
    name: `Card ${id}`,
    number: '1',
    rarity: 'Common',
    supertype: 'Pokémon',
    subtypes: [],
    images: { small: 's', large: 'l' },
    set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
  };
}

const settings = () => ({ getString: jest.fn(async () => '2024/01/01') }) as unknown as SettingsService;

describe('CatalogSyncService.remoteSets — degradación con gracia', () => {
  it('pokemontcg.io falla → fallback a sets LOCALES (degraded=true, source=local)', async () => {
    const localSets = [
      { externalId: 'sv8', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', printedTotal: 200, _count: { cards: 191 } },
      { externalId: 'base1', name: 'Base', series: 'Base', releaseDate: '1999/01/09', printedTotal: 102, _count: { cards: 102 } },
    ];
    const prisma: any = { cardSet: { findMany: jest.fn(async () => localSets) } };
    const client = {
      getSets: jest.fn(async () => {
        throw new Error('pokemontcg.io /sets -> HTTP 429');
      }),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    const res: any = await svc.remoteSets();
    expect(res.degraded).toBe(true);
    expect(res.source).toBe('local');
    // Mantiene el shape del contrato: data con id/name/releaseDate/imported/cardCount.
    expect(res.data[0]).toMatchObject({ id: 'sv8', imported: true, cardCount: 191 });
    // Ordenado por releaseDate desc (sv8 2024 antes que base1 1999).
    expect(res.data.map((d: any) => d.id)).toEqual(['sv8', 'base1']);
  });

  it('pokemontcg.io responde → usa remoto (degraded=false, source=remote)', async () => {
    const prisma: any = {
      cardSet: {
        findMany: jest.fn(async (arg: any) =>
          arg?.select
            ? [{ externalId: 'sv8', _count: { cards: 5 } }]
            : [],
        ),
      },
    };
    const client = {
      getSets: jest.fn(async () => [{ id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' }]),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());
    const res: any = await svc.remoteSets();
    expect(res.degraded).toBe(false);
    expect(res.source).toBe('remote');
    expect(res.data[0]).toMatchObject({ id: 'sv8', imported: true, cardCount: 5 });
  });
});

describe('CatalogSyncService — import robusto por carta', () => {
  function prismaWithCardUpsert(upsertImpl: (args: any) => Promise<any>) {
    return {
      cardSet: { upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })) },
      card: { upsert: jest.fn(upsertImpl) },
    } as any;
  }

  it('la 2ª carta truena pero el resto SÍ se importa (cardCount=2, no 1)', async () => {
    let n = 0;
    const prisma = prismaWithCardUpsert(async () => {
      n += 1;
      if (n === 2) throw new Error('bad card data (number missing)');
      return {};
    });
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-1'), remoteCard('sv8-2'), remoteCard('sv8-3')],
        page: 1,
        pageSize: 250,
        count: 3,
        totalCount: 3,
      })),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    // importSet devuelve el cardCount REAL importado (2), no aborta en la 1ª.
    const res = await (svc as any).importSet({ id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' });
    expect(res.cardCount).toBe(2);
    expect(prisma.card.upsert).toHaveBeenCalledTimes(3); // intentó las 3 (no abortó)
  });

  it('cartas sin id/name se omiten con log, sin reventar el barrido', async () => {
    const prisma = prismaWithCardUpsert(async () => ({}));
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-1'), { id: '', name: '', number: '2', set: {} }, remoteCard('sv8-3')],
        page: 1,
        pageSize: 250,
        count: 3,
        totalCount: 3,
      })),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());
    const res = await (svc as any).importSet({ id: 'sv8', name: 'S', releaseDate: '2024/11/08' });
    expect(res.cardCount).toBe(2); // la carta inválida se omite; las otras 2 entran
    expect(prisma.card.upsert).toHaveBeenCalledTimes(2);
  });

  it('pagina TODAS las páginas (usa totalCount/pageSize)', async () => {
    const prisma = prismaWithCardUpsert(async () => ({}));
    const getCardsBySet = jest
      .fn()
      // página 1: 2 cartas, totalCount 3, pageSize 2 → hay una 2ª página
      .mockResolvedValueOnce({ data: [remoteCard('c1'), remoteCard('c2')], page: 1, pageSize: 2, count: 2, totalCount: 3 })
      // página 2: la 3ª carta
      .mockResolvedValueOnce({ data: [remoteCard('c3')], page: 2, pageSize: 2, count: 1, totalCount: 3 });
    const client = { getCardsBySet } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    const res = await (svc as any).importSet({ id: 'sv8', name: 'S', releaseDate: '2024/11/08' });
    expect(getCardsBySet).toHaveBeenCalledTimes(2); // page 1 y page 2
    expect(res.cardCount).toBe(3); // todas las cartas de ambas páginas
  });
});
