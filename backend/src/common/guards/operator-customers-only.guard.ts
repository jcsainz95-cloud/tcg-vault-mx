import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../business.exception';

/**
 * §FICHA-CLIENTE (DECISIONES punto 13, qa B-1): el `vault_operator` solo ve CLIENTES. Sobre una cuenta que no sea `customer`
 * (staff) la ficha, la actividad, el overview y las notas dan 404, como si no existieran. El súper-admin no se filtra.
 * Se aplica SOLO a las rutas de lectura permitidas al operador: las restringidas conservan su 403 propio.
 */
@Injectable()
export class OperatorCustomersOnlyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.user?.role !== Role.vault_operator) return true;
    const id = req.params?.id;
    if (typeof id !== 'string' || id.length === 0) return true;
    const u = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (u && u.role !== Role.customer) throw BusinessException.notFound();
    return true;
  }
}
