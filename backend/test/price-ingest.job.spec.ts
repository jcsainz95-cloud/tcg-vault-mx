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

function build(hasRecentIngest = true) {
  const fx = { getCurrent: jest.fn(async () => fxCur) } as unknown as FxService;
  const ingest = {
    // WS-A fix-ppt: el fan-out ahora encola los sets EN SCOPE (listSetIdsForIngest), no todos.
    listSetIdsForIngest: jest.fn(async () => ['s1', 's2']),
    listLocalSetIds: jest.fn(async () => ['s1', 's2']),
    ingestSet: jest.fn(async () => ({})),
    ingestSetByExternalId: jest.fn(async () => ({})),
    ingestAll: jest.fn(async () => ({ sets: 2, priced: 4, pending: 0, dailyLimited: false })),
    // v1.50.2 (§4.38h): el gancho corre APARTE del barrido por set. Se mockea aquí porque las TRES
    // vías de disparo del barrido completo (cron con cola, cron sin cola y el botón N-11) lo llaman.
    ingestGradedEstimates: jest.fn(async () => ({ sets: 1, written: 2, escalation: null })),
    hasRecentIngest: jest.fn(async () => hasRecentIngest),
    // N-11: single-flight del disparo en background lo da el estado en memoria.
    getSyncStatus: jest.fn(() => ({ running: false })),
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

describe('PriceIngestJobService.runBackground — N-11 (fire-and-forget + single-flight)', () => {
  it('lanza ingestAll en background y DEVUELVE de inmediato (no espera al barrido)', async () => {
    const { job, ingest, fx } = build();
    let resolveIngest: () => void = () => undefined;
    (ingest.ingestAll as jest.Mock).mockImplementation(
      () => new Promise<void>((r) => { resolveIngest = () => r(); }),
    );

    const res = await job.runBackground(); // NO debe colgarse esperando ingestAll

    expect(res).toEqual({ job: 'price-ingest', enqueued: true, background: true, alreadyRunning: false });
    expect((fx.getCurrent as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((ingest.ingestAll as jest.Mock)).toHaveBeenCalledWith({ rate: 18, bufferPct: 3 });
    resolveIngest(); // limpia la promesa colgante
  });

  it('single-flight: si ya hay un barrido corriendo → no lanza otro', async () => {
    const { job, ingest } = build();
    (ingest.getSyncStatus as jest.Mock).mockReturnValue({ running: true });

    const res = await job.runBackground();

    expect(res).toEqual({ job: 'price-ingest', enqueued: false, background: true, alreadyRunning: true });
    expect((ingest.ingestAll as jest.Mock)).not.toHaveBeenCalled();
    // Ni el barrido ni el gancho: si NO se lanzó nada, no se refresca nada.
    expect((ingest.ingestGradedEstimates as jest.Mock)).not.toHaveBeenCalled();
  });

  /**
   * v1.50.2 fix (QA) — **el «sincronizar ahora» del admin TAMBIÉN refresca los estimados PSA.**
   *
   * `run()` (el cron) llamaba a `runGradedEstimates` en sus dos ramas; `runBackground()` —que es el
   * ÚNICO disparo manual del barrido completo, el botón de N-11— NO. El operador veía la barra llegar
   * al 100%, concluía que había refrescado todo, y los estimados seguían congelados hasta el cron.
   */
  it('refresca TAMBIÉN los estimados PSA tras el barrido (el botón N-11 no puede mentir)', async () => {
    const { job, ingest } = build();

    await job.runBackground();
    await new Promise((r) => setImmediate(r)); // el encadenado es fire-and-forget: se deja drenar

    expect((ingest.ingestAll as jest.Mock)).toHaveBeenCalledWith({ rate: 18, bufferPct: 3 });
    expect((ingest.ingestGradedEstimates as jest.Mock)).toHaveBeenCalledWith({ rate: 18, bufferPct: 3 });
    // ORDEN: el gancho va DESPUÉS. Su gate compara contra el precio de venta raw, que lo fija el
    // barrido; y correr los dos a la vez duplicaría la presión sobre la cuota del proveedor.
    const barrido = (ingest.ingestAll as jest.Mock).mock.invocationCallOrder[0];
    const gancho = (ingest.ingestGradedEstimates as jest.Mock).mock.invocationCallOrder[0];
    expect(gancho).toBeGreaterThan(barrido);
  });

  it('si el barrido de venta FALLA, el gancho se refresca igual (la dependencia va en un sentido)', async () => {
    const { job, ingest } = build();
    (ingest.ingestAll as jest.Mock).mockRejectedValue(new Error('PPT caído'));

    await job.runBackground();
    await new Promise((r) => setImmediate(r));

    // Un fallo del barrido no es razón para dejar los estimados rancios, ni para tumbar el request.
    expect((ingest.ingestGradedEstimates as jest.Mock)).toHaveBeenCalled();
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

/**
 * Auditoría de precios (2026-08-17) — catch-up al boot: con scheduler habilitado y SIN ingesta
 * reciente (hoy/ayer), se encola un `price-ingest` inmediato con jobId dedup por día, para que
 * los precios se pueblen solos tras cada deploy aunque el cron se haya perdido.
 */
describe('PriceIngestJobService.catchUpIfStale — catch-up al boot', () => {
  it('sin cola (local/CI sin Redis) → no-op (NO lanza el ingest secuencial pesado al boot)', async () => {
    const { job, ingest } = build(false);
    job.setQueue(undefined);

    const res = await job.catchUpIfStale();

    expect(res).toEqual({ enqueued: false, reason: 'no-queue' });
    expect((ingest.hasRecentIngest as jest.Mock)).not.toHaveBeenCalled();
    expect((ingest.ingestAll as jest.Mock)).not.toHaveBeenCalled();
  });

  it('con ingesta reciente (hoy/ayer) → NO encola nada', async () => {
    const { job } = build(true);
    const add = jest.fn().mockResolvedValue({});
    job.setQueue({ add } as any);

    const res = await job.catchUpIfStale();

    expect(res).toEqual({ enqueued: false, reason: 'recent' });
    expect(add).not.toHaveBeenCalled();
  });

  it('SIN ingesta reciente → encola un price-ingest inmediato con jobId dedup por día', async () => {
    const { job } = build(false);
    const add = jest.fn().mockResolvedValue({});
    job.setQueue({ add } as any);

    const res = await job.catchUpIfStale();

    expect(res).toEqual({ enqueued: true, reason: 'stale' });
    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = add.mock.calls[0];
    expect(name).toBe('price-ingest'); // el worker ya enruta este case → run() (fan-out)
    expect(data).toEqual({});
    // Dedup: dos reinicios el mismo día NO duplican el catch-up (mismo jobId vigente).
    expect(opts.jobId).toMatch(/^price-ingest-catchup-\d{4}-\d{2}-\d{2}$/);
    expect(opts).toMatchObject({ removeOnComplete: true });
  });
});
