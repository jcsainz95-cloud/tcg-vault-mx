import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v1.67 (Stream A · B2, ARCHITECTURE §4.47.2) — `JwtAuthGuard` añade `mustChangePassword` al `select`
 * que YA hacía y lo pone en `req.user`: **un guard más NO cuesta una consulta más**. Si alguien
 * quitara el campo del `select`, `PasswordChangeRequiredGuard` vería `undefined` y dejaría pasar
 * a todo el mundo en silencio — por eso este candado mira el `select` y el `req.user`, no solo el 200.
 */
function ctx(): { ctx: ExecutionContext; req: { headers: Record<string, string>; user?: unknown } } {
  const req: { headers: Record<string, string>; user?: unknown } = { headers: { authorization: 'Bearer ok' } };
  const c = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { ctx: c, req };
}

function build(row: { status: string; tokenVersion: number; emailVerified: boolean; mustChangePassword: boolean }) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
  const jwt = { verifyAsync: jest.fn(async () => ({ sub: 'u1', email: 'u@x', role: 'customer', tv: 1 })) };
  const findUnique = jest.fn(async () => row);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const config = { get: jest.fn(() => 'secret') } as unknown as ConfigService;
  return { guard: new JwtAuthGuard(reflector, jwt as unknown as JwtService, config, prisma), findUnique };
}

describe('JwtAuthGuard — v1.67: `mustChangePassword` viaja en el MISMO select y en req.user', () => {
  it('el select incluye mustChangePassword (junto a status/tokenVersion/emailVerified) y hay UNA sola consulta', async () => {
    const { guard, findUnique } = build({ status: 'active', tokenVersion: 1, emailVerified: true, mustChangePassword: true });
    const { ctx: c } = ctx();
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    const args = (findUnique.mock.calls[0] as unknown as [{ select: Record<string, boolean> }])[0];
    expect(args.select).toMatchObject({
      status: true,
      tokenVersion: true,
      emailVerified: true,
      mustChangePassword: true,
    });
  });

  it.each([true, false])('req.user.mustChangePassword refleja la BD (%s)', async (flag) => {
    const { guard } = build({ status: 'active', tokenVersion: 1, emailVerified: true, mustChangePassword: flag });
    const { ctx: c, req } = ctx();
    await guard.canActivate(c);
    expect(req.user).toMatchObject({ id: 'u1', mustChangePassword: flag });
  });

  it('el Jwt NO rechaza por el flag: con mustChangePassword=true sigue siendo 200 (rechazar es del otro guard)', async () => {
    const { guard } = build({ status: 'active', tokenVersion: 1, emailVerified: false, mustChangePassword: true });
    await expect(guard.canActivate(ctx().ctx)).resolves.toBe(true);
  });
});
