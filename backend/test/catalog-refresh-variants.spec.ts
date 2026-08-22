import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * M-34 (fix/variant-composition-regression) — `CatalogSyncService.refreshVariants`: refresca
 * variantes (finishes) + precios de un set YA IMPORTADO usando SOLO TCGCSV, sin llamar a
 * pokemontcg.io. El "Sync completo" acoplaba el re-fetch de cartas (pokemontcg.io) con el resolver
 * TCGCSV; con pokemontcg.io caído (502) no se podía reparar el `normal` fantasma de un set en BD.
 *
 * Estos tests fijan:
 *  1. refresh de set existente NO invoca al cliente pokemontcg.io (mock verificado), corre el
 *     resolver TCGCSV y devuelve el resumen;
 *  2. set no importado ⇒ SET_NOT_IMPORTED (404), y NO se llama a pokemontcg.io;
 *  3. TCGCSV caído ⇒ UPSTREAM_ERROR (502) accionable, money-safe (nada escrito), NO 500 crudo;
 *  4. variante sin precio ⇒ se refleja en `pending` (PRICE_PENDING/«—», jamás 0).
 */

const settings = (): SettingsService =>
  ({ getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService);
const reconciler = () => ({ reconcile: jest.fn(async () => 0) });

/** Cliente pokemontcg.io con TODOS los métodos espiados: los tests verifican que NO se invocan. */
function pokemonClientSpy(): PokemonTcgIoClient {
  return {
    getSets: jest.fn(async () => []),
    getCardsBySet: jest.fn(async () => ({ data: [], page: 1, pageSize: 250, count: 0, totalCount: 0 })),
  } as unknown as PokemonTcgIoClient;
}

/** Prisma mínimo: `cardSet.findUnique` devuelve el set local (o null) con su conteo de cartas. */
function prismaMock(set: { id: string; cards: number } | null) {
  return {
    cardSet: {
      findUnique: jest.fn(async () =>
        set ? { id: set.id, _count: { cards: set.cards } } : null,
      ),
    },
  } as unknown as PrismaService;
}

function expectPokemonNotCalled(client: PokemonTcgIoClient) {
  expect((client as any).getSets).not.toHaveBeenCalled();
  expect((client as any).getCardsBySet).not.toHaveBeenCalled();
}

describe('CatalogSyncService.refreshVariants (M-34) — SOLO TCGCSV, jamás pokemontcg.io', () => {
  it('set existente ⇒ corre el resolver TCGCSV, devuelve resumen y NO llama a pokemontcg.io', async () => {
    const prisma = prismaMock({ id: 'local-me05', cards: 42 });
    const client = pokemonClientSpy();
    const resolver = {
      resolveCardProductsForSet: jest.fn(async () => ({
        groupId: 24688,
        joined: 40,
        products: 41,
        pricesWritten: 55,
        pricesPending: 7,
        unjoined: 1,
      })),
    };
    const svc = new CatalogSyncService(
      prisma,
      client,
      settings(),
      reconciler() as any,
      resolver as any,
    );

    const res = await svc.refreshVariants('me05', false);

    // Resumen mapeado 1:1 desde el resolver.
    expect(res).toEqual({
      ok: true,
      setId: 'me05',
      cardsProcessed: 42,
      cardProductsUpserted: 40,
      pricesUpserted: 55,
      pending: 7,
      tcgcsvReachable: true,
    });
    // Corrió el resolver sobre el ID LOCAL del set (no un payload nuevo).
    expect(resolver.resolveCardProductsForSet).toHaveBeenCalledWith('local-me05');
    // BLINDAJE: jamás se tocó pokemontcg.io en este camino.
    expectPokemonNotCalled(client);
  });

  it('set NO importado (no existe en BD) ⇒ SET_NOT_IMPORTED 409 y NO llama a pokemontcg.io', async () => {
    // 409 (no 404) a propósito: el front trata 404/405 como "endpoint no desplegado"
    // (`isEndpointMissing`); un SET_NOT_IMPORTED real con 404 se confundiría con eso.
    const prisma = prismaMock(null);
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn() };
    const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver as any);

    await expect(svc.refreshVariants('ghost-set', false)).rejects.toMatchObject({
      code: 'SET_NOT_IMPORTED',
      status: 409,
    });
    expect(resolver.resolveCardProductsForSet).not.toHaveBeenCalled();
    expectPokemonNotCalled(client); // NO se intenta importar desde pokemontcg.io
  });

  it('set en BD pero SIN cartas ⇒ SET_NOT_IMPORTED 409 (no se puede refrescar lo que no está)', async () => {
    const prisma = prismaMock({ id: 'local-empty', cards: 0 });
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn() };
    const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver as any);

    await expect(svc.refreshVariants('empty', false)).rejects.toMatchObject({
      code: 'SET_NOT_IMPORTED',
      status: 409,
    });
    expect(resolver.resolveCardProductsForSet).not.toHaveBeenCalled();
    expectPokemonNotCalled(client);
  });

  it('TCGCSV caído (resolver lanza) ⇒ UPSTREAM_ERROR 502 money-safe, NO 500 crudo, NO pokemontcg.io', async () => {
    const prisma = prismaMock({ id: 'local-me05', cards: 42 });
    const client = pokemonClientSpy();
    // El resolver hace TODO el fetch (products+prices) ANTES de escribir ⇒ un fallo remoto no
    // escribió nada (money-safe). Aquí simulamos ese fallo remoto.
    const resolver = {
      resolveCardProductsForSet: jest.fn(async () => {
        throw new Error('tcgcsv.com -> HTTP 503');
      }),
    };
    const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver as any);

    let caught: unknown;
    try {
      await svc.refreshVariants('me05', false);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BusinessException);
    expect(caught).toMatchObject({ code: 'UPSTREAM_ERROR', status: 502 });
    // Mensaje accionable que apunta a TCGCSV (no a pokemontcg.io).
    expect((caught as Error).message).toMatch(/TCGCSV/i);
    expectPokemonNotCalled(client);
  });

  it('variante sin precio (marketPrice null) ⇒ se cuenta en `pending`, jamás precio 0', async () => {
    const prisma = prismaMock({ id: 'local-me05', cards: 1 });
    const client = pokemonClientSpy();
    const resolver = {
      resolveCardProductsForSet: jest.fn(async () => ({
        groupId: 24688,
        joined: 1,
        products: 1,
        pricesWritten: 1, // holofoil con precio
        pricesPending: 1, // reverse_holo sin precio ⇒ «—»/PRICE_PENDING
        unjoined: 0,
      })),
    };
    const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver as any);

    const res = await svc.refreshVariants('me05', false);

    expect(res.pending).toBe(1);
    expect(res.pricesUpserted).toBe(1);
    expectPokemonNotCalled(client);
  });

  it('groupId TCGCSV no resuelto (resolver ⇒ null) ⇒ ok con ceros, tcgcsvReachable=true, sin pokemontcg.io', async () => {
    const prisma = prismaMock({ id: 'local-ambig', cards: 10 });
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn(async () => null) };
    const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver as any);

    const res = await svc.refreshVariants('ambig', false);

    expect(res).toEqual({
      ok: true,
      setId: 'ambig',
      cardsProcessed: 10,
      cardProductsUpserted: 0,
      pricesUpserted: 0,
      pending: 0,
      tcgcsvReachable: true,
    });
    expectPokemonNotCalled(client);
  });

  it('setId con formato inválido ⇒ VALIDATION_ERROR 422 antes de tocar BD o red', async () => {
    const prisma = prismaMock({ id: 'local-me05', cards: 42 });
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn() };
    const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver as any);

    await expect(svc.refreshVariants('bad id!', false)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });
    expect((prisma as any).cardSet.findUnique).not.toHaveBeenCalled();
    expect(resolver.resolveCardProductsForSet).not.toHaveBeenCalled();
    expectPokemonNotCalled(client);
  });
});
