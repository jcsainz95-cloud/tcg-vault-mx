import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../modules/settings/settings.service';
import { SettingKey } from '../modules/settings/settings.constants';
import { UploadsService } from '../modules/uploads/uploads.service';
import { SELL_REQUEST_TERMINAL_STATES } from '../common/sell-request-states';

/**
 * IneRetentionJobService — Retención/purga de imágenes de INE (LFPDPPP).
 *
 * Borra las imágenes de INE (objeto en el bucket + limpia `ineFrontKey`/`ineBackKey`)
 * de un usuario cuando:
 *   1) NO tiene solicitudes de buylist abiertas (la INE ya no se necesita para operar), y
 *      «abierta» = NO terminal, por COMPLEMENTO sobre `SELL_REQUEST_TERMINAL_STATES` (M-46, §4.39c);
 *   2) su última solicitud cerrada/pagada superó el periodo `INE_RETENTION_DAYS` (dial).
 *
 * La función es disparable (invocable) aquí y el scheduling repetible BullMQ ya está cableado
 * en el scheduler (RB-5: BE-5 resuelta); también se puede llamar `run()` a mano/CLI/endpoint.
 *
 * v1.8-ronda-c / SEC-D2: la fecha de cierre se toma de `SellRequest.closedAt` (cierre REAL sellado
 * en la transición terminal) con FALLBACK al cálculo por timestamps de estado para filas legacy
 * (`closedAt` null). El predicado de seguridad (openCount>0 → continue; requiere lastClosed y
 * closureDate ≤ cutoff) NO cambia.
 */
@Injectable()
export class IneRetentionJobService {
  private readonly logger = new Logger(IneRetentionJobService.name);

  // v1.51 (M-46, §4.39c **SITIO 1** — el más grave de los nueve, y era de CUMPLIMIENTO).
  //
  // Este archivo definía su propio `CLOSED = ['pagada','rechazada','abandonada']`, copia número uno
  // de CINCO del set terminal. M-46 añade `expirada`: con la lista a mano, una solicitud **expirada**
  // contaría como **ABIERTA PARA SIEMPRE** ⇒ `openCount > 0` en cada corrida ⇒ **el INE de esa
  // persona NO SE PURGA NUNCA** (PII / LFPDPPP). No falla, no avisa y no se nota: simplemente el
  // `continue` de abajo salta a esa persona para siempre.
  //
  // La constante local **se borra**; la fuente es `common/sell-request-states.ts`. La nota de deuda
  // que pedía este reapuntado llevaba **147 commits** sin cobrarse; se cobra aquí.

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
          status: { notIn: [...SELL_REQUEST_TERMINAL_STATES] },
        },
      });
      if (openCount > 0) continue;

      // 2) Última solicitud cerrada/pagada: si ninguna cerró aún, no purgamos.
      const lastClosed = await this.prisma.sellRequest.findFirst({
        where: { userId: kyc.userId, status: { in: [...SELL_REQUEST_TERMINAL_STATES] } },
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

  /**
   * Fecha de cierre de la solicitud. SEC-D2: usa `closedAt` (cierre REAL sellado en la transición
   * terminal) cuando existe; si es null (filas legacy previas a M-19), cae al cálculo anterior por
   * timestamps de estado (última actividad conocida). Ambos caminos devuelven una fecha determinista.
   */
  private closureDate(req: {
    closedAt: Date | null;
    paidAt: Date | null;
    approvedAt: Date | null;
    verifiedAt: Date | null;
    receivedAt: Date | null;
    createdAt: Date;
  }): Date {
    if (req.closedAt) return req.closedAt;
    const candidates = [req.paidAt, req.approvedAt, req.verifiedAt, req.receivedAt, req.createdAt]
      .filter((d): d is Date => d != null)
      .map((d) => d.getTime());
    return new Date(Math.max(...candidates));
  }
}
