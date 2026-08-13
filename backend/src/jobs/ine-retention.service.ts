import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../modules/settings/settings.service';
import { SettingKey } from '../modules/settings/settings.constants';
import { UploadsService } from '../modules/uploads/uploads.service';

/**
 * IneRetentionJobService — Retención/purga de imágenes de INE (LFPDPPP).
 *
 * Borra las imágenes de INE (objeto en el bucket + limpia `ineFrontKey`/`ineBackKey`)
 * de un usuario cuando:
 *   1) NO tiene solicitudes de buylist abiertas (la INE ya no se necesita para operar), y
 *   2) su última solicitud cerrada/pagada superó el periodo `INE_RETENTION_DAYS` (dial).
 *
 * La función queda LISTA y disparable (invocable) aquí; el scheduling repetible BullMQ
 * es deuda BE-5 (ver docs/BACKEND_NOTES.md). Se puede llamar `run()` a mano/CLI/endpoint.
 */
@Injectable()
export class IneRetentionJobService {
  private readonly logger = new Logger(IneRetentionJobService.name);

  // Estados terminales de una solicitud (INE ya no se necesita para procesarla).
  private static readonly CLOSED = ['pagada', 'rechazada', 'abandonada'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly uploads: UploadsService,
  ) {}

  async run(now = new Date()): Promise<{ purged: number; scanned: number }> {
    const retentionDays = await this.settings.getNumber(SettingKey.INE_RETENTION_DAYS);
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000);

    const profiles = await this.prisma.kycProfile.findMany({
      where: { OR: [{ ineFrontKey: { not: null } }, { ineBackKey: { not: null } }] },
    });

    let purged = 0;
    for (const kyc of profiles) {
      // 1) ¿Tiene solicitudes aún abiertas? Si sí, la INE sigue siendo necesaria.
      const openCount = await this.prisma.sellRequest.count({
        where: {
          userId: kyc.userId,
          status: { notIn: [...IneRetentionJobService.CLOSED] },
        },
      });
      if (openCount > 0) continue;

      // 2) Última solicitud cerrada/pagada: si ninguna cerró aún, no purgamos.
      const lastClosed = await this.prisma.sellRequest.findFirst({
        where: { userId: kyc.userId, status: { in: [...IneRetentionJobService.CLOSED] } },
        orderBy: { createdAt: 'desc' },
      });
      if (!lastClosed) continue;

      const closedAt = this.closureDate(lastClosed);
      if (closedAt > cutoff) continue; // aún dentro del periodo de retención

      // Purga: borra los objetos del bucket y limpia las keys.
      for (const key of [kyc.ineFrontKey, kyc.ineBackKey]) {
        if (key) {
          try {
            await this.uploads.deleteObject(key);
          } catch (e) {
            this.logger.error(`ine-retention: fallo al borrar objeto ${key}: ${String(e)}`);
          }
        }
      }
      await this.prisma.kycProfile.update({
        where: { id: kyc.id },
        data: { ineFrontKey: null, ineBackKey: null },
      });
      purged++;
    }

    this.logger.log(`ine-retention: ${purged} INE purgadas de ${profiles.length} perfiles con INE.`);
    return { purged, scanned: profiles.length };
  }

  /** Mejor aproximación a la fecha de cierre disponible en el schema (última actividad). */
  private closureDate(req: {
    paidAt: Date | null;
    approvedAt: Date | null;
    verifiedAt: Date | null;
    receivedAt: Date | null;
    createdAt: Date;
  }): Date {
    const candidates = [req.paidAt, req.approvedAt, req.verifiedAt, req.receivedAt, req.createdAt]
      .filter((d): d is Date => d != null)
      .map((d) => d.getTime());
    return new Date(Math.max(...candidates));
  }
}
