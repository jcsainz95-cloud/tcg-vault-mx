import { ConfigService } from '@nestjs/config';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import { FxRefreshJobService } from '../src/jobs/fx-refresh.service';
import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';
import { IneRetentionJobService } from '../src/jobs/ine-retention.service';
import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { DisputeDeadlineJobService } from '../src/jobs/dispute-deadline.service';
import { AuthTokenSweepJobService } from '../src/jobs/auth-token-sweep.service';
import { SetPriceSyncJobService } from '../src/jobs/set-price-sync.service';
import { SetValueSnapshotJobService } from '../src/jobs/set-value-snapshot.service';
import { CatalogPriceSyncJobService } from '../src/jobs/catalog-price-sync.service';
import { PriceIngestJobService } from '../src/jobs/price-ingest.service';

// BullMQ + ioredis mockeados: capturamos qué jobs se programan sin infra real (Redis).
const addMock = jest.fn().mockResolvedValue(undefined);
const queueCloseMock = jest.fn().mockResolvedValue(undefined);
const workerOnMock = jest.fn();
const workerCloseMock = jest.fn().mockResolvedValue(undefined);
let workerProcessor: ((job: { name: string }) => unknown) | undefined;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: addMock, close: queueCloseMock })),
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    workerProcessor = processor;
    return { on: workerOnMock, close: workerCloseMock };
  }),
}));

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ quit: jest.fn().mockResolvedValue(undefined) })),
}));

// Import DESPUÉS de los mocks para que el servicio use las clases mockeadas.
import { SchedulerService } from '../src/jobs/scheduler.service';

const jobs = {} as PriceSyncJobService;
const fx = {} as FxRefreshJobService;
const snap = {} as PortfolioSnapshotJobService;
const ine = { run: jest.fn().mockResolvedValue({ purged: 0, scanned: 0 }) } as unknown as IneRetentionJobService;
const sweep = { run: jest.fn().mockResolvedValue({ rejected: 0, abandoned: 0 }) } as unknown as BuylistSweepJobService;
const dispute = { run: jest.fn().mockResolvedValue({ expired: 0 }) } as unknown as DisputeDeadlineJobService;
const tokens = { run: jest.fn().mockResolvedValue({ deleted: 0 }) } as unknown as AuthTokenSweepJobService;
const setPrice = {
  run: jest.fn().mockResolvedValue({ setId: 's1', priced: 10, total: 10 }),
} as unknown as SetPriceSyncJobService;
const setSnap = {
  run: jest.fn().mockResolvedValue({ setId: 's1', totalValueMxnCents: 0, pricedCardCount: 0, totalCardCount: 0 }),
} as unknown as SetValueSnapshotJobService;
const catalogPrice = {
  run: jest.fn().mockResolvedValue({ jobId: 'catalog-sync-all-1', setsQueued: 0, remaining: 0 }),
} as unknown as CatalogPriceSyncJobService;
const priceIngest = {
  setQueue: jest.fn(),
  run: jest.fn().mockResolvedValue({ job: 'price-ingest', enqueued: true }),
  runChild: jest.fn().mockResolvedValue(undefined),
} as unknown as PriceIngestJobService;

function build(config: ConfigService) {
  return new SchedulerService(
    config, jobs, fx, snap, ine, sweep, dispute, tokens, setPrice, setSnap, catalogPrice, priceIngest,
  );
}

/**
 * BE-5 / v15-D1 — El scheduler BullMQ solo se activa con REDIS_URL. Sin él queda DESHABILITADO
 * y NO abre conexiones (así el arranque local/tests/CI sin infra no se rompe). Con REDIS_URL,
 * programa los 7 jobs diarios (3 de pricing + 4 de barrido) y los enruta en el worker.
 */
