/**
 * stf.errata-v1-80-9-1.spec.ts — errata v1.80.9.1 (`API_CONTRACT §M6-U.11`, `ARCHITECTURE §4.58.9`), las piezas sin
 * infraestructura:
 *  - **STF-31** (D-4): `ResilientLoginAttemptStore.peekLockMs` — degradado o Redis sin contestar ⇒ lanza
 *    `LoginAttemptStoreUnavailableError`, ⛔ sin leer la memoria y ⛔ sin `markDown`.
 *  - **STF-33** (TD-9): `AdminService.lockedUntilOf` falla en alto — sin `PasswordAttemptsService` lanza, y solo la
 *    clase del almacén se traduce a `lockState:'unavailable'` (listado y ficha).
 * Lo de punta a punta (STF-32, STF-34 con BD, STF-35, STF-36) vive en `test/integration/stf-errata-v1-80-9-1.e2e-spec.ts`
 * y `test/integration/staff-without-email.e2e-spec.ts`; STF-34 sin BD en `prisma/reset-admin-password.username.spec.ts`.
 */
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import {
  LoginAttemptStoreUnavailableError,
  MemoryLoginAttemptStore,
  ResilientLoginAttemptStore,
} from '../src/modules/auth/login-attempt.store';
import { AdminService } from '../src/modules/admin/admin.service';
import { PasswordAttemptsService } from '../src/modules/auth/password-attempts.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { FakeRedisAttemptStore } from './helpers/fake-redis-attempt-store';

function fakeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

describe('STF-31 — peekLockMs del almacén resiliente: degradado o Redis sin contestar ⇒ LoginAttemptStoreUnavailableError', () => {
  it('(a) degradado ⇒ rechaza con la clase AUNQUE la memoria tenga un candado vivo para la clave; el primario recibe 0 llamadas', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    const memory = new MemoryLoginAttemptStore(c.now);
    const s = new ResilientLoginAttemptStore(redis, memory, undefined, 250, 30_000, c.now);
    // Degradar el almacén con una operación del login sobre OTRA clave.
    redis.mode = 'throw';
    await s.acquire('otra');
    expect(s.degraded).toBe(true);
    // Candado vivo EN LA MEMORIA para la clave consultada.
    for (let i = 0; i < 5; i++) await memory.acquire('k');
    expect(await memory.peekLockMs('k')).toBe(60_000);
    redis.mode = 'ok';
    redis.calls = 0;
    await expect(s.peekLockMs('k')).rejects.toBeInstanceOf(LoginAttemptStoreUnavailableError);
    expect(redis.calls).toBe(0);
  });

  it.each(['throw', 'hang'] as const)(
    '(b) primario que %s ⇒ rechaza con la clase, degraded sigue false y el siguiente acquire llega al primario',
    async (mode) => {
      const c = fakeClock();
      const redis = new FakeRedisAttemptStore(c.now);
      const memory = new MemoryLoginAttemptStore(c.now);
      // Plazo real corto: `withTimeout` usa `setTimeout` de verdad.
      const s = new ResilientLoginAttemptStore(redis, memory, undefined, 20, 30_000, c.now);
      for (let i = 0; i < 5; i++) await memory.acquire('k'); // la memoria NO debe leerse
      redis.mode = mode;
      await expect(s.peekLockMs('k')).rejects.toBeInstanceOf(LoginAttemptStoreUnavailableError);
      expect(s.degraded).toBe(false);
      redis.mode = 'ok';
      redis.calls = 0;
      await s.acquire('k2');
      expect(redis.calls).toBe(1);
    },
  );

  it('(c) primario sano con PTTL 42 000 ⇒ resuelve 42000', async () => {
    const c = fakeClock();
    const redis = new FakeRedisAttemptStore(c.now);
    redis.locks.set('k', c.now() + 42_000);
    const s = new ResilientLoginAttemptStore(redis, new MemoryLoginAttemptStore(c.now), undefined, 250, 30_000, c.now);
    await expect(s.peekLockMs('k')).resolves.toBe(42_000);
  });

  it('memoria pura (sin REDIS_URL) nunca lanza: la memoria ES la fuente configurada', async () => {
    const c = fakeClock();
    const m = new MemoryLoginAttemptStore(c.now);
    for (let i = 0; i < 5; i++) await m.acquire('k');
    await expect(m.peekLockMs('k')).resolves.toBe(60_000);
  });
});

// ───────────────────────────────────────────── STF-33 ─────────────────────────────────────────────

