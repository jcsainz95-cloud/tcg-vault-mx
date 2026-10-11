/**
 * LIVE-2 (API_CONTRACT §14.2, v1.84 · S5-1) — tope ABSOLUTO de vida de la sesión.
 *
 * Decisión del dueño: `HECHOS.md` fila «Listo para dinero real — respuestas del dueño (2026-10-05) a §4.63.9»,
 * P-6 «Cada 7 días»: «tope de sesión 7 días para el panel (personal y dueño) y 30 días para clientes».
 *
 * El refresh token lleva `sat` (segundos epoch del nacimiento de la sesión). `refresh()`:
 *  - `now − sat >= tope(rol LEÍDO DE BD)` ⇒ `401 UNAUTHENTICATED {reason:'session_max_age'}` (v1.84.1, §14.14 E-1:
 *    misma frontera que `now >= exp`; antes `>`, y en el segundo exacto el 401 salía sin `reason`);
 *  - el refresh nuevo conserva `sid` y `sat` y lleva `exp = min(now + JWT_REFRESH_TTL, sat + tope)`;
 *  - token legado sin `sat` ⇒ `sat = iat`.
 *
 * Reloj falso: `Date.now` (lo usan `jsonwebtoken` para `iat`/`exp` y el servicio para `now`).
 * Sin infraestructura: Prisma en memoria, `JwtService` real, `DeviceTokenService` real.
 *
 * Mutaciones que la ponen roja (tabla SES del contrato): quitar la comparación del paso 3 (SES-1/2/5);
 * usar el tope de cliente para todos (SES-2/5); `exp` fijo de `JWT_REFRESH_TTL` (SES-3); `sat = now` para el
 * legado (SES-4); leer el rol del token (SES-5); devolver el claim en el cuerpo (SES-6); volver a `>` (SES-7);
 * quitar la comprobación manual de `exp` (SES-8).
 */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { randomBytes, randomUUID } from 'crypto';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';
import { AuthTokenService } from '../src/modules/auth/auth-token.service';
import { MailService } from '../src/modules/mail/mail.service';
import { makeC7Deps } from './helpers/auth-c7-deps';

const REFRESH_SECRET = 'ref-secret-ses-0123456789abcdef0123456789';
const DAY = 24 * 60 * 60;
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0); // ms

function makeWorld(role: Role) {
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'acc-secret-ses-0123456789abcdef0123456789',
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    // TTL deliberadamente LARGO (90 d): así el tope de sesión es lo único que puede cortar la cadena.
    JWT_REFRESH_TTL: '90d',
    PII_HMAC_KEY: randomBytes(32).toString('base64'),
    PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: 'https://app.test',
  });
  const user = {
    id: randomUUID(),
    email: `ses-${randomUUID()}@test`,
    username: null,
    name: 'U',
    role,
    status: UserStatus.active,
    passwordHash: null as string | null,
    tokenVersion: 0,
    locale: 'es',
    emailVerified: true,
    mustChangePassword: false,
    nameSource: 'user',
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => (where.id === user.id ? { ...user } : null)),
      update: jest.fn(),
    },
  };
  const deps = makeC7Deps({ config });
  const svc = new AuthService(
    prisma as unknown as PrismaService,
    new JwtService({}),
    config,
    {} as GoogleTokenVerifier,
    deps.audit as unknown as AuditService,
    {} as AuthTokenService,
    {} as MailService,
    deps.attempts,
    deps.devices,
  );
  return { svc, user, jwt: new JwtService({}) };
}

