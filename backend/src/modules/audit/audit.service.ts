import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';

export interface AuditEntry {
  actorUserId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/** Ámbito de la consulta de auditoría por usuario (GET /admin/users/:id/audit). */
export type UserAuditScope = 'target' | 'actor' | 'both';

/** Entrada expuesta por la actividad/auditoría por usuario. NUNCA incluye before/after. */
export interface UserAuditEntryDTO {
  id: string;
  actorUserId: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
  // `ip` SOLO se puebla para super_admin (vault_operator lo recibe omitido).
  ip?: string | null;
}

/**
 * AuditService — Bitácora global (M10). ARCHITECTURE §3.2 AuditLog.
 * Toda acción de back-office se registra, en especial intentos bloqueados de
 * dinero saliente (queda registrado y bloqueado).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    // H-1 (SEC): cliente transaccional OPCIONAL. Cuando el evento auditado forma parte de una
    // transacción mayor (p. ej. el override manual del sellado al alta), el caller pasa el `tx` para
    // que la fila de bitácora participe del mismo commit/rollback que el cambio auditado. Ausente ⇒
    // comportamiento previo (auto-commit por `this.prisma`).
    await (tx ?? this.prisma).auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before === undefined ? undefined : (entry.before as object),
        after: entry.after === undefined ? undefined : (entry.after as object),
        ip: entry.ip,
      },
    });
  }

  /**
   * Actividad / auditoría por usuario (F1, v1.7-admin-users). API_CONTRACT §M6 /
   * ARCHITECTURE §4.7ter. LECTURA paginada de `AuditLog` de/sobre un usuario.
   *
   *  - `scope=target` (default): `entityType='User' AND entityId=:id` (acciones SOBRE el usuario).
   *  - `scope=actor`: `actorUserId=:id` (acciones realizadas POR el usuario).
   *  - `scope=both`: OR de ambas.
   *
   * Proyección: reusa el `select` del audit-log de M10 (id/actorUserId/actorRole/action/
   * entityType/entityId/createdAt) + `ip` CONDICIONAL por rol (solo super_admin). NUNCA expone
   * `before`/`after` (posible PII/estado sensible). 404 si el usuario no existe.
   */
  async listForUser(params: {
    userId: string;
    scope: UserAuditScope;
    role: Role;
    page: number;
    pageSize: number;
  }): Promise<{ data: UserAuditEntryDTO[]; page: number; pageSize: number; total: number }> {
    const { userId, scope, role, page, pageSize } = params;

    // 404 si el usuario no existe.
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw BusinessException.notFound();

    const target: Prisma.AuditLogWhereInput = { entityType: 'User', entityId: userId };
    const actor: Prisma.AuditLogWhereInput = { actorUserId: userId };
    const where: Prisma.AuditLogWhereInput =
      scope === 'actor' ? actor : scope === 'both' ? { OR: [target, actor] } : target;

    const isSuperAdmin = role === Role.super_admin;
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Select del audit-log de M10 + `ip` SOLO para super_admin (vault_operator no lo pide).
        // before/after NUNCA se seleccionan.
        select: {
          id: true,
          actorUserId: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          ...(isSuperAdmin ? { ip: true } : {}),
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: rows as UserAuditEntryDTO[], page, pageSize, total };
  }
}
