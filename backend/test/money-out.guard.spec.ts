import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { MoneyOutGuard } from '../src/common/guards/money-out.guard';
import { BusinessException } from '../src/common/business.exception';
import { AuditService } from '../src/modules/audit/audit.service';

function ctx(user: { id: string; role: Role } | undefined): ExecutionContext {
  const req = { user, method: 'POST', originalUrl: '/api/v1/admin/orders/x/refund', ip: '127.0.0.1' };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('MoneyOutGuard (regla de oro: solo super_admin toca dinero saliente)', () => {
  let audit: { log: jest.Mock };
  let reflector: Reflector;

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    reflector = new Reflector();
  });

  it('allows super_admin on a money-out route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new MoneyOutGuard(reflector, audit as unknown as AuditService);
    await expect(
      guard.canActivate(ctx({ id: 'u1', role: Role.super_admin })),
    ).resolves.toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('blocks vault_operator with MONEY_OUT_FORBIDDEN and audits the attempt', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new MoneyOutGuard(reflector, audit as unknown as AuditService);
    await expect(
      guard.canActivate(ctx({ id: 'op1', role: Role.vault_operator })),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'money_out.blocked', actorUserId: 'op1' }),
    );
  });

  it('blocks customer as well', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new MoneyOutGuard(reflector, audit as unknown as AuditService);
    await expect(guard.canActivate(ctx({ id: 'c1', role: Role.customer }))).rejects.toMatchObject({
      code: 'MONEY_OUT_FORBIDDEN',
    });
  });

  it('does not restrict non-money-out routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const guard = new MoneyOutGuard(reflector, audit as unknown as AuditService);
    await expect(
      guard.canActivate(ctx({ id: 'op1', role: Role.vault_operator })),
    ).resolves.toBe(true);
  });
});
