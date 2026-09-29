/**
 * C7 (v1.80) — la POLÍTICA del límite de intentos por cuenta, a nivel de `AuthService` (sin BD:
 * Prisma en memoria; argon2 REAL envuelto en un espía). `API_CONTRACT §1` «Límite de intentos por
 * cuenta» (`#auth-password-attempts`), `ARCHITECTURE §4.57`. Las mismas propiedades se prueban por
 * HTTP contra la app real en `test/integration/auth-password-attempts.e2e-spec.ts`.
 *
 * Cada `describe` lleva su número C7-n; la mutación que lo pone en rojo está en el contrato.
 */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { hkdfSync, randomBytes, randomUUID } from 'crypto';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';
import { AuthTokenService } from '../src/modules/auth/auth-token.service';
import { MailService } from '../src/modules/mail/mail.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { MemoryLoginAttemptStore } from '../src/modules/auth/login-attempt.store';
import { makeC7Deps, C7Deps } from './helpers/auth-c7-deps';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';

jest.setTimeout(60_000); // argon2 real (m=64 MiB): cada verify cuesta ~0,2 s aquí

const verifySpy = argon2.verify as unknown as jest.Mock;
const GOOD = 'correct-horse-battery';
const BAD = 'wrong-password';

const config = new ConfigService({
  JWT_ACCESS_SECRET: 'acc-secret-c7',
  JWT_REFRESH_SECRET: 'ref-secret-c7',
  PII_HMAC_KEY: randomBytes(32).toString('base64'),
  PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: 'https://app.test',
});

interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  passwordHash: string | null;
  tokenVersion: number;
  locale: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  nameSource: 'user';
}

let goodHash: string;
beforeAll(async () => {
  goodHash = await argon2.hash(GOOD);
});

function makeWorld(
  opts: { audit?: { log: jest.Mock }; store?: MemoryLoginAttemptStore; google?: GoogleTokenVerifier } = {},
) {
  // 2026-09-29 (QA IMPORTANTE 2 sobre 8ea245f): reloj FALSO por defecto. Con `Date.now` real, C7-3
  // exigía `retry: 60` y bajo carga salía 59 (`ceil((lockExpiresAt - now) / 1000)` con ≥ 1 s entre el
  // 5.º intento y el 6.º). El reloj no avanza salvo que la prueba lo mueva (`clock.t += …`), así
  // que el `Retry-After` es exactamente el candado recién puesto. Una prueba que pase su propio
  // `store` trae su propio reloj (C7-15 staff).
  const clock = { t: Date.now() };
  const store = opts.store ?? new MemoryLoginAttemptStore(() => clock.t);
  const users = new Map<string, FakeUser>();
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; id?: string } }) => {
        for (const u of users.values()) {
          if ((where.email !== undefined && u.email === where.email) || (where.id !== undefined && u.id === where.id)) {
            return { ...u };
          }
        }
        return null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = [...users.values()].find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (k === 'tokenVersion') u.tokenVersion += 1;
          else (u as unknown as Record<string, unknown>)[k] = v;
        }
        return { ...u };
      }),
    },
  };
  const deps: C7Deps = makeC7Deps({ config, audit: opts.audit, store });
  const tokens = {
    issue: jest.fn(async () => 'CLEAR'),
    consume: jest.fn(async () => null as string | null),
    ownerOf: jest.fn(async () => null),
    countIssuedLastHour: jest.fn(async () => 0),
  };
  const mail = { sendEmailVerification: jest.fn(), sendPasswordReset: jest.fn(async () => undefined) };
  const svc = new AuthService(
    prisma as unknown as PrismaService,
    new JwtService({}),
    config,
    opts.google ?? ({} as GoogleTokenVerifier),
    deps.audit as unknown as AuditService,
    tokens as unknown as AuthTokenService,
    mail as unknown as MailService,
    deps.attempts,
    deps.devices,
  );
  const addUser = (p: Partial<FakeUser> = {}): FakeUser => {
    const id = randomUUID();
    const u: FakeUser = {
      id,
      email: `u-${id}@c7.test`,
      name: 'U',
      role: Role.customer,
      status: UserStatus.active,
      passwordHash: goodHash,
      tokenVersion: 0,
      locale: 'es',
      emailVerified: true,
      mustChangePassword: false,
      nameSource: 'user',
      ...p,
    };
    users.set(u.id, u);
    return u;
  };
  return { svc, prisma, deps, tokens, addUser, users, clock };
}

