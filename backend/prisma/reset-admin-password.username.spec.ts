/**
 * STF-34 (errata v1.80.9.1, TD-4 b — `API_CONTRACT §1` «Script de rescate», fila «por usuario»; `ARCHITECTURE §4.58.9`):
 * el script de rescate gana `ADMIN_USERNAME` para el súper-admin SIN correo.
 *
 * Sin BD: Prisma y el cliente Redis son dobles; las claves esperadas las calcula `PasswordAttemptsService` REAL con la
 * misma `PII_HMAC_KEY` (⛔ nada duplicado a mano). El caso con BD real (el CHECK 4 `user_no_email_unverified` como juez)
 * vive en `test/integration/stf-errata-v1-80-9-1.e2e-spec.ts`. `reset-admin-password.spec.ts` (6 casos) y
 * `reset-admin-password.c7.spec.ts` (C7-23) quedan intactas: son el camino `ADMIN_EMAIL`.
 *
 * Mutaciones que lo ponen en rojo (contrato STF-34): (i) `emailVerified: true` siempre; (ii) `clearPasswordLock` con
 * `{ id, email }` sin `username`; (iii) buscar sin `normalizeIdentifier`; (iv) precedencia silenciosa entre variables.
 */
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { PasswordAttemptsService } from '../src/modules/auth/password-attempts.service';
import { MemoryLoginAttemptStore, loginAttemptRedisKeys } from '../src/modules/auth/login-attempt.store';
import { resetStaffPassword, ResetPrismaLike, MIN_PASSWORD_LENGTH, RedisLike } from './reset-admin-password';

const GOOD = 'Rescate-' + 'x'.repeat(MIN_PASSWORD_LENGTH);
const HMAC_KEY = randomBytes(32).toString('base64');
const fakeHash = async (plain: string) => `hashed(${plain.length})`;

type Row = { id: string; email: string | null; username: string | null; role: string };

/** Prisma doble que solo encuentra la fila por la clave EXACTA con que se guardó (`username` canónico o `email`). */
function fakePrisma(row: Row | null) {
  const findUnique = jest.fn(async ({ where }: { where: { email?: string; username?: string } }) => {
    if (!row) return null;
    if (where.username !== undefined) return where.username === row.username ? { ...row } : null;
    if (where.email !== undefined) return where.email === row.email ? { ...row } : null;
    return null;
  });
  const update = jest.fn().mockResolvedValue({});
  const prisma = { user: { findUnique, update } } as unknown as ResetPrismaLike;
  return { prisma, findUnique, update };
}

function fakeRedis() {
  const del = jest.fn(async (...keys: string[]) => keys.length);
  const client: RedisLike & { del: jest.Mock } = {
    connect: jest.fn(async () => undefined),
    del,
    quit: jest.fn(async () => 'OK'),
    disconnect: jest.fn(),
  };
  return client;
}

/** Las seis claves del cubo de la cuenta, calculadas por el servicio REAL (el de su identificador). */
function expectedKeys(user: { id: string; email: string | null; username: string | null }): string[] {
  const attempts = new PasswordAttemptsService(
    new MemoryLoginAttemptStore(),
    new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: HMAC_KEY })),
    {} as never,
    {} as never,
    {} as never,
  );
  return [attempts.accountKeyForUser(user), attempts.changePasswordKey(user.id), attempts.deviceAggregateKey(user.id)].flatMap(
    (k) => loginAttemptRedisKeys(k),
  );
}

