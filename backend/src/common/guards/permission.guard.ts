import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, Role } from '@prisma/client';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { BusinessException } from '../business.exception';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PermissionGuard — Autorización por permiso fino declarado con @RequirePermission() (ARCHITECTURE
 * §7, §13.4.1). Corre DESPUÉS de JwtAuthGuard (req.user ya poblado) y RolesGuard.
 *
 * Regla de concesión (Brief 2 §5.3): `super_admin` (el dueño) tiene `marketing:read` IMPLÍCITO (no
 * necesita fila). Cualquier OTRO rol solo pasa si existe una fila `UserPermission` explícita. Sin el
 * permiso ⇒ 403. Las rutas SIN @RequirePermission se dejan pasar (este guard no opina sobre ellas).
 *
 * ⚠️ No se mezcla con @Roles: una ruta del panel declara el permiso, no el rol.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { id?: string; role?: Role } | undefined;
    if (!user?.id) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');

    // El dueño (rol más alto) tiene el permiso implícito.
    if (user.role === Role.super_admin) return true;

    const granted = await this.prisma.userPermission.findUnique({
      where: { userId_permission: { userId: user.id, permission: required } },
      select: { id: true },
    });
    if (!granted) {
      throw BusinessException.forbidden('FORBIDDEN', 'Missing required permission for this action');
    }
    return true;
  }
}
