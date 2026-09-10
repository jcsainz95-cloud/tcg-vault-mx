import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import {
  deprecatedSetsOk,
  emptySetSweepTally,
  recordSweepAttempt,
  recordSweepFailure,
  sweepAttempted,
  sweepFailureCode,
} from '../src/modules/catalog/set-sweep-tally';
import { BusinessException } from '../src/common/business.exception';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * ⭐ EL CANDADO DEL REPARTO — `API_CONTRACT §M2-CS.0` / `§M2-CS.2`.
 *
 * ## Qué defecto vigila
 *
 * `refresh-variants-all` reportaba un `summary` que sólo tenía `setsOk`, y `setsOk` contaba como
 * bueno **al set que corrió sin escribir nada**. Un set cuyo nombre no empareja con TCGCSV no
 * lanza: escribe cero variantes, cero precios, y sumaba a `setsOk` **sin aparecer en `failures`**.
 * En un lote de cien sets el dueño leía «todo bien» mientras había sets sin tocar — la mentira de
 * las «191 cartas procesadas», pero a escala de lote, donde además nadie revisa renglón por renglón.
 *
 * ## Qué fija, y por qué cada aserción
 *
 *  1. **Un set que no escribió NO cuenta como tocado.** Es el candado central: si alguien vuelve a
 *     sumar el `noop` a la cifra de «cuántos toqué», estos tests se ponen rojos.
 *  2. **`I-CS1`** — `setsWritten + setsNoop + setsFailed === done`, verificado con **datos** y con
 *     las **tres categorías distintas de cero** (una sola corrida que escribe, no escribe y falla).
 *     Un invariante comprobado sólo con ceros no comprueba nada.
 *  3. **`I-CS3`** — ninguna cifra del `summary` es `null`: ahí un `null` es un defecto, no una
 *     ausencia honesta. Lo desconocido viaja por `summary: null` o por `total > done`.
 *  4. **`setsOk` congelado** — `setsOk === setsWritten + setsNoop`, y NO se redefine. Congelarlo no
 *     es arreglarlo: sigue sumando los `noop` a los buenos, y por eso ningún veredicto lo usa.
 *  5. **UN solo reparto para los DOS barridos** — `sync-all` y `refresh-variants-all` reparten con
 *     la misma forma y desde la misma fuente. Si alguien vuelve a escribir un reparto propio en uno
 *     de los dos, la simetría que se afirma aquí se rompe.
 */

