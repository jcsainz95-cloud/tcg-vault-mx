/**
 * stf-errata-v1-80-9-1.e2e-spec.ts — errata v1.80.9.1 (`API_CONTRACT §M6-U.11`, `ARCHITECTURE §4.58.9`), punta a punta
 * con Postgres real:
 *  - **STF-32** (D-4 + A-1): `AppModule` con el almacén de intentos sustituido por un `ResilientLoginAttemptStore`
 *    REAL sobre el Redis doble (`fake-redis-attempt-store.ts`). Con el doble fallando y 5 fallos de `ana` contados en
 *    la MEMORIA de respaldo, el listado y la ficha (los dos roles) dicen `lockState:'unavailable'` y `lockedUntil:null`
 *    — ⛔ no la memoria de la réplica. Con el doble sano y candado puesto ⇒ `'ok'` y `lockedUntil` ∈ [ahora+55 s,
 *    ahora+60 s].
 *  - **STF-34** (TD-4 b), el caso con BD: el script de rescate con `ADMIN_USERNAME` sobre un `super_admin` SIN correo.
 *    El juez es el CHECK 4 (`user_no_email_unverified`): escribir `emailVerified = true` haría fallar el `update`.
 *  - **TD-5** (techlead): la regex del CHECK `user_username_canonical` vivo en la BD = `USERNAME_CANONICAL_REGEX`.
 * Las piezas sin infraestructura: `test/stf.errata-v1-80-9-1.spec.ts` (STF-31, STF-33) y
 * `prisma/reset-admin-password.username.spec.ts` (STF-34 sin BD).
 *
 * Identificadores aleatorios por corrida: la BD de la suite sobrevive entre corridas.
 */
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import {
  LOGIN_ATTEMPT_STORE,
  MemoryLoginAttemptStore,
  ResilientLoginAttemptStore,
  loginAttemptRedisKeys,
} from '../../src/modules/auth/login-attempt.store';
import { PasswordAttemptsService } from '../../src/modules/auth/password-attempts.service';
import { PiiCryptoService } from '../../src/common/crypto/pii-crypto.service';
import { FakeRedisAttemptStore } from '../helpers/fake-redis-attempt-store';
import { USERNAME_CANONICAL_REGEX } from '../../src/common/validation/credentials';
import { RedisLike, resetStaffPassword } from '../../prisma/reset-admin-password';

jest.setTimeout(120_000);

