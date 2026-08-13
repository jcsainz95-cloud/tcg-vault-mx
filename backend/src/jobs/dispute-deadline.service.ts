import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DisputeDeadlineJobService — Cierra la ventana de recompra a 7 días desde entrega
 * (PROJECT §H, ARCHITECTURE §5). Las disputas abiertas cuyo deadline pasó se
 * marcan para revisión final (no se auto-rechazan: el admin decide el remedio).
 */
@Injectable()
export class DisputeDeadlineJobService {
  private readonly logger = new Logger(DisputeDeadlineJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<{ expired: number }> {
    const expired = await this.prisma.dispute.findMany({
      where: { status: 'abierta', deadlineAt: { lte: now } },
    });
    for (const d of expired) {
      await this.prisma.dispute.update({ where: { id: d.id }, data: { status: 'en_revision' } });
    }
    this.logger.log(`dispute-deadline: ${expired.length} disputas movidas a en_revision.`);
    return { expired: expired.length };
  }
}