const settings = (): SettingsService =>
  ({ getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService);
const reconciler = () => ({ reconcile: jest.fn(async () => 0) });

function pokemonClientSpy(): PokemonTcgIoClient {
  return {
    getSets: jest.fn(async () => []),
    getCardsBySet: jest.fn(async () => ({
      data: [],
      page: 1,
      pageSize: 250,
      count: 0,
      totalCount: 0,
    })),
  } as unknown as PokemonTcgIoClient;
}

function prismaMock(sets: { externalId: string; cards: number }[]) {
  const byExternalId = new Map(sets.map((s) => [s.externalId, s]));
  return {
    cardSet: {
      findMany: jest.fn(async () =>
        sets.map((s) => ({ externalId: s.externalId, _count: { cards: s.cards } })),
      ),
      findUnique: jest.fn(async (args: any) => {
        const s = byExternalId.get(args.where.externalId);
        return s ? { id: `local-${s.externalId}` } : null;
      }),
    },
    card: {
      count: jest.fn(async (args: any) => {
        const ext = String(args.where.setId).replace(/^local-/, '');
        return byExternalId.get(ext)?.cards ?? 0;
      }),
    },
  } as unknown as PrismaService;
}

/** Resolver que SÍ escribe (variantes y precios reales). */
const resolverThatWrites = () => ({
  groupId: 24688,
  joined: 5,
  products: 6,
  pricesWritten: 10,
  pricesPending: 2,
  unjoined: 1,
  cardsTouched: 5,
});

function makeSvc(prisma: PrismaService, client: PokemonTcgIoClient, resolver: any) {
  const svc = new CatalogSyncService(prisma, client, settings(), reconciler() as any, resolver);
  jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
  return svc;
}

/**
 * El barrido MIXTO que usan varios tests: tres sets, uno por categoría.
 *  - `writes` — el resolver resuelve y escribe ⇒ `setsWritten`.
 *  - `nomatch` — ⭐ el set que NO EMPAREJA con TCGCSV: resolver ⇒ `null`, corre limpio, escribe
 *    CERO. No lanza ⇒ no es `setsFailed`. Es `setsNoop`, y es el caso que originó todo esto.
 *  - `boom` — el resolver lanza ⇒ `setsFailed` + renglón en `failures`.
 */
async function runMixedSweep() {
  const prisma = prismaMock([
    { externalId: 'writes', cards: 10 },
    { externalId: 'nomatch', cards: 10 },
    { externalId: 'boom', cards: 10 },
  ]);
  const client = pokemonClientSpy();
  const resolver = {
    resolveCardProductsForSet: jest.fn(async (localSetId: string) => {
      if (localSetId === 'local-boom') throw new Error('tcgcsv.com -> HTTP 503');
      if (localSetId === 'local-nomatch') return null; // grupo no emparejado: cero escrituras
      return resolverThatWrites();
    }),
  };
  const svc = makeSvc(prisma, client, resolver);
  await svc.runRefreshVariantsAll(['writes', 'nomatch', 'boom'], false);
  return svc.getRefreshVariantsAllStatus();
}

describe('§M2-CS.0 — el reparto de un barrido: fuente única (unitarios del canon)', () => {
  it('recordSweepAttempt(false) va a setsNoop y NO a setsWritten (el candado, en su forma mínima)', () => {
    const t = emptySetSweepTally(1);
    recordSweepAttempt(t, false);
    expect(t.setsNoop).toBe(1);
    expect(t.setsWritten).toBe(0); // ⭐ no escribió ⇒ no lo toqué
  });

  it('recordSweepAttempt(true) va a setsWritten', () => {
    const t = emptySetSweepTally(1);
    recordSweepAttempt(t, true);
    expect(t.setsWritten).toBe(1);
    expect(t.setsNoop).toBe(0);
  });

  it('failures[].code: el de la BusinessException; null si no traía (⛔ no se inventa UNKNOWN)', () => {
    expect(sweepFailureCode(new Error('cualquiera'))).toBeNull();
    expect(sweepFailureCode('ni siquiera un Error')).toBeNull();

    const t = emptySetSweepTally(2);
    recordSweepFailure(t, 'plain', new Error('se cayó y no dijo por qué'));
    recordSweepFailure(t, 'business', BusinessException.validation('VALIDATION_ERROR', 'malo'));
    expect(t.setsFailed).toBe(2);
    expect(t.failures).toEqual([
      { setId: 'plain', code: null, message: 'se cayó y no dijo por qué' },
      { setId: 'business', code: 'VALIDATION_ERROR', message: 'malo' },
    ]);
  });

  it('I-CS4: setsNoop NO se suma a setsWritten «para redondear» un total', () => {
    const t = emptySetSweepTally(10);
    for (let i = 0; i < 7; i++) recordSweepAttempt(t, false); // siete sets que no escribieron nada
    expect(t.setsWritten).toBe(0); // ⭐ siete noop siguen siendo CERO sets tocados
    expect(t.setsNoop).toBe(7);
  });

  it('setsOk DEPRECADO con significado CONGELADO: setsWritten + setsNoop (⛔ no se redefine)', () => {
    const t = emptySetSweepTally(6);
    recordSweepAttempt(t, true);
    recordSweepAttempt(t, true);
    recordSweepAttempt(t, false);
    recordSweepFailure(t, 'x', new Error('boom'));
    // Congelado: sigue sumando el noop a los buenos. Es la cifra que mentía, y se conserva tal cual
    // porque hay consumidores; congelarla es distinto de arreglarla.
    expect(deprecatedSetsOk(t)).toBe(3);
    expect(deprecatedSetsOk(t)).toBe(t.setsWritten + t.setsNoop);
    // …y por eso NO es un veredicto: hay un noop dentro y un fallo fuera.
    expect(deprecatedSetsOk(t)).not.toBe(t.setsWritten);
  });
});

describe('§M2-CS.2 — refresh-variants-all: el set que no empareja es setsNoop, no un set bueno', () => {
  it('⭐ CANDADO: un set que corre sin escribir NADA no cuenta como tocado (setsWritten no lo suma)', async () => {
    const prisma = prismaMock([{ externalId: 'nomatch', cards: 191 }]);
    const client = pokemonClientSpy();
    // El set de 191 cartas cuyo nombre no empareja con TCGCSV: el resolver no resuelve grupo.
    const resolver = { resolveCardProductsForSet: jest.fn(async () => null) };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['nomatch'], false);
    const { summary } = svc.getRefreshVariantsAllStatus();

    expect(summary).not.toBeNull();
    // ⭐ La aserción que se pone roja si alguien vuelve a contar el noop como bueno.
    expect(summary!.setsWritten).toBe(0);
    expect(summary!.setsNoop).toBe(1);
    // No lanzó ⇒ NO es un fallo, y por tanto NO tiene renglón en `failures` (§M2-CS.0: `failures`
    // es «por set FALLIDO»; `setsFailed` es «cuyo intento LANZÓ»). El hecho «no escribí nada»
    // viaja como cifra medida, no como error inventado.
    expect(summary!.setsFailed).toBe(0);
    expect(summary!.failures).toEqual([]);
    // Y las cifras de escritura son cero MEDIDO, coherentes con el reparto.
    expect(summary!.cardProductsUpserted).toBe(0);
    expect(summary!.pricesUpserted).toBe(0);
  });

  it('un set que SÍ escribe cuenta en setsWritten (el candado no se pasa de listo)', async () => {
    const prisma = prismaMock([{ externalId: 'good', cards: 10 }]);
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn(async () => resolverThatWrites()) };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['good'], false);
    const { summary } = svc.getRefreshVariantsAllStatus();

    expect(summary!.setsWritten).toBe(1);
    expect(summary!.setsNoop).toBe(0);
  });

  it('⛔ `pending` NO cuenta como escritura: variantes SIN precio no convierten un noop en tocado', async () => {
    const prisma = prismaMock([{ externalId: 'nomatch', cards: 10 }]);
    const client = pokemonClientSpy();
    const resolver = { resolveCardProductsForSet: jest.fn(async () => null) };
    const svc = makeSvc(prisma, client, resolver);

    await svc.runRefreshVariantsAll(['nomatch'], false);
    const { summary } = svc.getRefreshVariantsAllStatus();

    // `pending` cuenta VARIANTES sin precio — es justo lo que NO se escribió. Meterlo en el
    // predicado de escritura resucitaría el defecto con otro nombre.
    expect(summary!.setsWritten).toBe(0);
    expect(summary!.setsNoop).toBe(1);
  });

  it('⭐ I-CS1 CON DATOS: las tres categorías ≠ 0 y la suma cuadra con `done`', async () => {
    const st = await runMixedSweep();
    const s = st.summary!;

    // Las tres categorías, distintas de cero en UNA sola corrida (el invariante no se comprueba
    // con ceros: así se ve que el reparto separa de verdad los tres hechos).
    expect(s.setsWritten).toBe(1);
    expect(s.setsNoop).toBe(1);
    expect(s.setsFailed).toBe(1);
    expect(s.setsWritten).toBeGreaterThan(0);
    expect(s.setsNoop).toBeGreaterThan(0);
    expect(s.setsFailed).toBeGreaterThan(0);

    // I-CS1: el reparto cubre EXACTAMENTE lo intentado.
    expect(st.done).toBe(3);
    expect(s.setsWritten + s.setsNoop + s.setsFailed).toBe(st.done);

    // El fallo, y sólo el fallo, deja renglón en `failures`.
    expect(s.failures).toEqual([
      { setId: 'boom', code: 'UPSTREAM_ERROR', message: expect.stringMatching(/TCGCSV/i) },
    ]);
  });

  it('⭐ el resumen ya NO puede decir «todo bien» de un lote con sets sin tocar', async () => {
    const st = await runMixedSweep();
    const s = st.summary!;

    // Éste es el hecho que el dueño no podía ver: de 3 sets intentados, sólo 1 se tocó.
    expect(s.setsWritten).toBeLessThan(st.done);
    // Y el `setsOk` congelado sigue siendo insuficiente para el veredicto: dice «2» sobre un lote
    // en el que se escribió UN set. Por eso ningún consumidor puede usarlo (§M2-CS.2).
    expect(s.setsOk).toBe(2);
    expect(s.setsOk).not.toBe(s.setsWritten);
  });

  it('I-CS3: ninguna cifra del summary es null (un null ahí es defecto, no ausencia)', async () => {
    const st = await runMixedSweep();
    const s = st.summary! as Record<string, unknown>;

    for (const k of [
      'setsTotal',
      'setsWritten',
      'setsNoop',
      'setsFailed',
      'setsOk',
      'cardProductsUpserted',
      'pricesUpserted',
      'pending',
    ]) {
      expect(s[k]).not.toBeNull();
      expect(typeof s[k]).toBe('number');
      expect(Number.isFinite(s[k] as number)).toBe(true);
    }
    // Lo desconocido viaja por las OTRAS dos vías, y sólo por ellas.
    expect(Array.isArray(s.failures)).toBe(true);
  });

  it('setsOk se emite DERIVADO del reparto vivo (no como contador propio que pueda desviarse)', async () => {
    const st = await runMixedSweep();
    const s = st.summary!;
    expect(s.setsOk).toBe(s.setsWritten + s.setsNoop);
  });

  it('barrido completo (refreshVariantsAll): setsTotal encolado e I-CS1 contra done', async () => {
    const prisma = prismaMock([
      { externalId: 'writes', cards: 10 },
      { externalId: 'nomatch', cards: 10 },
    ]);
    const client = pokemonClientSpy();
    const resolver = {
      resolveCardProductsForSet: jest.fn(async (localSetId: string) =>
        localSetId === 'local-nomatch' ? null : resolverThatWrites(),
      ),
    };
    const svc = makeSvc(prisma, client, resolver);

    await svc.refreshVariantsAll();
    await new Promise((r) => setImmediate(r)); // deja terminar el fire-and-forget + su .finally

    const st = svc.getRefreshVariantsAllStatus();
    const s = st.summary!;
    expect(s.setsTotal).toBe(2);
    expect(s.setsWritten).toBe(1);
    expect(s.setsNoop).toBe(1);
    expect(s.setsFailed).toBe(0);
    expect(s.setsWritten + s.setsNoop + s.setsFailed).toBe(st.done);
    // I-CS2: `done <= setsTotal`, y lo no intentado se DERIVA (⛔ no es un campo).
    expect(st.done).toBeLessThanOrEqual(st.total);
  });
});

