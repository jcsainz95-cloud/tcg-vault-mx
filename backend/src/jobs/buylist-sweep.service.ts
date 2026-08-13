import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BuylistSweepJobService — Plazos de buylist (PROJECT criterio 16, ARCHITECTURE §5):
 *  - 7 días sin respuesta a un ajuste → SellRequest `rechazada`.
 *  - 30 días de abandono → pasa a inventario (`convertida_inventario`).
 */
@Injectable()
export class BuylistSweepJobService {
  private readonly logger = new Logger(BuylistSweepJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<{ rejected: number; abandoned: number }> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    // 7 días: ajuste enviado sin respuesta → rechazada
    const toReject = await this.prisma.sellRequest.findMany({
      where: {
        status: { in: ['verificacion', 'aprobada'] },
        adjustmentSentAt: { not: null, lte: sevenDaysAgo },
      },
    });
    for (const req of toReject) {
      await this.prisma.sellRequest.update({
        where: { id: req.id },
        data: { status: 'rechazada' },
      });
    }

    // 30 días de abandono (sin recepción) → abandonada (pasa a inventario decisión admin)
    const toAbandon = await this.prisma.sellRequest.findMany({
      where: {
        status: { in: ['cotizada'] },
        createdAt: { lte: thirtyDaysAgo },
      },
    });
    for (const req of toAbandon) {
      await this.prisma.sellRequest.update({
        where: { id: req.id },
        data: { status: 'abandonada' },
      });
    }

    this.logger.log(`buylist-sweep: ${toReject.length} rechazadas, ${toAbandon.length} abandonadas.`);
    return { rejected: toReject.length, abandoned: toAbandon.length };
  }
}
