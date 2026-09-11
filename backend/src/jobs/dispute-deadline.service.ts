import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DisputeDeadlineJobService — Cierra la ventana de recompra a 7 días desde entrega
 * (PROJECT §H, ARCHITECTURE §5). Las disputas abiertas cuyo deadline pasó se
 * marcan para revisión final (no se auto-rechazan: el admin decide el remedio).
 *
 * ⚠️ v1.68 · §M8 (ARCHITECTURE §4.48.4) — **UN SOLO `updateMany`, con la guarda en el `where`.**
 * Hasta v1.67 esto era `findMany` + `update({ where: { id } })` por fila (**read-then-write**): una
 * disputa resuelta por el súper-admin entre la lectura y la escritura **volvía a `en_revision`**, y
 * el registro de un money-out (`resuelta_recompra`) perdía su estado. Con la precondición
 * (`status: 'abierta'`, `deadlineAt <= now`) dentro del `where` la exclusión la da el motor: una fila
 * que ya no está `abierta` en el instante de la escritura **no se toca**, y no hay ventana entre
 * «leer» y «escribir» porque son la misma sentencia. Cero `findMany` previo; `expired` es el `count`.
 */
@Injectable()
export class DisputeDeadlineJobService {
  private readonly logger = new Logger(DisputeDeadlineJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<{ expired: number }> {
    const { count } = await this.prisma.dispute.updateMany({
      where: { status: 'abierta', deadlineAt: { lte: now } },
      data: { status: 'en_revision' },
    });
    this.logger.log(`dispute-deadline: ${count} disputas movidas a en_revision.`);
    return { expired: count };
  }
}
