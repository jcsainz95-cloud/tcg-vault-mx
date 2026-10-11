/**
 * stf.staff-without-email.spec.ts — v1.80.9 (`API_CONTRACT §M6-U`), las piezas puras y sin infraestructura de las
 * pruebas STF: forma del usuario (STF-5), clave del cubo (STF-19), DTOs del login/forgot/register (STF-8, STF-12),
 * el guard de «sin correo no es cliente» (STF-28), la lectura del candado del almacén en memoria (STF-24) y el aviso
 * de candado sin correo (STF-23) con reloj y dobles. Lo de punta a punta vive en
 * `test/integration/staff-without-email.e2e-spec.ts`.
 */
import 'reflect-metadata';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role, UserStatus } from '@prisma/client';
import { checkUsername, normalizeIdentifier, normalizeEmail } from '../src/common/validation/credentials';
import { ForgotPasswordDto, LoginDto, RegisterDto } from '../src/modules/auth/dto/auth.dto';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { passwordAttemptKeysForUser, PasswordAttemptsService } from '../src/modules/auth/password-attempts.service';
import { MemoryLoginAttemptStore } from '../src/modules/auth/login-attempt.store';
import { EmailVerifiedGuard } from '../src/common/guards/email-verified.guard';
import { BusinessException } from '../src/common/business.exception';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

const errorsOf = <T extends object>(cls: new () => T, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, body) as object, { whitelist: true }).map((e) => e.property);

describe('STF-5 (unidad) — checkUsername: reglas en orden required → length → charset → start', () => {
  it.each([
    ['ana', 'ana'],
    ['luis.p', 'luis.p'],
    ['op_2', 'op_2'],
    ['m-r', 'm-r'],
    ['a' + 'b'.repeat(29), 'a' + 'b'.repeat(29)],
    ['  Luis.Q  ', 'luis.q'],
  ])('acepta %j ⇒ %j', (raw, value) => {
    expect(checkUsername(raw)).toEqual({ ok: true, value });
  });

  it.each([
    ['', 'required'],
    ['   ', 'required'],
    [undefined, 'required'],
    ['ab', 'length'],
    ['a' + 'b'.repeat(30), 'length'],
    ['a b', 'charset'],
    ['a@b', 'charset'],
    ['josé', 'charset'],
    ['niño', 'charset'],
    ['1ab', 'start'],
    ['.ab', 'start'],
    ['-ab', 'start'],
    ['_ab', 'start'],
  ])('rechaza %j con %s', (raw, rule) => {
    expect(checkUsername(raw)).toEqual({ ok: false, rule });
  });

  it('una sola función de normalización para correo y usuario', () => {
    expect(normalizeIdentifier).toBe(normalizeEmail);
  });
});

describe('STF-19 — la clave del cubo: la de hoy para un correo; un usuario nunca coincide con un correo', () => {
  const pii = new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: randomBytes(32).toString('base64'), PII_ENCRYPTION_KEY: randomBytes(32).toString('base64') }));
  const attempts = new PasswordAttemptsService(new MemoryLoginAttemptStore(), pii, {} as AuditService, {} as MailService, {} as PrismaService);

  it('vector fijo: accountKey("Owner@X.com") === blindIndex("auth-pw:v1:owner@x.com")', () => {
    expect(attempts.accountKey('Owner@X.com')).toBe(pii.blindIndex('auth-pw:v1:owner@x.com'));
    expect(attempts.accountKey(' ANA ')).toBe(pii.blindIndex('auth-pw:v1:ana'));
  });

  it('cuenta con correo ⇒ cubo de su correo; sin correo ⇒ cubo de su usuario; sin ninguno ⇒ lanza (nunca el cubo de "")', () => {
    expect(passwordAttemptKeysForUser(pii, { id: 'u1', email: 'Owner@X.com', username: null }).account).toBe(attempts.accountKey('owner@x.com'));
    expect(passwordAttemptKeysForUser(pii, { id: 'u1', email: null, username: 'ana' }).account).toBe(attempts.accountKey('ana'));
    expect(passwordAttemptKeysForUser(pii, { id: 'u1', email: null, username: 'ana' }).account).not.toBe(attempts.accountKey('ana@x.com'));
    expect(() => passwordAttemptKeysForUser(pii, { id: 'u1', email: null, username: null })).toThrow();
  });
});

