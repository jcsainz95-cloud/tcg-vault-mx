import { createHmac } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { c7Args } from './helpers/auth-c7-deps';
import { GoogleTokenVerifier } from '../src/modules/auth/google-token-verifier';

/**
 * §CELULAR-ALTA (v2 §6.2/§6.10 ii) — Google nuevo no crea cuenta; `POST /auth/google/complete` sí, con celular.
 * JWT REAL (la firma, `purpose`, la expiración y que no sirva como sesión se prueban de verdad).
 */
const config = new ConfigService({ JWT_ACCESS_SECRET: 'access-secret-test', JWT_REFRESH_SECRET: 'refresh-secret-test' });
const jwt = new JwtService({});

function build(existing: { byGoogle?: any; byEmail?: any } = {}) {
  const create = jest.fn(async ({ data }: any) => ({ id: 'new', status: 'active', tokenVersion: 0, role: 'customer', ...data }));
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => (where.googleId ? (existing.byGoogle ?? null) : (existing.byEmail ?? null))),
      create,
      update: jest.fn(),
    },
  };
  const verifier = { verify: jest.fn(async () => ({ sub: 'g1', email: 'Ana@X.com', emailVerified: true, name: 'Ana', picture: null })) } as unknown as GoogleTokenVerifier;
  const issue = jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' }));
  const svc = new AuthService(prisma as PrismaService, jwt, config, verifier, { log: jest.fn() } as unknown as AuditService, {} as never, {} as never, ...c7Args());
  (svc as any).issueTokens = issue;
  (svc as any).devices = { issue: jest.fn(async () => 'dev') };
  return { svc, create, prisma };
}

describe('Google alta con celular (§CELULAR-ALTA)', () => {
  it('Google nuevo: 0 filas, sin tokens de sesión; token propósito google_signup con exp 15 min', async () => {
    const { svc, create } = build();
    const res: any = await svc.google('id');
    expect(create).not.toHaveBeenCalled();
    expect(res.accessToken).toBeUndefined();
    expect(res.pendingSignup).toMatchObject({ email: 'ana@x.com', name: 'Ana' });
    const p: any = jwt.decode(res.pendingSignup.signupToken);
    expect(p.purpose).toBe('google_signup');
    expect(p.exp - p.iat).toBe(15 * 60);
    // no vale como access ni refresh
    await expect(jwt.verifyAsync(res.pendingSignup.signupToken, { secret: 'access-secret-test' })).rejects.toBeDefined();
    await expect(jwt.verifyAsync(res.pendingSignup.signupToken, { secret: 'refresh-secret-test' })).rejects.toBeDefined();
  });

  it('complete: crea cuenta con celular normalizado y da sesión', async () => {
    const { svc, create } = build();
    const { pendingSignup } = (await svc.google('id')) as any;
    const res: any = await svc.googleComplete(pendingSignup.signupToken, '+52 55 1234 5678');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({ email: 'ana@x.com', phone: '5512345678', role: 'customer', googleId: 'g1' });
    expect(res.accessToken).toBe('a');
  });

  it('complete con celular inválido ⇒ 422 PHONE_INVALID y 0 filas', async () => {
    const { svc, create } = build();
    const { pendingSignup } = (await svc.google('id')) as any;
    for (const bad of ['0000000000', '1234567890', 'abc', '', null, undefined, 123]) {
      await expect(svc.googleComplete(pendingSignup.signupToken, bad)).rejects.toMatchObject({ code: 'PHONE_INVALID' });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('token vencido (16 min), basura o de otro propósito ⇒ 401 SIGNUP_EXPIRED', async () => {
    const { svc } = build();
    const secret = createHmac('sha256', 'access-secret-test').update('google_signup').digest('hex');
    const old = await jwt.signAsync({ purpose: 'google_signup', sub: 'g1', email: 'a@x.com' }, { secret, expiresIn: -1 });
    const other = await jwt.signAsync({ purpose: 'otra', sub: 'g1', email: 'a@x.com' }, { secret, expiresIn: 900 });
    const asAccess = await jwt.signAsync({ purpose: 'google_signup', sub: 'g1', email: 'a@x.com' }, { secret: 'access-secret-test', expiresIn: 900 });
    for (const t of [old, other, asAccess, 'basura']) {
      await expect(svc.googleComplete(t, '5512345678')).rejects.toMatchObject({ code: 'SIGNUP_EXPIRED', status: 401 });
    }
  });

  it('SIGN-1: token de UN solo uso ⇒ con la cuenta ya creada, reusarlo NO da sesión (401 SIGNUP_EXPIRED)', async () => {
    const existing = { id: 'u1', status: 'active', tokenVersion: 0, role: 'customer', googleId: 'g1', email: 'ana@x.com' };
    const { svc, create } = build({ byGoogle: existing });
    const t = await jwt.signAsync({ purpose: 'google_signup', sub: 'g1', email: 'ana@x.com', name: 'Ana' }, { secret: createHmac('sha256', 'access-secret-test').update('google_signup').digest('hex'), expiresIn: 900 });
    await expect(svc.googleComplete(t, '5512345678')).rejects.toMatchObject({ code: 'SIGNUP_EXPIRED', status: 401 });
    expect(create).not.toHaveBeenCalled();
  });

  it('carrera simultánea: el que pierde el P2002 responde como login (1 sola cuenta)', async () => {
    const { svc, prisma } = build();
    const { Prisma } = require('@prisma/client'); // eslint-disable-line @typescript-eslint/no-var-requires
    const winner = { id: 'w', status: 'active', tokenVersion: 0, role: 'customer', googleId: 'g1' };
    prisma.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    prisma.user.findUnique.mockImplementation(async ({ where }: any) => (where.googleId && prisma.user.create.mock.calls.length ? winner : null));
    const { pendingSignup } = (await svc.google('id')) as any;
    const res: any = await svc.googleComplete(pendingSignup.signupToken, '5512345678');
    expect(res.accessToken).toBe('a');
  });
});
