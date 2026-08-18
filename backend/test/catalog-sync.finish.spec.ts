import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';
import { deriveAvailableFinishes, TCG_KEY_TO_FINISH } from '../src/modules/pricing/pricing.types';

/**
 * v1.22-variantes-orden (ARCHITECTURE §3.7 / §4.22a) — reemplaza la suite v1.6-finish: la FUENTE
 * de `Card.availableFinishes` deja de ser "las llaves de tcgplayer.prices con market > 0" (bug de
 * tres rondas, VAR-1/VAR-2) y pasa a ser la UNIÓN de dos señales del payload remoto —
 * `tcgplayer.prices` (LLAVE presente) ∪ `cardmarket.prices.reverseHolo*` (VALOR > 0) — con `null`
 * cuando NINGUNA de las dos existe (≠ "solo normal"). Tabla de verdad obligatoria (ARCHITECTURE
 * §4.22, «Reparto de trabajo»).
 */

describe('deriveAvailableFinishes (§4.22a-3) — tabla de verdad', () => {
  it('Señal A: llave PRESENTE con market:null SIGUE contando (arregla "reverse holo sin precio")', () => {
    const finishes = deriveAvailableFinishes({
      tcgplayer: { prices: { normal: { market: 1 }, reverseHolofoil: { market: null } } },
    });
    expect(finishes?.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
  });

  it('Señal A: mapea las llaves conocidas y descarta las no mapeadas', () => {
    const finishes = deriveAvailableFinishes({
      tcgplayer: {
        prices: {
          normal: { market: 1 },
          reverseHolofoil: { market: 2 },
          holofoil: { market: 3 },
          '1stEditionHolofoil': { market: 4 },
          '1stEditionNormal': { market: 5 }, // no mapeada → descartada
          unlimitedHolofoil: { market: 6 }, // no mapeada → descartada
        },
      },
    });
    expect(finishes?.slice().sort()).toEqual(
      ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'].sort(),
    );
  });

  it('Señal B: SOLO cardmarket.reverseHoloTrend > 0 (sin llave reverseHolofoil en tcgplayer) ⇒ idem que A+B juntas', () => {
    // tcgplayer solo trae `normal` (sin reverseHolofoil): la única fuente del reverse holo es
    // Cardmarket. El resultado es el MISMO universo que si TCGplayer también lo hubiera listado.
    const finishes = deriveAvailableFinishes({
      tcgplayer: { prices: { normal: { market: 1 } } },
      cardmarket: { prices: { reverseHoloTrend: 3.5 } },
    });
    expect(finishes?.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
  });

  it('Señal B: CUALQUIERA de las 6 llaves reverseHolo* > 0 activa la señal', () => {
    const keys = [
      'reverseHoloSell',
      'reverseHoloLow',
      'reverseHoloTrend',
      'reverseHoloAvg1',
      'reverseHoloAvg7',
      'reverseHoloAvg30',
    ];
    for (const key of keys) {
      const finishes = deriveAvailableFinishes({ cardmarket: { prices: { [key]: 0.01 } } });
      expect(finishes).toEqual(['reverse_holo']);
    }
  });

  it('Asimetría deliberada (§4.22a-3): en cardmarket la LLAVE presente con valor 0/null/negativo NO es señal', () => {
    // Cardmarket emite estas llaves SIEMPRE; si se trataran como TCGplayer (llave = señal) se
    // inventaría reverse holo en TODAS las cartas — la casilla de relleno que el PO prohíbe.
    expect(
      deriveAvailableFinishes({
        cardmarket: {
          prices: {
            reverseHoloSell: 0,
            reverseHoloLow: null,
            reverseHoloTrend: -1,
            reverseHoloAvg1: Number.NaN,
            reverseHoloAvg7: Number.POSITIVE_INFINITY,
            reverseHoloAvg30: '5', // string numérica: NO es `number` → no cuenta
          },
        },
      }),
    ).toBeNull();
  });

  it('Sin NINGUNA señal (payload vacío o ausente) ⇒ null (≠ ["normal"])', () => {
    expect(deriveAvailableFinishes(undefined)).toBeNull();
    expect(deriveAvailableFinishes(null)).toBeNull();
    expect(deriveAvailableFinishes({})).toBeNull();
    expect(deriveAvailableFinishes({ tcgplayer: {}, cardmarket: {} })).toBeNull();
    expect(deriveAvailableFinishes({ tcgplayer: { prices: {} }, cardmarket: { prices: {} } })).toBeNull();
  });

  it('Solo llaves de tcgplayer NO mapeadas y sin señal B ⇒ null', () => {
    expect(
      deriveAvailableFinishes({ tcgplayer: { prices: { unlimitedHolofoil: { market: 6 } } } }),
    ).toBeNull();
  });

  it('Resultado siempre en orden canónico FINISH_ORDER, deduplicado', () => {
    const finishes = deriveAvailableFinishes({
      tcgplayer: {
        prices: {
          '1stEditionHolofoil': { market: 1 },
          holofoil: { market: 1 },
          reverseHolofoil: { market: 1 },
          normal: { market: 1 },
        },
      },
    });
    expect(finishes).toEqual(['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil']);
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

describe('CatalogSyncService.upsertCards — autoridad única de availableFinishes (§4.22a-4)', () => {
  function buildPrisma(existingCards: Record<string, { availableFinishes: string[] }> = {}) {
    return {
      cardSet: {
        upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
        findMany: jest.fn(async () => []),
      },
      card: {
        upsert: jest.fn(async ({ where }: any) => ({
          id: where.externalId,
          availableFinishes: existingCards[where.externalId]?.availableFinishes ?? ['normal'],
        })),
      },
    } as any;
  }
  function settings(): SettingsService {
    return { getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService;
  }

  function remoteCard(
    id: string,
    over: { tcgplayer?: any; cardmarket?: any; number?: string } = {},
  ) {
    return {
      id,
      name: `Card ${id}`,
      number: over.number ?? '1',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      images: { small: 's', large: 'l' },
      tcgplayer: over.tcgplayer,
      cardmarket: over.cardmarket,
      set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    };
  }

  it('con señal (tcgplayer): CREATE y UPDATE reciben availableFinishes derivado', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-1', { tcgplayer: { prices: { normal: { market: 1 }, reverseHolofoil: { market: 2 } } } })],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ externalId: 'sv8-1' });
    expect(call.create.availableFinishes.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
    expect(call.update.availableFinishes.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
    // M-26: numberSort/numberPrefix siempre poblados, con o sin señal de finish.
    expect(call.create).toMatchObject({ numberSort: 1, numberPrefix: '' });
    expect(call.update).toMatchObject({ numberSort: 1, numberPrefix: '' });
  });

  it('con señal SOLO de cardmarket: deriva reverse_holo aunque tcgplayer no lo liste', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [
          remoteCard('sv8-2', {
            tcgplayer: { prices: { normal: { market: 1 } } },
            cardmarket: { prices: { reverseHoloTrend: 2.1 } },
          }),
        ],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.create.availableFinishes.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
  });

  it('SIN ninguna señal en CREATE ⇒ ["normal"] (conservador, nunca relleno)', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-3')], // sin tcgplayer ni cardmarket
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.create.availableFinishes).toEqual(['normal']);
  });

  it('SIN ninguna señal en UPDATE ⇒ la clave se OMITE (nunca clobbea lo que ya sabíamos)', async () => {
    // Carta que YA sabíamos con 2 variantes: un payload degradado (sin señal) en un re-sync no
    // debe poder volver a reducirla a ['normal'] — justo el bug de tres rondas (VAR-1).
    const prisma = buildPrisma({ 'sv8-4': { availableFinishes: ['normal', 'reverse_holo'] } });
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-4')], // sin tcgplayer ni cardmarket → derived === null
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('availableFinishes');
    // El resto de la metadata SÍ se sigue actualizando (name/number/orden), solo se omite la clave.
    expect(call.update).toMatchObject({ name: 'Card sv8-4', numberSort: 1, numberPrefix: '' });
  });

  it('con señal en UPDATE ⇒ el catálogo SÍ puede reducir (corrección legítima de un dato erróneo)', async () => {
    const prisma = buildPrisma({ 'sv8-5': { availableFinishes: ['normal', 'reverse_holo', 'holofoil'] } });
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-5', { tcgplayer: { prices: { normal: { market: 1 } } } })],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.update.availableFinishes).toEqual(['normal']);
  });

  it('M-26: promo con prefijo alfabético (TG12) ⇒ numberSort = PROMO_SORT_BASE + 12, numberPrefix = "TG"', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-tg12', { number: 'TG12' })],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ numberSort: 1_000_012, numberPrefix: 'TG' });
  });
});