describe('SchedulerService — gating por REDIS_URL', () => {
  // ConfigService.get('REDIS_URL') cae a process.env, que en CI SÍ define REDIS_URL.
  // Lo removemos para que el caso "sin REDIS_URL" observe realmente su ausencia.
  let prevRedisUrl: string | undefined;
  beforeEach(() => {
    prevRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
  });
  afterEach(() => {
    if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
    else delete process.env.REDIS_URL;
  });

  it('sin REDIS_URL: onModuleInit es no-op y onModuleDestroy no falla', async () => {
    const config = new ConfigService({}); // sin REDIS_URL
    const svc = build(config);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe('SchedulerService — con REDIS_URL programa los jobs diarios + catalog-price-sync 2×/día', () => {
  beforeEach(() => {
    addMock.mockClear();
    workerProcessor = undefined;
  });

  it('programa fx/price/snapshot + los 4 barridos con su cron, y los enruta en el worker', async () => {
    const config = new ConfigService({ REDIS_URL: 'redis://localhost:6379' });
    const svc = build(config);
    await svc.onModuleInit();

    const scheduled = addMock.mock.calls.map((c) => ({ name: c[0], pattern: c[2]?.repeat?.pattern }));
    const byName = Object.fromEntries(scheduled.map((s) => [s.name, s.pattern]));
    expect(byName).toEqual({
      'fx-refresh': '0 6 * * *',
      'price-sync': '15 6 * * *',
      // v1.9-set-chart: orden duro FX → set-price-sync (30 6) → set-value-snapshot (15 7).
      'set-price-sync': '30 6 * * *',
      'portfolio-snapshot': '0 7 * * *',
      'set-value-snapshot': '15 7 * * *',
      'ine-retention': '30 7 * * *',
      'dispute-deadline': '45 7 * * *',
      'buylist-sweep': '0 8 * * *',
      'auth-token-sweep': '15 8 * * *',
      // v1.12-catalog-pricing: re-sync completo 2×/día (00:00 y 12:00 UTC = 06:00/18:00 CDMX).
      'catalog-price-sync-1': '0 0 * * *',
      'catalog-price-sync-2': '0 12 * * *',
    });

    // El worker enruta cada barrido a su servicio (single-flight vía jobId + removeOnComplete).
    expect(workerProcessor).toBeDefined();
    await workerProcessor!({ name: 'ine-retention' });
    await workerProcessor!({ name: 'buylist-sweep' });
    await workerProcessor!({ name: 'dispute-deadline' });
    await workerProcessor!({ name: 'auth-token-sweep' });
    await workerProcessor!({ name: 'set-price-sync' });
    await workerProcessor!({ name: 'set-value-snapshot' });
    await workerProcessor!({ name: 'catalog-price-sync-1' });
    await workerProcessor!({ name: 'catalog-price-sync-2' });
    expect(ine.run).toHaveBeenCalled();
    expect(sweep.run).toHaveBeenCalled();
    expect(dispute.run).toHaveBeenCalled();
    expect(tokens.run).toHaveBeenCalled();
    expect(setPrice.run).toHaveBeenCalled();
    expect(setSnap.run).toHaveBeenCalled();
    // Ambos repeatables (AM/PM) enrutan al mismo job de re-sync completo.
    expect(catalogPrice.run).toHaveBeenCalledTimes(2);

    // WS-A (v1.14-price-ingest): la cola se ENTREGA al ingest para el fan-out por set, y el worker
    // enruta el parent (`price-ingest` → run) y el child (`price-ingest-set` → runChild).
    expect(priceIngest.setQueue).toHaveBeenCalled();
    await workerProcessor!({ name: 'price-ingest' });
    await workerProcessor!({ name: 'price-ingest-set', data: { setId: 's1', fx: { rate: 18, bufferPct: 0 } } } as any);
    expect(priceIngest.run).toHaveBeenCalled();
    expect(priceIngest.runChild).toHaveBeenCalledWith({ setId: 's1', fx: { rate: 18, bufferPct: 0 } });

    // Por defecto (sin PRICE_INGEST_CRON_*) el ingest NO se auto-programa (rollout money-safe).
    const scheduledNames = addMock.mock.calls.map((c) => c[0]);
    expect(scheduledNames).not.toContain('price-ingest-1');
    expect(scheduledNames).not.toContain('price-ingest-2');

    await svc.onModuleDestroy();
  });

  it('programa price-ingest 2×/día SOLO si devops fija PRICE_INGEST_CRON_1/_2 (opt-in)', async () => {
    const config = new ConfigService({
      REDIS_URL: 'redis://localhost:6379',
      PRICE_INGEST_CRON_1: '0 3 * * *',
      PRICE_INGEST_CRON_2: '0 15 * * *',
    });
    const svc = build(config);
    await svc.onModuleInit();

    const byName = Object.fromEntries(addMock.mock.calls.map((c) => [c[0], c[2]?.repeat?.pattern]));
    expect(byName['price-ingest-1']).toBe('0 3 * * *');
    expect(byName['price-ingest-2']).toBe('0 15 * * *');

    await svc.onModuleDestroy();
  });
});