describe('STF-8 / STF-12 (DTO) — identificador del login y del forgot; register sigue exigiendo correo', () => {
  it('LoginDto: sin @ ⇒ válido (usuario, sin validar forma); con @ ⇒ formato de correo como hoy; 1–254 tras trim', () => {
    expect(errorsOf(LoginDto, { email: 'ana', password: 'x' })).toEqual([]);
    expect(errorsOf(LoginDto, { email: 'a b', password: 'x' })).toEqual([]);
    expect(errorsOf(LoginDto, { email: 'José', password: 'x' })).toEqual([]);
    expect(errorsOf(LoginDto, { email: 'owner@x.com', password: 'x' })).toEqual([]);
    expect(errorsOf(LoginDto, { email: 'a@b', password: 'x' })).toEqual(['email']);
    expect(errorsOf(LoginDto, { email: '   ', password: 'x' })).toEqual(['email']);
    expect(errorsOf(LoginDto, { email: '', password: 'x' })).toEqual(['email']);
    expect(errorsOf(LoginDto, { email: 'a'.repeat(255), password: 'x' })).toEqual(['email']);
    expect(errorsOf(LoginDto, { email: 42, password: 'x' })).toEqual(['email']);
  });

  it('ForgotPasswordDto: la misma regla que el login', () => {
    expect(errorsOf(ForgotPasswordDto, { email: 'ana' })).toEqual([]);
    expect(errorsOf(ForgotPasswordDto, { email: 'owner@x.com' })).toEqual([]);
    expect(errorsOf(ForgotPasswordDto, { email: 'a@b' })).toEqual(['email']);
    expect(errorsOf(ForgotPasswordDto, { email: '' })).toEqual(['email']);
  });

  it('RegisterDto: "ana" ⇒ error en email (sin cambio)', () => {
    expect(errorsOf(RegisterDto, { email: 'ana', password: 'Password123!', name: 'Ana' })).toEqual(['email']);
  });
});

describe('STF-28 (unidad) — EmailVerifiedGuard: sin correo ⇒ 403 ACCOUNT_WITHOUT_EMAIL ANTES de mirar emailVerified', () => {
  const ctx = (user: object | undefined) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => ({}), getClass: () => ({}) }) as unknown as ExecutionContext;
  const guard = () => {
    const r = new Reflector();
    jest.spyOn(r, 'getAllAndOverride').mockReturnValue(true);
    return new EmailVerifiedGuard(r);
  };
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return 'passed';
    } catch (e) {
      return `${(e as BusinessException).getStatus()} ${(e as BusinessException).code}`;
    }
  };

  it('hasEmail=false ⇒ 403 ACCOUNT_WITHOUT_EMAIL (aunque emailVerified sea false)', () => {
    expect(codeOf(() => guard().canActivate(ctx({ hasEmail: false, emailVerified: false })))).toBe('403 ACCOUNT_WITHOUT_EMAIL');
  });
  it('con correo sin verificar ⇒ EMAIL_NOT_VERIFIED como hoy; verificado ⇒ pasa', () => {
    expect(codeOf(() => guard().canActivate(ctx({ hasEmail: true, emailVerified: false })))).toBe('403 EMAIL_NOT_VERIFIED');
    expect(codeOf(() => guard().canActivate(ctx({ hasEmail: true, emailVerified: true })))).toBe('passed');
  });
});

describe('STF-24 (unidad) — peekLockMs del almacén en memoria: ms restantes del candado, 0 sin candado, sin efectos', () => {
  it('0 sin entrada; tras el 5.º intento ⇒ 60 000 y baja con el reloj; leer no cuenta ni alarga', async () => {
    let now = 1_000_000;
    const s = new MemoryLoginAttemptStore(() => now);
    expect(await s.peekLockMs('k')).toBe(0);
    for (let i = 0; i < 4; i++) await s.acquire('k');
    expect(await s.peekLockMs('k')).toBe(0);
    await s.acquire('k');
    expect(await s.peekLockMs('k')).toBe(60_000);
    now += 10_000;
    expect(await s.peekLockMs('k')).toBe(50_000);
    expect(s.peek('k')!.failures).toBe(5);
    now += 50_000;
    expect(await s.peekLockMs('k')).toBe(0);
  });
});

