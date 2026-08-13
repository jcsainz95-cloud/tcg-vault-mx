import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { MONEY_OUT_KEY } from '../decorators/money-out.decorator';
import { BusinessException } from '../business.exception';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * MoneyOutGuard — Regla de oro: SOLO `super_admin` toca dinero que sale.
 * ARCHITECTURE §5/§7; PROJECT criterios 25/26.
 * Cualquier otro rol → 403 MONEY_OUT_FORBIDDEN y el intento queda AUDITADO.
 * Se aplica a rutas marcadas con @MoneyOut() (pago SPEI, reembolso, recompra).
 */
@Injectable()
export class MoneyOutGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isMoneyOut = this.reflector.getAllAndOverride<boolean>(MONEY_OUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isMoneyOut) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; role: Role } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');

    if (user.role !== Role.super_admin) {
      // Auditar el intento bloqueado antes de rechazar.
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'money_out.blocked',
        entityType: 'route',
        entityId: `${req.method} ${req.originalUrl ?? req.url}`,
        ip: req.ip,
      });
      throw BusinessException.forbidden(
        'MONEY_OUT_FORBIDDEN',
        'Only super_admin may execute money-out actions',
      );
    }
    return true;
  }
}
