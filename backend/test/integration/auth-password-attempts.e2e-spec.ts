/**
 * auth-password-attempts.e2e-spec.ts — C7 (v1.80), el límite de intentos de contraseña POR CUENTA,
 * punta a punta: app REAL de Nest (misma cadena de guards, filtro e interceptores que main.ts, con
 * `trust proxy`), Postgres real, HTTP real. `API_CONTRACT §1` «Límite de intentos por cuenta»
 * (`#auth-password-attempts`), `ARCHITECTURE §4.57`. Las mismas propiedades, sin infraestructura y
 * con reloj falso, en `test/auth.c7-policy.spec.ts` y `test/auth.c7-store.spec.ts`.
 *
 * ⛔ Nada aquí enciende ni apaga el candado: bajo `NODE_ENV=test` está VIVO (canario C7-17). El
 * almacén es memoria, nuevo por `AppModule` (§4.57.6); el de Redis se prueba directo en
 * `auth-password-attempts-redis.e2e-spec.ts`.
 */
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { AuthTokenType, Role, UserStatus } from '@prisma/client';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service';
import { LOGIN_ATTEMPT_STORE, MemoryLoginAttemptStore } from '../../src/modules/auth/login-attempt.store';

jest.setTimeout(120_000);

const verifySpy = argon2.verify as unknown as jest.Mock;
const GOOD = 'Correcta-C7-123';
const BAD = 'mala-C7-000';

