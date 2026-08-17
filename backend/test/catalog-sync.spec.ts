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

/**
 * v1.3 — sync-all (Opción 1 del cotizador, API_CONTRACT §M2): importa TODO el catálogo de
 * forma NO bloqueante (fire-and-forget), resumible (salta sets ya importados) e idempotente
 * (upsert por externalId). Single-flight para no duplicar carga contra pokemontcg.io.
 */
describe('CatalogSyncService.syncAll — importar todo el catálogo (no bloqueante)', () => {
  function prismaWithLocal(localSets: { externalId: string; count: number }[]) {
    return {
      cardSet: {
        upsert: jest.fn(async () => ({ id: 'local', externalId: 'x' })),
        findMany: jest.fn(async () => localSets.map((s) => ({ externalId: s.externalId, _count: { cards: s.count } }))),
      },
      card: { upsert: jest.fn(async () => ({})) },
    } as any;
  }

  const remoteSets = [
    { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    { id: 'base1', name: 'Base', releaseDate: '1999/01/09' },
  ];

  it('encola solo los sets pendientes (resumible) y NO bloquea el request', async () => {
    // sv8 ya está importado con cartas → pendiente solo base1.
    const prisma = prismaWithLocal([{ externalId: 'sv8', count: 5 }]);
    const client = { getSets: jest.fn(async () => remoteSets) } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    // El barrido de fondo se difiere (promesa pendiente): demuestra que syncAll NO lo espera.
    let resolveRun!: () => void;
    const runSpy = jest
      .spyOn(svc as any, 'runSyncAll')
      .mockReturnValue(new Promise<void>((r) => { resolveRun = r; }));

    const res = await svc.syncAll();

    // Retorna 202-shape de inmediato aunque el barrido siga en curso.
    expect(res).toMatchObject({ setsQueued: 1, remaining: 0 });
    expect(res.jobId).toMatch(/^catalog-sync-all-/);
    // Solo el set pendiente (base1) se encoló para el barrido.
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect((runSpy.mock.calls[0][0] as any[]).map((s: any) => s.id)).toEqual(['base1']);

    resolveRun();
  });

  it('force:false (default) salta un set ya importado (comportamiento de hoy)', async () => {
    // Ambos remotos poblados localmente → sin force no queda nada por encolar.
    const prisma = prismaWithLocal([
      { externalId: 'sv8', count: 5 },
      { externalId: 'base1', count: 3 },
    ]);
    const client = { getSets: jest.fn(async () => remoteSets) } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    const runSpy = jest.spyOn(svc as any, 'runSyncAll').mockResolvedValue(undefined);

    const res = await svc.syncAll(); // default: force omitido
    expect(res.setsQueued).toBe(0);
    // No se encoló ningún set (todos ya importados) → runSyncAll con lista vacía.
    expect((runSpy.mock.calls[0][0] as any[]).map((s: any) => s.id)).toEqual([]);
  });

  it('force:true NO filtra los sets ya importados: los reprocesa (re-upsert availableFinishes)', async () => {
    // Ambos remotos ya poblados: force debe encolarlos igual para refrescar acabados/precios.
    const prisma = prismaWithLocal([
      { externalId: 'sv8', count: 5 },
      { externalId: 'base1', count: 3 },
    ]);
    const client = { getSets: jest.fn(async () => remoteSets) } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    const runSpy = jest.spyOn(svc as any, 'runSyncAll').mockResolvedValue(undefined);

    const res = await svc.syncAll({ force: true });
    // Reprocesa TODOS los sets remotos pese a estar importados.
    expect(res.setsQueued).toBe(2);
    expect((runSpy.mock.calls[0][0] as any[]).map((s: any) => s.id)).toEqual(['sv8', 'base1']);
  });

  it('single-flight: una segunda llamada mientras hay barrido en curso no lanza otro', async () => {
    const prisma = prismaWithLocal([]); // nada importado → ambos remotos pendientes
    const client = { getSets: jest.fn(async () => remoteSets) } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    let resolveRun!: () => void;
    jest.spyOn(svc as any, 'runSyncAll').mockReturnValue(new Promise<void>((r) => { resolveRun = r; }));

    const first = await svc.syncAll();
    const second = await svc.syncAll();

    expect(first.setsQueued).toBe(2);
    // El segundo disparo no encola nada (ya hay barrido activo) y reporta lo que falta.
    expect(second.setsQueued).toBe(0);
    expect(second.remaining).toBe(2);

    resolveRun();
  });

  it('runSyncAll importa cada set con upsert idempotente por externalId (no duplica)', async () => {
    const prisma = prismaWithLocal([]);
    const client = {
      getSets: jest.fn(),
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('sv8-1')],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    await svc.runSyncAll([{ id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' }]);

    expect(prisma.cardSet.upsert.mock.calls[0][0].where).toEqual({ externalId: 'sv8' });
    expect(prisma.card.upsert.mock.calls[0][0].where).toEqual({ externalId: 'sv8-1' });

    // Re-correr → sigue siendo upsert por la misma key (idempotente, sin duplicar filas).
    await svc.runSyncAll([{ id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' }]);
    expect(prisma.card.upsert).toHaveBeenCalledTimes(2);
    const wheres = prisma.card.upsert.mock.calls.map((c: any) => c[0].where.externalId);
    expect(wheres).toEqual(['sv8-1', 'sv8-1']);
  });

  it('un set que falla no aborta el barrido de los demás', async () => {
    const prisma = prismaWithLocal([]);
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      { getSets: jest.fn() } as unknown as PokemonTcgIoClient,
      settings(),
    );
    const importSpy = jest
      .spyOn(svc as any, 'importSet')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ imported: true, cardCount: 1 });

    await expect(
      svc.runSyncAll([
        { id: 'bad', name: 'Bad', releaseDate: '2020/01/01' },
        { id: 'ok', name: 'Ok', releaseDate: '2021/01/01' },
      ]),
    ).resolves.toBeUndefined();
    expect(importSpy).toHaveBeenCalledTimes(2); // siguió con el segundo pese al fallo del primero
  });

  it('getSyncStatus refleja el progreso: total al lanzar, done por set, running→false al terminar', async () => {
    const prisma = prismaWithLocal([]); // nada importado → ambos remotos pendientes (total 2)
    const client = { getSets: jest.fn(async () => remoteSets) } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings());

    // Estado inicial: nunca corrió → running false, total/done 0, sin timestamps.
    expect(svc.getSyncStatus()).toMatchObject({ running: false, total: 0, done: 0, jobId: null });

    // Difiere el barrido para observar el estado "en curso" (running con total fijado).
    let resolveRun!: () => void;
    jest.spyOn(svc as any, 'runSyncAll').mockReturnValue(new Promise<void>((r) => { resolveRun = r; }));

    await svc.syncAll();
    const mid = svc.getSyncStatus();
    expect(mid.running).toBe(true);
    expect(mid.total).toBe(2);
    expect(mid.jobId).toMatch(/^catalog-sync-all-/);
    expect(mid.startedAt).not.toBeNull();
    expect(mid.finishedAt).toBeNull();

    resolveRun();
    await Promise.resolve(); // deja correr el .finally del fire-and-forget
    const done = svc.getSyncStatus();
    expect(done.running).toBe(false);
    expect(done.finishedAt).not.toBeNull();
  });

  it('runSyncAll incrementa done por cada set intentado (éxito o fallo)', async () => {
    const prisma = prismaWithLocal([]);
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      { getSets: jest.fn() } as unknown as PokemonTcgIoClient,
      settings(),
    );
    jest
      .spyOn(svc as any, 'importSet')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ imported: true, cardCount: 1 });

    await svc.runSyncAll([
      { id: 'bad', name: 'Bad', releaseDate: '2020/01/01' },
      { id: 'ok', name: 'Ok', releaseDate: '2021/01/01' },
    ]);
    // done cuenta ambos (el que falló y el que pasó): barra honesta de "intentados".
    expect(svc.getSyncStatus().done).toBe(2);
  });
});
