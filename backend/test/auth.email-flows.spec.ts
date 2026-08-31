import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthTokenType } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthTokenService } from '../src/modules/auth/auth-token.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

/**
 * v1.5 — Flujos de correo del AuthService:
 *  - forgot-password: anti-enumeración (200 aunque el email no exista; no envía correo).
 *  - reset-password: incrementa tokenVersion, setea emailVerified=true, marca token usado (consume).
 *  - verify-email: marca emailVerified; idempotente ante doble clic; 422 si el token es inválido.
 *  - resend: no-op si ya verificado; 429 si excede el tope por hora.
 */

const jwt = { signAsync: jest.fn(async () => 'tok') } as unknown as JwtService;
const config = new ConfigService({ APP_BASE_URL: 'https://app.tcghunt.mx', DEFAULT_LOCALE: 'es' });
const google = {} as unknown as GoogleTokenVerifier;

function make(overrides: {
  prisma?: any;
  tokens?: Partial<AuthTokenService>;
  mail?: Partial<MailService>;
  audit?: Partial<AuditService>;
}) {
  const prisma = overrides.prisma ?? { user: { findUnique: jest.fn(), update: jest.fn() } };
  const tokens = {
    issue: jest.fn(async () => 'CLEARTOKEN'),
    consume: jest.fn(async () => null),
    ownerOf: jest.fn(async () => null),
    countIssuedLastHour: jest.fn(async () => 0),
    ...overrides.tokens,
  } as unknown as AuthTokenService;
  const mail = {
    sendEmailVerification: jest.fn(async () => undefined),
    sendPasswordReset: jest.fn(async () => undefined),
    ...overrides.mail,
  } as unknown as MailService;
  const audit = { log: jest.fn(async () => undefined), ...overrides.audit } as unknown as AuditService;
  const svc = new AuthService(prisma as PrismaService, jwt, config, google, audit, tokens, mail);
  return { svc, prisma, tokens, mail, audit };
}

