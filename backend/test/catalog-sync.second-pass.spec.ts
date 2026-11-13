import { CATALOG_SYNC_BUDGET_MAX_MS, CATALOG_SYNC_PAUSE_MAX_MS, CatalogSyncService, syncAllErrorCount } from '../src/modules/catalog/catalog-sync.service';
import { CATALOG_METADATA_ATTEMPT_TIMEOUT_MS } from '../src/jobs/catalog-price-sync.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { CatalogStaleAlertService, sweepDetail } from '../src/modules/catalog/catalog-stale-alert.service';
import { CATALOG_AUTO_KEYS } from '../src/modules/catalog/catalog-auto-state.service';
import { allFailuresFromSource, isSourceOutageMessage } from '../src/modules/catalog/catalog-source-failure';

jest.mock('../src/modules/spend-alerts/spend-mail.service', () => ({ ownerRecipients: jest.fn(async () => [{ email: 'dueno@tcghunt.test' }]) }));

/**
 * Barrido «más paciente» (decisión del dueño 2026-11-13, opción B): pokemontcg.io da 5xx en ~60 % de los pedidos y con los reintentos
 * cortos siempre fallaba algún set ⇒ el barrido NUNCA contaba como éxito. Ahora, tras una pausa, una SEGUNDA PASADA reintenta solo lo que
 * falló (backoff largo); cuenta como error únicamente lo que falla TAMBIÉN ahí. Fuente caída de verdad ⇒ sigue fallando y la alerta de
 * 48 h salta, con el texto llano de que la causa es pokemontcg.io.
 */
const SETS = [
  { id: 'ok1', name: 'Ok 1', releaseDate: '2025/01/01' },
  { id: 'flaky', name: 'Flaky', releaseDate: '2025/02/01' },
  { id: 'dead', name: 'Dead', releaseDate: '2025/03/01' },
];

