import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { BusinessException } from '../src/common/business.exception';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * I-1 (v2.1.7, hallazgo de QA contra el stack vivo) — **falta de credencial es 401, no 422**.
 *
 * `jwt-auth.guard.ts` era el **único outlier del archivo**: la rama de «token inválido» (abajo, en el
 * mismo método) y las guards hermanas (`roles`, `money-out`, `email-verified`) ya devolvían 401,
 * pero la de «falta el header» usaba `BusinessException.validation` ⇒ **422**.
 *
 * ### El daño NO es cosmético
 * El interceptor del cliente filtra por `res.status === 401` para disparar el refresh y limpiar la
 * sesión. Un 422 **esquiva esa rama entera**: una sesión sin token acababa en un error genérico en
 * vez de ir al login. Y semánticamente 422 dice «tu payload no valida», que aquí es falso — no hay
 * payload que validar, falta la credencial.
 *
 * Verificado por QA en vivo sobre `/vault/holdings`, `/buylist/requests`, `/orders` y
 * `/admin/dashboard`: **todas devolvían 422**; con token basura sí daban 401.
 */
function ctx(headers: Record<string, string>): ExecutionContext {
  const req = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function build(opts: { verifyOk?: boolean } = {}) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false); // ruta NO pública
  const jwt = {
    verifyAsync: jest.fn(async () => {
      if (opts.verifyOk === false) throw new Error('bad token');
      return { sub: 'u1', role: 'customer', tv: 1 };
    }),
  } as unknown as JwtService;
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ status: 'active', tokenVersion: 1, emailVerified: true })),
    },
  } as unknown as PrismaService;
  const config = { get: jest.fn(() => 'secret') } as unknown as ConfigService;
  return new JwtAuthGuard(reflector, jwt, config, prisma);
}

describe('JwtAuthGuard — I-1: falta de credencial ⇒ 401', () => {
  it.each([
    ['sin header Authorization', {}],
    ['header vacío', { authorization: '' }],
    ['esquema equivocado (Basic)', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['«Bearer» mal escrito', { authorization: 'bearer abc' }],
  ])('%s ⇒ 401 UNAUTHENTICATED (antes: 422, que el interceptor del cliente ignoraba)', async (_l, headers) => {
    const guard = build();
    const err = await guard.canActivate(ctx(headers as Record<string, string>)).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('UNAUTHENTICATED');
    expect((err as BusinessException).getStatus()).toBe(401);
  });

  it('token PRESENTE pero inválido ⇒ 401 (esta rama ya era correcta; queda fijada)', async () => {
    const guard = build({ verifyOk: false });
    const err = await guard.canActivate(ctx({ authorization: 'Bearer basura' })).catch((e) => e);
    expect((err as BusinessException).getStatus()).toBe(401);
  });

  it('las DOS ramas del guard coinciden en código y status: no hay outlier', async () => {
    const grab = async (g: JwtAuthGuard, headers: Record<string, string>): Promise<BusinessException> => {
      try {
        await g.canActivate(ctx(headers));
        throw new Error('debió lanzar');
      } catch (e) {
        return e as BusinessException;
      }
    };
    const sinHeader = await grab(build(), {});
    const tokenMalo = await grab(build({ verifyOk: false }), { authorization: 'Bearer basura' });
    expect(sinHeader.getStatus()).toBe(tokenMalo.getStatus());
    expect(sinHeader.code).toBe(tokenMalo.code);
  });

  it('con token VÁLIDO deja pasar (la corrección no endurece de más)', async () => {
    await expect(build().canActivate(ctx({ authorization: 'Bearer bueno' }))).resolves.toBe(true);
  });

  it('una ruta @Public() pasa SIN credencial (el anónimo sigue siendo anónimo)', async () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new JwtAuthGuard(
      reflector,
      {} as JwtService,
      {} as ConfigService,
      {} as PrismaService,
    );
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
  });
});
