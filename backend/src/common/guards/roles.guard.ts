import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { BusinessException } from '../business.exception';

/**
 * RolesGuard — Autorización por rol declarado con @Roles(). ARCHITECTURE §7.
 * Debe ejecutarse DESPUÉS de JwtAuthGuard (req.user ya poblado).
 */
/**
 * §PROV F1: default-deny del rol `supplier`. Solo `/supplier/*` y los `/auth/*` básicos (API_CONTRACT_PROVEEDORES §0).
 * Se evalúa ANTES del chequeo por @Roles: una ruta sin @Roles (abierta a "cualquier autenticado") queda cerrada al proveedor.
 */
const SUPPLIER_AUTH_ALLOWED = new Set(['login', 'refresh', 'logout', 'change-password', 'forgot-password', 'reset-password']);
export function supplierMayCall(rawUrl: string): boolean {
  const path = (rawUrl ?? '').split('?')[0].replace(/^\/api\/v1(?=\/)/, '').replace(/\/+$/, '');
  if (/^\/supplier(\/|$)/.test(path)) return true;
  const m = /^\/auth\/([^/]+)$/.exec(path);
  return !!m && SUPPLIER_AUTH_ALLOWED.has(m[1]);
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rq = context.switchToHttp().getRequest();
    if (rq.user?.role === Role.supplier && !supplierMayCall(rq.originalUrl ?? rq.url ?? '')) {
      throw BusinessException.forbidden('FORBIDDEN_ROLE', 'Suppliers can only use /supplier/*');
    }
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { role: Role } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');
    if (!required.includes(user.role)) {
      throw BusinessException.forbidden(user.role === Role.supplier ? 'FORBIDDEN_ROLE' : 'FORBIDDEN', 'Insufficient role for this action');
    }
    return true;
  }
}
