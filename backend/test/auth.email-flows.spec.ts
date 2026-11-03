import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthTokenType } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthTokenService } from '../src/modules/auth/auth-token.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';
import { c7Args } from './helpers/auth-c7-deps';

/**
 * v1.5 — Flujos de correo del AuthService:
 *  - forgot-password: anti-enumeración (200 aunque el email no exista; no envía correo).
 *  - reset-password: incrementa tokenVersion, setea emailVerified=true, marca token usado (consume).
 *  - verify-email: marca emailVerified; idempotente ante doble clic; 422 si el token es inválido.
 *  - resend: no-op si ya verificado; 429 si excede el tope por hora.
 * v1.117.2 (§CTA.13, D-CTA-12, D-CTA-14): emisión y canje dentro del candado de la cuenta y atados al correo; verify-email pide
 * `password` o `newPassword`; forgot-password responde antes de buscar la cuenta.
 */

const jwt = { signAsync: jest.fn(async () => 'tok') } as unknown as JwtService;
const config = new ConfigService({ APP_BASE_URL: 'https://app.tcghunt.mx', DEFAULT_LOCALE: 'es' });
const google = {} as unknown as GoogleTokenVerifier;

/**
 * v1.117.2 (§CTA.13): emisión y canje van dentro de `withAccountGate` (`$transaction` + `pg_advisory_xact_lock`). El doble de
 * Prisma hace de su propia `tx`: `$transaction(fn)` llama a `fn(prisma)` y `$executeRaw` registra el candado.
 */
function withTx(prisma: any) {
  prisma.$executeRaw = prisma.$executeRaw ?? jest.fn(async () => 0);
  prisma.$transaction = prisma.$transaction ?? jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.address = prisma.address ?? { updateMany: jest.fn(async () => ({ count: 0 })) };
  return prisma;
}

function make(overrides: {
  prisma?: any;
  tokens?: Partial<AuthTokenService>;
  mail?: Partial<MailService>;
  audit?: Partial<AuditService>;
}) {
  const prisma = withTx(overrides.prisma ?? { user: { findUnique: jest.fn(), update: jest.fn() } });
  const tokens = {
    issue: jest.fn(async () => 'CLEARTOKEN'),
    consume: jest.fn(async () => null),
    ownerOf: jest.fn(async () => null),
    isLive: jest.fn(async () => false),
    isUsed: jest.fn(async () => false),
    countIssuedLastHour: jest.fn(async () => 0),
    // v1.117 (§CTA.5): `reset-password` anula además los `account_setup` pendientes.
    voidPending: jest.fn(async () => 0),
    ...overrides.tokens,
  } as unknown as AuthTokenService;
  const mail = {
    sendEmailVerification: jest.fn(async () => undefined),
    sendPasswordReset: jest.fn(async () => undefined),
    ...overrides.mail,
  } as unknown as MailService;
  const audit = { log: jest.fn(async () => undefined), ...overrides.audit } as unknown as AuditService;
  const svc = new AuthService(prisma as PrismaService, jwt, config, google, audit, tokens, mail, ...c7Args());
  return { svc, prisma, tokens, mail, audit };
}

/** v1.117.2 (D-CTA-14): `forgot-password` responde antes de buscar; el trabajo corre después. */
async function forgot(svc: AuthService, email: string) {
  const res = await svc.forgotPassword(email);
  await svc.backgroundIdle();
  return res;
}

