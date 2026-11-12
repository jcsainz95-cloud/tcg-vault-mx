import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard, supplierMayCall } from '../src/common/guards/roles.guard';
import { Roles } from '../src/common/decorators/roles.decorator';

/** §PROV F1 — default-deny del rol `supplier`, incluso en rutas SIN @Roles (las "abiertas a cualquier autenticado"). */
class OpenCtl { open() { return 1; } }
class StaffCtl { @Roles(Role.vault_operator, Role.super_admin) staff() { return 1; } }
class SupplierCtl { @Roles(Role.supplier) mine() { return 1; } }

const ctx = (cls: any, handler: string, role: Role | undefined, url: string): any => ({
  getHandler: () => cls.prototype[handler],
  getClass: () => cls,
  switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined, originalUrl: url }) }),
});

describe('RolesGuard — rol supplier (default-deny)', () => {
  const guard = new RolesGuard(new Reflector());

  it('ruta sin @Roles fuera de /supplier: el proveedor recibe 403 FORBIDDEN_ROLE; un cliente pasa', () => {
    expect(() => guard.canActivate(ctx(OpenCtl, 'open', Role.supplier, '/api/v1/orders'))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN_ROLE', status: 403 }),
    );
    expect(guard.canActivate(ctx(OpenCtl, 'open', Role.customer, '/api/v1/orders'))).toBe(true);
  });

  it('rutas de staff: el proveedor recibe FORBIDDEN_ROLE; /supplier/* con su @Roles pasa', () => {
    expect(() => guard.canActivate(ctx(StaffCtl, 'staff', Role.supplier, '/api/v1/admin/supply-requests'))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN_ROLE' }),
    );
    expect(guard.canActivate(ctx(SupplierCtl, 'mine', Role.supplier, '/api/v1/supplier/requests?x=1'))).toBe(true);
    expect(() => guard.canActivate(ctx(SupplierCtl, 'mine', Role.customer, '/api/v1/supplier/requests'))).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  it('lista blanca exacta de /auth y sin trampas de prefijo', () => {
    for (const ok of ['login', 'refresh', 'logout', 'change-password', 'forgot-password', 'reset-password']) {
      expect(supplierMayCall(`/api/v1/auth/${ok}`)).toBe(true);
    }
    for (const no of ['/api/v1/auth/google', '/api/v1/auth/register', '/api/v1/auth/set-password', '/api/v1/auth/login/x',
      '/api/v1/suppliers', '/api/v1/supplierx/a', '/api/v1/admin/supplier/a', '/api/v1/auth/../admin/x', '/', '']) {
      expect(supplierMayCall(no)).toBe(false);
    }
    expect(supplierMayCall('/api/v1/supplier')).toBe(true);
    expect(supplierMayCall('/api/v1/supplier/offers/1')).toBe(true);
  });
});
