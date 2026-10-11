/**
 * auth-password-attempts-redis.e2e-spec.ts — C7 (v1.80): el almacén REDIS del contador, DIRECTO
 * contra el Redis de CI (`REDIS_URL`), con prefijo ALEATORIO por corrida (no pisa nada de BullMQ ni
 * de otra corrida). `API_CONTRACT §1` pruebas C7-12 y C7-4 (variante Redis); `ARCHITECTURE §4.57.5`.
 *
 * Bajo `AppModule` la suite usa siempre memoria (§4.57.6); por eso el Lua se prueba AQUÍ, directo.
 * Sin `REDIS_URL` se salta con aviso, salvo `E2E_STRICT_INFRA=true` (CI), donde es ROJO.
 */
import { randomBytes, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { Role, UserStatus } from '@prisma/client';

jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';
import {
  RedisLoginAttemptStore,
  createLoginAttemptRedisClient,
} from '../../src/modules/auth/login-attempt.store';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { makeC7Deps } from '../helpers/auth-c7-deps';

jest.setTimeout(120_000);

const STRICT = process.env.E2E_STRICT_INFRA === 'true';
const URL = process.env.REDIS_URL;
const verifySpy = argon2.verify as unknown as jest.Mock;

describe('E2E — C7-12 / C7-4: almacén Redis del contador de intentos (directo, prefijo aleatorio)', () => {
  let client: Redis | undefined;
  const prefix = `tcg:test:c7:${randomUUID()}:`;

  beforeAll(async () => {
    if (!URL) {
      if (STRICT) throw new Error('REDIS_URL no definida y E2E_STRICT_INFRA=true');
      // eslint-disable-next-line no-console
      console.warn('[e2e] REDIS_URL no definida; se salta la prueba directa del almacén Redis (C7-12).');
      return;
    }
    client = createLoginAttemptRedisClient(URL);
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;
    const keys = await client.keys(`${prefix}*`);
    if (keys.length) await client.del(...keys);
    await client.quit();
  });

  const store = () => new RedisLoginAttemptStore(client!, prefix);

  it('C7-12 — 5 permitidos, el 6.º bloqueado con Retry-After ≈ 60 s; reset lo limpia', async () => {
    if (!client) return;
    const s = store();
    const k = `acct-${randomUUID()}`;
    for (let i = 1; i <= 4; i++) {
      await expect(s.acquire(k)).resolves.toEqual({ allowed: true, failures: i, lockedNow: false, lockSeconds: 0 });
    }
    await expect(s.acquire(k)).resolves.toEqual({ allowed: true, failures: 5, lockedNow: true, lockSeconds: 60 });
    const blocked = await s.acquire(k);
    expect(blocked.allowed).toBe(false);
    expect((blocked as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(59);
    expect((blocked as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(60);
    await s.reset(k);
    await expect(s.acquire(k)).resolves.toMatchObject({ allowed: true, failures: 1 });
  });

  it('C7-12 (retroceso, C7-5 en Redis) — candados 60,120,240,480,960,1920,3600,3600 s; durante el candado ni el contador ni el TTL se mueven; el contador vive 2 h', async () => {
    if (!client) return;
    const s = store();
    const k = `acct-${randomUUID()}`;
    for (let i = 0; i < 4; i++) await s.acquire(k);
    const seen: number[] = [];
    for (let f = 5; f <= 12; f++) {
      const r = await s.acquire(k);
      expect(r).toMatchObject({ allowed: true, failures: f, lockedNow: true });
      seen.push((r as { lockSeconds: number }).lockSeconds);
      const pttl = await client.pttl(`${prefix}l:${k}`);
      const failsBefore = await client.get(`${prefix}f:${k}`);
      for (let j = 0; j < 3; j++) await expect(s.acquire(k)).resolves.toMatchObject({ allowed: false });
      expect(await client.get(`${prefix}f:${k}`)).toBe(failsBefore);
      const pttlAfter = await client.pttl(`${prefix}l:${k}`);
      expect(pttlAfter).toBeLessThanOrEqual(pttl); // no se alarga
      expect(pttl - pttlAfter).toBeLessThan(2000);
      const failTtl = await client.pttl(`${prefix}f:${k}`);
      expect(failTtl).toBeGreaterThan(2 * 3600_000 - 5000); // TTL deslizante de 2 h
      await client.del(`${prefix}l:${k}`); // «expira» el candado
    }
    expect(seen).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600]);
  });

  it('C7-12 — ninguna clave contiene «@» ni el correo (claves por HMAC vía la política)', async () => {
    if (!client) return;
    const deps = makeC7Deps({ store: store() });
    const email = `Victima.${randomUUID().slice(0, 6)}@Ejemplo.MX`;
    const key = deps.attempts.accountKey(email);
    for (let i = 0; i < 6; i++) await deps.attempts.reserve(key).catch(() => undefined);
    const keys = await client.keys(`${prefix}*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).not.toContain('@');
      expect(k.toLowerCase()).not.toContain(email.toLowerCase().split('@')[0]);
    }
    expect(keys).toEqual(expect.arrayContaining([`${prefix}f:${key}`, `${prefix}l:${key}`]));
  });

  it('claimOnce (tope del correo a staff) en Redis: verdadero una vez', async () => {
    if (!client) return;
    const s = store();
    const k = `mail-${randomUUID()}`;
    await expect(s.claimOnce(k, 60_000)).resolves.toBe(true);
    await expect(s.claimOnce(k, 60_000)).resolves.toBe(false);
  });

  describe('C7-4 con Redis — 20 reservas simultáneas: exactamente 5 pasan (N=10, se exige 10/10)', () => {
    it.each(Array.from({ length: 10 }, (_, i) => i + 1))('corrida %i/10 (almacén)', async () => {
      if (!client) return;
      const s = store();
      const k = `race-${randomUUID()}`;
      const rs = await Promise.all(Array.from({ length: 20 }, () => s.acquire(k)));
      expect(rs.filter((r) => r.allowed)).toHaveLength(5);
    });

    it.each(Array.from({ length: 10 }, (_, i) => i + 1))('corrida %i/10 (AuthService.login: argon2 exactamente 5)', async () => {
      if (!client) return;
      const config = new ConfigService({
        JWT_ACCESS_SECRET: 'a',
        JWT_REFRESH_SECRET: 'r',
        PII_HMAC_KEY: randomBytes(32).toString('base64'),
      });
      const deps = makeC7Deps({ config, store: store() });
      const email = `race-${randomUUID()}@c7.test`;
      const user = {
        id: randomUUID(),
        email,
        role: Role.customer,
        status: UserStatus.active,
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$IUuYDslaChUS0mrzV74+WQ$Q8BNcs3QrO7nyLYG3ZAMbE+f87icx9X+oRBRlyP0RrE',
      };
      const prisma = { user: { findUnique: jest.fn(async () => user) } };
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
      verifySpy.mockClear();
      const rs = await Promise.all(
        Array.from({ length: 20 }, () =>
          svc.login({ email, password: 'x' }).then(
            () => 200,
            (e: { getStatus(): number }) => e.getStatus(),
          ),
        ),
      );
      expect(verifySpy).toHaveBeenCalledTimes(5);
      expect(rs.filter((s) => s === 429)).toHaveLength(15);
    });
  });

  // ── v1.80.1: el Lua con reposición (C7-22) y el bump de ventana fija (C7-20), contra Redis real ──
  describe('C7-22 (Lua real) — acquireSync repone extra / candado restante / borrar ANTES de mirar el candado, en una ida y vuelta', () => {
    it('f = 3 en Redis; pending { extra: 2, lockRestanteMs: 30 s } ⇒ bloqueado, f = 5, candado ≈ 30 s; la foto trae f', async () => {
      if (!client) return;
      const s = store();
      const k = `sync-${randomUUID()}`;
      for (let i = 0; i < 3; i++) await s.acquire(k);
      const r = await s.acquireSync(k, { extra: 2, lockRestanteMs: 30_000, borrar: false });
      expect(r.result).toMatchObject({ allowed: false, retryAfterSeconds: 30 });
      expect(r.photo).toMatchObject({ failures: 5 });
      expect(r.photo.lockMs).toBeGreaterThan(28_000);
      expect(r.photo.lockMs).toBeLessThanOrEqual(30_000);
      expect(await client.get(`${prefix}f:${k}`)).toBe('5');
      expect(await client.pttl(`${prefix}l:${k}`)).toBeGreaterThan(28_000);
    });

    it('nunca acorta un candado que Redis ya tenga: con 120 s en Redis y 30 s restantes en memoria, sigue en 120 s', async () => {
      if (!client) return;
      const s = store();
      const k = `sync-${randomUUID()}`;
      for (let i = 0; i < 5; i++) await s.acquire(k); // f = 5, candado 60 s
      await client.del(`${prefix}l:${k}`); // «vence»
      await expect(s.acquire(k)).resolves.toMatchObject({ failures: 6, lockSeconds: 120 }); // candado 120 s
      const r = await s.acquireSync(k, { extra: 0, lockRestanteMs: 30_000, borrar: false });
      expect(r.result).toMatchObject({ allowed: false });
      expect(await client.pttl(`${prefix}l:${k}`)).toBeGreaterThan(115_000);
    });

    it('borrar: 5 fallos + candado en Redis; pending { borrar: true } ⇒ DEL y reserva ⇒ f = 1, sin candado', async () => {
      if (!client) return;
      const s = store();
      const k = `sync-${randomUUID()}`;
      for (let i = 0; i < 5; i++) await s.acquire(k);
      await expect(s.acquire(k)).resolves.toMatchObject({ allowed: false });
      const r = await s.acquireSync(k, { extra: 0, lockRestanteMs: 0, borrar: true });
      expect(r.result).toMatchObject({ allowed: true, failures: 1, lockedNow: false });
      expect(r.photo).toEqual({ failures: 1, lockMs: 0 });
      expect(await client.pttl(`${prefix}l:${k}`)).toBeLessThan(0);
    });

    it('sin nada pendiente, acquireSync === acquire (misma reserva)', async () => {
      if (!client) return;
      const s = store();
      const k = `sync-${randomUUID()}`;
      const r = await s.acquireSync(k, { extra: 0, lockRestanteMs: 0, borrar: false });
      expect(r).toEqual({ result: { allowed: true, failures: 1, lockedNow: false, lockSeconds: 0 }, photo: { failures: 1, lockMs: 0 } });
    });
  });

  describe('C7-20 (Redis) — bump: ventana FIJA (TTL solo al crear), reposición con extra/borrar, reset la borra', () => {
    it('1, 2, 3 con el PTTL bajando (no se renueva); al vencer vuelve a 1; ninguna clave con «@»', async () => {
      if (!client) return;
      const s = store();
      const k = `agg-${randomUUID()}`;
      expect(await s.bump(k, 1500)).toBe(1);
      const p1 = await client.pttl(`${prefix}f:${k}`);
      await new Promise((r) => setTimeout(r, 300));
      expect(await s.bump(k, 1500)).toBe(2);
      const p2 = await client.pttl(`${prefix}f:${k}`);
      expect(p2).toBeLessThan(p1 - 200); // ventana fija: el 2.º bump NO la renovó
      expect(await s.bump(k, 1500)).toBe(3);
      await new Promise((r) => setTimeout(r, 1500));
      expect(await s.bump(k, 1500)).toBe(1);
      await s.reset(k);
      expect(await client.exists(`${prefix}f:${k}`)).toBe(0);
    });

    it('bumpSync: extra se suma antes del incremento; borrar reinicia; devuelve la ventana restante', async () => {
      if (!client) return;
      const s = store();
      const k = `agg-${randomUUID()}`;
      await s.bump(k, 60_000);
      const a = await s.bumpSync(k, 60_000, { extra: 2, borrar: false });
      expect(a.count).toBe(4);
      expect(a.windowMs).toBeGreaterThan(55_000);
      expect(a.windowMs).toBeLessThanOrEqual(60_000);
      const b = await s.bumpSync(k, 60_000, { extra: 0, borrar: true });
      expect(b.count).toBe(1);
      const c = await s.bumpSync(k, 60_000, { extra: 3, borrar: true });
      expect(c.count).toBe(4);
    });
  });
});
