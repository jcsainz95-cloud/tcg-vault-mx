import { ConfigService } from '@nestjs/config';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import { FxRefreshJobService } from '../src/jobs/fx-refresh.service';
import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';
import { IneRetentionJobService } from '../src/jobs/ine-retention.service';
import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { DisputeDeadlineJobService } from '../src/jobs/dispute-deadline.service';
import { AuthTokenSweepJobService } from '../src/jobs/auth-token-sweep.service';

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

function build(config: ConfigService) {
  return new SchedulerService(config, jobs, fx, snap, ine, sweep, dispute, tokens);
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

describe('SchedulerService — con REDIS_URL programa los 7 jobs diarios', () => {
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
      'portfolio-snapshot': '0 7 * * *',
      'ine-retention': '30 7 * * *',
      'dispute-deadline': '45 7 * * *',
      'buylist-sweep': '0 8 * * *',
      'auth-token-sweep': '15 8 * * *',
    });

    // El worker enruta cada barrido a su servicio (single-flight vía jobId + removeOnComplete).
    expect(workerProcessor).toBeDefined();
    await workerProcessor!({ name: 'ine-retention' });
    await workerProcessor!({ name: 'buylist-sweep' });
    await workerProcessor!({ name: 'dispute-deadline' });
    await workerProcessor!({ name: 'auth-token-sweep' });
    expect(ine.run).toHaveBeenCalled();
    expect(sweep.run).toHaveBeenCalled();
    expect(dispute.run).toHaveBeenCalled();
    expect(tokens.run).toHaveBeenCalled();

    await svc.onModuleDestroy();
  });
});