describe('forgot-password — anti-enumeración', () => {
  it('email inexistente → 200 { ok:true } y NO envía correo ni emite token', async () => {
    const prisma = { user: { findUnique: jest.fn(async () => null), update: jest.fn() } };
    const { svc, tokens, mail } = make({ prisma });
    await expect(svc.forgotPassword('nobody@x.com')).resolves.toEqual({ ok: true });
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('email existente y activo → 200 { ok:true } y emite token + envía correo con link', async () => {
    const user = { id: 'u1', email: 'a@x.com', name: 'A', locale: 'es', status: 'active' };
    const prisma = { user: { findUnique: jest.fn(async () => user), update: jest.fn() } };
    const { svc, tokens, mail } = make({ prisma });
    await expect(svc.forgotPassword('A@X.com')).resolves.toEqual({ ok: true });
    expect(tokens.issue).toHaveBeenCalledWith('u1', AuthTokenType.password_reset, undefined);
    const [, link] = (mail.sendPasswordReset as jest.Mock).mock.calls[0];
    expect(link).toContain('/es/reset-password?token=CLEARTOKEN');
  });

  it('cuenta bloqueada → 200 genérico pero NO emite token (no re-habilita)', async () => {
    const user = { id: 'u2', email: 'b@x.com', name: 'B', locale: 'es', status: 'blocked' };
    const prisma = { user: { findUnique: jest.fn(async () => user), update: jest.fn() } };
    const { svc, tokens } = make({ prisma });
    await expect(svc.forgotPassword('b@x.com')).resolves.toEqual({ ok: true });
    expect(tokens.issue).not.toHaveBeenCalled();
  });
});

describe('reset-password', () => {
  it('token válido → passwordHash nuevo, tokenVersion++, emailVerified=true, mustChangePassword=false', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', status: 'active' })),
        update: jest.fn(async () => ({})),
      },
    };
    const { svc } = make({ prisma, tokens: { consume: jest.fn(async () => 'u1') } });
    await expect(svc.resetPassword('t', 'newStrongPass1')).resolves.toEqual({ ok: true });
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(data.emailVerified).toBe(true);
    expect(data.mustChangePassword).toBe(false);
    expect(typeof data.passwordHash).toBe('string');
    expect(data.passwordHash).not.toBe('newStrongPass1'); // hasheado
  });

  it('token inválido/expirado/usado → 422 RESET_TOKEN_INVALID', async () => {
    const { svc } = make({ tokens: { consume: jest.fn(async () => null) } });
    await expect(svc.resetPassword('bad', 'newStrongPass1')).rejects.toMatchObject({
      code: 'RESET_TOKEN_INVALID',
    });
  });

  it('S15-B4: token válido pero cuenta bloqueada → 403 USER_BLOCKED y NO fija contraseña', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', status: 'blocked' })),
        update: jest.fn(async () => ({})),
      },
    };
    const { svc } = make({ prisma, tokens: { consume: jest.fn(async () => 'u1') } });
    await expect(svc.resetPassword('t', 'newStrongPass1')).rejects.toMatchObject({
      code: 'USER_BLOCKED',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('S15-B4: token válido pero cuenta eliminada → 403 USER_BLOCKED y NO fija contraseña', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ id: 'u1', status: 'deleted' })),
        update: jest.fn(async () => ({})),
      },
    };
    const { svc } = make({ prisma, tokens: { consume: jest.fn(async () => 'u1') } });
    await expect(svc.resetPassword('t', 'newStrongPass1')).rejects.toMatchObject({
      code: 'USER_BLOCKED',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('verify-email', () => {
  it('token válido → emailVerified=true y { verified:true }', async () => {
    const prisma = { user: { update: jest.fn(async () => ({})), findUnique: jest.fn() } };
    const { svc } = make({ prisma, tokens: { consume: jest.fn(async () => 'u1') } });
    await expect(svc.verifyEmail('t')).resolves.toEqual({ verified: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: true },
    });
  });

  it('doble clic: token ya usado pero usuario ya verificado → { verified:true } (idempotente)', async () => {
    const prisma = {
      user: { update: jest.fn(), findUnique: jest.fn(async () => ({ emailVerified: true })) },
    };
    const { svc } = make({
      prisma,
      tokens: { consume: jest.fn(async () => null), ownerOf: jest.fn(async () => 'u1') },
    });
    await expect(svc.verifyEmail('t')).resolves.toEqual({ verified: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('token inválido y sin dueño → 422 EMAIL_VERIFY_TOKEN_INVALID', async () => {
    const { svc } = make({
      tokens: { consume: jest.fn(async () => null), ownerOf: jest.fn(async () => null) },
    });
    await expect(svc.verifyEmail('bad')).rejects.toMatchObject({
      code: 'EMAIL_VERIFY_TOKEN_INVALID',
    });
  });
});

describe('resend verification', () => {
  it('ya verificado → no-op { ok:true }, no emite token', async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 'u1', emailVerified: true })) },
    };
    const { svc, tokens } = make({ prisma });
    await expect(svc.resendVerification('u1')).resolves.toEqual({ ok: true });
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('sin verificar y bajo el tope → emite token y envía', async () => {
    const user = { id: 'u1', email: 'a@x.com', name: 'A', locale: 'en', emailVerified: false };
    const prisma = { user: { findUnique: jest.fn(async () => user) } };
    const { svc, tokens, mail } = make({ prisma });
    await expect(svc.resendVerification('u1', '9.9.9.9')).resolves.toEqual({ ok: true });
    expect(tokens.issue).toHaveBeenCalledWith('u1', AuthTokenType.email_verification, '9.9.9.9');
    const [, link] = (mail.sendEmailVerification as jest.Mock).mock.calls[0];
    expect(link).toContain('/en/verify-email?token=CLEARTOKEN');
  });

  it('excede 3/h → 429 RATE_LIMITED', async () => {
    const user = { id: 'u1', email: 'a@x.com', name: 'A', locale: 'es', emailVerified: false };
    const prisma = { user: { findUnique: jest.fn(async () => user) } };
    const { svc } = make({ prisma, tokens: { countIssuedLastHour: jest.fn(async () => 3) } });
    await expect(svc.resendVerification('u1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
