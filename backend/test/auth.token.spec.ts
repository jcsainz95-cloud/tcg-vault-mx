import { AuthTokenType } from '@prisma/client';
import {
  AuthTokenService,
  hashAuthToken,
  AUTH_TOKEN_TTL_MS,
} from '../src/modules/auth/auth-token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v1.5 — AuthTokenService: emisión/consumo de tokens de un solo uso.
 *  - se guarda SOLO el SHA-256 (nunca el claro).
 *  - al emitir uno nuevo del mismo tipo se rotan (invalidan) los previos no usados.
 *  - el consumo es atómico (usedAt null + no expirado) → un solo uso.
 *  - expiraciones: verificación 24h, reset 1h.
 */
describe('AuthTokenService', () => {
  function prismaMock() {
    return {
      authToken: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async ({ data }: any) => ({ id: 't1', ...data })),
        findUnique: jest.fn(async () => ({ userId: 'u1' })),
        count: jest.fn(async () => 0),
      },
    };
  }

  it('issue: persiste el SHA-256 del token, NUNCA el claro, y rota los previos no usados', async () => {
    const prisma = prismaMock();
    const svc = new AuthTokenService(prisma as unknown as PrismaService);

    const clear = await svc.issue('u1', AuthTokenType.email_verification, '1.2.3.4');

    // El claro NO es lo persistido; lo persistido es su SHA-256.
    const created = prisma.authToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(hashAuthToken(clear));
    expect(created.tokenHash).not.toBe(clear);
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/); // hex de 32 bytes
    expect(created.userId).toBe('u1');
    expect(created.type).toBe(AuthTokenType.email_verification);
    expect(created.requestIp).toBe('1.2.3.4');

    // Rotación: invalida los previos no usados del mismo tipo ANTES de crear el nuevo.
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: AuthTokenType.email_verification, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('issue: expiración por tipo (verificación 24h, reset 1h)', async () => {
    const prisma = prismaMock();
    const svc = new AuthTokenService(prisma as unknown as PrismaService);
    const before = Date.now();

    await svc.issue('u1', AuthTokenType.email_verification);
    const verifyExp = prisma.authToken.create.mock.calls[0][0].data.expiresAt as Date;
    expect(verifyExp.getTime() - before).toBeGreaterThanOrEqual(
      AUTH_TOKEN_TTL_MS.email_verification - 2000,
    );

    await svc.issue('u1', AuthTokenType.password_reset);
    const resetExp = prisma.authToken.create.mock.calls[1][0].data.expiresAt as Date;
    expect(resetExp.getTime() - before).toBeLessThanOrEqual(AUTH_TOKEN_TTL_MS.password_reset + 2000);
  });

  it('consume: válido → marca usedAt (un solo uso, no expirado) y devuelve el userId', async () => {
    const prisma = prismaMock();
    const svc = new AuthTokenService(prisma as unknown as PrismaService);
    const now = new Date();

    const userId = await svc.consume('cleartoken', AuthTokenType.password_reset, now);
    expect(userId).toBe('u1');

    // El where del claim exige usedAt null y no expirado; el data marca usedAt (un solo uso).
    const call = (prisma.authToken.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toMatchObject({
      tokenHash: hashAuthToken('cleartoken'),
      type: AuthTokenType.password_reset,
      usedAt: null,
      expiresAt: { gt: now },
    });
    expect(call.data).toEqual({ usedAt: now });
  });

  it('consume: token inexistente/expirado/usado (count 0) → null, no busca dueño', async () => {
    const prisma = prismaMock();
    prisma.authToken.updateMany.mockResolvedValueOnce({ count: 0 });
    const svc = new AuthTokenService(prisma as unknown as PrismaService);

    const userId = await svc.consume('bad', AuthTokenType.email_verification);
    expect(userId).toBeNull();
    expect(prisma.authToken.findUnique).not.toHaveBeenCalled();
  });

  it('consume: segundo intento del mismo token ya no vale (un solo uso)', async () => {
    const prisma = prismaMock();
    // Primer consumo: claim exitoso. Segundo: ya usado → count 0.
    prisma.authToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const svc = new AuthTokenService(prisma as unknown as PrismaService);

    expect(await svc.consume('t', AuthTokenType.password_reset)).toBe('u1');
    expect(await svc.consume('t', AuthTokenType.password_reset)).toBeNull();
  });
});
