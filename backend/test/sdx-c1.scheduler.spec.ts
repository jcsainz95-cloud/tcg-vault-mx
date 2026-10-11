/**
 * sdx-c1.scheduler.spec.ts — 💰 C1 (API_CONTRACT §M4-SHIP.19.33.9, PS-172 (a)): los dos jobs de D2g en el planificador.
 * `spend-watch` cada 5 min (`SPEND_WATCH_CRON`) y `spend-digest` a las 08:00 de México (`SPEND_DIGEST_CRON` +
 * `tz: 'America/Mexico_City'`; la BullMQ instalada, 5.81.3, pasa `tz` a cron-parser 4.9.0 — medido en BACKEND_NOTES §66),
 * enrutados a `SpendWatchService.run()` y `SpendDigestService.run({})`. Sin los servicios ⇒ no se programan y se loguea
 * `error` (el patrón `@Optional()` de D2d). BullMQ e ioredis MOCKEADOS (sin infra). Propiedad: backend.
 * Que la app real los inyecte lo asevera `test/integration/sdx-c1-jobs.e2e-spec.ts` (PS-172 (c)).
 */
import { Logger } from '@nestjs/common';
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

function build(env: Record<string, string>, withSpend = true) {
  const watch = { run: jest.fn().mockResolvedValue({ owner: {} }) };
  const digest = { run: jest.fn().mockResolvedValue({ day: '2026-10-04', status: 'empty', alertCount: 0 }) };
  const svc = new SchedulerService(
    new ConfigService({ REDIS_URL: 'redis://localhost:6379', ...env }),
    stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), catalog, priceIngest, stub(), stub(), stub(),
    stub(), stub(), stub(),
    ...((withSpend ? [watch, digest] : []) as never[]),
  );
  return { svc, watch, digest };
}

const byName = () =>
  Object.fromEntries(addMock.mock.calls.map((c) => [c[0], { repeat: c[2]?.repeat, jobId: c[2]?.jobId }]));

describe('PS-172 (a) — `spend-watch` y `spend-digest` en el planificador (§19.33.9 C1)', () => {
  beforeEach(() => {
    addMock.mockClear();
    workerProcessor = undefined;
  });

  it('defaults: `spend-watch` `*/5 * * * *`; `spend-digest` `0 8 * * *` con `tz: America/Mexico_City`', async () => {
    const { svc } = build({});
    await svc.onModuleInit();
    await svc.setupDone;
    const by = byName();
    expect(by['spend-watch']).toEqual({ repeat: { pattern: '*/5 * * * *' }, jobId: 'spend-watch-cron' });
    expect(by['spend-digest']).toEqual({ repeat: { pattern: '0 8 * * *', tz: 'America/Mexico_City' }, jobId: 'spend-digest-daily' });
    await svc.onModuleDestroy();
  });

  it('los crons salen de las env (devops ajusta sin redeploy); el de resumen conserva la zona de México', async () => {
    const { svc } = build({ SPEND_WATCH_CRON: '*/7 * * * *', SPEND_DIGEST_CRON: '30 9 * * *' });
    await svc.onModuleInit();
    await svc.setupDone;
    const by = byName();
    expect(by['spend-watch'].repeat).toEqual({ pattern: '*/7 * * * *' });
    expect(by['spend-digest'].repeat).toEqual({ pattern: '30 9 * * *', tz: 'America/Mexico_City' });
    await svc.onModuleDestroy();
  });

  it('el worker enruta `spend-watch` ⇒ `SpendWatchService.run()` y `spend-digest` ⇒ `SpendDigestService.run({})`', async () => {
    const { svc, watch, digest } = build({});
    await svc.onModuleInit();
    await svc.setupDone;
    await workerProcessor!({ name: 'spend-watch' });
    expect(watch.run).toHaveBeenCalledTimes(1);
    expect(watch.run).toHaveBeenCalledWith(); // el reloj del módulo pone `now`
    expect(digest.run).not.toHaveBeenCalled();
    await workerProcessor!({ name: 'spend-digest' });
    expect(digest.run).toHaveBeenCalledTimes(1);
    expect(digest.run).toHaveBeenCalledWith({}); // `day` = ayer en México, lo decide el servicio
    expect(watch.run).toHaveBeenCalledTimes(1);
    await svc.onModuleDestroy();
  });

  it('sin los servicios ⇒ no se programan, se loguea `error` y el worker no revienta (devuelve null)', async () => {
    const errors: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      errors.push(String(m));
    });
    try {
      const { svc } = build({}, false);
      await svc.onModuleInit();
      await svc.setupDone;
      const names = addMock.mock.calls.map((c) => c[0]);
      expect(names).not.toContain('spend-watch');
      expect(names).not.toContain('spend-digest');
      expect(errors.some((e) => e.includes('spend-watch') && e.includes('spend-digest'))).toBe(true);
      await expect(Promise.resolve(workerProcessor!({ name: 'spend-watch' }))).resolves.toBeNull();
      await expect(Promise.resolve(workerProcessor!({ name: 'spend-digest' }))).resolves.toBeNull();
      await svc.onModuleDestroy();
    } finally {
      spy.mockRestore();
    }
  });
});
