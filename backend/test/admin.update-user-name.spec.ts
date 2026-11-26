import { NameSource } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { customerDisplayName } from '../src/modules/vault/customer-display-name';

/** §FICHA-CLIENTE: el nombre que el admin teclea pasa a `nameSource='user'` (cura «sin nombre» en Bóvedas de clientes). */
function setup(prev: { name: string | null; nameSource: NameSource }) {
  const row = { ...prev };
  const tx = {
    user: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(row, data);
        return row;
      }),
    },
  };
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ name: row.name, anonymizedAt: null })) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const svc = new AdminService(prisma as PrismaService, {} as PricingService, {} as any, {} as any);
  return { svc, tx, row };
}

describe('AdminService.updateUserName (nameSource)', () => {
  it('cliente derived: tras editar el nombre queda nameSource=user y customerDisplayName devuelve el nombre', async () => {
    const { svc, tx, row } = setup({ name: 'jc.sainz', nameSource: NameSource.derived });
    expect(customerDisplayName(row as any)).toBeNull();
    const audit = jest.fn(async () => undefined);
    const res = await svc.updateUserName('u1', 'Juan Sainz', audit);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { name: 'Juan Sainz', nameSource: NameSource.user } });
    expect(row.nameSource).toBe('user');
    expect(customerDisplayName(row as any)).toBe('Juan Sainz');
    expect(res).toEqual({ name: 'Juan Sainz', previous: 'jc.sainz' });
    expect(audit).toHaveBeenCalledWith(tx, res);
  });
});