let nowMs = T0;
beforeEach(() => {
  nowMs = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterEach(() => jest.restoreAllMocks());

const at = (days: number) => {
  nowMs = T0 + days * DAY * 1000;
};

type Outcome = { ok: true; refreshToken: string; body: Record<string, unknown> } | { ok: false; status: number; reason?: unknown };

async function refresh(svc: AuthService, token: string): Promise<Outcome> {
  try {
    const body = (await svc.refresh(token)) as unknown as Record<string, unknown>;
    return { ok: true, refreshToken: body.refreshToken as string, body };
  } catch (e: unknown) {
    const ex = e as { getStatus(): number; getResponse(): { details?: { reason?: unknown } } };
    return { ok: false, status: ex.getStatus(), reason: ex.getResponse().details?.reason };
  }
}

/** Cadena de refrescos día a día (como un navegador que vuelve cada día) hasta `untilDay`. */
async function chainUntil(svc: AuthService, first: string, untilDay: number): Promise<{ token: string; last: Outcome }> {
  let token = first;
  let last: Outcome = { ok: true, refreshToken: first, body: {} };
  for (let d = 1; d <= untilDay; d++) {
    at(d);
    last = await refresh(svc, token);
    if (!last.ok) return { token, last };
    token = last.refreshToken;
  }
  return { token, last };
}

describe('LIVE-2 · SES-1 — cliente: tope de 30 días desde `sat`', () => {
  it('día 29 ⇒ 200; día 31 ⇒ 401 {reason:"session_max_age"}', async () => {
    const { svc, user } = makeWorld(Role.customer);
    const { refreshToken } = await svc.issueTokens(user);
    const upTo29 = await chainUntil(svc, refreshToken, 29);
    expect(upTo29.last.ok).toBe(true);
    at(31);
    const r = await refresh(svc, upTo29.token);
    expect(r).toEqual({ ok: false, status: 401, reason: 'session_max_age' });
  });
});

describe('LIVE-2 · SES-2 — staff (super_admin y vault_operator): tope de 7 días', () => {
  it.each([Role.super_admin, Role.vault_operator])('%s: día 6 ⇒ 200; día 8 ⇒ 401 {reason:"session_max_age"}', async (role) => {
    const { svc, user } = makeWorld(role);
    const { refreshToken } = await svc.issueTokens(user);
    const upTo6 = await chainUntil(svc, refreshToken, 6);
    expect(upTo6.last.ok).toBe(true);
    at(8);
    const r = await refresh(svc, upTo6.token);
    expect(r).toEqual({ ok: false, status: 401, reason: 'session_max_age' });
  });
});

describe('LIVE-2 · SES-3 — `exp` del refresh = min(now + TTL, sat + tope)', () => {
  it('el refresh emitido el día 29 de un cliente lleva exp ≤ sat + 30 d (no 90 d desde ahora) y conserva sat y sid', async () => {
    const { svc, user, jwt } = makeWorld(Role.customer);
    const { refreshToken } = await svc.issueTokens(user);
    const birth = jwt.decode(refreshToken) as { sat: number; sid: string; exp: number };
    expect(birth.sat).toBe(Math.floor(T0 / 1000));
    // En el nacimiento ya rige el tope (TTL 90 d > 30 d).
    expect(birth.exp).toBe(birth.sat + 30 * DAY);
    const upTo29 = await chainUntil(svc, refreshToken, 29);
    expect(upTo29.last.ok).toBe(true);
    const p = jwt.decode(upTo29.token) as { sat: number; sid: string; exp: number };
    expect(p.sat).toBe(birth.sat);
    expect(p.sid).toBe(birth.sid);
    expect(p.exp).toBeLessThanOrEqual(birth.sat + 30 * DAY);
  });

  it('con TTL corto (1 d) gana now + TTL', async () => {
    const { svc, user, jwt } = makeWorld(Role.customer);
    (svc as unknown as { config: ConfigService }).config.set('JWT_REFRESH_TTL', '1d');
    const { refreshToken } = await svc.issueTokens(user);
    at(3 / 24);
    const r = await refresh(svc, refreshToken);
    expect(r.ok).toBe(true);
    const p = jwt.decode((r as { refreshToken: string }).refreshToken) as { exp: number };
    expect(p.exp).toBe(Math.floor(nowMs / 1000) + DAY);
  });

  it('el access token NO gana `sat` (es claim del refresh, §14.2)', async () => {
    const { svc, user, jwt } = makeWorld(Role.customer);
    const { accessToken } = await svc.issueTokens(user);
    expect(jwt.decode(accessToken)).not.toHaveProperty('sat');
  });
});

describe('LIVE-2 · SES-4 — token legado sin `sat` ⇒ `sat = iat`', () => {
  async function legacyToken(jwt: JwtService, user: { id: string; email: string; role: Role; tokenVersion: number }) {
    // Forma exacta de un refresh pre-v1.84: sin `sat`, TTL de 30 d.
    return jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, tv: user.tokenVersion, typ: 'refresh', sid: randomUUID() },
      { secret: REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
    );
  }

  it('el siguiente refresh lleva sat = iat del token presentado', async () => {
    const { svc, user, jwt } = makeWorld(Role.customer);
    const legacy = await legacyToken(jwt, user);
    const iat = (jwt.decode(legacy) as { iat: number }).iat;
    at(2);
    const r = await refresh(svc, legacy);
    expect(r.ok).toBe(true);
    expect((jwt.decode((r as { refreshToken: string }).refreshToken) as { sat: number }).sat).toBe(iat);
  });

  it('staff con legado de 8 días (exp de 30 d aún vivo) ⇒ 401 session_max_age', async () => {
    const { svc, user, jwt } = makeWorld(Role.super_admin);
    const legacy = await legacyToken(jwt, user);
    at(8);
    expect(await refresh(svc, legacy)).toEqual({ ok: false, status: 401, reason: 'session_max_age' });
  });
});

describe('LIVE-2 · SES-5 — el rol se lee de BD, no del token', () => {
  it('cliente ascendido a staff con sesión de 10 días ⇒ el siguiente refresh es 401 session_max_age', async () => {
    const { svc, user } = makeWorld(Role.customer);
    const { refreshToken } = await svc.issueTokens(user);
    const upTo9 = await chainUntil(svc, refreshToken, 9);
    expect(upTo9.last.ok).toBe(true);
    user.role = Role.vault_operator; // ascenso en BD; el token sigue diciendo `customer`
    at(10);
    expect(await refresh(svc, upTo9.token)).toEqual({ ok: false, status: 401, reason: 'session_max_age' });
  });
});

describe('LIVE-2 · SES-6 — `sat` y `sid` jamás en un cuerpo', () => {
  it('issueTokens y refresh devuelven exactamente sus llaves de siempre', async () => {
    const { svc, user } = makeWorld(Role.customer);
    const pair = await svc.issueTokens(user);
    expect(Object.keys(pair).sort()).toEqual(['accessToken', 'refreshToken']);
    at(1);
    const r = await refresh(svc, pair.refreshToken);
    expect(r.ok).toBe(true);
    const body = (r as { body: Record<string, unknown> }).body;
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'deviceToken', 'refreshToken']);
    expect(JSON.stringify(body)).not.toMatch(/"(sat|sid)"/);
  });
});

