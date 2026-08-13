import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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

/**
 * AuditService — Bitácora global (M10). ARCHITECTURE §3.2 AuditLog.
 * Toda acción de back-office se registra, en especial intentos bloqueados de
 * dinero saliente (queda registrado y bloqueado).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
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
}
