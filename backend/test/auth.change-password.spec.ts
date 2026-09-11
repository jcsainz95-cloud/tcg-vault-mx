import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import * as argon2 from 'argon2';

// `argon2` es un módulo nativo: sus exports no son redefinibles con `jest.spyOn`. Se envuelve el REAL
// en un `jest.fn` para poder aseverar «no se verificó nada» (paso 2) sin cambiar el comportamiento.
jest.mock('argon2', () => {
  const real = jest.requireActual('argon2');
  return { ...real, verify: jest.fn(real.verify), hash: real.hash };
});
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthTokenService } from '../src/modules/auth/auth-token.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';
import { BusinessException } from '../src/common/business.exception';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { ChangePasswordDto } from '../src/modules/auth/dto/auth.dto';
import { MIN_PASSWORD_LENGTH } from '../src/common/validation/credentials';

/**
 * v1.67 (Stream A · B3/B7, contrato §1 «Cambiar la propia contraseña», ARCHITECTURE §4.47.1) —
 * `POST /auth/change-password`: orden de evaluación NORMATIVO, códigos 422 (nunca 401 para «actual
 * incorrecta»), UNA escritura con `tokenVersion +1`, par NUEVO emitido con la versión ya incrementada
 * (⇒ el `tv` viejo cae en 401 y el nuevo pasa), `emailVerified` intacto, auditoría sin secretos.
 * Además: `publicUser` gana `mustChangePassword` (D-CTA-1) y `google()` escribe `nameSource` (D-CTA-4).
 */
const config = new ConfigService({
  JWT_ACCESS_SECRET: 'unit_access_secret',
  JWT_REFRESH_SECRET: 'unit_refresh_secret',
  APP_BASE_URL: 'https://app.tcghunt.mx',
  DEFAULT_LOCALE: 'es',
});
const google = {} as unknown as GoogleTokenVerifier;
const tokens = {
  issue: jest.fn(async () => 'tok'),
  consume: jest.fn(async () => null),
  ownerOf: jest.fn(async () => null),
  countIssuedLastHour: jest.fn(async () => 0),
} as unknown as AuthTokenService;
const mail = {
  sendEmailVerification: jest.fn(async () => undefined),
  sendPasswordReset: jest.fn(async () => undefined),
} as unknown as MailService;

const CURRENT = 'Temporal123!';
const NEW = 'Definitiva456!';
let CURRENT_HASH: string;

beforeAll(async () => {
  CURRENT_HASH = await argon2.hash(CURRENT);
});

function baseUser(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'u@x.com',
    passwordHash: CURRENT_HASH,
    role: 'customer',
    name: 'U',
    locale: 'es',
    status: 'active',
    authProvider: 'local',
    emailVerified: false,
    mustChangePassword: true,
    tokenVersion: 1,
    ...over,
  };
}

function make(user: Record<string, unknown> | null, jwt?: JwtService) {
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...(user ?? {}),
    ...data,
    tokenVersion: ((user?.tokenVersion as number) ?? 0) + 1,
  }));
  const prisma = { user: { findUnique: jest.fn(async () => user), update } };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new AuthService(
    prisma as unknown as PrismaService,
    jwt ?? ({ signAsync: jest.fn(async () => 'tok') } as unknown as JwtService),
    config,
    google,
    audit as unknown as AuditService,
    tokens,
    mail,
  );
  return { svc, prisma, audit, update };
}

async function grab(p: Promise<unknown>): Promise<BusinessException> {
  try {
    await p;
  } catch (e) {
    return e as BusinessException;
  }
  throw new Error('debió lanzar');
}

