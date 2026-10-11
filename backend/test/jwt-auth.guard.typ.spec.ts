/**
 * C7 rev v1.80.1 (deuda anotada por backend en `114aecf`, cerrada aquí): `JwtAuthGuard` rechaza como
 * `Bearer` cualquier token con `typ` (`'refresh'`, `'device'`) y compara `tv` ESTRICTO (sin `?? 0`),
 * simétrico a `AuthService.refresh()` (SEC-C7-RT). Sin infraestructura: `JwtService` REAL, Prisma doble.
 *
 * Por qué muerde: con `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET` (que `env.validation` ya rechaza,
 * pero la defensa no depende de eso) un refresh token verifica como access; y un access sin `tv`
 * casaba con `tokenVersion = 0` por el `?? 0`.
 *
 * Mutaciones que lo ponen en rojo: quitar la comprobación de `typ`; volver a `(payload.tv ?? 0)`.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { BusinessException } from '../src/common/business.exception';
import { PrismaService } from '../src/prisma/prisma.service';

const SECRET = 'same-secret-for-both-domains-0123456789';
const jwt = new JwtService({});

function ctx(token: string): ExecutionContext {
  const req = { headers: { authorization: `Bearer ${token}` } } as { headers: Record<string, string>; user?: unknown };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function build(tokenVersion: number) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ status: 'active', tokenVersion, emailVerified: true, mustChangePassword: false })),
    },
  } as unknown as PrismaService;
  const config = new ConfigService({ JWT_ACCESS_SECRET: SECRET, JWT_REFRESH_SECRET: SECRET });
  return new JwtAuthGuard(reflector, jwt, config, prisma);
}

async function status(guard: JwtAuthGuard, token: string): Promise<number | 'ok'> {
  try {
    await guard.canActivate(ctx(token));
    return 'ok';
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    return (e as BusinessException).getStatus();
  }
}

const sign = (payload: Record<string, unknown>) => jwt.signAsync(payload, { secret: SECRET, algorithm: 'HS256', expiresIn: '15m' });

describe('JwtAuthGuard — typ y tv estrictos (simetría con refresh(), SEC-C7-RT)', () => {
  it('control: un access legítimo { sub, email, role, tv } ⇒ pasa', async () => {
    const guard = build(1);
    await expect(status(guard, await sign({ sub: 'u1', email: 'u@x', role: 'customer', tv: 1 }))).resolves.toBe('ok');
  });

  it('un REFRESH token (typ: "refresh") presentado como Bearer, aun con el mismo secreto ⇒ 401', async () => {
    const guard = build(1);
    await expect(status(guard, await sign({ sub: 'u1', email: 'u@x', role: 'customer', tv: 1, typ: 'refresh', sid: 'x' }))).resolves.toBe(401);
  });

  it('un token { typ: "device" } firmado con el secreto de access ⇒ 401', async () => {
    const guard = build(1);
    await expect(status(guard, await sign({ sub: 'u1', jti: 'j', typ: 'device', tv: 1 }))).resolves.toBe(401);
  });

  it('sin tv contra una cuenta con tokenVersion = 0 ⇒ 401 (antes: `tv ?? 0` casaba)', async () => {
    const guard = build(0);
    await expect(status(guard, await sign({ sub: 'u1', email: 'u@x', role: 'customer' }))).resolves.toBe(401);
  });

  it('tv no numérico ("0") ⇒ 401; tv numérico distinto ⇒ 401; sub no string ⇒ 401', async () => {
    const guard = build(0);
    await expect(status(guard, await sign({ sub: 'u1', role: 'customer', tv: '0' }))).resolves.toBe(401);
    await expect(status(guard, await sign({ sub: 'u1', role: 'customer', tv: 1 }))).resolves.toBe(401);
    await expect(status(guard, await sign({ sub: 7, role: 'customer', tv: 0 }))).resolves.toBe(401);
  });
});
