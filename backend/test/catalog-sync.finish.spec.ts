import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';
import { deriveAvailableFinishes, TCG_KEY_TO_FINISH } from '../src/modules/pricing/pricing.types';

/**
 * v1.6-finish — el import deriva Card.availableFinishes de las LLAVES de tcgplayer.prices
 * (mapeo ARCHITECTURE §3.7), descartando las no mapeadas; ausente/vacío → [normal].
 */

describe('deriveAvailableFinishes (§3.7)', () => {
  it('mapea las llaves conocidas y descarta las no mapeadas', () => {
    const finishes = deriveAvailableFinishes({
      normal: { market: 1 },
      reverseHolofoil: { market: 2 },
      holofoil: { market: 3 },
      '1stEditionHolofoil': { market: 4 },
      '1stEditionNormal': { market: 5 }, // no mapeada → descartada
      unlimitedHolofoil: { market: 6 }, // no mapeada → descartada
    });
    expect(finishes.sort()).toEqual(
      ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'].sort(),
    );
  });

  it('prices ausente o vacío → [normal] (default seguro)', () => {
    expect(deriveAvailableFinishes(undefined)).toEqual(['normal']);
    expect(deriveAvailableFinishes(null)).toEqual(['normal']);
    expect(deriveAvailableFinishes({})).toEqual(['normal']);
  });

  it('solo llaves no mapeadas → [normal]', () => {
    expect(deriveAvailableFinishes({ unlimitedHolofoil: { market: 6 } })).toEqual(['normal']);
  });

  it('mapeo llave→Finish exacto (decisión del humano §3.7)', () => {
    expect(TCG_KEY_TO_FINISH).toMatchObject({
      normal: 'normal',
      reverseHolofoil: 'reverse_holo',
      holofoil: 'holofoil',
      '1stEditionHolofoil': 'first_edition_holofoil',
    });
  });
});

describe('CatalogSyncService.upsertCards — persiste availableFinishes', () => {
  function buildPrisma() {
    return {
      cardSet: {
        upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
        findMany: jest.fn(async () => []),
      },
      card: { upsert: jest.fn(async () => ({})) },
    } as any;
  }
  function settings(): SettingsService {
    return { getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService;
  }

  function remoteCard(id: string, prices?: Record<string, { market?: number }>) {
    return {
      id,
      name: `Card ${id}`,
      number: '1',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      images: { small: 's', large: 'l' },
      tcgplayer: prices ? { url: 'u', prices } : { url: 'u' },
      set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    };
  }

  it('deriva availableFinishes de tcgplayer.prices al importar el set', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [
          remoteCard('sv8-1', { normal: { market: 1 }, reverseHolofoil: { market: 2 } }),
          remoteCard('sv8-2'), // sin prices → [normal]
        ],
        page: 1,
        pageSize: 250,
        count: 2,
        totalCount: 2,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call1 = prisma.card.upsert.mock.calls[0][0];
    expect(call1.where).toEqual({ externalId: 'sv8-1' });
    expect(call1.create.availableFinishes.sort()).toEqual(['normal', 'reverse_holo'].sort());
    expect(call1.update.availableFinishes.sort()).toEqual(['normal', 'reverse_holo'].sort());

    const call2 = prisma.card.upsert.mock.calls[1][0];
    expect(call2.create.availableFinishes).toEqual(['normal']);
  });
});
