import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * M-35 (fix/variant-composition-regression) — versión BATCH de `refresh-variants`:
 * `CatalogSyncService.refreshVariantsAll` corre, sobre TODOS los sets YA IMPORTADOS (cartas en BD),
 * el MISMO refresh solo-TCGCSV por-set. Backfillea el catálogo viejo (fantasma pre-M-31) SIN tocar
 * pokemontcg.io — ni siquiera para LISTAR sets (la lista sale de BD local). Mismo modelo de
 * ejecución/progreso que `sync-all` (fire-and-forget + status pollable).
 *
 * Estos tests fijan:
 *  1. lista los sets importados desde BD LOCAL (cards>0), salta los vacíos, 202 no bloqueante,
 *     y JAMÁS invoca pokemontcg.io;
 *  2. single-flight (segundo disparo no lanza otro barrido);
 *  3. el barrido itera N sets reusando `refreshVariants`; un set que falla NO aborta el resto,
 *     se acumula en `summary.failures` y se sigue — sin llamar pokemontcg.io;
 *  4. resumen agregado correcto (setsOk/setsFailed/cardProductsUpserted/pricesUpserted/pending);
 *  5. delay entre sets (respeto a tcgcsv.com);
 *  6. progreso observable (done por set, running→false, finishedAt);
 *  7. money-safe: variante sin precio ⇒ se acumula en `pending` (jamás 0).
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

function expectPokemonNotCalled(client: PokemonTcgIoClient) {
  expect((client as any).getSets).not.toHaveBeenCalled();
  expect((client as any).getCardsBySet).not.toHaveBeenCalled();
}

/**
 * Prisma mínimo: `cardSet.findMany` devuelve la lista local (para refreshVariantsAll) y
 * `cardSet.findUnique` resuelve por externalId (para el refreshVariants por-set).
 */
function prismaMock(sets: { externalId: string; cards: number }[]) {
  const byExternalId = new Map(sets.map((s) => [s.externalId, s]));
  return {
    cardSet: {
      findMany: jest.fn(async () =>
        sets.map((s) => ({ externalId: s.externalId, _count: { cards: s.cards } })),
      ),
      findUnique: jest.fn(async (args: any) => {
        const s = byExternalId.get(args.where.externalId);
        return s ? { id: `local-${s.externalId}`, _count: { cards: s.cards } } : null;
      }),
    },
  } as unknown as PrismaService;
}

function resolverOk(overrides: Partial<Record<string, number>> = {}) {
  return {
    groupId: 24688,
    joined: 5,
    products: 6,
    pricesWritten: 10,
    pricesPending: 2,
    unjoined: 1,
    ...overrides,
  };
}

/** Construye el svc y neutraliza el delay entre sets (tests deterministas y rápidos). */
function makeSvc(prisma: PrismaService, client: PokemonTcgIoClient, resolver: any) {
  const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver);
  jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
  return svc;
}

