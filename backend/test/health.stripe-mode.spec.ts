/**
 * LIVE-7 · HLT-1 (API_CONTRACT §14.7, v1.84) — `GET /api/v1/health` gana `stripeMode`, derivado del PREFIJO de
 * `STRIPE_SECRET_KEY`: `sk_live_`/`rk_live_` ⇒ `live`; `sk_test_`/`rk_test_` ⇒ `test`; vacío ⇒ `none`.
 * `stripeMode` NO degrada la salud. ⛔ Jamás se devuelve la clave ni un fragmento.
 *
 * Mutación que la pone roja: devolver el prefijo crudo (`sk_live_`) o cualquier trozo de la clave.
 */
import { ConfigService } from '@nestjs/config';
import { HealthController } from '../src/modules/health/health.controller';
import { HealthService } from '../src/modules/health/health.service';
import { PrismaService } from '../src/prisma/prisma.service';

const prismaUp = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) } as unknown as PrismaService;
const prismaDown = { $queryRaw: jest.fn(async () => { throw new Error('down'); }) } as unknown as PrismaService;

function fakeRes() {
  const res = { statusCode: 200, status: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  return res;
}

async function healthWith(key: string | undefined, prisma = prismaUp) {
  const config = new ConfigService(key === undefined ? {} : { STRIPE_SECRET_KEY: key });
  const controller = new HealthController(new HealthService(prisma, config));
  const res = fakeRes();
  const body = await controller.check(res as never);
  return { body: body as unknown as Record<string, unknown>, status: res.statusCode };
}

// Claves de forma realista, inventadas (no son de ninguna cuenta).
const SECRET_TAIL = 'Zq81kPfakeFAKEfake0000LIVE7hlt1Tail';
const CASES: Array<[string | undefined, 'live' | 'test' | 'none']> = [
  [`sk_live_${SECRET_TAIL}`, 'live'],
  [`rk_live_${SECRET_TAIL}`, 'live'],
  [`sk_test_${SECRET_TAIL}`, 'test'],
  [`rk_test_${SECRET_TAIL}`, 'test'],
  ['', 'none'],
  ['   ', 'none'],
  [undefined, 'none'],
];

describe('LIVE-7 · HLT-1 — stripeMode', () => {
  it.each(CASES)('STRIPE_SECRET_KEY=%p ⇒ stripeMode %p', async (key, mode) => {
    const { body, status } = await healthWith(key);
    expect(body.stripeMode).toBe(mode);
    expect(status).toBe(200);
  });

  it('ningún fragmento de la clave aparece en el cuerpo (ni el prefijo crudo ni la cola)', async () => {
    for (const [key] of CASES) {
      if (!key || !key.trim()) continue;
      const { body } = await healthWith(key);
      const text = JSON.stringify(body);
      expect(text).not.toContain(key.slice(0, 8)); // `sk_live_` / `rk_test_` …
      expect(text).not.toContain('sk_');
      expect(text).not.toContain('rk_');
      for (let i = 0; i + 6 <= SECRET_TAIL.length; i++) expect(text).not.toContain(SECRET_TAIL.slice(i, i + 6));
    }
  });

  it('forma exacta del cuerpo (sin `ok` interno)', async () => {
    const { body } = await healthWith(`sk_test_${SECRET_TAIL}`);
    expect(Object.keys(body).sort()).toEqual(['db', 'redis', 'status', 'stripeMode', 'timestamp', 'uptime']);
  });

  it('stripeMode NO degrada: con BD caída sigue saliendo y el 503 es por la BD', async () => {
    const { body, status } = await healthWith(`sk_live_${SECRET_TAIL}`, prismaDown);
    expect(status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.stripeMode).toBe('live');
  });
});