describe('STF-34 — script de rescate por usuario (ADMIN_USERNAME)', () => {
  const ana: Row = { id: randomUUID(), email: null, username: 'ana', role: 'super_admin' };

  it("ADMIN_USERNAME='ANA ' ⇒ busca 'ana'; UNA escritura sin emailVerified; borra las seis claves de SU cubo; la salida dice ana y el rol", async () => {
    const { prisma, findUnique, update } = fakePrisma(ana);
    const redis = fakeRedis();
    const lines: string[] = [];
    const out = await resetStaffPassword(
      prisma,
      { NEW_ADMIN_PASSWORD: GOOD, ADMIN_USERNAME: 'ANA ', REDIS_URL: 'redis://fake', PII_HMAC_KEY: HMAC_KEY },
      fakeHash,
      { log: (l) => lines.push(l), redisClient: () => redis },
    );
    expect(findUnique).toHaveBeenCalledWith({ where: { username: 'ana' } });
    expect(update).toHaveBeenCalledTimes(1);
    const { where, data } = update.mock.calls[0][0];
    expect(where).toEqual({ username: 'ana' });
    // ⛔ `emailVerified` NO se escribe: con `email: null` viola el CHECK 4 (`user_no_email_unverified`).
    expect(data).toEqual({ passwordHash: `hashed(${GOOD.length})`, tokenVersion: { increment: 1 }, mustChangePassword: false });
    expect(out).toEqual({ username: 'ana', role: 'super_admin' });
    // El cubo de SU identificador: blindIndex('auth-pw:v1:ana') + auth-cp:v1:<id> + auth-pwdevagg:v1:<id>.
    const keys = expectedKeys(ana);
    expect(keys).toHaveLength(6);
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect([...redis.del.mock.calls[0]].sort()).toEqual([...keys].sort());
    const text = lines.join('\n');
    expect(text).toMatch(/candado de intentos \(C7\) limpiado en Redis para ana\./);
    expect(text).not.toContain(GOOD);
  });

  it('ADMIN_EMAIL y ADMIN_USERNAME a la vez ⇒ error SIN escritura (ni lectura, ni Redis): nada de precedencias silenciosas', async () => {
    const { prisma, findUnique, update } = fakePrisma(ana);
    const redis = fakeRedis();
    await expect(
      resetStaffPassword(
        prisma,
        { NEW_ADMIN_PASSWORD: GOOD, ADMIN_EMAIL: 'owner@x.mx', ADMIN_USERNAME: 'ana', REDIS_URL: 'redis://fake', PII_HMAC_KEY: HMAC_KEY },
        fakeHash,
        { log: () => undefined, redisClient: () => redis },
      ),
    ).rejects.toThrow(/ADMIN_EMAIL.*ADMIN_USERNAME/);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('ADMIN_USERNAME inexistente ⇒ error sin escritura; vacío ⇒ error sin lectura', async () => {
    const { prisma, update } = fakePrisma(ana);
    await expect(resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: GOOD, ADMIN_USERNAME: 'nadie' }, fakeHash, { log: () => undefined })).rejects.toThrow(
      /No user found with username "nadie"/,
    );
    expect(update).not.toHaveBeenCalled();
    const blank = fakePrisma(ana);
    await expect(resetStaffPassword(blank.prisma, { NEW_ADMIN_PASSWORD: GOOD, ADMIN_USERNAME: '   ' }, fakeHash, { log: () => undefined })).rejects.toThrow(
      /ADMIN_USERNAME is empty/,
    );
    expect(blank.findUnique).not.toHaveBeenCalled();
    expect(blank.update).not.toHaveBeenCalled();
  });

  it('mismas reglas de rol: una fila hallada por usuario que no es staff ⇒ error sin escritura', async () => {
    const { prisma, update } = fakePrisma({ id: randomUUID(), email: null, username: 'raro', role: 'customer' });
    await expect(resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: GOOD, ADMIN_USERNAME: 'raro' }, fakeHash, { log: () => undefined })).rejects.toThrow(
      /Refusing to reset "raro"/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('una cuenta CON correo hallada por ADMIN_EMAIL sigue escribiendo emailVerified = true (camino de hoy)', async () => {
    const owner: Row = { id: randomUUID(), email: 'owner@x.mx', username: null, role: 'super_admin' };
    const { prisma, update } = fakePrisma(owner);
    const out = await resetStaffPassword(prisma, { NEW_ADMIN_PASSWORD: GOOD, ADMIN_EMAIL: 'owner@x.mx' }, fakeHash, { log: () => undefined });
    expect(out).toEqual({ email: 'owner@x.mx', role: 'super_admin' });
    expect(update.mock.calls[0][0]).toEqual({
      where: { email: 'owner@x.mx' },
      data: { passwordHash: `hashed(${GOOD.length})`, tokenVersion: { increment: 1 }, emailVerified: true, mustChangePassword: false },
    });
  });
});
