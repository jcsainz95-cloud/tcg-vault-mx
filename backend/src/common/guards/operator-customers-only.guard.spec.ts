import { ExecutionContext } from '@nestjs/common';
import { OperatorCustomersOnlyGuard } from './operator-customers-only.guard';
import { BusinessException } from '../business.exception';

const ctx = (role: string, id?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user: { role }, params: { id } }) }) }) as unknown as ExecutionContext;
const guardWith = (target: { role: string } | null) =>
  new OperatorCustomersOnlyGuard({ user: { findUnique: jest.fn().mockResolvedValue(target) } } as never);

describe('OperatorCustomersOnlyGuard (B-1)', () => {
  it('operador sobre staff ⇒ 404; sobre cliente o inexistente ⇒ pasa', async () => {
    await expect(guardWith({ role: 'vault_operator' }).canActivate(ctx('vault_operator', 'x'))).rejects.toBeInstanceOf(BusinessException);
    await expect(guardWith({ role: 'super_admin' }).canActivate(ctx('vault_operator', 'x'))).rejects.toMatchObject({ status: 404 });
    await expect(guardWith({ role: 'customer' }).canActivate(ctx('vault_operator', 'x'))).resolves.toBe(true);
    await expect(guardWith(null).canActivate(ctx('vault_operator', 'x'))).resolves.toBe(true);
  });
  it('súper-admin no se filtra ni consulta la BD', async () => {
    const g = guardWith({ role: 'super_admin' });
    await expect(g.canActivate(ctx('super_admin', 'x'))).resolves.toBe(true);
  });
});
