import { TcgcsvCallBudget, BudgetExhaustedError, CircuitOpenError, DeadlineError } from '../src/modules/catalog/tcgcsv-call-budget';
import { backoffDays, autoLinkEnabled } from '../src/modules/catalog/catalog-auto-link.service';
import { PriceIngestJobService } from '../src/jobs/price-ingest.service';
import { isNotInProviderSet, untryableReason, nextAutoLinkRun, countsInUnlinkedCards } from '../src/modules/catalog/auto-link-stats';
import { SETTING_DEFAULTS, SettingKey } from '../src/modules/settings/settings.constants';

/** §AUTO-ENLACE fase 2 — unidades: presupuesto de llamadas, espera 1/3/7, dial, guardia de price-ingest, motivos fijos. */
describe('TcgcsvCallBudget (tope, reintento, disyuntor, plazo)', () => {
  const mk = (o: Partial<ConstructorParameters<typeof TcgcsvCallBudget>[0]> = {}) => new TcgcsvCallBudget({ max: 40, retryDelayMs: 0, sleep: async () => undefined, ...o });

  it('cuenta cada llamada; el tope corta la siguiente', async () => {
    const b = mk({ max: 2 });
    await b.call(async () => 1);
    await b.call(async () => 2);
    expect(b.used).toBe(2);
    await expect(b.call(async () => 3)).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(b.used).toBe(2);
  });

  it('1 reintento por llamada: el segundo intento también cuenta; si sale, no es fallo', async () => {
    const b = mk();
    const fn = jest.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce('ok');
    expect(await b.call(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(b.used).toBe(2);
    expect(b.consecutiveFailures).toBe(0);
  });

  it('disyuntor: 3 llamadas fallidas SEGUIDAS (cada una ya reintentada) ⇒ la 4.ª ni se intenta', async () => {
    const b = mk();
    const bad = jest.fn().mockRejectedValue(new Error('503'));
    for (let i = 0; i < 3; i++) await expect(b.call(bad)).rejects.toThrow('503');
    expect(bad).toHaveBeenCalledTimes(6);
    expect(b.tripped).toBe(true);
    await expect(b.call(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(bad).toHaveBeenCalledTimes(6);
  });

  it('un éxito reinicia la racha del disyuntor', async () => {
    const b = mk();
    const bad = jest.fn().mockRejectedValue(new Error('x'));
    await expect(b.call(bad)).rejects.toThrow();
    await expect(b.call(bad)).rejects.toThrow();
    await b.call(async () => 1);
    expect(b.consecutiveFailures).toBe(0);
    await expect(b.call(bad)).rejects.toThrow();
    expect(b.tripped).toBe(false);
  });

  it('plazo de 30 min: pasado el plazo, ninguna llamada más', async () => {
    let t = 0;
    const b = mk({ deadlineAt: 1000, now: () => t });
    await b.call(async () => 1);
    t = 1000;
    await expect(b.call(async () => 1)).rejects.toBeInstanceOf(DeadlineError);
  });

  it('el reintento no rebasa el tope', async () => {
    const b = mk({ max: 1 });
    await expect(b.call(async () => { throw new Error('503'); })).rejects.toThrow('503');
    expect(b.used).toBe(1);
  });
});

describe('espera sin progreso y dial', () => {
  it('1, 3, 7, 7… días', () => {
    expect([0, 1, 2, 3, 10].map(backoffDays)).toEqual([1, 3, 7, 7, 7]);
  });
  it('el dial nace ENCENDIDO (dueño 2026-11-27: «La reparación automática prendida»), se apaga con off y falla cerrado', async () => {
    expect(SETTING_DEFAULTS[SettingKey.AUTO_LINK_ENABLED]).toBe('on');
    expect(await autoLinkEnabled({ getString: async () => 'on' })).toBe(true);
    expect(await autoLinkEnabled({ getString: async () => 'off' })).toBe(false);
    expect(await autoLinkEnabled({ getString: async () => { throw new Error('db'); } })).toBe(false);
    expect(await autoLinkEnabled(undefined)).toBe(false);
  });
});

describe('motivos fijos sin llamar a nadie', () => {
  it('promos viejas ⇒ promo_route; tcgcsv: ⇒ tcgcsv_source; Futsal ⇒ not_in_provider (no cuenta); resto ⇒ reparable', () => {
    expect(untryableReason({ name: 'Dark Prism', externalId: 'dpp' })).toBe('promo_route');
    expect(untryableReason({ name: 'X', externalId: 'tcgcsv:123' })).toBe('tcgcsv_source');
    expect(untryableReason({ name: 'Pokémon Futsal Collection', externalId: 'fut20' })).toBe('not_in_provider');
    expect(isNotInProviderSet('Futsal Promos')).toBe(true);
    expect(isNotInProviderSet('Gym Heroes')).toBe(false);
    expect(untryableReason({ name: 'Gym Heroes', externalId: 'gym1' })).toBeNull();
    expect(countsInUnlinkedCards({ name: 'Futsal Promos', externalId: 'fut20' })).toBe(false);
    expect(countsInUnlinkedCards({ name: 'Dark Prism', externalId: 'dpp' })).toBe(true);
  });
  it('próxima corrida = 05:00 UTC', () => {
    expect(nextAutoLinkRun(new Date('2026-11-27T04:59:00Z')).toISOString()).toBe('2026-11-27T05:00:00.000Z');
    expect(nextAutoLinkRun(new Date('2026-11-27T05:00:00Z')).toISOString()).toBe('2026-11-28T05:00:00.000Z');
  });
});

describe('price-ingest se salta si catalog-auto-link tiene el candado compartido', () => {
  const build = (held: boolean) => {
    const fx = { getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 3 })) };
    const ingest = { ingestAll: jest.fn(async () => ({})), ingestStamped: jest.fn(), ingestGradedEstimates: jest.fn(async () => ({})), listSetIdsForIngest: jest.fn(async () => []) };
    // `$transaction(cb)` ejecuta cb con un tx cuyo `$queryRaw` dice si pudo tomar el candado compartido (ok=true ⇒ libre).
    const prisma = { $transaction: async (cb: (tx: unknown) => unknown) => cb({ $queryRaw: async () => [{ ok: !held }] }) };
    const job = new PriceIngestJobService(fx as never, ingest as never, prisma as never);
    return { job, ingest };
  };
  it('candado tomado ⇒ no barre (enqueued=false)', async () => {
    const { job, ingest } = build(true);
    expect(await job.run()).toEqual({ job: 'price-ingest', enqueued: false });
    expect(ingest.ingestAll).not.toHaveBeenCalled();
  });
  it('candado libre ⇒ barre como siempre', async () => {
    const { job, ingest } = build(false);
    expect((await job.run()).enqueued).toBe(true);
    expect(ingest.ingestAll).toHaveBeenCalled();
  });
});