describe('forgot-password — anti-enumeración', () => {
  it('email inexistente → 200 { ok:true } y NO envía correo ni emite token', async () => {
    const prisma: any = { user: { findUnique: jest.fn(async () => null), update: jest.fn() } };
    const { svc, tokens, mail } = make({ prisma });
    await expect(forgot(svc, 'nobody@x.com')).resolves.toEqual({ ok: true });
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('email existente y activo → 200 { ok:true } y emite token (bajo el candado, atado a su correo) + envía correo con link', async () => {
    const user = { id: 'u1', email: 'a@x.com', name: 'A', locale: 'es', status: 'active', role: 'customer', passwordHash: 'h' };
    const prisma: any = { user: { findUnique: jest.fn(async () => user), update: jest.fn() } };
    const { svc, tokens, mail } = make({ prisma });
    await expect(forgot(svc, 'A@X.com')).resolves.toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tokens.issue).toHaveBeenCalledWith(prisma, { id: 'u1', email: 'a@x.com' }, AuthTokenType.password_reset, undefined);
    const [to, link] = (mail.sendPasswordReset as jest.Mock).mock.calls[0];
    expect(to.email).toBe('a@x.com');
    expect(link).toContain('/es/reset-password?token=CLEARTOKEN');
  });

  it('responde ANTES de buscar la cuenta: al resolver, cero consultas (D-CTA-14, CTA-B18)', async () => {
    const prisma: any = { user: { findUnique: jest.fn(async () => null), update: jest.fn() } };
    const { svc } = make({ prisma });
    await expect(svc.forgotPassword('a@x.com')).resolves.toEqual({ ok: true });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    await svc.backgroundIdle();
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('cuenta bloqueada → 200 genérico pero NO emite token (no re-habilita)', async () => {
    const user = { id: 'u2', email: 'b@x.com', name: 'B', locale: 'es', status: 'blocked' };
    const prisma: any = { user: { findUnique: jest.fn(async () => user), update: jest.fn() } };
    const { svc, tokens } = make({ prisma });
    await expect(forgot(svc, 'b@x.com')).resolves.toEqual({ ok: true });
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});

describe('reset-password', () => {
  it('token válido → passwordHash nuevo, tokenVersion++, emailVerified=true, mustChangePassword=false', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', email: 'u1@x.com', status: 'active', emailVerified: true })),
        update: jest.fn(async () => ({})),
      },
    };
    const { svc, tokens } = make({ prisma, tokens: { ownerOf: jest.fn(async () => 'u1'), consume: jest.fn(async () => 'u1') } });
    // v1.80 (C7): el 200 trae además un `deviceToken` (sigue SIN sesión: ni access ni refresh).
    await expect(svc.resetPassword('t', 'newStrongPass1')).resolves.toEqual({
      ok: true,
      deviceToken: expect.any(String),
    });
    // v1.117.2: canje atado al correo leído DENTRO del candado.
    expect(tokens.consume).toHaveBeenCalledWith(prisma, 't', AuthTokenType.password_reset, 'u1@x.com');
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.emailVerified).toBe(true);
    expect(data.mustChangePassword).toBe(false);
    expect(typeof data.passwordHash).toBe('string');
    expect(data.passwordHash).not.toBe('newStrongPass1'); // hasheado
    // v1.117 (§CTA.5): simetría con account-setup paso 5 — los «Termina tu cuenta» pendientes quedan anulados.
    expect(tokens.voidPending).toHaveBeenCalledWith(prisma, 'u1', ['account_setup']);
    // Ya estaba verificada ⇒ sin 5-bis.
    expect(prisma.address.updateMany).not.toHaveBeenCalled();
  });

  it('v1.117.2: cuenta SIN verificar ⇒ además 5-bis (libreta sin predeterminada)', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', email: 'u1@x.com', status: 'active', emailVerified: false })),
        update: jest.fn(async () => ({})),
      },
    };
    const { svc } = make({ prisma, tokens: { ownerOf: jest.fn(async () => 'u1'), consume: jest.fn(async () => 'u1') } });
    await svc.resetPassword('t', 'newStrongPass1');
    expect(prisma.address.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', isDefault: true }, data: { isDefault: false } });
  });

  it('token inválido/expirado/usado → 422 RESET_TOKEN_INVALID', async () => {
    const { svc } = make({ tokens: { consume: jest.fn(async () => null) } });
    await expect(svc.resetPassword('bad', 'newStrongPass1')).rejects.toMatchObject({
      code: 'RESET_TOKEN_INVALID',
    });
  });

  it('token de otro correo (consume da null) ⇒ 422 sin escribir', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ id: 'u1', email: 'nuevo@x.com', status: 'active' })), update: jest.fn() },
    };
    const { svc } = make({ prisma, tokens: { ownerOf: jest.fn(async () => 'u1'), consume: jest.fn(async () => null) } });
    await expect(svc.resetPassword('t', 'newStrongPass1')).rejects.toMatchObject({ code: 'RESET_TOKEN_INVALID' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each([['blocked'], ['deleted']])('S15-B4: token válido pero cuenta %s → 403 USER_BLOCKED y NO fija contraseña', async (status) => {
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', email: 'u1@x.com', status })),
        update: jest.fn(async () => ({})),
      },
    };
    const { svc } = make({ prisma, tokens: { ownerOf: jest.fn(async () => 'u1'), consume: jest.fn(async () => 'u1') } });
    await expect(svc.resetPassword('t', 'newStrongPass1')).rejects.toMatchObject({
      code: 'USER_BLOCKED',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('verify-email (v1.117.2, D-CTA-12: el cuerpo prueba o fija la credencial)', () => {
  let goodHash: string;
  beforeAll(async () => {
    goodHash = await argon2.hash('Correcta123');
  });
  const user = (extra: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'u1@x.com',
    username: null,
    status: 'active',
    role: 'customer',
    emailVerified: false,
    passwordHash: goodHash,
    ...extra,
  });

  it('`password` correcta + token vivo ⇒ emailVerified=true y { verified:true }; tokenVersion NO cambia', async () => {
    const prisma: any = { user: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => user()) } };
    const { svc, tokens } = make({
      prisma,
      tokens: { ownerOf: jest.fn(async () => 'u1'), isLive: jest.fn(async () => true), consume: jest.fn(async () => 'u1') },
    });
    await expect(svc.verifyEmail({ token: 't', password: 'Correcta123' })).resolves.toEqual({ verified: true });
    expect(tokens.consume).toHaveBeenCalledWith(prisma, 't', AuthTokenType.email_verification, 'u1@x.com');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { emailVerified: true } });
  });

  it('`password` equivocada ⇒ 401 INVALID_CREDENTIALS sin consumir ni escribir', async () => {
    const prisma: any = { user: { update: jest.fn(), findUnique: jest.fn(async () => user()) } };
    const { svc, tokens } = make({
      prisma,
      tokens: { ownerOf: jest.fn(async () => 'u1'), isLive: jest.fn(async () => true), consume: jest.fn(async () => 'u1') },
    });
    await expect(svc.verifyEmail({ token: 't', password: 'Otra123456' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(tokens.consume).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('cuenta sin contraseña + `password` ⇒ 401 (argon2 ficticio) sin consumir', async () => {
    const prisma: any = { user: { update: jest.fn(), findUnique: jest.fn(async () => user({ passwordHash: null })) } };
    const { svc, tokens } = make({
      prisma,
      tokens: { ownerOf: jest.fn(async () => 'u1'), isLive: jest.fn(async () => true), consume: jest.fn(async () => 'u1') },
    });
    await expect(svc.verifyEmail({ token: 't', password: 'Correcta123' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(tokens.consume).not.toHaveBeenCalled();
  });

  it('doble clic (modo `password`): token ya usado de una cuenta ya verificada → { verified:true } sin escribir', async () => {
    const prisma: any = { user: { update: jest.fn(), findUnique: jest.fn(async () => user({ emailVerified: true })) } };
    const { svc, tokens } = make({
      prisma,
      tokens: { ownerOf: jest.fn(async () => 'u1'), isLive: jest.fn(async () => false), isUsed: jest.fn(async () => true) },
    });
    await expect(svc.verifyEmail({ token: 't', password: 'Correcta123' })).resolves.toEqual({ verified: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
    // v1.117.3: la idempotencia exige la atadura — `isUsed` recibe el correo ACTUAL leído dentro del candado.
    expect(tokens.isUsed).toHaveBeenCalledWith(prisma, 't', AuthTokenType.email_verification, user().email);
  });

  it('`newPassword` ⇒ hash nuevo, emailVerified, tokenVersion +1, anula los tres tipos, 5-bis y deviceToken', async () => {
    const prisma: any = { user: { update: jest.fn(async () => ({})), findUnique: jest.fn(async () => user()) } };
    const { svc, tokens } = make({ prisma, tokens: { ownerOf: jest.fn(async () => 'u1'), consume: jest.fn(async () => 'u1') } });
    await expect(svc.verifyEmail({ token: 't', newPassword: 'NuevaClave123' })).resolves.toEqual({
      verified: true,
      deviceToken: expect.any(String),
    });
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ emailVerified: true, tokenVersion: { increment: 1 }, mustChangePassword: false });
    expect(await argon2.verify(data.passwordHash, 'NuevaClave123')).toBe(true);
    expect(tokens.voidPending).toHaveBeenCalledWith(prisma, 'u1', Object.values(AuthTokenType));
    expect(prisma.address.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', isDefault: true }, data: { isDefault: false } });
  });

  it('`newPassword` con un token usado ⇒ 422 (no hace creer que fijó otra contraseña)', async () => {
    const prisma: any = { user: { update: jest.fn(), findUnique: jest.fn(async () => user({ emailVerified: true })) } };
    const { svc } = make({
      prisma,
      tokens: { ownerOf: jest.fn(async () => 'u1'), consume: jest.fn(async () => null), isUsed: jest.fn(async () => true) },
    });
    await expect(svc.verifyEmail({ token: 't', newPassword: 'NuevaClave123' })).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_TOKEN_INVALID',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('token inválido y sin dueño → 422 EMAIL_VERIFY_TOKEN_INVALID', async () => {
    const { svc } = make({
      tokens: { consume: jest.fn(async () => null), ownerOf: jest.fn(async () => null) },
    });
    await expect(svc.verifyEmail({ token: 'bad', password: 'x' })).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_TOKEN_INVALID',
    });
  });
});

describe('resend verification', () => {
  it('ya verificado → no-op { ok:true }, no emite token', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ({ id: 'u1', email: 'a@x.com', emailVerified: true })) },
    };
    const { svc, tokens } = make({ prisma });
    await expect(svc.resendVerification('u1')).resolves.toEqual({ ok: true });
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('sin verificar y bajo el tope → emite token (bajo el candado) y envía', async () => {
    const user = { id: 'u1', email: 'a@x.com', name: 'A', locale: 'en', emailVerified: false, passwordHash: 'h', role: 'customer', status: 'active' };
    const prisma: any = { user: { findUnique: jest.fn(async () => user) } };
    const { svc, tokens, mail } = make({ prisma });
    await expect(svc.resendVerification('u1', '9.9.9.9')).resolves.toEqual({ ok: true });
    expect(tokens.issue).toHaveBeenCalledWith(prisma, { id: 'u1', email: 'a@x.com' }, AuthTokenType.email_verification, '9.9.9.9');
    const [, link] = (mail.sendEmailVerification as jest.Mock).mock.calls[0];
    expect(link).toContain('/en/verify-email?token=CLEARTOKEN');
  });

  it('excede 3/h → 429 RATE_LIMITED', async () => {
    const user = { id: 'u1', email: 'a@x.com', name: 'A', locale: 'es', emailVerified: false, passwordHash: 'h', role: 'customer', status: 'active' };
    const prisma: any = { user: { findUnique: jest.fn(async () => user) } };
    const { svc, tokens } = make({ prisma, tokens: { countIssuedLastHour: jest.fn(async () => 3) } });
    await expect(svc.resendVerification('u1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});
