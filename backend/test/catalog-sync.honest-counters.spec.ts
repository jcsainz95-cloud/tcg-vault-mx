import {
  CatalogSyncService,
  selectSyncAllCandidates,
  isWithinCatalogFromDate,
} from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * CANDADO de los CONTADORES HONESTOS del sync de catálogo (D1 · D2 · D3).
 *
 * ## Qué se rompió y por qué este archivo existe
 *
 * El dueño pulsó «sincronizar», la pantalla le dijo **éxito en verde** y no se había hecho nada.
 * Dos mentiras distintas, las dos por rellenar un contador con algo que no se había medido:
 *
 *  - **D1 — el contador de sets estaba escrito a mano.** `importSet`/`importSetByExternalId`
 *    devolvían `{ imported: true, cardCount }` con `imported` **literal**, así que el llamador
 *    contaba «1 set importado» hubiera importado uno, ninguno, o hubiera sido un no-op.
 *  - **D2 — «cartas procesadas» era el total de la base.** `refreshVariants` devolvía
 *    `cardsProcessed = localSet._count.cards` (cuántas cartas EXISTEN), no cuántas tocó la corrida.
 *    Síntoma real: **«191 cartas procesadas · 0 precios», en verde**, en un set donde no se
 *    resolvió absolutamente nada.
 *
 * ## Qué fija este archivo (y qué lo pone rojo)
 *
 * Cada test de aquí muere si alguien vuelve a **rellenar** un contador en vez de medirlo:
 *  1. devolver un literal fijo desde el import ⇒ los tests de `setsImported`/`setsRefreshed`
 *     revientan (un re-sync se declararía import);
 *  2. devolver el total del set como «procesadas» ⇒ el test de D2 revienta contra el 191 exacto;
 *  3. tapar un dato desconocido con `0` o con el total en vez de dejarlo AUSENTE (`null` ⇒ «—»)
 *     ⇒ revienta el test del resolver que no reporta `cardsTouched`.
 * Verificado por MUTACIÓN sobre una copia del árbol (ver docs/BACKEND_NOTES.md, D1/D2): con el
 * literal y el total restaurados, esta suite pasa a rojo.
 *
 * ## Y el corte de fecha (D3)
 *
 * «Importar sets nuevos» traía TODO lo que faltara, de cualquier año. El criterio de admisión vive
 * ahora en UNA función (`selectSyncAllCandidates`) que ambos caminos llaman; estos tests fijan sus
 * cuatro ramas y el cubo de los sets SIN fecha (caso que nadie ha decidido y que antes caía en
 * silencio).
 */

function remoteCard(id: string, setId = 'sv8') {
  return {
    id,
    name: `Card ${id}`,
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    images: { small: 's', large: 'l' },
    set: { id: setId, name: 'Surging Sparks', releaseDate: '2024/11/08' },
  };
}

/** Sets locales del fixture: `externalId` → cuántas cartas TIENE (universo previo). */
type LocalSet = { externalId: string; cards: number; releaseDate?: string | null };

function prismaMock(localSets: LocalSet[] = []) {
  const byExt = new Map(localSets.map((s) => [s.externalId, s]));
  const localIdOf = (ext: string) => `local-${ext}`;
  return {
    cardSet: {
      upsert: jest.fn(async ({ where }: any) => ({
        id: localIdOf(where.externalId),
        externalId: where.externalId,
      })),
      findMany: jest.fn(async () =>
        localSets.map((s) => ({
          externalId: s.externalId,
          releaseDate: s.releaseDate ?? null,
          _count: { cards: s.cards },
        })),
      ),
      findUnique: jest.fn(async ({ where }: any) =>
        byExt.has(where.externalId) ? { id: localIdOf(where.externalId) } : null,
      ),
    },
    card: {
      upsert: jest.fn(async ({ where }: any) => ({ id: where.externalId })),
      // Universo por set: la fuente ÚNICA del predicado «cartas locales de un set».
      count: jest.fn(async ({ where }: any) => {
        const ext = String(where.setId).replace(/^local-/, '');
        return byExt.get(ext)?.cards ?? 0;
      }),
    },
  } as any;
}

function settings(fromDate = '2024/01/01'): SettingsService {
  return { getString: jest.fn(async () => fromDate) } as unknown as SettingsService;
}