describe('LIVE-2 · SES-7 (v1.84.1) — en EXACTAMENTE `sat + tope` el 401 lleva reason', () => {
  // §14.14 E-1: `exp = sat + tope`, así que en el segundo exacto las dos fronteras coinciden. Con `>` el paso del
  // tope no dispara y el de `exp` sí ⇒ 401 SIN reason. Con `>=` sale `session_max_age`.
  it.each([
    [Role.customer, 30],
    [Role.super_admin, 7],
    [Role.vault_operator, 7],
  ])('%s (tope %i d): un segundo antes ⇒ 200; en el segundo exacto sat + tope ⇒ 401 {reason:"session_max_age"}', async (role, days) => {
    const { svc, user, jwt } = makeWorld(role as Role);
    const { refreshToken } = await svc.issueTokens(user);
    const birth = jwt.decode(refreshToken) as { sat: number; exp: number };
    expect(birth.exp).toBe(birth.sat + (days as number) * DAY); // precondición: exp cae justo en el tope
    nowMs = (birth.sat + (days as number) * DAY - 1) * 1000;
    expect((await refresh(svc, refreshToken)).ok).toBe(true);
    nowMs = (birth.sat + (days as number) * DAY) * 1000;
    expect(await refresh(svc, refreshToken)).toEqual({ ok: false, status: 401, reason: 'session_max_age' });
  });
});

