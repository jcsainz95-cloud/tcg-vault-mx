import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier, GoogleIdentity } from '../src/modules/auth/google-token-verifier';
import { BusinessException } from '../src/common/business.exception';

/**
 * v1.1 — Login con Google (ARCHITECTURE §4.7, API_CONTRACT §auth/google):
 *  - ID token inválido (aud/firma/exp) → 401 GOOGLE_TOKEN_INVALID.
 *  - email_verified != true → 403 GOOGLE_EMAIL_UNVERIFIED (no crea ni enlaza).
 *  - account-linking por email verificado (sin duplicar cuenta).
 *  - alta nueva: role SIEMPRE customer, passwordHash null, emailVerified true.
 *  - /auth/login rechaza cuentas sin passwordHash (cuentas solo-Google) con 401.
 */

const jwt = {
  signAsync: jest.fn(async () => 'token'),
} as unknown as JwtService;
const config = new ConfigService({ JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'r' });
const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;

function verifierReturning(identity: GoogleIdentity): GoogleTokenVerifier {
  return { verify: jest.fn(async () => identity) } as unknown as GoogleTokenVerifier;
}
function verifierRejecting(err: unknown): GoogleTokenVerifier {
  return {
    verify: jest.fn(async () => {
      throw err;
    }),
  } as unknown as GoogleTokenVerifier;
}

describe('AuthService.google — verificación del ID token', () => {
  it('token inválido (aud/firma) → 401 GOOGLE_TOKEN_INVALID; no crea usuario', async () => {
    const prisma: any = { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
    const svc = new AuthService(
      prisma as PrismaService,
      jwt,
      config,
      verifierRejecting(new BusinessException('GOOGLE_TOKEN_INVALID', 401, 'bad aud')),
      audit,
    );
    await expect(svc.google('bad-token')).rejects.toMatchObject({ code: 'GOOGLE_TOKEN_INVALID' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('email_verified=false → 403 GOOGLE_EMAIL_UNVERIFIED; no crea ni enlaza', async () => {
    const prisma: any = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const svc = new AuthService(
      prisma as PrismaService,
      jwt,
      config,
      verifierReturning({ sub: 'g1', email: 'a@x.com', emailVerified: false }),
      audit,
    );
    await expect(svc.google('t')).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_UNVERIFIED' });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('account-linking por email verificado: enlaza la cuenta local existente SIN duplicar', async () => {
    const existing = { id: 'u1', email: 'a@x.com', role: 'customer', status: 'active', avatarUrl: null };
    const prisma: any = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null) // por googleId
          .mockResolvedValueOnce(existing), // por email
        update: jest.fn(async ({ data }: any) => ({ ...existing, ...data })),
        create: jest.fn(),
      },
    };
    const svc = new AuthService(
      prisma as PrismaService,
      jwt,
      config,
      verifierReturning({ sub: 'g1', email: 'a@x.com', emailVerified: true, picture: 'p' }),
      audit,
    );
    const res = await svc.google('t');
    expect(res.user.id).toBe('u1');
    expect(prisma.user.create).not.toHaveBeenCalled(); // NO duplica
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update.mock.calls[0][0].data.googleId).toBe('g1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.google_link' }));
  });

  it('alta nueva: role SIEMPRE customer, passwordHash null, emailVerified true (nunca del token)', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null), // ni por googleId ni por email
        update: jest.fn(),
        create: jest.fn(async ({ data }: any) => ({ id: 'new', ...data })),
      },
    };
    const svc = new AuthService(
      prisma as PrismaService,
      jwt,
      config,
      verifierReturning({ sub: 'g2', email: 'New@X.com', emailVerified: true, name: 'New' }),
      audit,
    );
    const res = await svc.google('t');
    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.role).toBe('customer');
    expect(created.authProvider).toBe('google');
    expect(created.passwordHash).toBeNull();
    expect(created.emailVerified).toBe(true);
    expect(created.email).toBe('new@x.com'); // normalizado a minúsculas
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
  });

  it('cuenta bloqueada → 403 USER_BLOCKED al enlazar', async () => {
    const blocked = { id: 'u2', email: 'b@x.com', role: 'customer', status: 'blocked', avatarUrl: null };
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(blocked),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    const svc = new AuthService(
      prisma as PrismaService,
      jwt,
      config,
      verifierReturning({ sub: 'g3', email: 'b@x.com', emailVerified: true }),
      audit,
    );
    await expect(svc.google('t')).rejects.toMatchObject({ code: 'USER_BLOCKED' });
  });
});

describe('AuthService.login — cuentas solo-Google (sin passwordHash)', () => {
  it('rechaza login por contraseña de una cuenta sin passwordHash con 401 INVALID_CREDENTIALS', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'g@x.com',
          passwordHash: null,
          status: 'active',
          role: 'customer',
        }),
      },
    };
    const svc = new AuthService(prisma as PrismaService, jwt, config, verifierReturning({} as any), audit);
    await expect(svc.login({ email: 'g@x.com', password: 'whatever' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });
});