const reconciler = () => ({ reconcile: jest.fn(async () => 0) }) as any;

/** Cliente que devuelve N cartas para cualquier set pedido (una sola página). */
function clientWithCards(cards: ReturnType<typeof remoteCard>[]): PokemonTcgIoClient {
  return {
    getSets: jest.fn(async () => []),
    getCardsBySet: jest.fn(async () => ({
      data: cards,
      page: 1,
      pageSize: 250,
      count: cards.length,
      totalCount: cards.length,
    })),
  } as unknown as PokemonTcgIoClient;
}

describe('D1 — «cuántos sets importé» ≠ «cuántos ya estaban» (nada de literales)', () => {
  it('re-sync de un set QUE YA TENÍA cartas ⇒ setsImported 0 y setsRefreshed 1 (no es un import)', async () => {
    // El set ya tiene 191 cartas en BD: esta corrida las re-upsertea, no importa nada nuevo.
    const prisma = prismaMock([{ externalId: 'sv8', cards: 191 }]);
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      clientWithCards([remoteCard('sv8-1'), remoteCard('sv8-2')]),
      settings(),
      reconciler(),
    );

    const res = await svc.sync('sv8');

    // ⚠️ Con el literal `imported: true` de vuelta, esto reporta un import que no ocurrió.
    expect(res.setsImported).toBe(0);
    expect(res.setsRefreshed).toBe(1);
    expect(res.setsNoop).toBe(0);
    // Cartas ESCRITAS por esta corrida (2), jamás las 191 que el set tiene.
    expect(res.cardsUpserted).toBe(2);
    expect(res.cardsUpserted).not.toBe(191);
    // `setsQueued` (campo del contrato) sigue siendo «sets procesados»: 1.
    expect(res.setsQueued).toBe(1);
  });

  it('primer import de un set vacío ⇒ setsImported 1 y setsRefreshed 0', async () => {
    const prisma = prismaMock([]); // no hay nada local
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      clientWithCards([remoteCard('sv8-1')]),
      settings(),
      reconciler(),
    );

    const res = await svc.sync('sv8');

    expect(res).toMatchObject({ setsImported: 1, setsRefreshed: 0, setsNoop: 0, cardsUpserted: 1 });
  });

  it('el remoto no trae cartas ⇒ NO-OP: ni importado ni refrescado, y 0 cartas escritas', async () => {
    const prisma = prismaMock([{ externalId: 'sv8', cards: 191 }]);
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      clientWithCards([]),
      settings(),
      reconciler(),
    );

    const res = await svc.sync('sv8');

    expect(res).toMatchObject({
      setsQueued: 0,
      setsImported: 0,
      setsRefreshed: 0,
      setsNoop: 1,
      cardsUpserted: 0,
    });
  });

  it('modo from_date: un set nuevo + uno ya poblado ⇒ 1 importado y 1 re-sync (no «2 importados»)', async () => {
    const prisma = prismaMock([{ externalId: 'sv8', cards: 191 }]);
    const client = {
      getSets: jest.fn(async () => [
        { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
        { id: 'sv9', name: 'Nine', releaseDate: '2025/02/01' },
      ]),
      getCardsBySet: jest.fn(async (setId: string) => ({
        data: [remoteCard(`${setId}-1`, setId)],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings(), reconciler());

    const res = await svc.sync(undefined, undefined, false);

    expect(res).toMatchObject({
      mode: 'from_date',
      setsQueued: 2,
      setsImported: 1, // solo sv9
      setsRefreshed: 1, // sv8 ya estaba
      cardsUpserted: 2,
    });
  });

  it('backfill force sobre un set YA importado ⇒ no lo lista como importado, lo lista como refrescado', async () => {
    const prisma = prismaMock([{ externalId: 'base1', cards: 102, releaseDate: '1999/01/09' }]);
    const client = {
      getSets: jest.fn(async () => [{ id: 'base1', name: 'Base', releaseDate: '1999/01/09' }]),
      getCardsBySet: jest.fn(async () => ({
        data: [remoteCard('base1-1', 'base1')],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings(), reconciler());

    const res = await svc.backfill(10, undefined, true);

    // ⚠️ Con el literal de vuelta, `imported` traía este set y el operador leería «1 set
    // importado» de un set que ya tenía sus 102 cartas desde hace meses.
    expect(res.imported).toEqual([]);
    expect(res.refreshed).toHaveLength(1);
    expect(res.refreshed[0]).toMatchObject({ id: 'base1', cardCount: 1 });
    expect(res.setsImported).toBe(0);
    expect(res.setsRefreshed).toBe(1);
  });

  it('el barrido sync-all ya no tira el resultado: el summary separa importados, re-sync y fallos', async () => {
    const prisma = prismaMock([]);
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      { getSets: jest.fn() } as unknown as PokemonTcgIoClient,
      settings(),
      reconciler(),
    );
    jest
      .spyOn(svc as any, 'importSet')
      .mockResolvedValueOnce({ outcome: 'imported', cardsUpserted: 191, cardsBefore: 0 })
      .mockResolvedValueOnce({ outcome: 'refreshed', cardsUpserted: 10, cardsBefore: 10 })
      .mockResolvedValueOnce({ outcome: 'noop', cardsUpserted: 0, cardsBefore: 3 })
      .mockRejectedValueOnce(new Error('boom'));

    await svc.runSyncAll([
      { id: 'a', name: 'A', releaseDate: '2025/01/01' },
      { id: 'b', name: 'B', releaseDate: '2025/02/01' },
      { id: 'c', name: 'C', releaseDate: '2025/03/01' },
      { id: 'd', name: 'D', releaseDate: '2025/04/01' },
    ]);

    const { summary, done } = svc.getSyncStatus();
    expect(done).toBe(4); // intentados (barra honesta)
    expect(summary).toMatchObject({
      // ⭐ «cuántos toqué» tiene UN solo nombre (§M2-CS.0): `setsWritten`. `setsImported` y
      // `setsRefreshed` sobreviven como DESGLOSE suyo (`I-CS5`), no como vocabulario paralelo.
      setsWritten: 2,
      setsImported: 1,
      setsRefreshed: 1,
      setsNoop: 1,
      setsFailed: 1,
      cardsUpserted: 201,
    });
    // I-CS1: setsWritten + setsNoop + setsFailed === done (las tres categorías ≠ 0 aquí).
    expect(summary!.setsWritten + summary!.setsNoop + summary!.setsFailed).toBe(done);
    // I-CS5: el desglose suma exactamente el total del que cuelga.
    expect(summary!.setsImported + summary!.setsRefreshed).toBe(summary!.setsWritten);
    // `failures[]` con la forma única del canon: {setId, code, message}. `code: null` porque el
    // error no era una BusinessException — ⛔ no se inventa un código (§M2-CS.0).
    expect(summary?.failures).toEqual([{ setId: 'd', code: null, message: 'boom' }]);
  });

  it('sin barrido disparado, el summary es AUSENTE (null) — no un «0/0» que parece un resultado', async () => {
    const svc = new CatalogSyncService(
      prismaMock([]) as PrismaService,
      { getSets: jest.fn() } as unknown as PokemonTcgIoClient,
      settings(),
      reconciler(),
    );
    expect(svc.getSyncStatus().summary).toBeNull();
  });
});

describe('D2 — «cartas procesadas» es lo que la corrida tocó, no lo que hay en la base', () => {
  /** El set del síntoma real: 191 cartas en BD. */
  const SET_UNIVERSE = 191;

  function svcWithResolver(resolverResult: unknown, cardsInSet = SET_UNIVERSE) {
    const prisma = prismaMock([{ externalId: 'me05', cards: cardsInSet }]);
    const resolver = { resolveCardProductsForSet: jest.fn(async () => resolverResult) };
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      { getSets: jest.fn(), getCardsBySet: jest.fn() } as unknown as PokemonTcgIoClient,
      settings(),
      reconciler(),
      resolver as any,
    );
    return { svc, resolver };
  }

  it('el resolver tocó 3 cartas de 191 ⇒ cardsProcessed 3 (y el 191 viaja aparte, como cardsInSet)', async () => {
    const { svc } = svcWithResolver({
      groupId: 1,
      joined: 3,
      products: 3,
      pricesWritten: 0,
      pricesPending: 6,
      unjoined: 0,
      cardsTouched: 3,
    });

    const res = await svc.refreshVariants('me05', false);

    // ⚠️ Con `cardsProcessed = localSet._count.cards` de vuelta, esto vale 191 y el banner verde
    // vuelve a decir «191 cartas procesadas · 0 precios» en una corrida que tocó tres.
    expect(res.cardsProcessed).toBe(3);
    expect(res.cardsProcessed).not.toBe(SET_UNIVERSE);
    expect(res.cardsInSet).toBe(SET_UNIVERSE);
    expect(res.pricesUpserted).toBe(0);
  });

  it('el resolver no reconoció NADA ⇒ cardsProcessed 0, medido — no 191 en verde', async () => {
    const { svc } = svcWithResolver({
      groupId: 1,
      joined: 0,
      products: 0,
      pricesWritten: 0,
      pricesPending: 0,
      unjoined: 40,
      cardsTouched: 0,
    });

    const res = await svc.refreshVariants('me05', false);

    expect(res.cardsProcessed).toBe(0);
    expect(res.cardsInSet).toBe(SET_UNIVERSE);
  });

  it('sin groupId TCGCSV (no se tocó nada) ⇒ cardsProcessed 0 medido, universo aparte', async () => {
    const { svc } = svcWithResolver(null);

    const res = await svc.refreshVariants('me05', false);

    expect(res.cardsProcessed).toBe(0);
    expect(res.cardsProcessed).not.toBe(SET_UNIVERSE);
    expect(res.cardsInSet).toBe(SET_UNIVERSE);
  });

  it('el resolver NO reporta cuántas cartas tocó ⇒ dato AUSENTE (null ⇒ «—»), ni 0 ni el total', async () => {
    // Un resolver que no cuenta cartas (versión vieja / camino que no lo sabe): el dato es
    // DESCONOCIDO. La norma de precios se aplica igual aquí: ausente se muestra «—»; no se rellena
    // con el total (mentira alegre) ni con 0 (afirmaría que sabemos que no se tocó nada).
    const { svc } = svcWithResolver({
      groupId: 1,
      joined: 5,
      products: 5,
      pricesWritten: 2,
      pricesPending: 3,
      unjoined: 0,
      // sin `cardsTouched`
    });

    const res = await svc.refreshVariants('me05', false);

    expect(res.cardsProcessed).toBeNull();
    expect(res.cardsProcessed).not.toBe(SET_UNIVERSE);
    expect(res.cardsProcessed).not.toBe(0);
    expect(res.cardsInSet).toBe(SET_UNIVERSE);
  });
});

describe('D3 — el criterio de admisión al barrido vive en UNA función', () => {
  const remote = [
    { id: 'sv9', name: 'Nine', releaseDate: '2025/02/01' }, // nuevo y dentro del corte
    { id: 'base1', name: 'Base', releaseDate: '1999/01/09' }, // nuevo pero anterior al corte
    { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' }, // ya importado
    { id: 'me05', name: 'Mega', releaseDate: undefined as unknown as string }, // sin fecha
  ];
  const importedWithCards = new Set(['sv8']);

  it('sin force: entra lo nuevo dentro del corte; lo viejo sale aparte; lo ya importado se salta', () => {
    const { queue, outOfRange, unknownDate } = selectSyncAllCandidates(remote, {
      importedWithCards,
      force: false,
      fromReleaseDate: '2024/01/01',
    });

    expect(queue.map((s) => s.id)).toEqual(['sv9']);
    expect(outOfRange.map((s) => s.id)).toEqual(['base1']);
    // El set SIN fecha sigue quedando fuera, pero ya no en silencio: tiene su propio cubo.
    expect(unknownDate.map((s) => s.id)).toEqual(['me05']);
  });

  it('con force: se repara lo YA importado aunque sea viejo, pero NO se arrastra lo viejo que no tenemos', () => {
    const { queue, outOfRange } = selectSyncAllCandidates(remote, {
      importedWithCards,
      force: true,
      fromReleaseDate: '2024/01/01',
    });

    expect(queue.map((s) => s.id).sort()).toEqual(['sv8', 'sv9']);
    expect(outOfRange.map((s) => s.id)).toEqual(['base1']);
  });

  it('el corte lo aplica el MISMO predicado que usa el sync from_date', () => {
    expect(isWithinCatalogFromDate({ releaseDate: '2024/01/01' }, '2024/01/01')).toBe(true);
    expect(isWithinCatalogFromDate({ releaseDate: '2023/12/31' }, '2024/01/01')).toBe(false);
    // Sin fecha ⇒ fuera (comportamiento que ya tenía `sync()`; no se adivina una fecha).
    expect(isWithinCatalogFromDate({ releaseDate: null }, '2024/01/01')).toBe(false);
  });

  it('syncAll lee el corte del dial y lo reporta junto a lo que dejó fuera', async () => {
    const prisma = prismaMock([]);
    const client = {
      getSets: jest.fn(async () => remote),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      client,
      settings('2024/01/01'),
      reconciler(),
    );
    jest.spyOn(svc as any, 'runSyncAll').mockResolvedValue(undefined);

    const res = await svc.syncAll();

    expect(res.fromReleaseDate).toBe('2024/01/01');
    expect(res.setsQueued).toBe(2); // sv9 + sv8 (sv8 no está importado en este fixture)
    expect(res.setsSkippedOutOfRange).toBe(1); // base1
    // ⭐ El NOMBRE es del contrato, no del código: §M2-CS.1/§M2-CS.4 dicen
    // `setsSkippedUnknownDate`. Este test fijaba `setsSkippedUndated` —el nombre que el backend
    // había inventado— y con ello BENDECÍA la divergencia: la suite aprobaba un campo que ningún
    // consumidor del contrato podía leer. Se corrige el código y el candado en el mismo pase.
    expect(res.setsSkippedUnknownDate).toBe(1); // me05, sin releaseDate
    // ⛔ Y el nombre viejo no vuelve por la puerta de atrás como «alias de compatibilidad»: dos
    // nombres para la misma cifra son dos verdades que se desincronizan (§0-B.3 regla 8).
    expect(Object.keys(res)).not.toContain('setsSkippedUndated');
  });

  it('las TRES cifras de selección viven DENTRO del summary, y el 202 es su ECO exacto', async () => {
    // §M2-CS.1: `fromReleaseDate` / `setsSkippedOutOfRange` / `setsSkippedUnknownDate` se declaran
    // DENTRO de `summary` —«la fuente canónica del registro de la corrida es este summary»— y el
    // 202 las «hace eco» al arrancar. Viajaban SÓLO en el 202: quien leía `sync-status` no podía
    // saber desde cuándo se barrió ni qué quedó fuera, que es justo lo que explica un setsTotal
    // pequeño. Un solo cálculo, dos momentos: si divergen, este test muere.
    const prisma = prismaMock([]);
    const client = {
      getSets: jest.fn(async () => remote),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(
      prisma as PrismaService,
      client,
      settings('2024/01/01'),
      reconciler(),
    );
    jest.spyOn(svc as any, 'runSyncAll').mockResolvedValue(undefined);

    const res = await svc.syncAll();
    const { summary } = svc.getSyncStatus();

    expect(summary).not.toBeNull();
    expect(summary!.fromReleaseDate).toBe('2024/01/01');
    expect(summary!.setsSkippedOutOfRange).toBe(1);
    expect(summary!.setsSkippedUnknownDate).toBe(1);
    // ECO === CANÓNICO, campo por campo.
    expect({
      fromReleaseDate: summary!.fromReleaseDate,
      setsSkippedOutOfRange: summary!.setsSkippedOutOfRange,
      setsSkippedUnknownDate: summary!.setsSkippedUnknownDate,
    }).toEqual({
      fromReleaseDate: res.fromReleaseDate,
      setsSkippedOutOfRange: res.setsSkippedOutOfRange,
      setsSkippedUnknownDate: res.setsSkippedUnknownDate,
    });
    // ⛔ Selección ≠ escritura (§M2-CS.1): los descartados NO entran en `setsTotal`.
    expect(summary!.setsTotal).toBe(2);
  });

  it('dial con formato inválido ⇒ VALIDATION_ERROR accionable (no se adivina un corte)', async () => {
    const svc = new CatalogSyncService(
      prismaMock([]) as PrismaService,
      { getSets: jest.fn() } as unknown as PokemonTcgIoClient,
      settings('ayer'),
      reconciler(),
    );

    await expect(svc.syncAll()).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