describe('E2E — C7: límite de intentos de contraseña por cuenta (v1.80)', () => {
  let h: E2EHarness;
  let goodHash: string;
  let ip = 0;

  beforeAll(async () => {
    h = await E2EHarness.create();
    goodHash = await argon2.hash(GOOD);
  });

  afterAll(async () => {
    await h?.close();
  });

  async function newUser(p: { role?: Role; status?: UserStatus; passwordHash?: string | null } = {}) {
    const email = `c7_${randomUUID().slice(0, 12)}@e2e.local`;
    const u = await h.prisma.user.create({
      data: {
        email,
        name: 'C7',
        role: p.role ?? Role.customer,
        status: p.status ?? UserStatus.active,
        passwordHash: p.passwordHash === undefined ? goodHash : p.passwordHash,
        authProvider: p.passwordHash === null ? 'google' : 'local',
        emailVerified: true,
      },
    });
    return u;
  }

  /** Cada intento desde una IP «distinta» por `X-Forwarded-For` (el truco de P-RL-1). */
  function login(email: string, password: string, deviceToken?: string) {
    ip += 1;
    return h.api('POST', '/auth/login', {
      json: { email, password, ...(deviceToken ? { deviceToken } : {}) },
      headers: { 'x-forwarded-for': `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}` },
    });
  }

  async function lockOut(email: string) {
    for (let i = 0; i < 5; i++) expect((await login(email, BAD)).status).toBe(401);
    const r = await login(email, GOOD);
    expect(r.status).toBe(429);
    return r;
  }

  async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 50));
      v = await fn();
    }
    return v;
  }

  it('C7-17 canario: bajo NODE_ENV=test, sin variable que lo encienda, el almacén es memoria (aunque haya REDIS_URL) y el candado vive', async () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(Object.keys(process.env).filter((k) => /C7|PASSWORD_ATTEMPT|LOGIN_ATTEMPT|LOCKOUT/i.test(k))).toEqual([]);
    expect(h.app.get(LOGIN_ATTEMPT_STORE)).toBeInstanceOf(MemoryLoginAttemptStore);
    const u = await newUser();
    await lockOut(u.email!);
  });

  describe('C7-1 — mismo correo, X-Forwarded-For distinto cada vez: 401×5, el 6.º 429 + Retry-After, argon2 exactamente 5 (5/5 con correos nuevos)', () => {
    it.each([1, 2, 3, 4, 5])('repetición %i/5', async () => {
      const u = await newUser();
      verifySpy.mockClear();
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await login(u.email!, BAD)).status);
      const sixth = await login(u.email!, BAD);
      expect(statuses).toEqual([401, 401, 401, 401, 401]);
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.code).toBe('TOO_MANY_PASSWORD_ATTEMPTS');
      const retry = Number(sixth.headers['retry-after']);
      expect(retry).toBeGreaterThanOrEqual(1);
      expect(sixth.body.error.details).toEqual({ retryAfterSeconds: retry });
      expect(verifySpy).toHaveBeenCalledTimes(5);
    });
  });

  it('C7-2 — con el candado puesto, la contraseña CORRECTA ⇒ 429 (no 200)', async () => {
    const u = await newUser();
    const r = await lockOut(u.email!);
    expect(r.body.error.code).toBe('TOO_MANY_PASSWORD_ATTEMPTS');
  });

  it('C7-3 — anti-enumeración: misma secuencia (estado, cuerpo, Retry-After, argon2) para existente, inexistente, solo-Google y bloqueada', async () => {
    const kinds = {
      existing: (await newUser()).email!,
      missing: `c7_nadie_${randomUUID().slice(0, 12)}@e2e.local`,
      googleOnly: (await newUser({ passwordHash: null })).email!,
      blocked: (await newUser({ status: UserStatus.blocked })).email!,
    };
    const seqs: Record<string, unknown[]> = {};
    for (const [k, email] of Object.entries(kinds)) {
      const s = [];
      for (let i = 0; i < 7; i++) {
        const before = verifySpy.mock.calls.length;
        const r = await login(email, BAD);
        s.push({ status: r.status, body: r.body, retryAfter: r.headers['retry-after'] ?? null, argon2: verifySpy.mock.calls.length - before });
      }
      seqs[k] = s;
    }
    expect(seqs.existing.map((x) => (x as { status: number }).status)).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect(seqs.missing).toEqual(seqs.existing);
    expect(seqs.googleOnly).toEqual(seqs.existing);
    expect(seqs.blocked).toEqual(seqs.existing);
  });

  it('C7-4 (por HTTP) — 20 intentos simultáneos contra un correo nuevo ⇒ argon2 exactamente 5 y 15 × 429', async () => {
    const u = await newUser();
    verifySpy.mockClear();
    const rs = await Promise.all(Array.from({ length: 20 }, () => login(u.email!, BAD)));
    expect(verifySpy).toHaveBeenCalledTimes(5);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(15);
    expect(rs.filter((r) => r.status === 401)).toHaveLength(5);
  });

  it('C7-7 — 4 fallos + acierto ⇒ 200 con deviceToken; después vuelven a haber 5 libres', async () => {
    const u = await newUser();
    for (let i = 0; i < 4; i++) await login(u.email!, BAD);
    const ok = await login(u.email!, GOOD);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body).sort()).toEqual(['accessToken', 'deviceToken', 'refreshToken', 'user']);
    const after: number[] = [];
    for (let i = 0; i < 6; i++) after.push((await login(u.email!, BAD)).status);
    expect(after).toEqual([401, 401, 401, 401, 401, 429]);
  });

  describe('C7-8 — qué levanta el candado', () => {
    it('(a) reset-password completado ⇒ levanta y devuelve { ok, deviceToken } (sin sesión)', async () => {
      const u = await newUser();
      await lockOut(u.email!);
      const clear = await h.app.get(AuthTokenService).issue(u.id, AuthTokenType.password_reset);
      const r = await h.api('POST', '/auth/reset-password', { json: { token: clear, password: 'Nueva-C7-456' } });
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['deviceToken', 'ok']);
      expect((await login(u.email!, 'Nueva-C7-456')).status).toBe(200);
    });

    it('(b) reset por admin ⇒ levanta', async () => {
      const u = await newUser();
      await lockOut(u.email!);
      const adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      const r = await h.api('POST', `/admin/users/${u.id}/reset-password`, { token: adminToken });
      expect(r.status).toBe(200);
      expect((await login(u.email!, r.body.tempPassword)).status).toBe(200);
    });

    it('(c) change-password correcto ⇒ levanta (y el 429 del login no le impide cambiarla desde dentro)', async () => {
      const u = await newUser();
      const session = await login(u.email!, GOOD);
      await lockOut(u.email!);
      const r = await h.api('POST', '/auth/change-password', {
        token: session.body.accessToken,
        json: { currentPassword: GOOD, newPassword: 'Nueva-C7-789' },
      });
      expect(r.status).toBe(200);
      expect((await login(u.email!, 'Nueva-C7-789')).status).toBe(200);
    });

    it('(d) forgot-password NO levanta: tras pedirlo, el login sigue en 429', async () => {
      const u = await newUser();
      await lockOut(u.email!);
      expect((await h.api('POST', '/auth/forgot-password', { json: { email: u.email } })).status).toBe(200);
      expect((await login(u.email!, GOOD)).status).toBe(429);
    });
  });

  it('C7-9 — el dueño no queda fuera: con el deviceToken de un login anterior y su contraseña ⇒ 200', async () => {
    const owner = await newUser({ role: Role.super_admin });
    const first = await login(owner.email!, GOOD);
    const deviceToken = first.body.deviceToken as string;
    for (let i = 0; i < 8; i++) await login(owner.email!, BAD); // atacante sin token
    expect((await login(owner.email!, GOOD)).status).toBe(429);
    const mine = await login(owner.email!, GOOD, deviceToken);
    expect(mine.status).toBe(200);
    // ⚠️ El acierto por el dispositivo NO limpia el cubo de la cuenta (C7-11).
    expect((await login(owner.email!, BAD)).status).toBe(429);
  });

  it('C7-10 — deviceToken ajeno ⇒ misma respuesta que sin token; como Bearer ⇒ 401; como refreshToken ⇒ 401', async () => {
    const victim = await newUser();
    const other = await newUser();
    const otherLogin = await login(other.email!, GOOD);
    const foreign = otherLogin.body.deviceToken as string;
    for (let i = 0; i < 5; i++) await login(victim.email!, BAD);
    const without = await login(victim.email!, GOOD);
    const withForeign = await login(victim.email!, GOOD, foreign);
    expect(without.status).toBe(429);
    expect({ s: withForeign.status, b: withForeign.body }).toEqual({ s: without.status, b: without.body });
    expect((await h.api('GET', '/users/me', { token: foreign })).status).toBe(401);
    expect((await h.api('POST', '/auth/refresh', { json: { refreshToken: foreign } })).status).toBe(401);
    // Y el refresh legítimo trae su deviceToken (v1.80).
    const ref = await h.api('POST', '/auth/refresh', { json: { refreshToken: otherLogin.body.refreshToken } });
    expect(ref.status).toBe(200);
    expect(Object.keys(ref.body).sort()).toEqual(['accessToken', 'deviceToken', 'refreshToken']);
  });

  it('C7-11 — cubo del dispositivo: 5 fallos con token ⇒ el 6.º 429 aunque sea la correcta', async () => {
    const u = await newUser();
    const deviceToken = (await login(u.email!, GOOD)).body.deviceToken as string;
    for (let i = 0; i < 5; i++) expect((await login(u.email!, BAD, deviceToken)).status).toBe(401);
    expect((await login(u.email!, GOOD, deviceToken)).status).toBe(429);
    expect((await login(u.email!, GOOD)).status).toBe(200); // el de la cuenta, intacto
  });

  it('C7-14 — super_admin, vault_operator y customer: la misma secuencia', async () => {
    const seqs: number[][] = [];
    for (const role of [Role.super_admin, Role.vault_operator, Role.customer]) {
      const u = await newUser({ role });
      const s: number[] = [];
      for (let i = 0; i < 7; i++) s.push((await login(u.email!, BAD)).status);
      seqs.push(s);
    }
    expect(seqs).toEqual([seqs[2], seqs[2], [401, 401, 401, 401, 401, 429, 429]]);
  });

  it('C7-15 — candado sobre cuenta existente ⇒ UNA fila auth.password_lock sin correo; sobre inexistente ⇒ cero', async () => {
    const u = await newUser();
    const countAll = () => h.prisma.auditLog.count({ where: { action: 'auth.password_lock' } });
    const before = await countAll();
    for (let i = 0; i < 7; i++) await login(u.email!, BAD);
    const rows = await waitFor(
      () => h.prisma.auditLog.findMany({ where: { action: 'auth.password_lock', entityId: u.id } }),
      (r) => r.length >= 1,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'User', actorUserId: null, after: { failures: 5, lockSeconds: 60, via: 'account' } });
    expect(JSON.stringify(rows[0])).not.toContain('@');
    const mid = await countAll();
    expect(mid - before).toBe(1);
    const ghost = `c7_ghost_${randomUUID().slice(0, 12)}@e2e.local`;
    for (let i = 0; i < 7; i++) await login(ghost, BAD);
    await new Promise((r) => setTimeout(r, 300));
    expect(await countAll()).toBe(mid);
  });

  it('C7-16 — change-password: 5 × 422 ⇒ el 6.º 429 + Retry-After, sin argon2; no 401', async () => {
    const u = await newUser();
    const session = (await login(u.email!, GOOD)).body.accessToken as string;
    for (let i = 0; i < 5; i++) {
      const r = await h.api('POST', '/auth/change-password', { token: session, json: { currentPassword: BAD, newPassword: 'Nueva-C7-000' } });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    }
    verifySpy.mockClear();
    const sixth = await h.api('POST', '/auth/change-password', { token: session, json: { currentPassword: GOOD, newPassword: 'Nueva-C7-000' } });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toEqual({
      code: 'TOO_MANY_PASSWORD_ATTEMPTS',
      message: expect.any(String),
      details: { retryAfterSeconds: Number(sixth.headers['retry-after']) },
    });
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('C7-17 — Owner@X.COM y owner@x.com comparten contador (por HTTP)', async () => {
    const u = await newUser();
    const [local, domain] = u.email!.split('@');
    const shout = `${local.toUpperCase()}@${domain.toUpperCase()}`;
    for (let i = 0; i < 5; i++) expect((await login(i % 2 ? shout : u.email!, BAD)).status).toBe(401);
    expect((await login(u.email!, GOOD)).status).toBe(429);
  });

  // ── v1.80.1 (SEC-C7-MINT): el dispositivo es la sesión, por HTTP ─────────────────────────────
  const decode = (t: string) => new JwtService({}).decode(t) as Record<string, unknown>;

  it('C7-19 (por HTTP) — 4 refrescos (2 reproduciendo R0, 2 encadenados) ⇒ 4 deviceToken con el MISMO jti = sid de R0; con la cuenta bloqueada, 5 fallos con el 1.º ⇒ 401×5 y 1 con cada otro ⇒ 429×3; argon2 = 5', async () => {
    const u = await newUser();
    const first = await login(u.email!, GOOD);
    expect(first.status).toBe(200);
    const R0 = first.body.refreshToken as string;
    const sid = decode(R0).sid as string;
    expect(typeof sid).toBe('string');
    expect(decode(first.body.deviceToken as string).jti).toBe(sid);
    const refresh = (t: string) => h.api('POST', '/auth/refresh', { json: { refreshToken: t } });
    const r1 = await refresh(R0);
    const r2 = await refresh(R0);
    const r3 = await refresh(r1.body.refreshToken as string);
    const r4 = await refresh(r3.body.refreshToken as string);
    const devices = [r1, r2, r3, r4].map((r) => {
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['accessToken', 'deviceToken', 'refreshToken']);
      expect(decode(r.body.refreshToken as string).sid).toBe(sid);
      return r.body.deviceToken as string;
    });
    for (const d of devices) expect(decode(d).jti).toBe(sid);
    await lockOut(u.email!);
    verifySpy.mockClear();
    for (let i = 0; i < 5; i++) expect((await login(u.email!, BAD, devices[0])).status).toBe(401);
    for (const d of devices.slice(1)) {
      const r = await login(u.email!, BAD, d);
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe('TOO_MANY_PASSWORD_ATTEMPTS');
    }
    expect(verifySpy).toHaveBeenCalledTimes(5);
  });

  it('C7-20 (por HTTP) — tope agregado: 29 fallos por 8 dispositivos ⇒ 401×29; el 30.º correcto ⇒ 200; el 31.º correcto ⇒ 429 sin argon2', async () => {
    const u = await newUser();
    const devices: string[] = [];
    for (let i = 0; i < 8; i++) devices.push((await login(u.email!, GOOD)).body.deviceToken as string);
    expect(new Set(devices.map((d) => decode(d).jti)).size).toBe(8);
    await lockOut(u.email!);
    verifySpy.mockClear();
    for (let i = 0; i < 29; i++) expect((await login(u.email!, BAD, devices[i % 8])).status).toBe(401);
    expect(verifySpy).toHaveBeenCalledTimes(29);
    expect((await login(u.email!, GOOD, devices[0])).status).toBe(200);
    verifySpy.mockClear();
    const r = await login(u.email!, GOOD, devices[3]);
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('TOO_MANY_PASSWORD_ATTEMPTS');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('C7-21 (por HTTP) — un refresh legado (sin sid) reproducido 3 veces ⇒ el mismo jti; el par nuevo lleva sid y lo conserva', async () => {
    const u = await newUser();
    const legacy = await new JwtService({}).signAsync(
      { sub: u.id, email: u.email, role: u.role, tv: u.tokenVersion, typ: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
    );
    expect(decode(legacy).sid).toBeUndefined();
    const refresh = (t: string) => h.api('POST', '/auth/refresh', { json: { refreshToken: t } });
    const rs = [await refresh(legacy), await refresh(legacy), await refresh(legacy)];
    for (const r of rs) expect(r.status).toBe(200);
    const jtis = rs.map((r) => decode(r.body.deviceToken as string).jti);
    expect(new Set(jtis).size).toBe(1);
    expect(jtis[0]).toBe(`legacy:${u.id}:${decode(legacy).iat}`);
    expect(decode(rs[0].body.refreshToken as string).sid).toBe(jtis[0]);
    const chained = await refresh(rs[0].body.refreshToken as string);
    expect(decode(chained.body.deviceToken as string).jti).toBe(jtis[0]);
  });
});