function build(opts: { sets?: typeof SETS; tcgcsv?: { importGroup: jest.Mock } } = {}) {
  const state: Record<string, unknown> = {};
  const autoState = {
    set: jest.fn(async (k: string, v: unknown) => void (state[k] = v)),
    get: jest.fn(async (k: string) => state[k] ?? null),
    getLastSuccessAt: jest.fn(async () => null),
    setLastSuccessAt: jest.fn(async (at: string) => void (state[CATALOG_AUTO_KEYS.lastSuccessAt] = { at })),
  };
  const client = { getSets: jest.fn(async () => opts.sets ?? SETS), runPatient: jest.fn(<T>(fn: () => Promise<T>) => fn()) } as unknown as PokemonTcgIoClient;
  const prisma = { cardSet: { findMany: jest.fn(async () => []) } } as never;
  const settings = { getString: jest.fn(async () => '2024/01/01') } as never;
  const svc = new CatalogSyncService(prisma, client, settings, { reconcile: jest.fn() } as never, undefined, undefined, (opts.tcgcsv ?? { importGroup: jest.fn(async () => ({ created: 0, updated: 1 })) }) as never, undefined, undefined, autoState as never);
  jest.spyOn(svc as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue(undefined);
  return { svc, autoState, state, client };
}

async function sweep(svc: CatalogSyncService) {
  await svc.syncAll({ actor: { kind: 'system', job: 'catalog-price-sync' } });
  await (svc as unknown as { syncAllDone: Promise<void> }).syncAllDone;
  return svc.getSyncStatus();
}

describe('catalog sync-all — segunda pasada paciente', () => {
  afterEach(() => {
    delete process.env.CATALOG_SYNC_BUDGET_MS;
    delete process.env.CATALOG_SYNC_RETRY_PAUSE_MS;
    jest.restoreAllMocks();
  });

  it('fuente con fallos intermitentes ⇒ ÉXITO tras la segunda pasada (lastSuccessAt se mueve, 0 fallidos, I-CS1 intacto)', async () => {
    const { svc, autoState, state, client } = build({ sets: SETS.slice(0, 2) });
    const calls: Record<string, number> = {};
    jest.spyOn(svc as never, 'importSet').mockImplementation((async (s: { id: string }) => {
      calls[s.id] = (calls[s.id] ?? 0) + 1;
      if (s.id === 'flaky' && calls[s.id] === 1) throw new Error('pokemontcg.io /cards -> HTTP 502');
      return { outcome: 'imported', cardsUpserted: 10, cardsBefore: 0 };
    }) as never);
    const st = await sweep(svc);
    const s = st.summary!;
    expect(calls).toEqual({ ok1: 1, flaky: 2 }); // la 2.ª pasada tocó SOLO el set fallido
    expect([s.setsFailed, s.failures, s.setsWritten]).toEqual([0, [], 2]);
    expect(s.retry).toEqual({ attempted: 1, recovered: 1, stillFailing: 0 });
    expect(s.setsWritten + s.setsNoop + s.setsFailed).toBe(st.done); // I-CS1
    expect(syncAllErrorCount(s)).toBe(0);
    expect(st.lastSuccessAt).not.toBeNull();
    expect(autoState.setLastSuccessAt).toHaveBeenCalledTimes(1);
    expect(state[CATALOG_AUTO_KEYS.lastSweep]).toMatchObject({ errors: 0, setsFailed: 0 });
    expect(client.runPatient).toHaveBeenCalledTimes(1); // y en modo PACIENTE
    await expect(svc.awaitSyncAll(1000)).resolves.toBeDefined();
  });

  it('fuente CAÍDA de verdad ⇒ sigue fallando: sin lastSuccessAt, awaitSyncAll lanza y lastSweep marca la causa externa', async () => {
    const { svc, autoState, state } = build();
    jest.spyOn(svc as never, 'importSet').mockImplementation((async (s: { id: string }) => {
      if (s.id === 'ok1') return { outcome: 'refreshed', cardsUpserted: 5, cardsBefore: 5 };
      throw new Error('pokemontcg.io /cards -> HTTP 503');
    }) as never);
    const st = await sweep(svc);
    const s = st.summary!;
    expect(s.setsFailed).toBe(2);
    expect(s.failures.map((f) => f.setId).sort()).toEqual(['dead', 'flaky']);
    expect(s.failures[0].message).toMatch(/segunda pasada/);
    expect(s.retry).toEqual({ attempted: 2, recovered: 0, stillFailing: 2 });
    expect(s.setsWritten + s.setsNoop + s.setsFailed).toBe(st.done);
    expect(st.lastSuccessAt).toBeNull();
    expect(autoState.setLastSuccessAt).not.toHaveBeenCalled(); // ⇒ la alerta de 48 h SIGUE saltando
    await expect(svc.awaitSyncAll(1000)).rejects.toThrow(/errores/);
    expect(state[CATALOG_AUTO_KEYS.lastSweep]).toMatchObject({ errors: 2, setsFailed: 2, setsTotal: 3, sourceDown: true });
  });

  it('mezcla: uno se recupera y otro no ⇒ cuenta solo el que falló también en la segunda pasada', async () => {
    const { svc } = build();
    const seen: Record<string, number> = {};
    jest.spyOn(svc as never, 'importSet').mockImplementation((async (s: { id: string }) => {
      seen[s.id] = (seen[s.id] ?? 0) + 1;
      if (s.id === 'flaky' && seen[s.id] === 1) throw new Error('pokemontcg.io /cards -> HTTP 500');
      if (s.id === 'dead') throw new Error('pokemontcg.io /cards -> HTTP 500');
      return { outcome: 'noop', cardsUpserted: 0, cardsBefore: 3 };
    }) as never);
    const s = (await sweep(svc)).summary!;
    expect([s.setsFailed, s.failures.map((f) => f.setId)]).toEqual([1, ['dead']]);
    expect(s.retry).toMatchObject({ attempted: 2, recovered: 1, stillFailing: 1 });
    expect(s.setsNoop).toBe(2);
  });

  it('presupuesto del barrido agotado ⇒ no hay segunda pasada (skipped) y lo fallido sigue contando; el job no se cuelga', async () => {
    process.env.CATALOG_SYNC_BUDGET_MS = '1';
    const { svc } = build({ sets: SETS.slice(1, 2) });
    const imp = jest.spyOn(svc as never, 'importSet').mockImplementation((async () => {
      throw new Error('pokemontcg.io /cards -> HTTP 502');
    }) as never);
    const s = (await sweep(svc)).summary!;
    expect(imp).toHaveBeenCalledTimes(1);
    expect(s.retry).toMatchObject({ attempted: 0, skipped: true, stillFailing: 1 });
    expect(s.setsFailed).toBe(1);
  });

  it('CS-1: con un grupo TCGCSV en error por causa propia NO se culpa a pokemontcg.io aunque todos los sets fallen por la fuente', async () => {
    const tcgcsv = { importGroup: jest.fn(async () => { throw new Error('boom propio'); }) };
    const { svc, state } = build({ tcgcsv });
    jest.spyOn(svc as never, 'importSet').mockImplementation((async () => { throw new Error('pokemontcg.io /cards -> HTTP 502'); }) as never);
    await sweep(svc);
    expect(state[CATALOG_AUTO_KEYS.lastSweep]).toMatchObject({ setsFailed: 3, sourceDown: false });
  });

  it('CS-2: las env se acotan (presupuesto ≤ 40 min, pausa ≤ 10 min, nunca 2^31-1 ni negativas ni NaN)', () => {
    const { svc } = build();
    const g = (k: 'sweepBudgetMs' | 'retryPauseMs') => (svc as unknown as Record<string, number>)[k];
    process.env.CATALOG_SYNC_BUDGET_MS = String(2 ** 31 - 1);
    expect(g('sweepBudgetMs')).toBe(CATALOG_SYNC_BUDGET_MAX_MS);
    process.env.CATALOG_SYNC_BUDGET_MS = '-5';
    expect(g('sweepBudgetMs')).toBe(CATALOG_SYNC_BUDGET_MAX_MS);
    process.env.CATALOG_SYNC_BUDGET_MS = 'abc';
    expect(g('sweepBudgetMs')).toBe(CATALOG_SYNC_BUDGET_MAX_MS);
    process.env.CATALOG_SYNC_BUDGET_MS = '5';
    expect(g('sweepBudgetMs')).toBe(1000);
    process.env.CATALOG_SYNC_RETRY_PAUSE_MS = String(2 ** 31 - 1);
    expect(g('retryPauseMs')).toBe(CATALOG_SYNC_PAUSE_MAX_MS);
    process.env.CATALOG_SYNC_RETRY_PAUSE_MS = '-9';
    expect(g('retryPauseMs')).toBe(0);
    expect(CATALOG_SYNC_BUDGET_MAX_MS).toBeLessThan(CATALOG_METADATA_ATTEMPT_TIMEOUT_MS); // margen bajo el tope del job
    expect(CATALOG_METADATA_ATTEMPT_TIMEOUT_MS - CATALOG_SYNC_BUDGET_MAX_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
    delete process.env.CATALOG_SYNC_RETRY_PAUSE_MS;
  });

  it('sin fallos no hay segunda pasada (ni pausa)', async () => {
    const { svc } = build({ sets: SETS.slice(0, 1) });
    jest.spyOn(svc as never, 'importSet').mockImplementation((async () => ({ outcome: 'imported', cardsUpserted: 1, cardsBefore: 0 })) as never);
    const s = (await sweep(svc)).summary!;
    expect(s.retry).toBeUndefined();
    expect((svc as unknown as { sleep: jest.Mock }).sleep).not.toHaveBeenCalled();
  });
});

describe('cliente pokemontcg.io — modo paciente', () => {
  class Probe extends PokemonTcgIoClient {
    waits: number[] = [];
    protected async sleep(ms: number): Promise<void> {
      this.waits.push(ms);
    }
  }
  const mkClient = () => new Probe({ get: () => undefined } as never);
  const fetchMock = () => jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502, headers: new Headers() } as Response);
  afterEach(() => jest.restoreAllMocks());

  it('normal: 4 reintentos cortos (5 pedidos); paciente: 6 reintentos con backoff 5,10,20,40,60,60 s (7 pedidos)', async () => {
    const f = fetchMock();
    const c = mkClient();
    await expect(c.getCardsBySet('sv1', 1)).rejects.toThrow(/HTTP 502/);
    expect(f).toHaveBeenCalledTimes(5);
    expect(c.waits).toEqual([500, 1000, 2000, 4000]);
    f.mockClear();
    c.waits = [];
    await expect(c.runPatient(() => c.getCardsBySet('sv1', 1))).rejects.toThrow(/HTTP 502/);
    expect(f).toHaveBeenCalledTimes(7);
    expect(c.waits).toEqual([5000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });

  it('QA: timeout/red del cliente salen PREFIJADOS con pokemontcg.io; en modo paciente se reintentan; el Retry-After se acota a 60 s', async () => {
    const boom = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const f = jest.spyOn(globalThis, 'fetch').mockRejectedValue(boom);
    const c = mkClient();
    await expect(c.getCardsBySet('sv1', 1)).rejects.toThrow(/^pokemontcg\.io \/cards.* -> timeout: /);
    expect(f).toHaveBeenCalledTimes(1); // modo normal: sin cambios (una sola vez)
    f.mockClear();
    await expect(c.runPatient(() => c.getCardsBySet('sv1', 1))).rejects.toThrow(/^pokemontcg\.io .* -> timeout/);
    expect(f).toHaveBeenCalledTimes(7);
    f.mockRejectedValue(new TypeError('fetch failed'));
    await expect(c.getCardsBySet('sv1', 1)).rejects.toThrow(/^pokemontcg\.io .* -> network: fetch failed/);
    // Retry-After de 1 hora: normal lo respeta; paciente lo acota a 60 s
    f.mockReset();
    f.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'retry-after': '3600' }) } as Response);
    c.waits = [];
    await expect(c.runPatient(() => c.getCardsBySet('sv1', 1))).rejects.toThrow(/HTTP 429/);
    expect(Math.max(...c.waits)).toBe(60_000);
  });

  it('el modo paciente NO se filtra a un pedido concurrente fuera de `runPatient`', async () => {
    const f = fetchMock();
    const c = mkClient();
    await Promise.allSettled([c.runPatient(() => c.getCardsBySet('a', 1)), c.getCardsBySet('b', 1)]);
    expect(f).toHaveBeenCalledTimes(7 + 5);
  });
});