/** Resultado normalizado de un intento: lo que ve el cliente + llamadas a argon2 del paso. */
async function attempt(svc: AuthService, body: { email: string; password: string; deviceToken?: string }) {
  const before = verifySpy.mock.calls.length;
  try {
    const r = await svc.login(body);
    return { status: 200, code: null, details: null, argon2: verifySpy.mock.calls.length - before, body: r };
  } catch (e: unknown) {
    const ex = e as { getStatus(): number; code: string; details: Record<string, unknown> };
    return {
      status: ex.getStatus(),
      code: ex.code,
      details: ex.details,
      argon2: verifySpy.mock.calls.length - before,
      body: null,
    };
  }
}

const flush = () => new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));

beforeEach(() => verifySpy.mockClear());

describe('C7-1 — 5 fallos ⇒ 401×5; el 6.º ⇒ 429 con Retry-After ≥ 1, y argon2 exactamente 5 veces (5/5 con correos nuevos)', () => {
  it.each([1, 2, 3, 4, 5])('repetición %i/5', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    const seq = [];
    for (let i = 0; i < 6; i++) seq.push(await attempt(svc, { email: u.email, password: BAD }));
    expect(seq.slice(0, 5).map((s) => s.status)).toEqual([401, 401, 401, 401, 401]);
    expect(seq[5]).toMatchObject({ status: 429, code: 'TOO_MANY_PASSWORD_ATTEMPTS', argon2: 0 });
    expect(seq[5].details!.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(seq.reduce((a, s) => a + s.argon2, 0)).toBe(5);
  });
});

describe('C7-2 — con el candado puesto, la contraseña CORRECTA ⇒ 429 (no 200)', () => {
  it('429, sin argon2', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    await expect(attempt(svc, { email: u.email, password: GOOD })).resolves.toMatchObject({
      status: 429,
      code: 'TOO_MANY_PASSWORD_ATTEMPTS',
      argon2: 0,
    });
  });
});

describe('C7-3 — anti-enumeración: misma secuencia para existente, inexistente, solo-Google y bloqueada', () => {
  it('estado, código, forma del cuerpo, Retry-After y nº de argon2 por paso: idénticos', async () => {
    const { svc, addUser } = makeWorld();
    const cases = {
      existing: addUser().email,
      missing: `nadie-${randomUUID()}@c7.test`,
      googleOnly: addUser({ passwordHash: null }).email,
      blocked: addUser({ status: UserStatus.blocked }).email,
    };
    const seqs: Record<string, unknown[]> = {};
    for (const [name, email] of Object.entries(cases)) {
      const s = [];
      for (let i = 0; i < 7; i++) {
        const r = await attempt(svc, { email, password: BAD });
        s.push({ status: r.status, code: r.code, detailKeys: Object.keys(r.details ?? {}).sort(), retry: r.details?.retryAfterSeconds, argon2: r.argon2 });
      }
      seqs[name] = s;
    }
    expect(seqs.existing).toEqual([
      ...Array(5).fill({ status: 401, code: 'INVALID_CREDENTIALS', detailKeys: [], retry: undefined, argon2: 1 }),
      ...Array(2).fill({ status: 429, code: 'TOO_MANY_PASSWORD_ATTEMPTS', detailKeys: ['retryAfterSeconds'], retry: 60, argon2: 0 }),
    ]);
    expect(seqs.missing).toEqual(seqs.existing);
    expect(seqs.googleOnly).toEqual(seqs.existing);
    expect(seqs.blocked).toEqual(seqs.existing);
  });

  it('el Retry-After sale del reloj inyectado, no de Date.now (a los 30 s del candado dice 30; a los 60 s se abre)', async () => {
    const { svc, addUser, clock } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    await expect(attempt(svc, { email: u.email, password: BAD })).resolves.toMatchObject({ status: 429, details: { retryAfterSeconds: 60 } });
    clock.t += 30_000;
    await expect(attempt(svc, { email: u.email, password: BAD })).resolves.toMatchObject({ status: 429, details: { retryAfterSeconds: 30 } });
    clock.t += 30_000;
    await expect(attempt(svc, { email: u.email, password: BAD })).resolves.toMatchObject({ status: 401 });
  });
});