describe('STF-23 (unidad) — notifyLock: sin correo ⇒ lockNoticeAt (después de claimOnce); con correo ⇒ correo', () => {
  const pii = new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: randomBytes(32).toString('base64'), PII_ENCRYPTION_KEY: randomBytes(32).toString('base64') }));
  const flush = () => new Promise((r) => setTimeout(r, 20));
  const build = () => {
    const store = new MemoryLoginAttemptStore();
    const mail = { sendPasswordLockAlert: jest.fn(async () => undefined) };
    const audit = { log: jest.fn(async () => undefined) };
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const svc = new PasswordAttemptsService(store, pii, audit as unknown as AuditService, mail as unknown as MailService, { user: { updateMany } } as unknown as PrismaService);
    return { svc, mail, updateMany };
  };
  const user = (email: string | null) => ({ id: 'u-1', email, username: email ? null : 'ana', name: 'Ana', role: Role.vault_operator, status: UserStatus.active });
  const locked = { failures: 5, lockedNow: true, lockSeconds: 60 };

  it('sin correo: un updateMany {id, email:null} ⇒ lockNoticeAt; cero correos; el segundo candado en 24 h no escribe', async () => {
    const { svc, mail, updateMany } = build();
    svc.notifyLock(locked, { via: 'account', accountKey: 'k', user: user(null) });
    await flush();
    expect(mail.sendPasswordLockAlert).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'u-1', email: null }, data: { lockNoticeAt: expect.any(Date) } });
    svc.notifyLock(locked, { via: 'account', accountKey: 'k', user: user(null) });
    await flush();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('con correo: un correo y ninguna escritura del aviso', async () => {
    const { svc, mail, updateMany } = build();
    svc.notifyLock(locked, { via: 'account', accountKey: 'k', user: user('op@x.com') });
    await flush();
    expect(mail.sendPasswordLockAlert).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('STF-3 / STF-15 (unidad) — AuditedSuperAdminGuard: 403 + fila a quien no es super_admin; el rechazo no depende de la bitácora', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AuditedSuperAdminGuard } = require('../src/modules/admin/audited-super-admin.guard');
  const ctx = (role: string, attempted: string, params: Record<string, string> = {}) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'actor-1', role }, params }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;
  const build = (attempted: string, log: jest.Mock) => {
    const r = new Reflector();
    jest.spyOn(r, 'get').mockReturnValue(attempted);
    return new AuditedSuperAdminGuard(r, { log } as unknown as AuditService);
  };

  it('super_admin pasa sin fila', async () => {
    const log = jest.fn(async () => undefined);
    await expect(build('create', log).canActivate(ctx('super_admin', 'create'))).resolves.toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it('vault_operator en alta ⇒ 403 FORBIDDEN + fila {attempted:create}, entityId ausente (NULL)', async () => {
    const log = jest.fn(async () => undefined);
    await expect(build('create', log).canActivate(ctx('vault_operator', 'create'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(log).toHaveBeenCalledWith({
      actorUserId: 'actor-1',
      actorRole: 'vault_operator',
      action: 'user.admin_action_denied',
      entityType: 'User',
      entityId: undefined,
      after: { attempted: 'create' },
    });
  });

  it('vault_operator en reset ⇒ 403 + fila con entityId = :id; con la bitácora caída ⇒ 403 igual', async () => {
    const log = jest.fn(async () => undefined);
    await expect(build('reset_password', log).canActivate(ctx('vault_operator', 'reset_password', { id: 'u-9' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((log.mock.calls[0] as unknown[])[0]).toMatchObject({ entityId: 'u-9', after: { attempted: 'reset_password' } });
    const failing = jest.fn(async () => {
      throw new Error('db down');
    });
    await expect(build('reset_password', failing).canActivate(ctx('vault_operator', 'reset_password', { id: 'u-9' }))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
