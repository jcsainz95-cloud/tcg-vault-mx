/**
 * C7 rev v1.80.1 — C7-23 (`SEC-C7-SCRIPT`, `D-C7-4`): el script de rescate LEVANTA el candado C7.
 * `API_CONTRACT §1` «Script de rescate» (`#reset-admin-password-script`); `ARCHITECTURE §4.57.10.3`.
 *
 * Sin Redis real: un cliente doble registra el `DEL` y las claves se comparan contra las que calcula
 * `PasswordAttemptsService` con la MISMA `PII_HMAC_KEY` (⛔ nada duplicado a mano). Los dos casos de
 * red (puerto cerrado / agujero negro) usan sockets locales de verdad. El caso con Redis real y el
 * login posterior están en `test/integration/reset-admin-password-lock.e2e-spec.ts`.
 * `reset-admin-password.spec.ts` (6 casos) queda intacta.
 *
 * Mutaciones que lo ponen en rojo: no borrar; fallar el script cuando Redis no contesta; derivar la
 * clave con el correo sin normalizar.
 */
import * as net from 'net';
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { PasswordAttemptsService } from '../src/modules/auth/password-attempts.service';
import { MemoryLoginAttemptStore, loginAttemptRedisKeys } from '../src/modules/auth/login-attempt.store';
import { resetStaffPassword, ResetPrismaLike, MIN_PASSWORD_LENGTH, RedisLike } from './reset-admin-password';

const GOOD = 'Rescate-' + 'x'.repeat(MIN_PASSWORD_LENGTH);
const HMAC_KEY = randomBytes(32).toString('base64');

function fakePrisma(user: { id: string; email: string; role: string } | null) {
  const update = jest.fn().mockResolvedValue({});
  const findUnique = jest.fn().mockResolvedValue(user);
  const prisma: ResetPrismaLike = { user: { findUnique, update } };
  return { prisma, update, findUnique };
}

const fakeHash = async (plain: string) => `hashed(${plain.length})`;

/** Las seis claves que el backend usaría para esa cuenta, calculadas por el servicio REAL. */
function expectedKeys(user: { id: string; email: string }): string[] {
  const attempts = new PasswordAttemptsService(
    new MemoryLoginAttemptStore(),
    new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: HMAC_KEY })),
    {} as never,
    {} as never,
    {} as never, // v1.80.9: PrismaService (solo lo usa el aviso de candado sin correo)
  );
  return [attempts.accountKey(user.email), attempts.changePasswordKey(user.id), attempts.deviceAggregateKey(user.id)].flatMap(
    (k) => loginAttemptRedisKeys(k),
  );
}

function fakeRedis(behaviour: 'ok' | 'hang-connect' | 'throw-del' = 'ok') {
  const del = jest.fn(async (...keys: string[]) => {
    if (behaviour === 'throw-del') throw new Error('DEL failed');
    return keys.length;
  });
  const client: RedisLike & { del: jest.Mock; quit: jest.Mock; disconnect: jest.Mock } = {
    connect: jest.fn(async () => {
      if (behaviour === 'hang-connect') await new Promise<never>(() => undefined);
    }),
    del,
    quit: jest.fn(async () => 'OK'),
    disconnect: jest.fn(),
  };
  return client;
}