describe('C7-4 — 20 intentos fallidos SIMULTÁNEOS ⇒ argon2 exactamente 5 y 15 × 429 (N=10, se exige 10/10; almacén en memoria)', () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))('corrida %i/10', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    verifySpy.mockClear();
    const rs = await Promise.all(Array.from({ length: 20 }, () => attempt(svc, { email: u.email, password: BAD })));
    expect(verifySpy).toHaveBeenCalledTimes(5);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(15);
    expect(rs.filter((r) => r.status === 401)).toHaveLength(5);
  });
});

describe('C7-7 — 4 fallos + acierto ⇒ 200; después vuelven a haber 5 libres', () => {
  it('limpia al acertar', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 4; i++) await attempt(svc, { email: u.email, password: BAD });
    await expect(attempt(svc, { email: u.email, password: GOOD })).resolves.toMatchObject({ status: 200 });
    const after = [];
    for (let i = 0; i < 6; i++) after.push((await attempt(svc, { email: u.email, password: BAD })).status);
    expect(after).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('el 200 trae un deviceToken (login)', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    const r = await attempt(svc, { email: u.email, password: GOOD });
    expect(typeof (r.body as { deviceToken: string }).deviceToken).toBe('string');
  });
});

describe('C7-9 — el dueño no queda fuera: con su deviceToken y su contraseña ⇒ 200 aunque un atacante tenga el candado puesto', () => {
  it('200 por el dispositivo', async () => {
    const { svc, addUser } = makeWorld();
    const owner = addUser({ role: Role.super_admin });
    const first = await attempt(svc, { email: owner.email, password: GOOD });
    const deviceToken = (first.body as { deviceToken: string }).deviceToken;
    for (let i = 0; i < 8; i++) await attempt(svc, { email: owner.email, password: BAD }); // atacante, sin token
    await expect(attempt(svc, { email: owner.email, password: GOOD })).resolves.toMatchObject({ status: 429 });
    await expect(attempt(svc, { email: owner.email, password: GOOD, deviceToken })).resolves.toMatchObject({ status: 200 });
  });
});

describe('C7-10 — deviceToken de OTRA cuenta, caducado, mal firmado o con la llave de access ⇒ como ausente', () => {
  it('misma respuesta 429 que sin token', async () => {
    const { svc, addUser } = makeWorld();
    const victim = addUser();
    const other = addUser();
    const otherToken = ((await attempt(svc, { email: other.email, password: GOOD })).body as { deviceToken: string }).deviceToken;
    const victimToken = ((await attempt(svc, { email: victim.email, password: GOOD })).body as { deviceToken: string }).deviceToken;
    const jwt = new JwtService({});
    const key = Buffer.from(hkdfSync('sha256', 'ref-secret-c7', Buffer.alloc(0), 'tcg-hunt/device-token/v1', 32));
    const expired = await jwt.signAsync(
      { typ: 'device', sub: victim.id, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) - 5 },
      { secret: key, algorithm: 'HS256' },
    );
    const withAccessKey = await jwt.signAsync({ typ: 'device', sub: victim.id, jti: randomUUID() }, { secret: 'acc-secret-c7', algorithm: 'HS256' });
    const withRawRefresh = await jwt.signAsync({ typ: 'device', sub: victim.id, jti: randomUUID() }, { secret: 'ref-secret-c7', algorithm: 'HS256' });
    const tampered = victimToken.slice(0, -3) + (victimToken.endsWith('AAA') ? 'BBB' : 'AAA');
    for (let i = 0; i < 5; i++) await attempt(svc, { email: victim.email, password: BAD });
    const without = await attempt(svc, { email: victim.email, password: GOOD });
    expect(without).toMatchObject({ status: 429 });
    for (const deviceToken of [otherToken, expired, withAccessKey, withRawRefresh, tampered, 'basura']) {
      const r = await attempt(svc, { email: victim.email, password: GOOD, deviceToken });
      expect({ status: r.status, code: r.code, details: r.details, argon2: r.argon2 }).toEqual({
        status: without.status,
        code: without.code,
        details: without.details,
        argon2: 0,
      });
    }
  });
});

