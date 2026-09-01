import { Role } from '@prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  AdminUsersController,
} from '../src/modules/admin/admin.controller';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { DisputesService } from '../src/modules/disputes/disputes.service';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

/**
 * F2 (v1.7-admin-users, API_CONTRACT §M6 / ARCHITECTURE §4.7ter) — historial por usuario:
 *  - AuditService.listForUser: scope target/actor/both, ip condicional por rol, sin before/after, 404.
 *  - `?userId=` en los listados admin de buylist / shipments / disputes (filtra por FK userId).
 *  - Guard de rol (super_admin para crear; vault_operator+ para el audit).
 */

function auditSvc(prisma: any) {
  return new AuditService(prisma as PrismaService);
}

function prismaAudit(opts: { user?: any; rows?: any[]; total?: number } = {}): any {
  return {
    user: {
      findUnique: jest.fn(async () => ('user' in opts ? opts.user : { id: 'u1' })),
    },
    auditLog: {
      findMany: jest.fn(async () => opts.rows ?? []),
      count: jest.fn(async () => opts.total ?? 0),
    },
  };
}

describe('AuditService.listForUser — scopes', () => {
  it('scope target (default): where entityType=User AND entityId=:id', async () => {
    const prisma = prismaAudit();
    await auditSvc(prisma).listForUser({
      userId: 'u1',
      scope: 'target',
      role: Role.super_admin,
      page: 1,
      pageSize: 20,
    });
    const arg = prisma.auditLog.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ entityType: 'User', entityId: 'u1' });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: { entityType: 'User', entityId: 'u1' } });
  });

  it('scope actor: where actorUserId=:id', async () => {
    const prisma = prismaAudit();
    await auditSvc(prisma).listForUser({
      userId: 'u1',
      scope: 'actor',
      role: Role.super_admin,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({ actorUserId: 'u1' });
  });

  it('scope both: where OR(target, actor)', async () => {
    const prisma = prismaAudit();
    await auditSvc(prisma).listForUser({
      userId: 'u1',
      scope: 'both',
      role: Role.super_admin,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toEqual({
      OR: [{ entityType: 'User', entityId: 'u1' }, { actorUserId: 'u1' }],
    });
  });
});

describe('AuditService.listForUser — proyección por rol', () => {
  it('super_admin selecciona ip; nunca before/after', async () => {
    const prisma = prismaAudit();
    await auditSvc(prisma).listForUser({
      userId: 'u1',
      scope: 'target',
      role: Role.super_admin,
      page: 1,
      pageSize: 20,
    });
    const select = prisma.auditLog.findMany.mock.calls[0][0].select;
    expect(select.ip).toBe(true);
    expect(select.before).toBeUndefined();
    expect(select.after).toBeUndefined();
    // Campos base del audit-log de M10.
    expect(select).toMatchObject({
      id: true,
      actorUserId: true,
      actorRole: true,
      action: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    });
  });

  it('vault_operator NO selecciona ip (proyección reducida); nunca before/after', async () => {
    const prisma = prismaAudit();
    await auditSvc(prisma).listForUser({
      userId: 'u1',
      scope: 'target',
      role: Role.vault_operator,
      page: 1,
      pageSize: 20,
    });
    const select = prisma.auditLog.findMany.mock.calls[0][0].select;
    expect(select.ip).toBeUndefined();
    expect(select.before).toBeUndefined();
    expect(select.after).toBeUndefined();
  });

  it('usuario inexistente → 404 NOT_FOUND (no consulta auditLog)', async () => {
    const prisma = prismaAudit({ user: null });
    await expect(
      auditSvc(prisma).listForUser({
        userId: 'nope',
        scope: 'target',
        role: Role.super_admin,
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('paginación: skip/take derivados de page/pageSize; devuelve total', async () => {
    const prisma = prismaAudit({ rows: [{ id: 'a1' }], total: 42 });
    const res = await auditSvc(prisma).listForUser({
      userId: 'u1',
      scope: 'target',
      role: Role.super_admin,
      page: 3,
      pageSize: 10,
    });
    const arg = prisma.auditLog.findMany.mock.calls[0][0];
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(res).toEqual({ data: [{ id: 'a1' }], page: 3, pageSize: 10, total: 42 });
  });
});

describe('AdminUsersController.userAudit — normaliza scope y respeta rol', () => {
  it('scope inválido cae a target; pasa el rol del actor a listForUser', async () => {
    const auditMock = { log: jest.fn(), listForUser: jest.fn(async () => ({ data: [], page: 1, pageSize: 20, total: 0 })) };
    const ctrl = new AdminUsersController({} as any, auditMock as any);
    await ctrl.userAudit('u1', Role.vault_operator, 'garbage', '1', '20');
    expect(auditMock.listForUser).toHaveBeenCalledWith({
      userId: 'u1',
      scope: 'target',
      role: Role.vault_operator,
      page: 1,
      pageSize: 20,
    });
  });

  it('scope both válido se conserva', async () => {
    const auditMock = { log: jest.fn(), listForUser: jest.fn(async () => ({ data: [], page: 1, pageSize: 20, total: 0 })) };
    const ctrl = new AdminUsersController({} as any, auditMock as any);
    await ctrl.userAudit('u1', Role.super_admin, 'both', '2', '5');
    expect(auditMock.listForUser).toHaveBeenCalledWith({
      userId: 'u1',
      scope: 'both',
      role: Role.super_admin,
      page: 2,
      pageSize: 5,
    });
  });
});

describe('Guards de rol (403 sin rol suficiente)', () => {
  it('POST /admin/users exige super_admin (metadata @Roles en el método)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype.createUser);
    expect(roles).toEqual([Role.super_admin]);
  });

  it('/admin/users es vault_operator+ a nivel de clase (cubre el audit read)', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, AdminUsersController);
    expect(roles).toEqual([Role.vault_operator, Role.super_admin]);
  });
});

describe('Listados admin — filtro ?userId= (F2)', () => {
  it('buylist.adminList añade where.userId', async () => {
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
      },
    };
    // v1.51.14 · BL-22: `adminList` lee el dial de emisión para derivar `offerIssueDeadlineAt`.
    const settings = { getNumber: jest.fn(async () => 7) } as any;
    const svc = new BuylistService(prisma as any, {} as any, settings, {} as any, {} as any);
    await svc.adminList(undefined, 1, 20, 'user-42');
    expect(prisma.sellRequest.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-42' });
    expect(prisma.sellRequest.count).toHaveBeenCalledWith({ where: { userId: 'user-42' } });
  });

  it('buylist.adminList sin userId no filtra por usuario', async () => {
    const prisma: any = {
      sellRequest: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    };
    // v1.51.14 · BL-22: `adminList` lee el dial de emisión para derivar `offerIssueDeadlineAt`.
    const settings = { getNumber: jest.fn(async () => 7) } as any;
    const svc = new BuylistService(prisma as any, {} as any, settings, {} as any, {} as any);
    await svc.adminList('cotizada', 1, 20);
    expect(prisma.sellRequest.findMany.mock.calls[0][0].where).toEqual({ status: 'cotizada' });
  });

  it('shipments.adminList añade where.userId', async () => {
    const prisma: any = {
      shipmentRequest: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    };
    const svc = new ShipmentsService(prisma as any, {} as any, {} as any);
    await svc.adminList(undefined, 1, 20, 'user-7');
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-7' });
  });

  it('disputes.adminList añade where.userId', async () => {
    const prisma: any = {
      dispute: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    };
    const svc = new DisputesService(prisma as any, {} as any);
    await svc.adminList('abierta', 1, 20, 'user-9');
    expect(prisma.dispute.findMany.mock.calls[0][0].where).toEqual({ status: 'abierta', userId: 'user-9' });
  });
});