describe('C7-23 — el script borra las SEIS claves con las mismas funciones/constantes que el backend', () => {
  it('con REDIS_URL: un DEL con f/l de auth-pw (normalizado + blindIndex), auth-cp y auth-pwdevagg; cliente cerrado; salida sin contraseña ni HMAC completo', async () => {
    const user = { id: randomUUID(), email: 'Admin@TCG.local', role: 'super_admin' };
    const { prisma, update } = fakePrisma(user);
    const redis = fakeRedis();
    const lines: string[] = [];
    const out = await resetStaffPassword(
      prisma,
      { NEW_ADMIN_PASSWORD: GOOD, ADMIN_EMAIL: user.email, REDIS_URL: 'redis://fake', PII_HMAC_KEY: HMAC_KEY },
      fakeHash,
      { log: (l) => lines.push(l), redisClient: () => redis },
    );
    expect(out).toEqual({ email: user.email, role: 'super_admin' });
    expect(update).toHaveBeenCalledTimes(1);
    // Orden: DESPUÉS de la escritura.
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(redis.del.mock.invocationCallOrder[0]);
    expect(redis.del).toHaveBeenCalledTimes(1);
    const keys = expectedKeys(user);
    expect(keys).toHaveLength(6);
    expect([...redis.del.mock.calls[0]].sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(k.startsWith('tcg:auth:f:') || k.startsWith('tcg:auth:l:')).toBe(true);
      expect(k).not.toContain('@');
    }
    expect(redis.quit).toHaveBeenCalledTimes(1);
    const text = lines.join('\n');
    expect(text).toMatch(/candado.*limpiad/i);
    expect(text).not.toContain(GOOD);
    const hmac = keys[0].slice('tcg:auth:f:'.length); // 64 hex del blind index
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(text).not.toContain(hmac);
    expect(JSON.stringify(out)).not.toContain(GOOD);
  });

  it('el correo se NORMALIZA antes del HMAC: «Admin@TCG.local» y «admin@tcg.local» borran las mismas claves', async () => {
    const id = randomUUID();
    const dels: string[][] = [];
    for (const email of ['Admin@TCG.local', 'admin@tcg.local', '  ADMIN@tcg.LOCAL ']) {
      const { prisma } = fakePrisma({ id, email, role: 'vault_operator' });
      const redis = fakeRedis();
      await resetStaffPassword(
        prisma,
        { NEW_ADMIN_PASSWORD: GOOD, ADMIN_EMAIL: email, REDIS_URL: 'redis://fake', PII_HMAC_KEY: HMAC_KEY },
        fakeHash,
        { log: () => undefined, redisClient: () => redis },
      );
      dels.push([...redis.del.mock.calls[0]].sort());
    }
    expect(dels[1]).toEqual(dels[0]);
    expect(dels[2]).toEqual(dels[0]);
    expect(dels[0]).toEqual([...expectedKeys({ id, email: 'admin@tcg.local' })].sort());
  });

  it('sin REDIS_URL ⇒ termina OK, la contraseña cambió, y la salida dice que el candado NO se limpió (sin REDIS_URL)', async () => {
    const { prisma, update } = fakePrisma({ id: randomUUID(), email: 'admin@tcg.local', role: 'super_admin' });
    const lines: string[] = [];
    const redisClient = jest.fn();
    await expect(
      resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: GOOD, PII_HMAC_KEY: HMAC_KEY }, fakeHash, { log: (l) => lines.push(l), redisClient }),
    ).resolves.toEqual({ email: 'admin@tcg.local', role: 'super_admin' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(redisClient).not.toHaveBeenCalled();
    expect(lines.join('\n')).toMatch(/candado de intentos NO limpiado \(sin REDIS_URL\)/);
    expect(lines.join('\n')).toMatch(/60 min|dispositivo conocido/);
  });

  it('el DEL falla ⇒ termina OK (la contraseña YA cambió) y avisa con el motivo; el cliente se cierra', async () => {
    const { prisma, update } = fakePrisma({ id: randomUUID(), email: 'admin@tcg.local', role: 'super_admin' });
    const redis = fakeRedis('throw-del');
    const lines: string[] = [];
    await expect(
      resetStaffPassword(
        prisma,
        { NEW_ADMIN_PASSWORD: GOOD, REDIS_URL: 'redis://fake', PII_HMAC_KEY: HMAC_KEY },
        fakeHash,
        { log: (l) => lines.push(l), redisClient: () => redis },
      ),
    ).resolves.toMatchObject({ role: 'super_admin' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).toMatch(/candado de intentos NO limpiado/);
    expect(lines.join('\n')).toMatch(/DEL failed/);
    expect(redis.quit.mock.calls.length + redis.disconnect.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('Redis inaccesible (puerto CERRADO, cliente ioredis real) ⇒ OK en < 3 s, contraseña cambiada, aviso', async () => {
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise((r) => probe.close(r));
    const { prisma, update } = fakePrisma({ id: randomUUID(), email: 'admin@tcg.local', role: 'super_admin' });
    const lines: string[] = [];
    const t0 = Date.now();
    await expect(
      resetStaffPassword(
        prisma,
        { NEW_ADMIN_PASSWORD: GOOD, REDIS_URL: `redis://127.0.0.1:${port}`, PII_HMAC_KEY: HMAC_KEY },
        fakeHash,
        { log: (l) => lines.push(l) },
      ),
    ).resolves.toMatchObject({ role: 'super_admin' });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).toMatch(/candado de intentos NO limpiado/);
  });

  it('Redis que acepta la conexión y NUNCA contesta (agujero negro) ⇒ OK en < 3 s y aviso', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((sock) => sockets.push(sock));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const { prisma, update } = fakePrisma({ id: randomUUID(), email: 'admin@tcg.local', role: 'super_admin' });
      const lines: string[] = [];
      const t0 = Date.now();
      await expect(
        resetStaffPassword(
          prisma,
          { NEW_ADMIN_PASSWORD: GOOD, REDIS_URL: `redis://127.0.0.1:${port}`, PII_HMAC_KEY: HMAC_KEY },
          fakeHash,
          { log: (l) => lines.push(l) },
        ),
      ).resolves.toMatchObject({ role: 'super_admin' });
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(update).toHaveBeenCalledTimes(1);
      expect(lines.join('\n')).toMatch(/candado de intentos NO limpiado/);
    } finally {
      sockets.forEach((x) => x.destroy());
      await new Promise((r) => server.close(r));
    }
  });

  it('si la cuenta no es staff, no se toca Redis (no hay escritura que acompañar)', async () => {
    const { prisma, update } = fakePrisma({ id: randomUUID(), email: 'c@x.mx', role: 'customer' });
    const redis = fakeRedis();
    await expect(
      resetStaffPassword(
        prisma,
        { NEW_ADMIN_PASSWORD: GOOD, ADMIN_EMAIL: 'c@x.mx', REDIS_URL: 'redis://fake', PII_HMAC_KEY: HMAC_KEY },
        fakeHash,
        { log: () => undefined, redisClient: () => redis },
      ),
    ).rejects.toThrow(/Refusing to reset/);
    expect(update).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