describe('AuthService.changePassword — orden de evaluación normativo', () => {
  it('paso 1: cuenta no activa / inexistente ⇒ 401 UNAUTHENTICATED, sin escribir', async () => {
    for (const u of [null, baseUser({ status: 'blocked' }), baseUser({ status: 'deleted' })]) {
      const { svc, update } = make(u);
      const err = await grab(svc.changePassword('u1', { currentPassword: CURRENT, newPassword: NEW }));
      expect(err.code).toBe('UNAUTHENTICATED');
      expect(err.getStatus()).toBe(401);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('paso 2: passwordHash NULL (solo-Google) ⇒ 422 PASSWORD_NOT_SET, y NO se verifica nada más', async () => {
    const verify = argon2.verify as unknown as jest.Mock;
    verify.mockClear();
    const { svc, update } = make(baseUser({ passwordHash: null, authProvider: 'google' }));
    const err = await grab(svc.changePassword('u1', { currentPassword: 'lo-que-sea', newPassword: NEW }));
    expect(err.code).toBe('PASSWORD_NOT_SET');
    expect(err.getStatus()).toBe(422);
    expect(err.details).toEqual({});
    expect(verify).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('paso 3: actual incorrecta ⇒ 422 CURRENT_PASSWORD_INCORRECT con details.field — y NUNCA 401', async () => {
    const { svc, update, audit } = make(baseUser());
    const err = await grab(svc.changePassword('u1', { currentPassword: 'equivocada!', newPassword: NEW }));
    expect(err.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect(err.getStatus()).toBe(422);
    expect(err.getStatus()).not.toBe(401);
    expect(err.details).toEqual({ field: 'currentPassword' });
    expect(update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('paso 4 va DESPUÉS del 3: actual incorrecta y nueva == actual ⇒ CURRENT_PASSWORD_INCORRECT (no SAME)', async () => {
    const { svc } = make(baseUser());
    const err = await grab(svc.changePassword('u1', { currentPassword: 'equivocada!', newPassword: 'equivocada!' }));
    expect(err.code).toBe('CURRENT_PASSWORD_INCORRECT');
  });

  it('paso 4: actual correcta y nueva == actual ⇒ 422 PASSWORD_SAME_AS_CURRENT (details.field=newPassword)', async () => {
    const { svc, update } = make(baseUser());
    const err = await grab(svc.changePassword('u1', { currentPassword: CURRENT, newPassword: CURRENT }));
    expect(err.code).toBe('PASSWORD_SAME_AS_CURRENT');
    expect(err.getStatus()).toBe(422);
    expect(err.details).toEqual({ field: 'newPassword' });
    expect(update).not.toHaveBeenCalled();
  });

  it('paso 5: UNA escritura — hash nuevo (argon2id), tokenVersion +1, mustChangePassword=false; emailVerified y authProvider NO se tocan', async () => {
    const { svc, update } = make(baseUser());
    await svc.changePassword('u1', { currentPassword: CURRENT, newPassword: NEW });
    expect(update).toHaveBeenCalledTimes(1);
    const { where, data } = update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(where).toEqual({ id: 'u1' });
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.mustChangePassword).toBe(false);
    expect(data).not.toHaveProperty('emailVerified');
    expect(data).not.toHaveProperty('authProvider');
    expect(typeof data.passwordHash).toBe('string');
    expect(data.passwordHash).not.toBe(CURRENT_HASH);
    expect(String(data.passwordHash).startsWith('$argon2id$')).toBe(true);
    await expect(argon2.verify(String(data.passwordHash), NEW)).resolves.toBe(true);
    // La contraseña nunca viaja en claro a la BD.
    expect(JSON.stringify(data)).not.toContain(NEW);
  });

  it('paso 6: devuelve { ok, accessToken, refreshToken } emitidos con el tokenVersion YA incrementado', async () => {
    const signAsync = jest.fn(async (payload: { tv: number }) => `tok-tv${payload.tv}`);
    const { svc } = make(baseUser({ tokenVersion: 4 }), { signAsync } as unknown as JwtService);
    const res = await svc.changePassword('u1', { currentPassword: CURRENT, newPassword: NEW });
    expect(res).toEqual({ ok: true, accessToken: 'tok-tv5', refreshToken: 'tok-tv5' });
    // Los DOS tokens llevan tv=5 (el de `updated`), no tv=4 (el de la fila leída).
    expect(signAsync.mock.calls.map((c) => (c[0] as { tv: number }).tv)).toEqual([5, 5]);
  });

  it('paso 7: audita auth.password_changed (User, actor = el propio usuario) sin volcar contraseñas', async () => {
    const { svc, audit } = make(baseUser({ role: 'vault_operator' }));
    await svc.changePassword('u1', { currentPassword: CURRENT, newPassword: NEW }, '10.0.0.7');
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      actorUserId: 'u1',
      actorRole: 'vault_operator',
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: 'u1',
      ip: '10.0.0.7',
    });
    const dump = JSON.stringify(entry);
    expect(dump).not.toContain(CURRENT);
    expect(dump).not.toContain(NEW);
    expect(dump).not.toContain('$argon2');
  });
});

describe('Efecto medible del par nuevo (contrato paso 6): tv viejo ⇒ 401, tv nuevo ⇒ 200', () => {
  function guardCtx(token: string) {
    const req = { headers: { authorization: `Bearer ${token}` } };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('con JwtService REAL: el access viejo cae y el devuelto pasa contra la fila con tokenVersion+1', async () => {
    const jwt = new JwtService({});
    const { svc } = make(baseUser({ tokenVersion: 1 }), jwt);
    const old = await svc.issueTokens({ id: 'u1', email: 'u@x.com', role: 'customer' as never, tokenVersion: 1 });
    const res = await svc.changePassword('u1', { currentPassword: CURRENT, newPassword: NEW });

    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const prismaAfter = {
      user: {
        findUnique: jest.fn(async () => ({
          status: 'active',
          tokenVersion: 2, // la fila tras el cambio
          emailVerified: false,
          mustChangePassword: false,
        })),
      },
    } as unknown as PrismaService;
    const guard = new JwtAuthGuard(reflector, jwt, config, prismaAfter);

    const oldErr = await guard.canActivate(guardCtx(old.accessToken)).catch((e) => e as BusinessException);
    expect((oldErr as BusinessException).getStatus()).toBe(401);
    await expect(guard.canActivate(guardCtx(res.accessToken))).resolves.toBe(true);
  });
});

describe('publicUser (D-CTA-1) — login emite mustChangePassword', () => {
  it.each([true, false])('login ⇒ user.mustChangePassword = %s (200, sin rechazar)', async (flag) => {
    const { svc } = make(baseUser({ mustChangePassword: flag }));
    const res = await svc.login({ email: 'u@x.com', password: CURRENT });
    expect(res.user).toEqual({
      id: 'u1',
      email: 'u@x.com',
      name: 'U',
      role: 'customer',
      locale: 'es',
      emailVerified: false,
      mustChangePassword: flag,
    });
    expect(typeof res.accessToken).toBe('string');
  });
});

describe('google() alta nueva (D-CTA-4) — escribe nameSource', () => {
  function makeGoogle(identity: { sub: string; email: string; emailVerified: boolean; name?: string }) {
    const create = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'new',
      status: 'active',
      tokenVersion: 0,
      ...data,
    }));
    const prisma = { user: { findUnique: jest.fn(async () => null), update: jest.fn(), create } };
    const verifier = { verify: jest.fn(async () => identity) } as unknown as GoogleTokenVerifier;
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      { signAsync: jest.fn(async () => 'tok') } as unknown as JwtService,
      config,
      verifier,
      { log: jest.fn(async () => undefined) } as unknown as AuditService,
      tokens,
      mail,
    );
    return { svc, create };
  }

  it('el ID token trae name ⇒ name=<name>, nameSource=google', async () => {
    const { svc, create } = makeGoogle({ sub: 'g1', email: 'ana@x.com', emailVerified: true, name: 'Ana Pérez' });
    await svc.google('t');
    expect(create.mock.calls[0][0].data).toMatchObject({ name: 'Ana Pérez', nameSource: 'google' });
  });

  it('sin name ⇒ name=<trozo del correo>, nameSource=derived (la regla del backfill M-52b, hacia delante)', async () => {
    const { svc, create } = makeGoogle({ sub: 'g1', email: 'jcsainz95@x.com', emailVerified: true });
    await svc.google('t');
    expect(create.mock.calls[0][0].data).toMatchObject({ name: 'jcsainz95', nameSource: 'derived' });
  });

  it('name en blanco ⇒ cuenta como ausente: derived (no se guarda "" ni se marca google)', async () => {
    const { svc, create } = makeGoogle({ sub: 'g1', email: 'jcsainz95@x.com', emailVerified: true, name: '   ' });
    await svc.google('t');
    expect(create.mock.calls[0][0].data).toMatchObject({ name: 'jcsainz95', nameSource: 'derived' });
  });
});

describe('Controlador — throttle y DTO', () => {
  it('change-password está limitado a 5/min (paridad con login)', () => {
    const fn = AuthController.prototype.changePassword;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', fn)).toBe(5);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', fn)).toBe(60_000);
  });

  it('ChangePasswordDto: currentPassword no vacía; newPassword con MIN_PASSWORD_LENGTH (la misma constante)', async () => {
    const { validate } = await import('class-validator');
    const short = Object.assign(new ChangePasswordDto(), { currentPassword: 'x', newPassword: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) });
    const okDto = Object.assign(new ChangePasswordDto(), { currentPassword: 'x', newPassword: 'a'.repeat(MIN_PASSWORD_LENGTH) });
    const empty = Object.assign(new ChangePasswordDto(), { currentPassword: '', newPassword: 'a'.repeat(MIN_PASSWORD_LENGTH) });
    expect((await validate(short)).map((e) => e.property)).toEqual(['newPassword']);
    expect(await validate(okDto)).toHaveLength(0);
    expect((await validate(empty)).map((e) => e.property)).toEqual(['currentPassword']);
  });
});
