/**
 * 🔒 CANDADO — autorización del Panel: token `marketing-reader` (hash SHA-256, comparación en tiempo
 * constante, rate-limit 60/h, bloqueo de IP 10/10min) y `PermissionGuard` 403 (Brief 2 §7.2, §5.3;
 * ARCHITECTURE §13.4.1/2). Sin BD: Prisma mockeado; las ventanas son puras.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, Role } from '@prisma/client';
import { BusinessException } from '../src/common/business.exception';
import {
  constantTimeHexEqual,
  generateClearToken,
  hashToken,
} from '../src/modules/marketing/token-crypto';
import { SlidingWindowCounter } from '../src/modules/marketing/rate-limiter';
import { MarketingTokenService } from '../src/modules/marketing/marketing-token.service';
import { PermissionGuard } from '../src/common/guards/permission.guard';

const statusOf = async (fn: () => Promise<unknown>): Promise<number> => {
  try {
    await fn();
    return 200;
  } catch (e) {
    if (e instanceof BusinessException) return e.getStatus();
    throw e;
  }
};

describe('token-crypto', () => {
  it('genera un token de 256 bits (64 hex) y un hash de 64 hex', () => {
    const t = generateClearToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('hash determinista; ⛔ el claro no se deduce del hash (distintos valores)', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
  });
  it('constantTimeHexEqual: true iguales, false distintos o de distinta longitud', () => {
    const h = hashToken('x');
    expect(constantTimeHexEqual(h, h)).toBe(true);
    expect(constantTimeHexEqual(h, hashToken('y'))).toBe(false);
    expect(constantTimeHexEqual(h, 'ab')).toBe(false);
  });
});

describe('SlidingWindowCounter', () => {
  it('cuenta en la ventana y descarta lo viejo', () => {
    const w = new SlidingWindowCounter(1000, 3);
    w.record('k', 0);
    w.record('k', 100);
    w.record('k', 200);
    expect(w.count('k', 300)).toBe(3);
    expect(w.atLimit('k', 300)).toBe(true);
    // 1500ms después, los de t≤500 caducan.
    expect(w.count('k', 1500)).toBe(0);
  });
  it('MKT-TL1 — IPs que no vuelven se podan al pasar la ventana (el Map no crece con IPs viejas)', () => {
    const w = new SlidingWindowCounter(1000, 10);
    for (let i = 0; i < 5000; i++) w.record(`ip-${i}`, i % 1000); // 5000 IPs distintas dentro de la 1ª ventana
    expect(w.size()).toBe(5000);
    // Pasada la ventana, una sola petición nueva barre lo caducado.
    w.record('ip-nueva', 5000);
    expect(w.size()).toBe(1);
  });

  it('MKT-TL1 — cota dura: con N IPs distintas DENTRO de la ventana, el Map no pasa de maxKeys', () => {
    const w = new SlidingWindowCounter(60_000, 10, 1000);
    for (let i = 0; i < 20_000; i++) w.record(`ip-${i}`, i);
    expect(w.size()).toBeLessThanOrEqual(1000);
    // Las más recientes siguen contando (se expulsan las más viejas).
    expect(w.count('ip-19999', 20_000)).toBe(1);
  });

  it('recordAndExceeded marca true al superar el límite', () => {
    const w = new SlidingWindowCounter(1000, 2);
    expect(w.recordAndExceeded('k', 0)).toBe(false);
    expect(w.recordAndExceeded('k', 1)).toBe(false);
    expect(w.recordAndExceeded('k', 2)).toBe(true);
  });
});

/** Prisma mockeado con una sola fila de token. */
function mockPrisma(row: { id: string; label: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null } | null) {
  return {
    marketingApiToken: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue({}),
    },
  } as never;
}