describe('C7-11 — el cubo del dispositivo', () => {
  it('5 fallos con token ⇒ el 6.º 429 aunque sea la contraseña correcta', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    const deviceToken = ((await attempt(svc, { email: u.email, password: GOOD })).body as { deviceToken: string }).deviceToken;
    for (let i = 0; i < 5; i++) {
      await expect(attempt(svc, { email: u.email, password: BAD, deviceToken })).resolves.toMatchObject({ status: 401 });
    }
    await expect(attempt(svc, { email: u.email, password: GOOD, deviceToken })).resolves.toMatchObject({ status: 429 });
    // Y el cubo de la cuenta NO se tocó: sin token, 5 libres.
    await expect(attempt(svc, { email: u.email, password: GOOD })).resolves.toMatchObject({ status: 200 });
  });

  it('el acierto por el dispositivo NO limpia el cubo de la cuenta (el atacante sigue en 429)', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    const deviceToken = ((await attempt(svc, { email: u.email, password: GOOD })).body as { deviceToken: string }).deviceToken;
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    await expect(attempt(svc, { email: u.email, password: GOOD, deviceToken })).resolves.toMatchObject({ status: 200 });
    await expect(attempt(svc, { email: u.email, password: BAD })).resolves.toMatchObject({ status: 429 });
  });
});

describe('C7-14 — super_admin, vault_operator y customer producen la MISMA secuencia', () => {
  it('sin diferencias por rol', async () => {
    const { svc, addUser } = makeWorld();
    const seqs: number[][] = [];
    for (const role of [Role.super_admin, Role.vault_operator, Role.customer]) {
      const u = addUser({ role });
      const s: number[] = [];
      for (let i = 0; i < 7; i++) s.push((await attempt(svc, { email: u.email, password: BAD })).status);
      seqs.push(s);
    }
    expect(seqs[0]).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect(seqs[1]).toEqual(seqs[0]);
    expect(seqs[2]).toEqual(seqs[0]);
  });
});

describe('C7-15 — bitácora y aviso', () => {
  it('cuenta existente ⇒ UNA fila auth.password_lock sin correo ni contraseña; inexistente ⇒ cero', async () => {
    const { svc, addUser, deps } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 7; i++) await attempt(svc, { email: u.email, password: BAD });
    for (let i = 0; i < 7; i++) await attempt(svc, { email: `nadie-${randomUUID()}@c7.test`, password: BAD });
    const ghost = `ghost-${randomUUID()}@c7.test`;
    for (let i = 0; i < 7; i++) await attempt(svc, { email: ghost, password: BAD });
    await flush();
    const rows = deps.audit.log.mock.calls.map((c) => c[0]).filter((e) => e.action === 'auth.password_lock');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'User',
      entityId: u.id,
      after: { failures: 5, lockSeconds: 60, via: 'account' },
    });
    const dump = JSON.stringify(rows[0]);
    expect(dump).not.toContain(u.email);
    expect(dump).not.toContain('@');
    expect(dump).not.toContain(BAD);
  });

  it('con audit.log que NUNCA resuelve, el 5.º intento responde igual (plazo 2 s)', async () => {
    const hang = { log: jest.fn(() => new Promise<void>(() => undefined)) };
    const { svc, addUser } = makeWorld({ audit: hang });
    const u = addUser();
    for (let i = 0; i < 4; i++) await attempt(svc, { email: u.email, password: BAD });
    const fifth = await Promise.race([
      attempt(svc, { email: u.email, password: BAD }),
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 2000)),
    ]);
    expect(fifth).toMatchObject({ status: 401 });
    await flush();
    expect(hang.log).toHaveBeenCalledTimes(1); // se intentó, pero no se esperó
  });

  it('staff: dos candados en 24 h ⇒ UN correo; customer ⇒ cero', async () => {
    const c = { t: Date.now() };
    const store = new MemoryLoginAttemptStore(() => c.t);
    const { svc, addUser, deps } = makeWorld({ store });
    const admin = addUser({ role: Role.super_admin });
    const op = addUser({ role: Role.vault_operator });
    const cust = addUser({ role: Role.customer });
    for (const u of [admin, op, cust]) {
      for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
      c.t += 61_000; // expira el primer candado
      await attempt(svc, { email: u.email, password: BAD }); // 2.º candado (120 s)
    }
    await flush();
    const locks = deps.audit.log.mock.calls.filter((x) => x[0].action === 'auth.password_lock');
    expect(locks).toHaveLength(6);
    const sent = deps.mail.sendPasswordLockAlert.mock.calls.map((x) => x[0].email);
    expect(sent.sort()).toEqual([admin.email, op.email].sort());
    // Pasadas 24 h, el siguiente candado del staff vuelve a avisar.
    c.t += 24 * 3600_000;
    for (let i = 0; i < 5; i++) await attempt(svc, { email: admin.email, password: BAD });
    await flush();
    expect(deps.mail.sendPasswordLockAlert).toHaveBeenCalledTimes(3);
  });
});

