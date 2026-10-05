/**
 * sdx-d2d.scheduler.spec.ts — ⭐ D2d: los tres jobs de Skydropx en el planificador (API_CONTRACT §M4-SHIP.19.10: cola
 * `tcg-daily`, crons por env con su default) y su enrutado en el worker. BullMQ e ioredis MOCKEADOS (sin infra). Propiedad:
 * backend. ⚠️ `test/scheduler.spec.ts` (fuera de la columna D2d, §19.32.9) construye el planificador SIN estos tres
 * servicios: ahí no se programan (y se loguea `error`); aquí, con ellos, sí. Que la app real los inyecte lo asevera
 * `test/integration/sdx-d2d-charges.e2e-spec.ts` («cableado») con el AppModule entero.
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

const stub = (extra: Record<string, unknown> = {}) => ({ run: jest.fn().mockResolvedValue({}), ...extra }) as never;
const priceIngest = {
  setQueue: jest.fn(),
  run: jest.fn().mockResolvedValue({}),
  runChild: jest.fn(),
  catchUpIfStale: jest.fn().mockResolvedValue({ enqueued: false }),
} as never;
const catalog = { run: jest.fn(), runMetadataImport: jest.fn() } as never;

function build(env: Record<string, string>, withShipments = true) {
  const poll = { run: jest.fn().mockResolvedValue({ polled: 0 }) };
  const proc = { run: jest.fn().mockResolvedValue({ processing: {} }) };
  const charges = { run: jest.fn().mockResolvedValue({ seen: 0 }) };
  const svc = new SchedulerService(
    new ConfigService({ REDIS_URL: 'redis://localhost:6379', ...env }),
    stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), catalog, priceIngest, stub(), stub(), stub(),
    ...((withShipments ? [poll, proc, charges] : []) as never[]),
  );
  return { svc, poll, proc, charges };
}

describe('⭐ D2d — los jobs de Skydropx en el planificador (§19.10)', () => {
  beforeEach(() => {
    addMock.mockClear();
    workerProcessor = undefined;
  });

  it('defaults: tracking `*/10 * * * *`, label-processing `* * * * *`, extra-charges `30 8 * * *`; enrutados a su servicio', async () => {
    const { svc, poll, proc, charges } = build({});
    await svc.onModuleInit();
    await svc.setupDone;
    const by = Object.fromEntries(addMock.mock.calls.map((c) => [c[0], { pattern: c[2]?.repeat?.pattern, jobId: c[2]?.jobId }]));
    expect(by['shipment-tracking-poll']).toEqual({ pattern: '*/10 * * * *', jobId: 'shipment-tracking-poll-cron' });
    expect(by['shipment-label-processing']).toEqual({ pattern: '* * * * *', jobId: 'shipment-label-processing-cron' });
    expect(by['shipment-extra-charges']).toEqual({ pattern: '30 8 * * *', jobId: 'shipment-extra-charges-daily' });
    await workerProcessor!({ name: 'shipment-tracking-poll' });
    await workerProcessor!({ name: 'shipment-label-processing' });
    await workerProcessor!({ name: 'shipment-extra-charges' });
    expect(poll.run).toHaveBeenCalledTimes(1);
    expect(poll.run).toHaveBeenCalledWith(); // el cron corre el LOTE (sin `shipmentId`)
    expect(proc.run).toHaveBeenCalledTimes(1);
    expect(charges.run).toHaveBeenCalledTimes(1);
    await svc.onModuleDestroy();
  });

  it('los crons salen de las env (devops ajusta sin redeploy)', async () => {
    const { svc } = build({ SHIPMENT_TRACKING_POLL_CRON: '*/5 * * * *', SHIPMENT_LABEL_PROCESSING_CRON: '*/2 * * * *', SHIPMENT_EXTRA_CHARGES_CRON: '0 9 * * *' });
    await svc.onModuleInit();
    await svc.setupDone;
    const by = Object.fromEntries(addMock.mock.calls.map((c) => [c[0], c[2]?.repeat?.pattern]));
    expect([by['shipment-tracking-poll'], by['shipment-label-processing'], by['shipment-extra-charges']]).toEqual(['*/5 * * * *', '*/2 * * * *', '0 9 * * *']);
    await svc.onModuleDestroy();
  });

  it('sin los servicios inyectados (la construcción a mano de `scheduler.spec.ts`) ⇒ no se programan y el worker no revienta', async () => {
    const { svc } = build({}, false);
    await svc.onModuleInit();
    await svc.setupDone;
    expect(addMock.mock.calls.map((c) => c[0])).not.toContain('shipment-tracking-poll');
    await expect(Promise.resolve(workerProcessor!({ name: 'shipment-label-processing' }))).resolves.toBeNull();
    await svc.onModuleDestroy();
  });
});
