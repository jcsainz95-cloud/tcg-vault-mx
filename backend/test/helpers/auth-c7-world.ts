/**
 * auth-c7-world.ts — v1.80.1 (C7): un `AuthService` REAL sobre Prisma en memoria, reloj falso y el
 * almacén de intentos que la spec elija, para las specs C7 que llegaron después de
 * `auth.c7-policy.spec.ts` (C7-19…C7-23). Propiedad: backend.
 *
 * Mismo mundo que el `makeWorld` de `auth.c7-policy.spec.ts` (que se deja intacto: QA lo midió
 * sobre `178c705`), extraído aquí para que las specs nuevas no lo copien una tercera vez.
 *
 * ⛔ Nada aquí apaga el candado: `PasswordAttemptsService` y `DeviceTokenService` son los reales
 * (`makeC7Deps`). `argon2` es el real; si la spec lo envuelve con `jest.mock('argon2', …)`, el
 * `attempt` de abajo cuenta sus llamadas (si no, cuenta 0 y no falla).
 */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../../src/modules/auth/google-token-verifier';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { LoginAttemptStore, MemoryLoginAttemptStore } from '../../src/modules/auth/login-attempt.store';
import { makeC7Deps, C7Deps } from './auth-c7-deps';

export const C7_ACCESS_SECRET = 'acc-secret-c7-world-0123456789abcdef';
export const C7_REFRESH_SECRET = 'ref-secret-c7-world-0123456789abcdef';

export const GOOD = 'correct-horse-battery';
export const BAD = 'wrong-password';

export interface FakeUser {
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

let goodHashCache: Promise<string> | undefined;
/** Hash argon2 REAL de `GOOD`, calculado una vez por proceso (≈ 0,2 s). */
export function goodHash(): Promise<string> {
  goodHashCache ??= argon2.hash(GOOD);
  return goodHashCache;
}

export interface C7World {
  svc: AuthService;
  deps: C7Deps;
  config: ConfigService;
  clock: { t: number };
  store: LoginAttemptStore;
  jwt: JwtService;
  tokens: { consume: jest.Mock; issue: jest.Mock };
  users: Map<string, FakeUser>;
  addUser(p?: Partial<FakeUser>): Promise<FakeUser>;
}

/**
 * `store` opcional: por defecto memoria con el reloj falso del mundo. Una spec que traiga un
 * almacén propio (p. ej. `ResilientLoginAttemptStore` con un Redis simulado, C7-22) debe
 * construirlo con `clock` propio y pasarlo aquí junto con el mismo reloj.
 */
export function makeWorld(
  opts: { store?: LoginAttemptStore; clock?: { t: number }; audit?: { log: jest.Mock } } = {},
): C7World {
  const clock = opts.clock ?? { t: Date.now() };
  const store = opts.store ?? new MemoryLoginAttemptStore(() => clock.t);
  const config = new ConfigService({
    JWT_ACCESS_SECRET: C7_ACCESS_SECRET,
    JWT_REFRESH_SECRET: C7_REFRESH_SECRET,
    PII_HMAC_KEY: randomBytes(32).toString('base64'),
    PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: 'https://app.test',
  });
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
  const deps = makeC7Deps({ config, store, audit: opts.audit });
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
    {} as GoogleTokenVerifier,
    deps.audit as unknown as AuditService,
    tokens as unknown as AuthTokenService,
    mail as unknown as MailService,
    deps.attempts,
    deps.devices,
  );
  const addUser = async (p: Partial<FakeUser> = {}): Promise<FakeUser> => {
    const id = randomUUID();
    const u: FakeUser = {
      id,
      email: `u-${id}@c7.test`,
      name: 'U',
      role: Role.customer,
      status: UserStatus.active,
      passwordHash: await goodHash(),
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
  return { svc, deps, config, clock, store, jwt: new JwtService({}), tokens, users, addUser };
}

export interface AttemptResult {
  status: number;
  code: string | null;
  details: Record<string, unknown> | null;
  /** Llamadas a `argon2.verify` durante ESTE intento (0 si la spec no lo espía). */
  argon2: number;
  body: { deviceToken: string; refreshToken: string; accessToken: string } | null;
}

function verifyCalls(): number {
  const spy = argon2.verify as unknown as { mock?: { calls: unknown[] } };
  return spy.mock?.calls.length ?? 0;
}

/** Un intento de login normalizado: lo que ve el cliente + llamadas a argon2 del paso. */
export async function attempt(
  svc: AuthService,
  body: { email: string; password: string; deviceToken?: string },
): Promise<AttemptResult> {
  const before = verifyCalls();
  try {
    const r = await svc.login(body);
    return { status: 200, code: null, details: null, argon2: verifyCalls() - before, body: r };
  } catch (e: unknown) {
    const ex = e as { getStatus(): number; code: string; details: Record<string, unknown> };
    return { status: ex.getStatus(), code: ex.code, details: ex.details, argon2: verifyCalls() - before, body: null };
  }
}

/** Claims de un JWT sin verificar (para leer `sid`/`jti`/`iat` en las aserciones). */
export function claims(token: string): Record<string, unknown> {
  return new JwtService({}).decode(token) as Record<string, unknown>;
}

/** Deja correr los `setImmediate` de `notifyLock`. */
export const flush = (): Promise<unknown> =>
  new Promise((r) => setImmediate(r)).then(() => new Promise((r) => setImmediate(r)));
