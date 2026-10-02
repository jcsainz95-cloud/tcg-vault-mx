/**
 * C7-18 (v1.80, sub-condición de C7 en `SECURITY_NOTES`): `trust proxy === 1` y el tracker del
 * throttler por IP es la ÚLTIMA entrada de `X-Forwarded-For` (la que escribe el edge), no la primera
 * (la que escribe el cliente). Mutación que la pone en rojo: `trust proxy = true`.
 * Además: `isLoginAttemptRedisDisabled()` solo es cierto bajo `NODE_ENV=test` (§4.57.6).
 */
import * as http from 'http';
import express from 'express';
import { TRUST_PROXY_HOPS, applyTrustProxy } from '../src/trust-proxy';
import { AppThrottlerGuard } from '../src/common/guards/app-throttler.guard';
import { isLoginAttemptRedisDisabled } from '../src/config/test-env';

function get(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/', headers }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve(b));
      })
      .on('error', reject);
  });
}

describe('C7-18 — trust proxy fijado a 1', () => {
  it('app.get("trust proxy") === 1', () => {
    const app = express();
    applyTrustProxy(app);
    expect(TRUST_PROXY_HOPS).toBe(1);
    expect(app.get('trust proxy')).toBe(1);
  });

  it('el tracker del throttler es la ÚLTIMA entrada de X-Forwarded-For', async () => {
    const app = express();
    applyTrustProxy(app);
    const guard = new AppThrottlerGuard({ throttlers: [] } as never, {} as never, {} as never);
    const getTracker = (req: unknown) =>
      (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker(req);
    app.get('/', async (req, res) => {
      res.send(await getTracker(req));
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(get(port, { 'x-forwarded-for': '6.6.6.6, 7.7.7.7' })).resolves.toBe('7.7.7.7');
      await expect(get(port, { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 7.7.7.7' })).resolves.toBe('7.7.7.7');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe('C7 — isLoginAttemptRedisDisabled() (config/test-env.ts)', () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it('bajo NODE_ENV=test: memoria siempre', () => {
    process.env.NODE_ENV = 'test';
    expect(isLoginAttemptRedisDisabled()).toBe(true);
  });

  it.each(['production', 'staging', 'development', 'local', ''])('con NODE_ENV=%p: NO', (env) => {
    process.env.NODE_ENV = env;
    expect(isLoginAttemptRedisDisabled()).toBe(false);
  });
});
