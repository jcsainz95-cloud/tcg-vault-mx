/**
 * staff-throttle.e2e-spec.ts — v1.80.9, STF-21 (`API_CONTRACT §M6-U.9`, criterio 264): el `@Throttle 5/min` por IP
 * de `POST /auth/login` cubre también los nombres de usuario — misma ruta, mismo límite. Seis logins desde la misma
 * IP con usuarios DISTINTOS (inexistentes) ⇒ los cinco primeros `401` (no `400`: un usuario es un identificador
 * válido) y el 6.º `429 RATE_LIMITED`. Re-activa el throttler como `auth-throttle.e2e-spec.ts`.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';

describe('E2E — STF-21: throttle por IP con nombres de usuario', () => {
  let h: E2EHarness;
  let prev: string | undefined;

  beforeAll(async () => {
    prev = process.env.E2E_ENABLE_THROTTLER;
    process.env.E2E_ENABLE_THROTTLER = 'true';
    h = await E2EHarness.create();
  });

  afterAll(async () => {
    await h?.close();
    if (prev === undefined) delete process.env.E2E_ENABLE_THROTTLER;
    else process.env.E2E_ENABLE_THROTTLER = prev;
  });

  it('misma IP, 6 logins en 60 s con usuarios distintos ⇒ 401×5 y el 6.º 429 RATE_LIMITED', async () => {
    const ip = `10.21.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
    const statuses: number[] = [];
    let last: { status: number; body: any } | undefined;
    for (let i = 0; i < 6; i++) {
      last = await h.api('POST', '/auth/login', {
        json: { email: `stfthr${randomBytes(4).toString('hex')}`, password: 'mala-STF-000' },
        headers: { 'x-forwarded-for': ip },
      });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
  });
});
