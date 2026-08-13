import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { BusinessException } from '../business.exception';

/**
 * RolesGuard — Autorización por rol declarado con @Roles(). ARCHITECTURE §7.
 * Debe ejecutarse DESPUÉS de JwtAuthGuard (req.user ya poblado).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { role: Role } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');
    if (!required.includes(user.role)) {
      throw BusinessException.forbidden('FORBIDDEN', 'Insufficient role for this action');
    }
    return true;
  }
}