describe('alerta de 48 h — texto llano con cuántos sets fallaron y la causa', () => {
  it('clasifica: 5xx/429/timeout/red de pokemontcg.io = fuente; un error nuestro no', () => {
    for (const m of ['pokemontcg.io /cards -> HTTP 502', 'pokemontcg.io /sets -> HTTP 429', 'pokemontcg.io /cards?q=x -> timeout: The operation was aborted due to timeout', 'pokemontcg.io /cards -> network: fetch failed', 'pokemontcg.io /cards -> HTTP 503 (también en la segunda pasada)']) expect(isSourceOutageMessage(m)).toBe(true);
    // CS-1: timeouts y abortos PROPIOS (o de TCGCSV) no son de la fuente aunque suenen igual.
    for (const m of [
      'pokemontcg.io /cards -> HTTP 404',
      'Unique constraint failed',
      'tcgcsv.com -> HTTP 503 grupo 1',
      'Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms',
      'canceling statement due to lock timeout',
      'Timed out fetching a new connection from the connection pool',
      'The operation was aborted due to timeout',
      'fetch failed',
      'connect ETIMEDOUT 1.2.3.4',
      'tcgcsv.com /groups -> aborted',
    ]) expect([m, isSourceOutageMessage(m)]).toEqual([m, false]);
    expect(allFailuresFromSource([{ message: 'pokemontcg.io /cards -> HTTP 502' }, { message: 'pokemontcg.io /cards -> network: fetch failed' }])).toBe(true);
    expect(allFailuresFromSource([{ message: 'pokemontcg.io /cards -> HTTP 502' }, { message: 'Timed out fetching a new connection from the connection pool' }])).toBe(false);
    expect(allFailuresFromSource([{ message: 'pokemontcg.io /cards -> HTTP 502' }, { message: 'Unique constraint failed' }])).toBe(false);
    expect(allFailuresFromSource([])).toBe(false);
  });

  it('sweepDetail: cuenta de sets y causa externa; sin errores no dice nada', () => {
    expect(sweepDetail(null)).toBe('');
    expect(sweepDetail({ errors: 0 })).toBe('');
    const t = sweepDetail({ errors: 4, setsFailed: 4, setsTotal: 230, sourceDown: true });
    expect(t).toMatch(/fallaron 4 de 230 sets/);
    expect(t).toMatch(/pokemontcg\.io/);
    expect(t).toMatch(/No es un problema de tu tienda/);
    expect(sweepDetail({ errors: 1, setsFailed: 1, setsTotal: 5, sourceDown: false })).not.toMatch(/pokemontcg\.io/);
    // QA: si la segunda pasada se omitió por falta de tiempo, el texto NO dice que ocurrió.
    const omitted = sweepDetail({ errors: 2, setsFailed: 2, setsTotal: 9, sourceDown: true, retry: { skipped: true } });
    expect(omitted).toMatch(/no hubo tiempo para una segunda pasada/);
    expect(omitted).not.toMatch(/incluso despues de una segunda pasada/);
    expect(sweepDetail({ errors: 2, setsFailed: 2, setsTotal: 9, retry: { skipped: false } })).toMatch(/incluso despues de una segunda pasada/);
  });

  it('el correo del dueño lleva el detalle del último barrido; sigue saltando con fuente caída (48 h sin éxito)', async () => {
    const sent: { subject: string; text: string }[] = [];
    const state: Record<string, unknown> = {
      [CATALOG_AUTO_KEYS.lastSweep]: { errors: 3, setsFailed: 3, setsTotal: 200, sourceDown: true },
    };
    const st = {
      getLastSuccessAt: jest.fn(async () => '2026-11-11T01:10:00.000Z'),
      get: jest.fn(async (k: string) => state[k] ?? null),
      set: jest.fn(async (k: string, v: unknown) => void (state[k] = v)),
    };
    const svc = new CatalogStaleAlertService({} as never, st as never, { send: async (m: { subject: string; text: string }) => void sent.push(m) } as never);
    expect(await svc.check(new Date('2026-11-13T12:00:00.000Z'))).toBe('sent');
    expect(sent[0].text).toMatch(/fallaron 3 de 200 sets/);
    expect(sent[0].text).toMatch(/servicio externo pokemontcg\.io/);
    expect(sent[0].text).toMatch(/La tienda sigue funcionando/);
  });
});
