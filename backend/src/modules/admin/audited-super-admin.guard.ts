import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { AuditService } from '../audit/audit.service';

/** Qué intentó quien fue rechazado (`AuditLog.after.attempted`, §M6-U.6). */
export type AdminDeniedAttempt = 'create' | 'reset_password';

export const AUDITED_SUPER_ADMIN_KEY = 'auditedSuperAdmin';

/**
 * Marca una ruta de Usuarios como **solo `super_admin`, con el rechazo AUDITADO** (v1.80.9, `API_CONTRACT §M6-U.6`,
 * criterios 256/261, `D-STF-1`). Se usa en lugar de `@Roles(Role.super_admin)` en las DOS rutas de la norma:
 * `POST /admin/users` (`'create'`) y `POST /admin/users/:id/reset-password` (`'reset_password'`).
 */
export const AuditedSuperAdmin = (attempted: AdminDeniedAttempt) => SetMetadata(AUDITED_SUPER_ADMIN_KEY, attempted);

/**
 * `AuditedSuperAdminGuard` — el `RolesGuard` responde `403` **sin bitácora** (medido: el único guard que audita era
 * `money-out.guard.ts`). Para alta y restablecimiento la norma pide **403 + fila** `user.admin_action_denied`
 * `{ actorUserId, actorRole, entityType:'User', entityId: <:id o null>, after: { attempted } }`.
 *
 * - Es guard de RUTA: corre después de los globales (`JwtAuthGuard`, `RolesGuard` con el `@Roles` de clase, que ya
 *   dejó fuera al `customer` con su `403` sin fila) y **antes de los pipes** ⇒ un cuerpo mal formado de un
 *   `vault_operator` también deja la fila (no es un `400`).
 * - Mismo cuerpo que el `RolesGuard` (`FORBIDDEN`, «Insufficient role for this action»).
 * - El rechazo NO depende de la bitácora: si la fila no se escribe, se registra en el log y se rechaza igual.
 */
@Injectable()
export class AuditedSuperAdminGuard implements CanActivate {
  private readonly logger = new Logger(AuditedSuperAdminGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const attempted = this.reflector.get<AdminDeniedAttempt | undefined>(AUDITED_SUPER_ADMIN_KEY, context.getHandler());
    const req = context.switchToHttp().getRequest();
    const user = req.user as { id: string; role: Role } | undefined;
    if (!user) throw new BusinessException('UNAUTHENTICATED', 401, 'Not authenticated');
    if (user.role === Role.super_admin) return true;
    if (attempted) {
      const id = (req.params?.id as string | undefined) ?? null;
      try {
        await this.audit.log({
          actorUserId: user.id,
          actorRole: user.role,
          action: 'user.admin_action_denied',
          entityType: 'User',
          entityId: attempted === 'create' ? undefined : (id ?? undefined), // alta ⇒ NULL en la fila
          after: { attempted },
        });
      } catch (e) {
        this.logger.error(`user.admin_action_denied: bitácora falló (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    throw BusinessException.forbidden('FORBIDDEN', 'Insufficient role for this action');
  }
}
