import { HealthController } from '../src/modules/health/health.controller';
import { HealthService, HealthRedisClient } from '../src/modules/health/health.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Response de Express falso: captura el status fijado por el controller. */
function fakeRes() {
  const res = { statusCode: 200, status: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

function makeService(opts: {
  dbOk: boolean;
  redis?: HealthRedisClient;
}): HealthService {
  const prisma = {
    $queryRaw: jest.fn(() =>
      opts.dbOk ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('db down')),
    ),
  } as unknown as PrismaService;
  return new HealthService(prisma, opts.redis);
}

describe('HealthController (GET /api/v1/health)', () => {
  it('responde 200 { status: ok } cuando la DB responde y no hay Redis (skipped)', async () => {
    const controller = new HealthController(makeService({ dbOk: true }));
    const res = fakeRes();

    const body = await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(body.redis).toBe('skipped');
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.timestamp).toBe('string');
    // El cuerpo no filtra el flag interno `ok`.
    expect((body as Record<string, unknown>).ok).toBeUndefined();
  });

  it('responde 200 { status: ok } cuando DB y Redis (PING) responden', async () => {
    const redis: HealthRedisClient = { ping: jest.fn().mockResolvedValue('PONG') };
    const controller = new HealthController(makeService({ dbOk: true, redis }));
    const res = fakeRes();

    const body = await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(body.redis).toBe('up');
    expect(redis.ping).toHaveBeenCalledTimes(1);
  });

  it('responde 503 { status: degraded } cuando la DB está caída', async () => {
    const controller = new HealthController(makeService({ dbOk: false }));
    const res = fakeRes();

    const body = await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('down');
  });

  it('responde 503 cuando el PING a Redis falla (con DB sana)', async () => {
    const redis: HealthRedisClient = { ping: jest.fn().mockRejectedValue(new Error('no redis')) };
    const controller = new HealthController(makeService({ dbOk: true, redis }));
    const res = fakeRes();

    const body = await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('up');
    expect(body.redis).toBe('down');
  });
});
