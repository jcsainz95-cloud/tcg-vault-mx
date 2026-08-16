import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AuthTokenSweepJobService — housekeeping de `AuthToken` (v1.5, ARCHITECTURE §3.2/§4.11).
 * Borra los tokens que ya no sirven: expirados (`expiresAt < now`) o ya usados (`usedAt != null`).
 * No es crítico (la validación de consumo ya rechaza expirados/usados); solo mantiene la tabla
 * chica. Sigue el patrón standalone de buylist-sweep/ine-retention: `run()` invocable/disparable.
 */
@Injectable()
export class AuthTokenSweepJobService {
  private readonly logger = new Logger(AuthTokenSweepJobService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<{ deleted: number }> {
    const res = await this.prisma.authToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
      },
    });
    this.logger.log(`auth-token-sweep: ${res.count} tokens expirados/usados borrados.`);
    return { deleted: res.count };
  }
}
