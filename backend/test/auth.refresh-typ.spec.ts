/**
 * SEC-C7-RT (2026-09-29, deuda del techlead «Alta» + seguridad «Baja») — `AuthService.refresh()`
 * exige `typ === 'refresh'` y un `tv` numérico. Sin infraestructura: Prisma en memoria, `JwtService`
 * real, `DeviceTokenService` real.
 *
 * Por qué muerde aunque los secretos sean distintos en producción: `env.validation.ts` NO impide
 * `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET`. El primer `describe` modela esa configuración
 * (permitida) y muestra que, sin la comprobación de `typ`, un access token vale como refresh. El
 * segundo modela un `deviceToken` firmado con la llave de refresh tal cual (C7-10, «con la llave de
 * refresh tal cual»): verifica la firma, y sin `typ`/`tv` estrictos, `tv ?? 0` casaba con
 * `tokenVersion = 0` y emitía sesión.
 *
 * Mutaciones que ponen esto en rojo: quitar `payload.typ !== 'refresh'`; volver a `(payload.tv ?? 0)`.
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

const REFRESH_SECRET = 'ref-secret-rt-0123456789abcdef0123456789';

function makeConfig(accessSecret: string) {
  return new ConfigService({
    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    PII_HMAC_KEY: randomBytes(32).toString('base64'),
    PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: 'https://app.test',
  });
}

function makeWorld(config: ConfigService) {
  const user = {
    id: randomUUID(),
    email: `rt-${randomUUID()}@test`,
    name: 'U',
    role: Role.customer,
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
  return { svc, user, prisma, deps, jwt: new JwtService({}) };
}

async function refreshStatus(svc: AuthService, token: string): Promise<number | 'ok'> {
  try {
    await svc.refresh(token);
    return 'ok';
  } catch (e: unknown) {
    return (e as { getStatus(): number }).getStatus();
  }
}

describe('SEC-C7-RT — refresh() exige typ === "refresh"', () => {
  it('control: un refresh legítimo sigue valiendo (200) y con tokenVersion distinto ⇒ 401', async () => {
    const { svc, user } = makeWorld(makeConfig('acc-secret-rt-0123456789abcdef0123456789'));
    const { refreshToken } = await svc.issueTokens(user);
    await expect(refreshStatus(svc, refreshToken)).resolves.toBe('ok');
    user.tokenVersion = 1;
    await expect(refreshStatus(svc, refreshToken)).resolves.toBe(401);
  });

  it('con JWT_ACCESS_SECRET === JWT_REFRESH_SECRET (env.validation lo permite), un ACCESS token presentado como refresh ⇒ 401', async () => {
    const { svc, user, prisma } = makeWorld(makeConfig(REFRESH_SECRET));
    const { accessToken } = await svc.issueTokens(user);
    await expect(refreshStatus(svc, accessToken)).resolves.toBe(401);
    // Y no se emitió ningún par: el `tv` y el `sub` eran válidos, lo que lo tira es el `typ`.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('un deviceToken real (llave HKDF) presentado como refresh ⇒ 401', async () => {
    const { svc, user, deps } = makeWorld(makeConfig('acc-secret-rt-0123456789abcdef0123456789'));
    const deviceToken = await deps.devices.issue(user.id);
    await expect(refreshStatus(svc, deviceToken)).resolves.toBe(401);
  });

  it('un token { typ: "device" } firmado con JWT_REFRESH_SECRET tal cual (C7-10) presentado como refresh ⇒ 401', async () => {
    const { svc, user, jwt } = makeWorld(makeConfig('acc-secret-rt-0123456789abcdef0123456789'));
    const rawDevice = await jwt.signAsync(
      { typ: 'device', sub: user.id, jti: randomUUID() },
      { secret: REFRESH_SECRET, algorithm: 'HS256', expiresIn: '90d' },
    );
    await expect(refreshStatus(svc, rawDevice)).resolves.toBe(401);
  });
});

describe('SEC-C7-RT — refresh() exige tv numérico (no `tv ?? 0`)', () => {
  it('un refresh bien firmado SIN tv, contra una cuenta con tokenVersion = 0 ⇒ 401 (antes: 200 porque `tv ?? 0`)', async () => {
    const { svc, user, jwt } = makeWorld(makeConfig('acc-secret-rt-0123456789abcdef0123456789'));
    expect(user.tokenVersion).toBe(0);
    const noTv = await jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, typ: 'refresh' },
      { secret: REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
    );
    await expect(refreshStatus(svc, noTv)).resolves.toBe(401);
  });

  it('un refresh con tv NO numérico ("0") ⇒ 401', async () => {
    const { svc, user, jwt } = makeWorld(makeConfig('acc-secret-rt-0123456789abcdef0123456789'));
    const strTv = await jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, typ: 'refresh', tv: '0' },
      { secret: REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
    );
    await expect(refreshStatus(svc, strTv)).resolves.toBe(401);
  });

  it('un refresh con tv numérico igual al vigente ⇒ 200 (el control del control)', async () => {
    const { svc, user, jwt } = makeWorld(makeConfig('acc-secret-rt-0123456789abcdef0123456789'));
    const ok = await jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, typ: 'refresh', tv: 0 },
      { secret: REFRESH_SECRET, algorithm: 'HS256', expiresIn: '30d' },
    );
    await expect(refreshStatus(svc, ok)).resolves.toBe('ok');
  });
});