describe('MarketingTokenService.verify', () => {
  const CLEAR = 'a'.repeat(64);
  const validRow = () => ({ id: 'tok1', label: 'marketing-reader', tokenHash: hashToken(CLEAR), expiresAt: new Date('2030-01-01'), revokedAt: null });
  const NOW = new Date('2026-10-16T00:00:00Z');

  it('token válido ⇒ devuelve {id,label}', async () => {
    const svc = new MarketingTokenService(mockPrisma(validRow()));
    await expect(svc.verify(CLEAR, '1.1.1.1', NOW)).resolves.toEqual({ id: 'tok1', label: 'marketing-reader' });
  });

  it('401 — sin bearer', async () => {
    const svc = new MarketingTokenService(mockPrisma(validRow()));
    expect(await statusOf(() => svc.verify(undefined, '1.1.1.1', NOW))).toBe(401);
  });

  it('401 — token inexistente', async () => {
    const svc = new MarketingTokenService(mockPrisma(null));
    expect(await statusOf(() => svc.verify('deadbeef', '1.1.1.1', NOW))).toBe(401);
  });

  it('401 — token revocado', async () => {
    const svc = new MarketingTokenService(mockPrisma({ ...validRow(), revokedAt: new Date('2026-01-01') }));
    expect(await statusOf(() => svc.verify(CLEAR, '1.1.1.1', NOW))).toBe(401);
  });

  it('401 — token caducado', async () => {
    const svc = new MarketingTokenService(mockPrisma({ ...validRow(), expiresAt: new Date('2020-01-01') }));
    expect(await statusOf(() => svc.verify(CLEAR, '1.1.1.1', NOW))).toBe(401);
  });

  it('429 — 61ª petición del mismo token dentro de la hora', async () => {
    const svc = new MarketingTokenService(mockPrisma(validRow()));
    for (let i = 0; i < 60; i++) await svc.verify(CLEAR, '1.1.1.1', new Date(NOW.getTime() + i));
    expect(await statusOf(() => svc.verify(CLEAR, '1.1.1.1', new Date(NOW.getTime() + 60)))).toBe(429);
  });

  it('429 — IP bloqueada tras 10 fallos en 10 min', async () => {
    const svc = new MarketingTokenService(mockPrisma(null)); // todo falla (401) y cuenta como fallo de IP
    for (let i = 0; i < 10; i++) await statusOf(() => svc.verify('bad', '9.9.9.9', new Date(NOW.getTime() + i)));
    expect(await statusOf(() => svc.verify('bad', '9.9.9.9', new Date(NOW.getTime() + 11)))).toBe(429);
  });
});

/** ExecutionContext mínimo para el guard. */
function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  const reflector = (required: Permission | undefined) =>
    ({ getAllAndOverride: () => required } as unknown as Reflector);
  const prismaWith = (granted: boolean) =>
    ({ userPermission: { findUnique: jest.fn().mockResolvedValue(granted ? { id: 'p1' } : null) } } as never);

  it('sin @RequirePermission ⇒ pasa', async () => {
    const g = new PermissionGuard(reflector(undefined), prismaWith(false));
    await expect(g.canActivate(ctx({ id: 'u', role: Role.customer }))).resolves.toBe(true);
  });

  it('super_admin tiene marketing:read implícito (sin consultar BD)', async () => {
    const prisma = prismaWith(false);
    const g = new PermissionGuard(reflector(Permission.marketing_read), prisma);
    await expect(g.canActivate(ctx({ id: 'owner', role: Role.super_admin }))).resolves.toBe(true);
    expect((prisma as unknown as { userPermission: { findUnique: jest.Mock } }).userPermission.findUnique).not.toHaveBeenCalled();
  });

  it('otro rol CON fila explícita ⇒ pasa', async () => {
    const g = new PermissionGuard(reflector(Permission.marketing_read), prismaWith(true));
    await expect(g.canActivate(ctx({ id: 'u', role: Role.vault_operator }))).resolves.toBe(true);
  });

  it('otro rol SIN fila ⇒ 403', async () => {
    const g = new PermissionGuard(reflector(Permission.marketing_read), prismaWith(false));
    expect(await statusOf(() => g.canActivate(ctx({ id: 'u', role: Role.vault_operator })))).toBe(403);
  });

  it('sin usuario ⇒ 401', async () => {
    const g = new PermissionGuard(reflector(Permission.marketing_read), prismaWith(false));
    expect(await statusOf(() => g.canActivate(ctx(undefined)))).toBe(401);
  });
});
