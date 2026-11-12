import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../business.exception';

/**
 * §PROV: `/admin/users/:id/*` no opera sobre cuentas `supplier` (reset, bloqueo, borrado, ficha): por id ⇒ 404, como si no
 * existieran. Las tiendas se gestionan solo en `/admin/suppliers`.
 */
@Injectable()
export class NotSupplierTargetGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const id = context.switchToHttp().getRequest().params?.id;
    if (typeof id !== 'string' || id.length === 0) return true;
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (u?.role === Role.supplier) throw BusinessException.notFound();
    return true;
  }
}