describe('LIVE-2 · SES-8 (v1.84.1) — caducado por `exp` (no por tope) ⇒ 401 SIN reason y sin par; sin `exp` ⇒ 401', () => {
  function spyPair(svc: AuthService) {
    const issue = jest.spyOn(svc, 'issueTokens');
    const devices = (svc as unknown as { devices: { issue: (...a: unknown[]) => unknown } }).devices;
    const dev = jest.spyOn(devices, 'issue');
    return { issue, dev };
  }

  it('TTL 1 d, presentado al día 2 (sesión de 2 d, muy dentro del tope) ⇒ 401 sin reason y ningún par', async () => {
    const { svc, user } = makeWorld(Role.customer);
    (svc as unknown as { config: ConfigService }).config.set('JWT_REFRESH_TTL', '1d');
    const { refreshToken } = await svc.issueTokens(user);
    const { issue, dev } = spyPair(svc);
    at(2);
    expect(await refresh(svc, refreshToken)).toEqual({ ok: false, status: 401, reason: undefined });
    expect(issue).not.toHaveBeenCalled();
    expect(dev).not.toHaveBeenCalled();
  });

  it('TTL 1 d, presentado en EXACTAMENTE exp (now >= exp) ⇒ 401 sin reason', async () => {
    const { svc, user, jwt } = makeWorld(Role.customer);
    (svc as unknown as { config: ConfigService }).config.set('JWT_REFRESH_TTL', '1d');
    const { refreshToken } = await svc.issueTokens(user);
    const { exp } = jwt.decode(refreshToken) as { exp: number };
    nowMs = exp * 1000;
    expect(await refresh(svc, refreshToken)).toEqual({ ok: false, status: 401, reason: undefined });
  });

  it('refresh bien firmado SIN `exp` (con sat reciente) ⇒ 401 sin reason y ningún par', async () => {
    const { svc, user, jwt } = makeWorld(Role.customer);
    const noExp = await jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        tv: user.tokenVersion,
        typ: 'refresh',
        sid: randomUUID(),
        sat: Math.floor(T0 / 1000),
      },
      { secret: REFRESH_SECRET, algorithm: 'HS256' },
    );
    expect(jwt.decode(noExp)).not.toHaveProperty('exp');
    const { issue, dev } = spyPair(svc);
    at(1);
    expect(await refresh(svc, noExp)).toEqual({ ok: false, status: 401, reason: undefined });
    expect(issue).not.toHaveBeenCalled();
    expect(dev).not.toHaveBeenCalled();
  });
});

describe('LIVE-2 — ttlSeconds interpreta JWT_REFRESH_TTL igual que jsonwebtoken', () => {
  // Paridad medida contra `jsonwebtoken` real (`exp − iat` con `expiresIn`), no contra una tabla escrita a mano.
  it.each(['30d', '15m', '1d', '90d', '2 hours', '1.5h', '7 days', '1w', '1y', '3600', '45s', 3600, 0])(
    '%p',
    async (ttl) => {
      const { ttlSeconds } = await import('../src/modules/auth/session-max-age');
      const jwt = new JwtService({});
      const t = await jwt.signAsync({ a: 1 }, { secret: 's', algorithm: 'HS256', expiresIn: ttl as string });
      const p = jwt.decode(t) as { iat: number; exp: number };
      expect(ttlSeconds(ttl)).toBe(p.exp - p.iat);
    },
  );

  it('formato inválido ⇒ lanza (como jsonwebtoken), nunca un TTL por defecto', async () => {
    const { ttlSeconds } = await import('../src/modules/auth/session-max-age');
    for (const bad of ['', 'abc', '30 lunas', '1d2h']) expect(() => ttlSeconds(bad)).toThrow();
  });
});
