/**
 * wishlist.scheduler.spec.ts — rev v1.87⟨wishlist⟩ WSH-T24 (unit, criterio 823; D-WSH-1): el planificador REGISTRA
 * `wishlist-notify` y `sealed-restock-notify` (cada 5 min por defecto, sufijo `-cron`; crons por env
 * `WISHLIST_NOTIFY_CRON` / `SEALED_RESTOCK_NOTIFY_CRON`) y `process()` los enruta a `run()`. BullMQ e ioredis MOCKEADOS
 * (patrón de `sdx-c1.scheduler.spec.ts`). Que la app REAL los inyecte lo asevera `test/integration/wishlist-notify.e2e-spec.ts`.
 */
import { ConfigService } from '@nestjs/config';

const addMock = jest.fn().mockResolvedValue(undefined);
let workerProcessor: ((job: { name: string; data?: unknown }) => unknown) | undefined;

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: addMock,
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    removeRepeatable: jest.fn().mockResolvedValue(true),
  })),
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => {
    workerProcessor = processor;
    return { on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
  }),
}));
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ on: jest.fn(), quit: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn(), status: 'ready' })),
}));

import { SchedulerService } from '../src/jobs/scheduler.service';

beforeAll(() => {
  process.env.E2E_ENABLE_SCHEDULER = 'true';
});
afterAll(() => {
  delete process.env.E2E_ENABLE_SCHEDULER;
});

const stub = () => ({ run: jest.fn().mockResolvedValue({}) }) as never;
const priceIngest = {
  setQueue: jest.fn(),
  run: jest.fn().mockResolvedValue({}),
  runChild: jest.fn(),
  catchUpIfStale: jest.fn().mockResolvedValue({ enqueued: false }),
} as never;
const catalog = { run: jest.fn(), runMetadataImport: jest.fn() } as never;

function build(env: Record<string, string>) {
  const wishlist = { run: jest.fn().mockResolvedValue({ job: 'wishlist-notify', enqueued: true }) };
  const restock = { run: jest.fn().mockResolvedValue({ job: 'sealed-restock-notify', enqueued: true }) };
  const svc = new SchedulerService(
    new ConfigService({ REDIS_URL: 'redis://localhost:6379', ...env }),
    stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), catalog, priceIngest, stub(), stub(), stub(),
    stub(), stub(), stub(), stub(), stub(),
    wishlist as never, restock as never,
  );
  return { svc, wishlist, restock };
}

const byName = () =>
  Object.fromEntries(addMock.mock.calls.map((c) => [c[0], { repeat: c[2]?.repeat, jobId: c[2]?.jobId }]));

describe('WSH-T24 (unit) — `wishlist-notify` y `sealed-restock-notify` en el planificador', () => {
  beforeEach(() => {
    addMock.mockClear();
    workerProcessor = undefined;
  });

  it('defaults: los dos cada 5 min con sufijo `-cron`', async () => {
    const { svc } = build({});
    await svc.onModuleInit();
    await svc.setupDone;
    const by = byName();
    expect(by['wishlist-notify']).toEqual({ repeat: { pattern: '*/5 * * * *' }, jobId: 'wishlist-notify-cron' });
    expect(by['sealed-restock-notify']).toEqual({ repeat: { pattern: '*/5 * * * *' }, jobId: 'sealed-restock-notify-cron' });
    await svc.onModuleDestroy();
  });

  it('los crons salen de las env', async () => {
    const { svc } = build({ WISHLIST_NOTIFY_CRON: '*/7 * * * *', SEALED_RESTOCK_NOTIFY_CRON: '*/9 * * * *' });
    await svc.onModuleInit();
    await svc.setupDone;
    const by = byName();
    expect(by['wishlist-notify'].repeat).toEqual({ pattern: '*/7 * * * *' });
    expect(by['sealed-restock-notify'].repeat).toEqual({ pattern: '*/9 * * * *' });
    await svc.onModuleDestroy();
  });

  it('el worker enruta cada nombre a su `run()`', async () => {
    const { svc, wishlist, restock } = build({});
    await svc.onModuleInit();
    await svc.setupDone;
    await workerProcessor!({ name: 'wishlist-notify' });
    expect(wishlist.run).toHaveBeenCalledTimes(1);
    expect(restock.run).not.toHaveBeenCalled();
    await workerProcessor!({ name: 'sealed-restock-notify' });
    expect(restock.run).toHaveBeenCalledTimes(1);
    await svc.onModuleDestroy();
  });

  it('`process()` directo (el camino que usa la e2e con el AppModule real) enruta igual', async () => {
    const { svc, wishlist, restock } = build({});
    await svc.process({ name: 'wishlist-notify' });
    await svc.process({ name: 'sealed-restock-notify' });
    expect(wishlist.run).toHaveBeenCalledTimes(1);
    expect(restock.run).toHaveBeenCalledTimes(1);
  });
});
