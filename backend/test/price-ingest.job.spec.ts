import { PriceIngestJobService, PRICE_INGEST_SET_JOB } from '../src/jobs/price-ingest.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PriceIngestService } from '../src/modules/pricing/price-ingest.service';

/**
 * WS-A (v1.14-price-ingest, §4.15c) — PriceIngestJobService (orquestación):
 *  - CON cola (Redis): fan-out por set (un `price-ingest-set` por set), FX una vez por corrida;
 *  - SIN cola: secuencial AWAITED (nunca fire-and-forget), single-flight;
 *  - `setId` → ingesta un solo set (verificación de esquema), AWAITED.
 */

const fxCur = { rate: 18, bufferPct: 3, source: 'manual', effectiveDate: '2026-08-17' };

function build() {
  const fx = { getCurrent: jest.fn(async () => fxCur) } as unknown as FxService;
  const ingest = {
    listLocalSetIds: jest.fn(async () => ['s1', 's2']),
    ingestSet: jest.fn(async () => ({})),
    ingestSetByExternalId: jest.fn(async () => ({})),
    ingestAll: jest.fn(async () => ({ sets: 2, priced: 4 })),
  } as unknown as PriceIngestService;
  const job = new PriceIngestJobService(fx, ingest);
  return { job, fx, ingest };
}

describe('PriceIngestJobService.run — CON cola: fan-out por set + FX una vez', () => {
  it('encola un price-ingest-set por set, con el MISMO snapshot de FX en cada child', async () => {
    const { job, fx } = build();
    const add = jest.fn().mockResolvedValue({});
    job.setQueue({ add } as any);

    const res = await job.run();

    // FX una sola vez por corrida (snapshot compartido).
    expect((fx.getCurrent as jest.Mock)).toHaveBeenCalledTimes(1);
    // Un job por set.
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.map((c) => c[0])).toEqual([PRICE_INGEST_SET_JOB, PRICE_INGEST_SET_JOB]);
    const datas = add.mock.calls.map((c) => c[1]);
    expect(datas).toEqual([
      { setId: 's1', fx: { rate: 18, bufferPct: 3 } },
      { setId: 's2', fx: { rate: 18, bufferPct: 3 } },
    ]);
    // Mismo snapshot de FX en todos los children (FX una vez, no por set).
    expect(datas[0].fx).toEqual(datas[1].fx);
    // jobId determinista por día (single-flight vía dedup de BullMQ) en las opciones del child.
    const opts = add.mock.calls.map((c) => c[2]);
    expect(opts[0].jobId).toMatch(/^price-ingest-set-s1-\d{4}-\d{2}-\d{2}$/);
    expect(opts[0]).toMatchObject({ attempts: 3 });
    expect(res).toMatchObject({ job: 'price-ingest', enqueued: true });
    expect(res.jobId).toMatch(/^price-ingest-\d{4}-\d{2}-\d{2}$/);
  });
});

describe('PriceIngestJobService.run — SIN cola: secuencial AWAITED + single-flight', () => {
  it('corre ingestAll AWAITED con el snapshot de FX (nunca fire-and-forget)', async () => {
    const { job, ingest } = build();
    job.setQueue(undefined);

    const res = await job.run();

    expect((ingest.ingestAll as jest.Mock)).toHaveBeenCalledWith({ rate: 18, bufferPct: 3 });
    expect(res).toEqual({ job: 'price-ingest', enqueued: true });
  });

  it('single-flight: si ya hay una corrida en curso → enqueued:false y NO relanza', async () => {
    const { job, ingest } = build();
    job.setQueue(undefined);
    (job as any).running = true; // simula corrida en curso

    const res = await job.run();

    expect(res).toEqual({ job: 'price-ingest', enqueued: false });
    expect((ingest.ingestAll as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('PriceIngestJobService — setId (verificación de esquema) y runChild', () => {
  it('run(setId) ingesta SOLO ese set AWAITED y reporta scope:set', async () => {
    const { job, ingest } = build();
    job.setQueue({ add: jest.fn() } as any); // aún con cola, setId corre inline

    const res = await job.run('sv8');

    expect((ingest.ingestSetByExternalId as jest.Mock)).toHaveBeenCalledWith('sv8', { rate: 18, bufferPct: 3 });
    expect(res).toEqual({ job: 'price-ingest', enqueued: true, scope: 'set', setId: 'sv8' });
  });

  it('runChild ingesta el set del job.data con su snapshot de FX', async () => {
    const { job, ingest } = build();
    await job.runChild({ setId: 's1', fx: { rate: 18, bufferPct: 3 } });
    expect((ingest.ingestSet as jest.Mock)).toHaveBeenCalledWith('s1', { rate: 18, bufferPct: 3 });
  });
});
