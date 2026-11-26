import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../modules/audit/audit.service';
import { isSchedulerDisabled } from '../config/test-env';
import { isValidMxPhone, maskPhone, normalizeMxPhone } from '../modules/users/phone-mx';

/**
 * UsersPhoneBackfillService — §CELULAR-ALTA (v2 §6.4a). Job diario (04:30 UTC) y de arranque: a cada `User` sin celular válido
 * (nulo, vacío o basura) le copia el primer celular que pase `normalizeMxPhone` de: su pedido más reciente
 * (`shippingAddressSnapshot.phone`), su dirección predeterminada, su dirección más reciente.
 * Idempotente y nunca pisa un celular válido: la escritura es `updateMany where phone sigue siendo el que leí` (y solo si
 * ese valor es inválido). Auditoría `user.phone.backfill` `{source, masked, previousMasked}` (⛔ nunca el número completo).
 * Sin candidato válido ⇒ no hace nada (la puerta de §3 lo pide al iniciar sesión). Conteo `filled/candidates` en el log.
 */
export interface PhoneBackfillReport {
  candidates: number;
  filled: number;
}

const BATCH = 200;

@Injectable()
export class UsersPhoneBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersPhoneBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (isSchedulerDisabled()) return;
    // Pruebas/integración: misma variable que la reparación de bóveda (`VAULT_ORPHAN_REPAIR_BOOT=off`); en producción corre.
    if (process.env.VAULT_ORPHAN_REPAIR_BOOT === 'off') return;
    setTimeout(() => {
      this.run().catch((e: unknown) => this.logger.error(`users-phone-backfill(boot): ${(e as Error).message}`));
    }, 8_000).unref();
  }

  async run(opts: { onlyUserIds?: string[] } = {}): Promise<PhoneBackfillReport> {
    const report: PhoneBackfillReport = { candidates: 0, filled: 0 };
    let cursor: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: { anonymizedAt: null, ...(opts.onlyUserIds ? { id: { in: opts.onlyUserIds } } : {}) },
        select: { id: true, role: true, phone: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;
      for (const u of users) {
        if (isValidMxPhone(u.phone)) continue;
        report.candidates += 1;
        const found = await this.candidateFor(u.id);
        if (!found) continue;
        const filled = await this.prisma.$transaction(async (tx) => {
          // Nunca pisa: solo si la fila sigue con el MISMO valor (inválido) que se leyó.
          const r = await tx.user.updateMany({ where: { id: u.id, phone: u.phone }, data: { phone: found.phone } });
          if (r.count !== 1) return false;
          await this.audit.log(
            {
              actorRole: u.role,
              action: 'user.phone.backfill',
              entityType: 'User',
              entityId: u.id,
              after: { source: found.source, masked: maskPhone(found.phone), previousMasked: u.phone ? maskPhone(u.phone) : null },
            },
            tx,
          );
          return true;
        });
        if (filled) report.filled += 1;
      }
      if (users.length < BATCH) break;
    }
    this.logger.log(`users-phone-backfill: ${report.filled}/${report.candidates} cuentas sin celular válido rellenadas.`);
    return report;
  }

  private async candidateFor(userId: string): Promise<{ phone: string; source: 'order' | 'address' } | null> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { shippingAddressSnapshot: true },
    });
    for (const o of orders) {
      const p = normalizeMxPhone((o.shippingAddressSnapshot as { phone?: unknown } | null)?.phone);
      if (p) return { phone: p, source: 'order' };
    }
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { phone: true },
    });
    for (const a of addresses) {
      const p = normalizeMxPhone(a.phone);
      if (p) return { phone: p, source: 'address' };
    }
    return null;
  }
}