const pii = new PiiCryptoService(new ConfigService({}));

const ROWS = [
  { id: 'u1', email: null, username: 'ana', name: 'Ana', role: Role.vault_operator, status: 'active', createdAt: new Date(), kycProfile: null },
  { id: 'u2', email: 'c@x.mx', username: null, name: 'C', role: Role.customer, status: 'active', createdAt: new Date(), kycProfile: null },
];

const DETAIL = {
  id: 'u1',
  email: null,
  username: 'ana',
  name: 'Ana',
  nameSource: 'user',
  role: 'vault_operator',
  status: 'active',
  locale: 'es',
  emailVerified: false,
  authProvider: 'local',
  phone: null,
  avatarUrl: null,
  mustChangePassword: false,
  deletedAt: null,
  anonymizedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  kycProfile: null,
  billingProfile: null,
  addresses: [],
  orders: [],
  sellRequests: [],
  disputes: [],
  ownedItems: [],
  shipmentRequests: [],
};

function adminWith(attempts?: Pick<PasswordAttemptsService, 'lockMsForUser'>) {
  const prisma = {
    priceReference: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findMany: jest.fn().mockResolvedValue(ROWS),
      count: jest.fn().mockResolvedValue(ROWS.length),
      findUnique: jest.fn().mockResolvedValue(DETAIL),
    },
  };
  return new AdminService(
    prisma as unknown as PrismaService,
    { fxSnapshotSafe: jest.fn().mockResolvedValue(null) } as unknown as PricingService,
    pii,
    {} as UploadsService,
    undefined,
    attempts as PasswordAttemptsService | undefined,
  );
}

describe('STF-33 — lockedUntilOf falla en alto: solo LoginAttemptStoreUnavailableError ⇒ unavailable', () => {
  it('(a) construido SIN PasswordAttemptsService ⇒ listUsers y getUser RECHAZAN (no resuelven unavailable)', async () => {
    const svc = adminWith(undefined);
    await expect(svc.listUsers({ page: 1, pageSize: 20 })).rejects.toThrow(/PasswordAttemptsService is not wired/);
    await expect(svc.getUser('u1', Role.super_admin)).rejects.toThrow(/PasswordAttemptsService is not wired/);
    await expect(svc.getUser('u1', Role.vault_operator)).rejects.toThrow(/PasswordAttemptsService is not wired/);
  });

  it('(b) lockMsForUser lanza un Error que NO es la clase del almacén ⇒ listUsers y getUser rechazan con ESE error', async () => {
    const boom = new Error('boom');
    const svc = adminWith({ lockMsForUser: jest.fn().mockRejectedValue(boom) });
    await expect(svc.listUsers({ page: 1, pageSize: 20 })).rejects.toBe(boom);
    await expect(svc.getUser('u1', Role.super_admin)).rejects.toBe(boom);
  });

  it('(c) lanza LoginAttemptStoreUnavailableError ⇒ listado y ficha (los dos roles) resuelven lockState unavailable, todas null', async () => {
    const svc = adminWith({ lockMsForUser: jest.fn().mockRejectedValue(new LoginAttemptStoreUnavailableError('degraded')) });
    const list = await svc.listUsers({ page: 1, pageSize: 20 });
    expect(list.lockState).toBe('unavailable');
    expect(list.data.map((u) => u.lockedUntil)).toEqual([null, null]);
    for (const role of [Role.super_admin, Role.vault_operator]) {
      const d = (await svc.getUser('u1', role)) as unknown as Record<string, unknown>;
      expect([role, d.lockState, d.lockedUntil]).toEqual([role, 'unavailable', null]);
    }
  });

  it('almacén sano ⇒ ok; la ficha trae lockState ok y lockedUntil = ahora + ms', async () => {
    const svc = adminWith({ lockMsForUser: jest.fn().mockResolvedValue(42_000) });
    const t0 = Date.now();
    const list = await svc.listUsers({ page: 1, pageSize: 20 });
    expect(list.lockState).toBe('ok');
    for (const role of [Role.super_admin, Role.vault_operator]) {
      const d = (await svc.getUser('u1', role)) as unknown as Record<string, unknown>;
      expect(d.lockState).toBe('ok');
      const until = Date.parse(d.lockedUntil as string);
      expect(until).toBeGreaterThanOrEqual(t0 + 42_000);
      expect(until).toBeLessThanOrEqual(Date.now() + 42_000);
    }
  });
});
