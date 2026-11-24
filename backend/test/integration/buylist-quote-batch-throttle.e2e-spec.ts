/**
 * §BUYLIST-429 (criterio B) — `POST /buylist/quote/batch` anónimo: 30 peticiones/min por IP; la 31.ª da 429
 * RATE_LIMITED con `Retry-After`; ninguna petición con >50 ítems pasa (400). Se re-activa el throttler real
 * (`E2E_ENABLE_THROTTLER=true`), como `auth-throttle.e2e-spec.ts`. La clave es `req.ip` con `trust proxy = 1`
 * (última entrada de `X-Forwarded-For`), de ahí que cada caso use su propia IP.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';

describe('E2E — rate limit de POST /buylist/quote/batch (§BUYLIST-429)', () => {
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

  const ip = () => `10.30.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const items = (n: number) =>
    Array.from({ length: n }, () => ({ cardId: 'no-existe-429', productType: 'raw', rawCondition: 'NM' }));

  it('30 peticiones en 60 s pasan (200); la 31.ª da 429 RATE_LIMITED con Retry-After', async () => {
    const headers = { 'x-forwarded-for': ip() };
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      statuses.push((await h.api('POST', '/buylist/quote/batch', { json: { items: items(1) }, headers })).status);
    }
    expect(statuses).toEqual(Array(30).fill(200));

    const limited = await h.api('POST', '/buylist/quote/batch', { json: { items: items(1) }, headers });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(limited.headers['retry-after']);
    expect(Number.isInteger(retryAfter) && retryAfter > 0).toBe(true);
    expect(limited.body.error.details).toEqual({ retryAfterSeconds: retryAfter });
  });

  it('50 ítems pasan (200); 51 ítems ⇒ 400 VALIDATION_ERROR (B-C1 sigue cerrado por el tope)', async () => {
    const headers = { 'x-forwarded-for': ip() };
    const ok = await h.api('POST', '/buylist/quote/batch', { json: { items: items(50) }, headers });
    expect(ok.status).toBe(200);
    const big = await h.api('POST', '/buylist/quote/batch', { json: { items: items(51) }, headers });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('VALIDATION_ERROR');
  });
});
