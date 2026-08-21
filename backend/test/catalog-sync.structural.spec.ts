import {
  CatalogSyncService,
  parseTcgplayerProductId,
} from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * v1.26 (ARCHITECTURE §4.24a) — `catalog-sync.upsertCards` gana DOS responsabilidades nuevas:
 *  1. Poblar `Card.tcgplayerId` parseando el `productId` de `tcgplayer.url` (ancla del join a TCGCSV).
 *  2. SEMBRAR `Card.structuralFinishes = derived ?? ['normal']` en CREATE; NUNCA tocarla en UPDATE
 *     (pokemontcg.io no es autoridad estructural — esa es el resolver TCGCSV de `importSet`).
 * Se construye el servicio SIN el resolver (`@Optional`), verificando la ruta sync-single/metadata.
 */

describe('parseTcgplayerProductId (§4.24a) — extrae productId de tcgplayer.url', () => {
  it('parsea la url canónica de pokemontcg.io (.../product/<id>/slug)', () => {
    expect(
      parseTcgplayerProductId(
        'https://www.tcgplayer.com/product/593245/pokemon-sv08-surging-sparks-pikachu-ex-057-191',
      ),
    ).toBe('593245');
  });
  it('parsea .../product/<id> sin slug final', () => {
    expect(parseTcgplayerProductId('https://www.tcgplayer.com/product/610894')).toBe('610894');
    expect(parseTcgplayerProductId('https://www.tcgplayer.com/product/610894?foo=bar')).toBe('610894');
  });
  it('url ausente / sin patrón / id no numérico ⇒ null (no clobbea el ancla)', () => {
    expect(parseTcgplayerProductId(undefined)).toBeNull();
    expect(parseTcgplayerProductId(null)).toBeNull();
    expect(parseTcgplayerProductId('https://www.tcgplayer.com/search/pokemon')).toBeNull();
    expect(parseTcgplayerProductId('https://www.tcgplayer.com/product/abc/x')).toBeNull();
  });
});