describe('CatalogSyncService.refreshVariantsAll (M-35) — BATCH solo-TCGCSV, jamás pokemontcg.io', () => {
  it('encola solo los sets IMPORTADOS (cards>0) desde BD local, 202 no bloqueante, sin pokemontcg.io', async () => {
    const prisma = prismaMock([
      { externalId: 'me05', cards: 42 },
      { externalId: 'empty', cards: 0 }, // sin cartas → NO se encola
      { externalId: 'sv8', cards: 5 },
    ]);
    const client = pokemonClientSpy();
    const svc = makeSvc(prisma, client, { resolveCardProductsForSet: jest.fn() });

    // Difiere el barrido de fondo para demostrar que refreshVariantsAll NO lo espera.
    let resolveRun!: () => void;
    const runSpy = jest
      .spyOn(svc as any, 'runRefreshVariantsAll')
      .mockReturnValue(new Promise<void>((r) => { resolveRun = r; }));

    const res = await svc.refreshVariantsAll();

    expect(res).toMatchObject({ setsQueued: 2, remaining: 0 });
    expect(res.jobId).toMatch(/^catalog-refresh-variants-all-/);
    // Solo los sets con cartas (me05, sv8) — jamás el vacío.
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0]).toEqual(['me05', 'sv8']);
    // La lista salió de BD local (findMany), NUNCA de pokemontcg.io.
    expect((prisma as any).cardSet.findMany).toHaveBeenCalled();
    expectPokemonNotCalled(client);

    resolveRun();
  });

  it('single-flight: un segundo disparo con barrido en curso no lanza otro', async () => {
    const prisma = prismaMock([{ externalId: 'me05', cards: 42 }]);
    const client = pokemonClientSpy();
    const svc = makeSvc(prisma, client, { resolveCardProductsForSet: jest.fn() });

    let resolveRun!: () => void;
    jest
      .spyOn(svc as any, 'runRefreshVariantsAll')
      .mockReturnValue(new Promise<void>((r) => { resolveRun = r; }));

    const first = await svc.refreshVariantsAll();
    const second = await svc.refreshVariantsAll();

    expect(first.setsQueued).toBe(1);
    expect(second.setsQueued).toBe(0);
    expect(second.remaining).toBe(1);
    expectPokemonNotCalled(client);

    resolveRun();
  });

  it('itera N sets reusando refreshVariants; un set que FALLA no aborta el resto (resiliente por-set)', async () => {
    const prisma = prismaMock([
      { externalId: 'ok1', cards: 10 },
      { externalId: 'bad', cards: 10 },
      { externalId: 'ok2', cards: 10 },
    ]);
    const client = pokemonClientSpy();
    // El resolver: ok1/ok2 resuelven; bad lanza (TCGCSV 503) ⇒ refreshVariants lo envuelve en 502.
    const resolver = {
      resolveCardProductsForSet: jest.fn(async (localSetId: string) => {
        if (localSetId === 'local-bad') throw new Error('tcgcsv.com -> HTTP 503');
        return resolverOk();
      }),
    };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['ok1', 'bad', 'ok2'], false);

    // Se intentaron los 3 pese al fallo del de en medio.
    expect(resolver.resolveCardProductsForSet).toHaveBeenCalledTimes(3);
    const st = svc.getRefreshVariantsAllStatus();
    expect(st.done).toBe(3);
    expect(st.summary).not.toBeNull();
    expect(st.summary!.setsOk).toBe(2);
    expect(st.summary!.setsFailed).toBe(1);
    // El fallo se remapeó a UPSTREAM_ERROR (502) por refreshVariants y quedó en failures.
    expect(st.summary!.failures).toEqual([
      { setId: 'bad', code: 'UPSTREAM_ERROR', message: expect.stringMatching(/TCGCSV/i) },
    ]);
    expectPokemonNotCalled(client);
  });

  it('resumen agregado: acumula cardProductsUpserted/pricesUpserted/pending de los sets OK', async () => {
    const prisma = prismaMock([
      { externalId: 'a', cards: 10 },
      { externalId: 'b', cards: 10 },
    ]);
    const client = pokemonClientSpy();
    const resolver = {
      resolveCardProductsForSet: jest.fn(async (localSetId: string) =>
        localSetId === 'local-a'
          ? resolverOk({ joined: 3, pricesWritten: 7, pricesPending: 1 })
          : resolverOk({ joined: 4, pricesWritten: 9, pricesPending: 5 }),
      ),
    };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['a', 'b'], false);

    const { summary } = svc.getRefreshVariantsAllStatus();
    expect(summary).not.toBeNull();
    expect(summary!.setsTotal).toBe(0); // total lo fija refreshVariantsAll; runRefreshVariantsAll solo suma OK/fail
    expect(summary!.setsOk).toBe(2);
    expect(summary!.setsFailed).toBe(0);
    expect(summary!.cardProductsUpserted).toBe(3 + 4);
    expect(summary!.pricesUpserted).toBe(7 + 9);
    expect(summary!.pending).toBe(1 + 5);
    expectPokemonNotCalled(client);
  });

  it('delay entre sets (no tras el último): respeto a tcgcsv.com', async () => {
    const prisma = prismaMock([
      { externalId: 'a', cards: 1 },
      { externalId: 'b', cards: 1 },
      { externalId: 'c', cards: 1 },
    ]);
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn(async () => resolverOk()) };
    const svc = makeSvc(prisma, client, resolver);
    const sleepSpy = (svc as any).sleep as jest.Mock;

    await svc.runRefreshVariantsAll(['a', 'b', 'c'], false);

    // N-1 delays (entre a-b y b-c; no tras c).
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  it('progreso observable: running true al lanzar, done por set, running→false + finishedAt al terminar', async () => {
    const prisma = prismaMock([
      { externalId: 'a', cards: 1 },
      { externalId: 'b', cards: 1 },
    ]);
    const client = pokemonClientSpy();
    const svc = makeSvc(prisma, client, { resolveCardProductsForSet: jest.fn(async () => resolverOk()) });

    // Estado inicial: nunca corrió → summary === null (contrato; sin banner "Listo — 0/0" falso).
    expect(svc.getRefreshVariantsAllStatus()).toMatchObject({ running: false, total: 0, done: 0, jobId: null });
    expect(svc.getRefreshVariantsAllStatus().summary).toBeNull();

    let resolveRun!: () => void;
    jest
      .spyOn(svc as any, 'runRefreshVariantsAll')
      .mockReturnValue(new Promise<void>((r) => { resolveRun = r; }));

    await svc.refreshVariantsAll();
    const mid = svc.getRefreshVariantsAllStatus();
    expect(mid.running).toBe(true);
    expect(mid.total).toBe(2);
    // Con el barrido en curso el summary ya está poblado (ya no null): arranca en ceros con setsTotal fijo.
    expect(mid.summary).not.toBeNull();
    expect(mid.summary!.setsTotal).toBe(2);
    expect(mid.jobId).toMatch(/^catalog-refresh-variants-all-/);
    expect(mid.startedAt).not.toBeNull();
    expect(mid.finishedAt).toBeNull();

    resolveRun();
    await Promise.resolve(); // deja correr el .finally del fire-and-forget
    const done = svc.getRefreshVariantsAllStatus();
    expect(done.running).toBe(false);
    expect(done.finishedAt).not.toBeNull();
  });

  it('money-safe: variante sin precio ⇒ se acumula en `pending` (jamás precio 0)', async () => {
    const prisma = prismaMock([{ externalId: 'me05', cards: 3 }]);
    const client = pokemonClientSpy();
    const resolver = {
      resolveCardProductsForSet: jest.fn(async () =>
        resolverOk({ pricesWritten: 2, pricesPending: 4 }),
      ),
    };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['me05'], false);

    const { summary } = svc.getRefreshVariantsAllStatus();
    expect(summary).not.toBeNull();
    expect(summary!.pricesUpserted).toBe(2);
    expect(summary!.pending).toBe(4);
    expectPokemonNotCalled(client);
  });

  it('resolver ⇒ null (groupId no resuelto) cuenta como OK con ceros, sin pokemontcg.io', async () => {
    const prisma = prismaMock([{ externalId: 'ambig', cards: 10 }]);
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn(async () => null) };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['ambig'], false);

    const { summary } = svc.getRefreshVariantsAllStatus();
    expect(summary).not.toBeNull();
    expect(summary!.setsOk).toBe(1);
    expect(summary!.setsFailed).toBe(0);
    expect(summary!.cardProductsUpserted).toBe(0);
    expect(summary!.pricesUpserted).toBe(0);
    expect(summary!.pending).toBe(0);
    expectPokemonNotCalled(client);
  });

  it('summary === null hasta que termina un batch; poblado después del barrido (contrato)', async () => {
    const prisma = prismaMock([
      { externalId: 'a', cards: 5 },
      { externalId: 'b', cards: 5 },
    ]);
    const client = pokemonClientSpy();
    const svc = makeSvc(prisma, client, { resolveCardProductsForSet: jest.fn(async () => resolverOk()) });

    // 1) Backend recién levantado, NINGÚN batch disparado ⇒ summary null (sin banner "Listo — 0/0" falso).
    const pristine = svc.getRefreshVariantsAllStatus();
    expect(pristine.running).toBe(false);
    expect(pristine.finishedAt).toBeNull();
    expect(pristine.summary).toBeNull();

    // 2) Tras arrancar+correr un barrido ⇒ summary poblado (ya no null).
    await svc.refreshVariantsAll();
    await new Promise((r) => setImmediate(r)); // deja terminar el fire-and-forget + su .finally

    const after = svc.getRefreshVariantsAllStatus();
    expect(after.running).toBe(false);
    expect(after.finishedAt).not.toBeNull();
    expect(after.summary).not.toBeNull();
    expect(after.summary!.setsTotal).toBe(2);
    expect(after.summary!.setsOk).toBe(2);
    expectPokemonNotCalled(client);
  });
});
