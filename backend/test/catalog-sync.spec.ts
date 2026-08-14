import { CatalogSyncService, SET_ID_PATTERN } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * v1.1 — Sync de catálogo (M2, ARCHITECTURE §4.8):
 *  - validación anti-inyección del setId (^[a-z0-9]+(-[a-z0-9]+)*$).
 *  - upsert idempotente por externalId (no duplica al re-correr).
 *  - default fromReleaseDate = dial catalog_sync_from_date (2024/01/01).
 */

function remoteCard(id: string) {
  return {
    id,
    name: `Card ${id}`,
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    images: { small: 's', large: 'l' },
    set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
  };
}

function buildPrisma() {
  return {
    cardSet: {
      upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
      findMany: jest.fn(async () => []),
    },
    card: { upsert: jest.fn(async () => ({})) },
  } as any;
}

function settings(fromDate = '2024/01/01'): SettingsService {
  return { getString: jest.fn(async () => fromDate) } as unknown as SettingsService;
}

describe('CatalogSyncService — validación anti-inyección del setId', () => {
  it('acepta ids válidos y rechaza los peligrosos', () => {
    expect(SET_ID_PATTERN.test('sv8')).toBe(true);
    expect(SET_ID_PATTERN.test('base1-2')).toBe(true);
    expect(SET_ID_PATTERN.test('sv8 OR 1=1')).toBe(false);
    expect(SET_ID_PATTERN.test('sv8:foo')).toBe(false);
    expect(SET_ID_PATTERN.test('SV8')).toBe(false); // mayúsculas fuera
  });

  it('sync con setId inválido → 422 VALIDATION_ERROR y NO llama al cliente remoto', async () => {
    const client = { getCardsBySet: jest.fn(), getSets: jest.fn() } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(buildPrisma() as PrismaService, client, settings());
    await expect(svc.sync('sv8 OR 1=1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((client as any).getCardsBySet).not.toHaveBeenCalled();
  });
});

describe('CatalogSyncService.sync — set puntual, upsert idempotente', () => {
  it('importa un set y upsertea por externalId (idempotente al re-correr)', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-1'), remoteCard('sv8-2')],
        page: 1,
        pageSize: 250,
        count: 2,
        totalCount: 2,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    const res1 = await svc.sync('sv8');
    expect(res1).toMatchObject({ mode: 'single', setsQueued: 1 });
    // El set se upsertea por externalId y las cartas por externalId (idempotente).
    expect(prisma.cardSet.upsert.mock.calls[0][0].where).toEqual({ externalId: 'sv8' });
    expect(prisma.card.upsert.mock.calls[0][0].where).toEqual({ externalId: 'sv8-1' });
    expect(prisma.card.upsert).toHaveBeenCalledTimes(2);

    // Re-correr: mismas keys de upsert ⇒ no se crean duplicados (upsert por externalId).
    await svc.sync('sv8');
    expect(prisma.card.upsert).toHaveBeenCalledTimes(4);
    const allCardWheres = prisma.card.upsert.mock.calls.map((c: any) => c[0].where.externalId);
    expect(allCardWheres).toEqual(['sv8-1', 'sv8-2', 'sv8-1', 'sv8-2']);
  });

  it('setId remoto sin cartas → setsQueued 0 (no importado)', async () => {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({ data: [], page: 1, pageSize: 250, count: 0, totalCount: 0 })),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());
    const res = await svc.sync('emptyset');
    expect(res.setsQueued).toBe(0);
    expect(prisma.cardSet.upsert).not.toHaveBeenCalled();
  });
});

describe('CatalogSyncService.sync — desde fecha (default dial 2024/01/01)', () => {
  it('sin setId usa el dial y solo importa sets con releaseDate >= 2024/01/01', async () => {
    const prisma = buildPrisma();
    const client = {
      getSets: jest.fn(async () => [
        { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
        { id: 'base1', name: 'Base', releaseDate: '1999/01/09' },
      ]),
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('x-1')],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
    } as unknown as PokemonTcgIoClient;
    const st = settings('2024/01/01');
    const svc = new CatalogSyncService(prisma as PrismaService, client, st);

    const res = await svc.sync();
    expect(st.getString).toHaveBeenCalled(); // tomó el default del dial
    expect(res.mode).toBe('from_date');
    expect(res.setsQueued).toBe(1); // solo el set de 2024, no el de 1999
    // Se importó únicamente el set moderno.
    expect((client as any).getCardsBySet).toHaveBeenCalledTimes(1);
  });

  it('fromReleaseDate con formato inválido → 422 VALIDATION_ERROR', async () => {
    const client = { getSets: jest.fn() } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(buildPrisma() as PrismaService, client, settings());
    await expect(svc.sync(undefined, '2024-01-01')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