describe('C7-16 — change-password: contador propio por userId', () => {
  it('5 × 422 CURRENT_PASSWORD_INCORRECT ⇒ el 6.º 429 sin argon2 (no 401)', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 5; i++) {
      await expect(svc.changePassword(u.id, { currentPassword: BAD, newPassword: 'nueva-clave-123' })).rejects.toMatchObject({
        code: 'CURRENT_PASSWORD_INCORRECT',
      });
    }
    verifySpy.mockClear();
    const e = await svc.changePassword(u.id, { currentPassword: GOOD, newPassword: 'nueva-clave-123' }).catch((x) => x);
    expect(e).toMatchObject({ code: 'TOO_MANY_PASSWORD_ATTEMPTS', details: { retryAfterSeconds: 60 } });
    expect(e.getStatus()).toBe(429);
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('con el login del mismo usuario bloqueado por un atacante, change-password con la actual correcta ⇒ 200 y limpia los dos', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 6; i++) await attempt(svc, { email: u.email, password: BAD });
    await expect(attempt(svc, { email: u.email, password: GOOD })).resolves.toMatchObject({ status: 429 });
    await expect(svc.changePassword(u.id, { currentPassword: GOOD, newPassword: 'nueva-clave-123' })).resolves.toMatchObject({ ok: true });
    await expect(attempt(svc, { email: u.email, password: 'nueva-clave-123' })).resolves.toMatchObject({ status: 200 });
  });

  it('el candado de change-password pone su bitácora con via change_password y el actor', async () => {
    const { svc, addUser, deps } = makeWorld();
    const u = addUser();
    for (let i = 0; i < 5; i++) await svc.changePassword(u.id, { currentPassword: BAD, newPassword: 'nueva-clave-123' }).catch(() => undefined);
    await flush();
    const rows = deps.audit.log.mock.calls.map((c) => c[0]).filter((x) => x.action === 'auth.password_lock');
    expect(rows).toEqual([
      expect.objectContaining({ actorUserId: u.id, entityId: u.id, after: { failures: 5, lockSeconds: 60, via: 'change_password' } }),
    ]);
  });
});

describe('C7-17 — normalización y canario', () => {
  it('Owner@X.COM y owner@x.com comparten contador', async () => {
    const { svc, addUser } = makeWorld();
    const id = randomUUID().slice(0, 8);
    const u = addUser({ email: `owner-${id}@x.com` });
    const variants = [`Owner-${id}@X.COM`, `owner-${id}@x.com`, `OWNER-${id}@x.Com`, `owner-${id}@X.com`, `Owner-${id}@x.com`];
    for (const email of variants) await expect(attempt(svc, { email, password: BAD })).resolves.toMatchObject({ status: 401 });
    await expect(attempt(svc, { email: u.email, password: GOOD })).resolves.toMatchObject({ status: 429 });
  });

  it('canario: bajo NODE_ENV=test y SIN ninguna variable que lo encienda, el candado está VIVO', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    const escape = Object.keys(process.env).filter((k) => /C7|PASSWORD_ATTEMPT|LOGIN_ATTEMPT|LOCKOUT/i.test(k));
    expect(escape).toEqual([]);
    const { svc } = makeWorld();
    const email = `canario-${randomUUID()}@c7.test`;
    for (let i = 0; i < 5; i++) await attempt(svc, { email, password: BAD });
    await expect(attempt(svc, { email, password: BAD })).resolves.toMatchObject({ status: 429 });
  });
});