const BAD = 'mala-STF-000';
const NEW_PW = 'Nueva-STF-12345';
/** Plazo de «modo memoria» corto (real): el doble vuelve a contestar sin esperar 30 s. */
const FALLBACK_MS = 400;
const uname = (p: string) => `${p}${randomBytes(5).toString('hex')}`.slice(0, 30);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('E2E — errata v1.80.9.1: el almacén degradado no se pinta como «sin candado» (STF-32) y el rescate por usuario (STF-34)', () => {
  let h: E2EHarness;
  let adminTok: string;
  let opTok: string;
  let mailSpy: jest.SpyInstance;
  let ip = 0;
  const redis = new FakeRedisAttemptStore(Date.now);
  const memory = new MemoryLoginAttemptStore();
  const store = new ResilientLoginAttemptStore(redis, memory, undefined, 100, FALLBACK_MS);

  beforeAll(async () => {
    h = await E2EHarness.create((b) => b.overrideProvider(LOGIN_ATTEMPT_STORE).useValue(store));
    adminTok = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    opTok = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    mailSpy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (_m: MailMessage) => ({}));
  });

  afterAll(async () => {
    mailSpy?.mockRestore();
    await h?.close();
  });

  function login(identifier: string, password: string) {
    ip += 1;
    return h.api('POST', '/auth/login', {
      json: { email: identifier, password },
      headers: { 'x-forwarded-for': `10.78.${(ip >> 8) & 255}.${ip & 255}` },
    });
  }

  /** Staff sin correo con la temporal ya cambiada. */
  async function activeStaff(prefix: string, role: Role) {
    const username = uname(prefix);
    const c = await h.api('POST', '/admin/users', { json: { name: `STF ${prefix}`, username, role }, token: adminTok });
    expect([c.status, c.text]).toEqual([201, c.text]);
    const l = await login(username, c.body.tempPassword);
    expect(l.status).toBe(200);
    const ch = await h.api('POST', '/auth/change-password', {
      json: { currentPassword: c.body.tempPassword, newPassword: NEW_PW },
      token: l.body.accessToken,
    });
    expect(ch.status).toBe(200);
    return { id: c.body.user.id as string, username };
  }

  it('STF-32 — Redis doble caído + 5 fallos en la MEMORIA ⇒ listado y ficha (super_admin y vault_operator) unavailable; sano ⇒ ok con lockedUntil', async () => {
    const ana = await activeStaff('ana', Role.vault_operator);
    // Redis doble cae: el login decide en memoria (degradado) y cuenta los 5 fallos ALLÍ.
    redis.mode = 'throw';
    for (let i = 0; i < 5; i++) expect((await login(ana.username, BAD)).status).toBe(401);
    expect((await login(ana.username, BAD)).status).toBe(429);
    expect(store.degraded).toBe(true);
    const memKey = h.app.get(PasswordAttemptsService).accountKeyForUser({ id: ana.id, email: null, username: ana.username });
    expect(await memory.peekLockMs(memKey)).toBeGreaterThan(55_000); // la memoria SÍ tiene el candado

    const list = await h.api('GET', `/admin/users?q=${ana.username}`, { token: adminTok });
    expect(list.status).toBe(200);
    expect(list.body.lockState).toBe('unavailable');
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    for (const u of list.body.data) expect(u.lockedUntil).toBeNull();
    for (const tok of [adminTok, opTok]) {
      const d = await h.api('GET', `/admin/users/${ana.id}`, { token: tok });
      expect(d.status).toBe(200);
      expect([d.body.lockState, d.body.lockedUntil]).toEqual(['unavailable', null]);
    }
    // Fuera del modo degradado pero con Redis aún sin contestar: sigue unavailable, y la lectura NO vuelve a degradar.
    await sleep(FALLBACK_MS + 50);
    expect(store.degraded).toBe(false);
    const still = await h.api('GET', `/admin/users/${ana.id}`, { token: adminTok });
    expect([still.status, still.body.lockState]).toEqual([200, 'unavailable']);
    expect(store.degraded).toBe(false);

    // El doble vuelve: el siguiente intento del login repone en Redis lo contado en memoria (candado incluido).
    redis.mode = 'ok';
    expect((await login(ana.username, BAD)).status).toBe(429);
    const t0 = Date.now();
    for (const tok of [adminTok, opTok]) {
      const d = await h.api('GET', `/admin/users/${ana.id}`, { token: tok });
      expect(d.status).toBe(200);
      expect(d.body.lockState).toBe('ok');
      const until = Date.parse(d.body.lockedUntil);
      expect(until).toBeGreaterThanOrEqual(t0 + 55_000);
      expect(until).toBeLessThanOrEqual(Date.now() + 60_000);
    }
    const ok = await h.api('GET', `/admin/users?q=${ana.username}`, { token: adminTok });
    expect(ok.body.lockState).toBe('ok');
    expect(Date.parse(ok.body.data.find((u: { id: string }) => u.id === ana.id).lockedUntil)).toBeGreaterThanOrEqual(t0 + 55_000);
  });

  // ─────────────────────────────────────── STF-34 con BD real ───────────────────────────────────────

  const HMAC_KEY = randomBytes(32).toString('base64');

  /** Redis doble del SCRIPT con estado: las claves existen hasta que un `DEL` las borra. */
  function statefulRedis(seed: string[]) {
    const keys = new Set(seed);
    const client: RedisLike = {
      connect: async () => undefined,
      del: async (...ks: string[]) => ks.filter((k) => keys.delete(k)).length,
      quit: async () => 'OK',
      disconnect: () => undefined,
    };
    return { client, keys };
  }

  function bucketKeys(user: { id: string; email: string | null; username: string | null }): string[] {
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

  // ⛔ Nunca apunta a una cuenta de la suite: el respaldo `SEED_ADMIN_EMAIL` es un correo inexistente, para que un
  // script que IGNORE `ADMIN_USERNAME` (o una mutación) falle con «No user found» en vez de cambiarle la contraseña al
  // admin del fixture (medido 2026-10-04: la corrida roja contra el código viejo se la cambió a `admin@e2e.local`).
  const env = (extra: Record<string, string>) => ({
    NEW_ADMIN_PASSWORD: 'Rescate-STF34-' + randomUUID().slice(0, 8),
    SEED_ADMIN_EMAIL: `nadie_${randomUUID().slice(0, 8)}@e2e.local`,
    REDIS_URL: 'redis://fake',
    PII_HMAC_KEY: HMAC_KEY,
    ...extra,
  });

  it("STF-34 — ADMIN_USERNAME='<USUARIO> ' sobre un super_admin SIN correo: hash, tokenVersion+1, mustChangePassword=false, emailVerified NO se escribe, las seis claves de SU cubo desaparecen", async () => {
    const jefa = await activeStaff('jefa', Role.super_admin);
    const before = await h.prisma.user.findUniqueOrThrow({ where: { id: jefa.id } });
    expect([before.email, before.emailVerified]).toEqual([null, false]);
    const six = bucketKeys({ id: jefa.id, email: null, username: jefa.username });
    expect(six).toHaveLength(6);
    const r = statefulRedis([...six, 'tcg:auth:f:otra-cuenta']);
    const e = env({ ADMIN_USERNAME: `${jefa.username.toUpperCase()} ` });
    const lines: string[] = [];
    const out = await resetStaffPassword(h.prisma as never, e, undefined, { log: (l) => lines.push(l), redisClient: () => r.client });
    expect(out).toEqual({ username: jefa.username, role: 'super_admin' });
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: jefa.id } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(after.mustChangePassword).toBe(false);
    expect(after.emailVerified).toBe(false);
    expect(after.email).toBeNull();
    expect(await argon2.verify(after.passwordHash!, e.NEW_ADMIN_PASSWORD)).toBe(true);
    expect([...r.keys]).toEqual(['tcg:auth:f:otra-cuenta']);
    expect(lines.join('\n')).toContain(`limpiado en Redis para ${jefa.username}.`);
    expect(lines.join('\n')).not.toContain(e.NEW_ADMIN_PASSWORD);
    // La cuenta entra con la contraseña fijada (sin temporal pendiente).
    const l = await login(jefa.username, e.NEW_ADMIN_PASSWORD);
    expect(l.status).toBe(200);
    expect(l.body.user.mustChangePassword).toBe(false);
  });

  it('STF-34 — ADMIN_EMAIL y ADMIN_USERNAME a la vez, o un usuario inexistente ⇒ error y la fila NO cambia', async () => {
    const jefa = await activeStaff('jefb', Role.super_admin);
    // Un correo de staff desechable (sembrado por SQL: por API el staff no tiene correo) para el caso «las dos».
    const other = await h.prisma.user.create({
      data: { email: `stf34_${randomUUID().slice(0, 8)}@e2e.local`, name: 'STF34', role: Role.vault_operator, passwordHash: 'x', emailVerified: true },
    });
    const before = await h.prisma.user.findUniqueOrThrow({ where: { id: jefa.id } });
    await expect(
      resetStaffPassword(h.prisma as never, env({ ADMIN_EMAIL: other.email!, ADMIN_USERNAME: jefa.username }), undefined, { log: () => undefined }),
    ).rejects.toThrow(/not both/);
    const otherAfter = await h.prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect([otherAfter.passwordHash, otherAfter.tokenVersion]).toEqual(['x', other.tokenVersion]);
    await expect(
      resetStaffPassword(h.prisma as never, env({ ADMIN_USERNAME: uname('nadie') }), undefined, { log: () => undefined }),
    ).rejects.toThrow(/No user found with username/);
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: jefa.id } });
    expect([after.passwordHash, after.tokenVersion]).toEqual([before.passwordHash, before.tokenVersion]);
  });

  // ─────────────────────────────── TD-5 (techlead, gate sobre da6d910e) ───────────────────────────────

  it('TD-5 — la regex del CHECK `user_username_canonical` VIVO en la BD es la misma que USERNAME_CANONICAL_REGEX', async () => {
    // Se lee de `pg_constraint` (no del .sql de M-63): mide la BD que la app usa, también si una migración futura
    // reescribe el CHECK. Si divergen, el alta valida con una regla y la BD decide con otra (⇒ 500 en vez de 422).
    const rows = await h.prisma.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'user_username_canonical'`,
    );
    expect(rows).toHaveLength(1);
    const m = /~ '([^']+)'::text/.exec(rows[0].def);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(USERNAME_CANONICAL_REGEX.source);
    expect(USERNAME_CANONICAL_REGEX.flags).toBe('');
  });
});