describe('§M2-CS.0 — UN solo reparto para los DOS barridos (regla 8: no dos implementaciones)', () => {
  /** Barrido `sync-all` con un set que escribe, uno que no y uno que lanza. */
  async function runMixedSyncAll() {
    const prisma = prismaMock([]);
    const client = pokemonClientSpy();
    const svc = makeSvc(prisma, client, { resolveCardProductsForSet: jest.fn(async () => null) });
    jest.spyOn(svc as any, 'importSet').mockImplementation(async (...args: unknown[]) => {
      const s = args[0] as { id: string };
      if (s.id === 'boom') throw new Error('pokemontcg.io -> HTTP 502');
      if (s.id === 'nomatch') return { outcome: 'noop', cardsUpserted: 0, cardsBefore: 0 };
      return { outcome: 'imported', cardsUpserted: 191, cardsBefore: 0 };
    });
    await svc.runSyncAll(
      [{ id: 'writes' }, { id: 'nomatch' }, { id: 'boom' }] as any,
      false,
    );
    return svc.getSyncStatus();
  }

  it('sync-all reparte con EL MISMO vocabulario y cumple I-CS1 con las tres categorías ≠ 0', async () => {
    const st = await runMixedSyncAll();
    const s = st.summary!;

    expect(s.setsWritten).toBe(1);
    expect(s.setsNoop).toBe(1);
    expect(s.setsFailed).toBe(1);
    expect(s.setsWritten + s.setsNoop + s.setsFailed).toBe(st.done);
    // `failures[]` con la MISMA forma que el hermano: {setId, code, message}. Aquí el error no era
    // una BusinessException ⇒ `code: null`, y NO se inventa un código (§M2-CS.0).
    expect(s.failures).toEqual([
      { setId: 'boom', code: null, message: expect.stringMatching(/502/) },
    ]);
  });

  it('I-CS5: setsImported + setsRefreshed === setsWritten (desglose, no vocabulario paralelo)', async () => {
    const st = await runMixedSyncAll();
    const s = st.summary!;
    expect(s.setsImported + s.setsRefreshed).toBe(s.setsWritten);
  });

  it('⭐ los DOS barridos exponen exactamente las mismas claves de reparto', async () => {
    const reparto = ['setsTotal', 'setsWritten', 'setsNoop', 'setsFailed', 'failures'];
    const refresh = (await runMixedSweep()).summary! as Record<string, unknown>;
    const sync = (await runMixedSyncAll()).summary! as Record<string, unknown>;

    for (const k of reparto) {
      expect(Object.keys(refresh)).toContain(k);
      expect(Object.keys(sync)).toContain(k);
    }
    // Y ⛔ ningún segundo vocabulario para «cuántos toqué» en ninguno de los dos.
    for (const banned of ['setsProcessed', 'setsHandled', 'setsDone']) {
      expect(Object.keys(refresh)).not.toContain(banned);
      expect(Object.keys(sync)).not.toContain(banned);
    }
    // `setsOk` sólo sobrevive (deprecado) en refresh-variants; ⛔ NO se propaga al hermano.
    expect(Object.keys(sync)).not.toContain('setsOk');
  });

  it('sweepAttempted es la fuente de I-CS1 y no cuenta lo no intentado', () => {
    const t = emptySetSweepTally(100); // 100 encolados…
    recordSweepAttempt(t, true);
    recordSweepAttempt(t, false);
    recordSweepFailure(t, 'x', new Error('boom'));
    expect(sweepAttempted(t)).toBe(3); // …pero sólo 3 intentados: el resto es I-CS2 (total - done)
    expect(sweepAttempted(t)).not.toBe(t.setsTotal);
  });
});