describe('C7-8 — qué levanta el candado (a nivel de servicio)', () => {
  async function lockOut(svc: AuthService, email: string) {
    for (let i = 0; i < 5; i++) await attempt(svc, { email, password: BAD });
    await expect(attempt(svc, { email, password: GOOD })).resolves.toMatchObject({ status: 429 });
  }

  it('(a) reset-password completado ⇒ levanta, y devuelve deviceToken', async () => {
    const { svc, addUser, tokens } = makeWorld();
    const u = addUser();
    await lockOut(svc, u.email);
    tokens.consume.mockResolvedValueOnce(u.id);
    const r = await svc.resetPassword('tok', 'otra-clave-123');
    expect(typeof r.deviceToken).toBe('string');
    await expect(attempt(svc, { email: u.email, password: 'otra-clave-123' })).resolves.toMatchObject({ status: 200 });
  });

  it('(b) reset por admin ⇒ levanta', async () => {
    const { svc, addUser, deps, prisma } = makeWorld();
    const u = addUser();
    await lockOut(svc, u.email);
    const admin = new AdminService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      deps.attempts,
    );
    const { tempPassword } = await admin.resetPassword(u.id);
    await expect(attempt(svc, { email: u.email, password: tempPassword })).resolves.toMatchObject({ status: 200 });
  });

  it('(c) change-password correcto ⇒ levanta', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    await lockOut(svc, u.email);
    await svc.changePassword(u.id, { currentPassword: GOOD, newPassword: 'nueva-clave-123' });
    await expect(attempt(svc, { email: u.email, password: 'nueva-clave-123' })).resolves.toMatchObject({ status: 200 });
  });

  it('(d) forgot-password NO: tras pedirlo, el login sigue en 429', async () => {
    const { svc, addUser } = makeWorld();
    const u = addUser();
    await lockOut(svc, u.email);
    await expect(svc.forgotPassword(u.email)).resolves.toEqual({ ok: true });
    await expect(attempt(svc, { email: u.email, password: GOOD })).resolves.toMatchObject({ status: 429 });
  });
});

describe('C7 — deviceToken en las cuatro respuestas: login, google, refresh y reset-password', () => {
  it('google devuelve deviceToken (y NO pasa por el contador por cuenta, §4.57.2 #12)', async () => {
    const google = { verify: jest.fn() } as unknown as GoogleTokenVerifier & { verify: jest.Mock };
    const { svc, addUser, deps } = makeWorld({ google });
    const u = addUser();
    (google.verify as jest.Mock).mockResolvedValue({ sub: 'g-1', email: u.email, emailVerified: true });
    // Candado puesto en la cuenta: google entra igual (no hay contraseña que adivinar).
    for (let i = 0; i < 5; i++) await attempt(svc, { email: u.email, password: BAD });
    const r = await svc.google('id-token');
    expect(typeof r.deviceToken).toBe('string');
    await expect(deps.devices.verify(r.deviceToken)).resolves.toMatchObject({ userId: u.id });
  });

  it('refresh devuelve deviceToken', async () => {
    const { svc, addUser, deps } = makeWorld();
    const u = addUser();
    const { refreshToken } = await svc.issueTokens(u);
    const r = await svc.refresh(refreshToken);
    expect(Object.keys(r).sort()).toEqual(['accessToken', 'deviceToken', 'refreshToken']);
    await expect(deps.devices.verify(r.deviceToken)).resolves.toMatchObject({ userId: u.id });
  });
});