describe('CatalogSyncService.upsertCards — tcgplayerId + seed de structuralFinishes (§4.24a)', () => {
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
        count: jest.fn(async () => 0),
      },
    } as any;
  }
  const settings = (): SettingsService =>
    ({ getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService);
  const reconciler = () => ({ reconcile: jest.fn(async () => 0) });

  function remoteCard(id: string, over: { tcgplayer?: any; number?: string } = {}) {
    return {
      id,
      name: `Card ${id}`,
      number: over.number ?? '57',
      rarity: 'Double Rare',
      supertype: 'Pokémon',
      subtypes: [],
      images: { small: 's', large: 'l' },
      tcgplayer: over.tcgplayer,
      set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    };
  }

  function client(card: any): PokemonTcgIoClient {
    return {
      getCardsBySet: jest.fn(async () => ({ data: [card], page: 1, pageSize: 250, count: 1, totalCount: 1 })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
  }

  it('CREATE: escribe tcgplayerId (parseado de la url) y SIEMBRA structuralFinishes = derived (holofoil-only, sin normal fantasma)', async () => {
    const prisma = buildPrisma();
    const c = remoteCard('sv8-pikachu', {
      number: '57',
      tcgplayer: {
        url: 'https://www.tcgplayer.com/product/593245/pokemon-sv08-surging-sparks-pikachu-ex-057-191',
        prices: { holofoil: { market: 2.31 } },
      },
    });
    const svc = new CatalogSyncService(prisma as PrismaService, client(c), settings(), reconciler() as any);

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.create.tcgplayerId).toBe('593245');
    expect(call.update.tcgplayerId).toBe('593245');
    // SEED estructural = derived: holofoil puro, SIN `normal` de relleno (VAR-1 / §4.24a).
    expect(call.create.structuralFinishes).toEqual(['holofoil']);
  });

  it('CREATE sin señal de acabado ⇒ structuralFinishes SEED = ["normal"] (conservador, nunca relleno)', async () => {
    const prisma = buildPrisma();
    const c = remoteCard('sv8-nada', { tcgplayer: undefined }); // sin tcgplayer ⇒ derived=null
    const svc = new CatalogSyncService(prisma as PrismaService, client(c), settings(), reconciler() as any);

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    expect(call.create.structuralFinishes).toEqual(['normal']);
    // Sin url ⇒ NO se escribe tcgplayerId (ni en create ni en update): no se inventa un ancla.
    expect(call.create).not.toHaveProperty('tcgplayerId');
    expect(call.update).not.toHaveProperty('tcgplayerId');
  });

  it('UPDATE: NUNCA incluye structuralFinishes (pokemontcg.io no es autoridad estructural — lo es el resolver TCGCSV)', async () => {
    const prisma = buildPrisma({ 'sv8-x': { availableFinishes: ['normal', 'reverse_holo'] } });
    const c = remoteCard('sv8-x', {
      tcgplayer: {
        url: 'https://www.tcgplayer.com/product/700700/x',
        prices: { normal: { market: 1 }, reverseHolofoil: { market: 2 } },
      },
    });
    const svc = new CatalogSyncService(prisma as PrismaService, client(c), settings(), reconciler() as any);

    await svc.sync('sv8');

    const call = prisma.card.upsert.mock.calls[0][0];
    // CREATE sí siembra; UPDATE NO toca structuralFinishes (ni siquiera con señal).
    expect(call.create.structuralFinishes.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
    expect(call.update).not.toHaveProperty('structuralFinishes');
    // catalogFinishes SÍ se sigue refrescando en UPDATE (observabilidad, sin cambio v1.22).
    expect(call.update.catalogFinishes.slice().sort()).toEqual(['normal', 'reverse_holo'].sort());
    // tcgplayerId (ancla) SÍ puede refrescarse en UPDATE cuando la url está presente.
    expect(call.update.tcgplayerId).toBe('700700');
  });
});

/**
 * v1.27 (P-12, ARCHITECTURE §4.25c) — `POST /admin/catalog/sync` gana `force`: el sync por set
 * (`importSetByExternalId`) corre el resolver estructural TCGCSV con el MISMO gate que `importSet`
 * (`firstImport || force`), cerrando la asimetría (el botón por set de M2 jamás refrescaba
 * variantes). Best-effort/money-safe: un fallo TCGCSV se loguea y NO aborta el import.
 */
describe('CatalogSyncService.sync single — resolver estructural con force (P-12, §4.25c)', () => {
  function buildPrisma(existingCardCount = 5) {
    return {
      cardSet: {
        upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
        findMany: jest.fn(async () => []),
      },
      card: {
        upsert: jest.fn(async ({ where }: any) => ({ id: where.externalId })),
        count: jest.fn(async () => existingCardCount),
      },
    } as any;
  }
  const settings = (): SettingsService =>
    ({ getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService);
  const reconciler = () => ({ reconcile: jest.fn(async () => 0) });
  const resolver = () => ({ resolveStructuralFinishesForSet: jest.fn(async () => ({ groupId: 1407, joined: 1, updated: 1, unjoined: 0 })) });

  function client(): PokemonTcgIoClient {
    const card = {
      id: 'sv8-1',
      name: 'Card sv8-1',
      number: '1',
      set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    };
    return {
      getCardsBySet: jest.fn(async () => ({ data: [card], page: 1, pageSize: 250, count: 1, totalCount: 1 })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
  }

  it('force:true ⇒ corre el resolver TCGCSV para el set aunque NO sea first-import', async () => {
    const prisma = buildPrisma(5); // el set YA tiene cartas (no first-import)
    const res = resolver();
    const svc = new CatalogSyncService(prisma as PrismaService, client(), settings(), reconciler() as any, res as any);

    await svc.sync('sv8', undefined, true);

    expect(res.resolveStructuralFinishesForSet).toHaveBeenCalledWith('local-sv8');
  });

  it('sin force y NO first-import ⇒ NO corre el resolver (comportamiento previo exacto, retrocompatible)', async () => {
    const prisma = buildPrisma(5);
    const res = resolver();
    const svc = new CatalogSyncService(prisma as PrismaService, client(), settings(), reconciler() as any, res as any);

    await svc.sync('sv8');

    expect(res.resolveStructuralFinishesForSet).not.toHaveBeenCalled();
  });

  it('first-import (el set no tenía cartas) ⇒ corre el resolver aun sin force (paridad con importSet)', async () => {
    const prisma = buildPrisma(0);
    const res = resolver();
    const svc = new CatalogSyncService(prisma as PrismaService, client(), settings(), reconciler() as any, res as any);

    await svc.sync('sv8');

    expect(res.resolveStructuralFinishesForSet).toHaveBeenCalledWith('local-sv8');
  });

  it('BEST-EFFORT money-safe: el resolver falla ⇒ se loguea y el import NO aborta (setsQueued=1)', async () => {
    const prisma = buildPrisma(5);
    const res = { resolveStructuralFinishesForSet: jest.fn(async () => { throw new Error('TCGCSV 502'); }) };
    const svc = new CatalogSyncService(prisma as PrismaService, client(), settings(), reconciler() as any, res as any);
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    const out = await svc.sync('sv8', undefined, true);

    expect(out).toMatchObject({ mode: 'single', setsQueued: 1 });
    expect(warnSpy.mock.calls.some(([m]) => String(m).includes('TCGCSV 502'))).toBe(true);
    warnSpy.mockRestore();
  });
});
