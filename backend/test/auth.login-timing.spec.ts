import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

// Se envuelve `verify` en un jest.fn que delega en la implementación real: así se puede
// contar cuántas veces se invoca (mitigación de temporización) sin perder el hashing real
// que necesita la rama feliz. `hash` permanece real.
jest.mock('argon2', () => {
  const actual = jest.requireActual('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});
import * as argon2 from 'argon2';

/**
 * D5 (techlead / seguridad) — mitigación de ENUMERACIÓN DE USUARIOS POR TEMPORIZACIÓN en el
 * login. Cuando el usuario no existe o su passwordHash es null (cuenta solo-Google), el
 * servicio ejecuta igualmente un `argon2.verify` contra un hash dummy fijo para igualar el
 * tiempo de respuesta. Ambas ramas devuelven 401 INVALID_CREDENTIALS, y en ambas se realiza
 * la verificación argon2 (no hay retorno temprano barato antes del hash).
 */
const jwt = { signAsync: jest.fn(async () => 'token') } as unknown as JwtService;
const config = new ConfigService({ JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'r' });
const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
const verifier = { verify: jest.fn() } as unknown as GoogleTokenVerifier;
// v1.5: AuthService gana dos deps (tokens/mail). El login no las usa; stubs para el ctor.
const tokens = {
  issue: jest.fn(async () => 'tok'),
  consume: jest.fn(async () => null),
  ownerOf: jest.fn(async () => null),
  countIssuedLastHour: jest.fn(async () => 0),
} as unknown as import('../src/modules/auth/auth-token.service').AuthTokenService;
const mail = {
  sendEmailVerification: jest.fn(async () => undefined),
  sendPasswordReset: jest.fn(async () => undefined),
} as unknown as import('../src/modules/mail/mail.service').MailService;

describe('AuthService.login — mitigación de temporización (D5)', () => {
  const verifyMock = argon2.verify as unknown as jest.Mock;

  beforeEach(() => {
    verifyMock.mockClear();
  });

  it('usuario inexistente → 401 y AUN ASÍ ejecuta argon2.verify (contra hash dummy)', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const svc = new AuthService(prisma as PrismaService, jwt, config, verifier, audit, tokens, mail);
    await expect(svc.login({ email: 'nobody@x.com', password: 'secret' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it('cuenta solo-Google (passwordHash null) → 401 y ejecuta argon2.verify (contra hash dummy)', async () => {
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
    const svc = new AuthService(prisma as PrismaService, jwt, config, verifier, audit, tokens, mail);
    await expect(svc.login({ email: 'g@x.com', password: 'whatever' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it('el hash dummy no coincide con ninguna contraseña (verify=false) → 401', async () => {
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const svc = new AuthService(prisma as PrismaService, jwt, config, verifier, audit, tokens, mail);
    const ok = await argon2.verify(
      '$argon2id$v=19$m=65536,t=3,p=4$IUuYDslaChUS0mrzV74+WQ$Q8BNcs3QrO7nyLYG3ZAMbE+f87icx9X+oRBRlyP0RrE',
      'anything',
    );
    expect(ok).toBe(false);
    await expect(svc.login({ email: 'x@x.com', password: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('credenciales correctas → emite tokens (rama feliz intacta)', async () => {
    const passwordHash = await argon2.hash('correct-horse');
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u2',
          email: 'real@x.com',
          passwordHash,
          status: 'active',
          role: 'customer',
          name: 'Real',
          locale: 'es',
        }),
      },
    };
    const svc = new AuthService(prisma as PrismaService, jwt, config, verifier, audit, tokens, mail);
    const res = await svc.login({ email: 'real@x.com', password: 'correct-horse' });
    expect(res.accessToken).toBeDefined();
    expect(res.user.id).toBe('u2');
  });
});
