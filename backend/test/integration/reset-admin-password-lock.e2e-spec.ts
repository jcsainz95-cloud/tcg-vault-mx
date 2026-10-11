/**
 * reset-admin-password-lock.e2e-spec.ts — C7 rev v1.80.1, C7-23 con Redis REAL (`REDIS_URL`):
 * cuenta staff con `f = 6` + candado en Redis (más `auth-cp` y `auth-pwdevagg` con valor) ⇒ tras
 * `resetStaffPassword` las SEIS claves no existen y el login con la contraseña nueva ⇒ 200 sin
 * esperar. `API_CONTRACT §1` «Script de rescate»; `ARCHITECTURE §4.57.10.3`.
 *
 * Usa el prefijo REAL (`tcg:auth:`), como el script en producción, con un correo aleatorio por
 * corrida; limpia sus claves al terminar. Sin `REDIS_URL` se salta con aviso, salvo
 * `E2E_STRICT_INFRA=true` (CI), donde es ROJO. No toca Postgres: Prisma es un doble.
 */
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  RedisLoginAttemptStore,
  createLoginAttemptRedisClient,
  loginAttemptRedisKeys,
} from '../../src/modules/auth/login-attempt.store';
import { LOGIN_ATTEMPT_REDIS_PREFIX, DEVICE_ROUTE_WINDOW_MS } from '../../src/modules/auth/password-attempts.constants';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makeC7Deps } from '../helpers/auth-c7-deps';
import { resetStaffPassword } from '../../prisma/reset-admin-password';

jest.setTimeout(60_000);

const STRICT = process.env.E2E_STRICT_INFRA === 'true';
const URL = process.env.REDIS_URL;
const GOOD = 'Correcta-C7-123';
const NEW = 'Nueva-de-rescate-C7-456';

describe('E2E — C7-23: el script de rescate levanta el candado C7 en Redis real', () => {
  let client: Redis | undefined;
  const hmacKey = randomBytes(32).toString('base64');
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'a-secret-c7-23',
    JWT_REFRESH_SECRET: 'r-secret-c7-23',
    PII_HMAC_KEY: hmacKey,
    PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const user = {
    id: randomUUID(),
    email: `c7_23_${randomUUID().slice(0, 12)}@e2e.local`,
    name: 'Op',
    role: Role.vault_operator,
    status: UserStatus.active,
    passwordHash: '' as string,
    tokenVersion: 0,
    locale: 'es',
    emailVerified: true,
    mustChangePassword: false,
  };
  let keys: string[] = [];

  beforeAll(async () => {
    if (!URL) {
      if (STRICT) throw new Error('REDIS_URL no definida y E2E_STRICT_INFRA=true');
      // eslint-disable-next-line no-console
      console.warn('[e2e] REDIS_URL no definida; se salta C7-23 con Redis real.');
      return;
    }
    client = createLoginAttemptRedisClient(URL);
    await client.connect();
    user.passwordHash = await argon2.hash(GOOD);
  });

  afterAll(async () => {
    if (!client) return;
    if (keys.length) await client.del(...keys);
    await client.quit();
  });

  it('f = 6 + candado (+ auth-cp + auth-pwdevagg) ⇒ tras el script, las seis claves no existen y el login con la nueva ⇒ 200 sin esperar', async () => {
    if (!client) return;
    const store = new RedisLoginAttemptStore(client, LOGIN_ATTEMPT_REDIS_PREFIX);
    const deps = makeC7Deps({ config, store });
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ ...user })),
        update: jest.fn(async ({ data }: { data: { passwordHash: string } }) => {
          user.passwordHash = data.passwordHash;
          user.tokenVersion += 1;
          return { ...user };
        }),
      },
    };
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService({}),
      config,
      {} as never,
      deps.audit as never,
      {} as never,
      {} as never,
      deps.attempts,
      deps.devices,
    );
    const account = deps.attempts.accountKey(user.email);
    const cp = deps.attempts.changePasswordKey(user.id);
    const agg = deps.attempts.deviceAggregateKey(user.id);
    keys = [account, cp, agg].flatMap((k) => loginAttemptRedisKeys(k));
    expect(keys).toHaveLength(6);

    const login = (password: string) => svc.login({ email: user.email, password }).then(() => 200, (e: { getStatus(): number }) => e.getStatus());
    // 5 fallos ⇒ f = 5 + candado 60 s; «vence» el candado y un 6.º fallo ⇒ f = 6 + candado 120 s;
    // la contraseña correcta ⇒ 429.
    for (let i = 0; i < 5; i++) expect(await login('mala')).toBe(401);
    await client.del(keys[1]);
    expect(await login('mala')).toBe(401);
    expect(await login(GOOD)).toBe(429);
    expect(await client.get(keys[0])).toBe('6');
    expect(await client.pttl(keys[1])).toBeGreaterThan(100_000);
    // auth-cp y el agregado con valor.
    await store.acquire(cp);
    await store.bump(agg, DEVICE_ROUTE_WINDOW_MS);
    expect(await client.exists(...keys)).toBeGreaterThanOrEqual(4);

    const lines: string[] = [];
    const t0 = Date.now();
    await expect(
      resetStaffPassword(
        prisma as never,
        { NEW_ADMIN_PASSWORD: NEW, ADMIN_EMAIL: user.email.toUpperCase(), REDIS_URL: URL, PII_HMAC_KEY: hmacKey },
        undefined,
        { log: (l) => lines.push(l) },
      ),
    ).resolves.toEqual({ email: user.email.toUpperCase(), role: Role.vault_operator });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await client.exists(...keys)).toBe(0);
    expect(lines.join('\n')).toMatch(/candado.*limpiad/i);
    expect(lines.join('\n')).not.toContain(NEW);
    // Sin esperar: la nueva contraseña entra.
    expect(await login(NEW)).toBe(200);
  });
});
