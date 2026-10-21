/**
 * marketing-access-log.service.ts — registro de accesos del Panel (Brief 2 §5.3, PM-M3;
 * ARCHITECTURE §13.4.4). Cada export, descarga del botón semanal y llamada al endpoint deja UNA fila.
 * ⛔ SIN contenido (ni filas, ni datos personales): solo quién/qué/cuándo/formato/nº de filas.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface MarketingAccessEntry {
  /** Exactamente uno de los dos: sesión admin (export/botón) … */
  actorUserId?: string | null;
  /** … o token marketing-reader (endpoint). */
  tokenId?: string | null;
  /** Pantalla a-h, o 'todo' / 'semana'. */
  screen: string;
  /** Filtros aplicados, SIN PII (ya escapados; sin contenido). */
  filters?: Prisma.InputJsonValue;
  format?: 'json' | 'xlsx' | 'csv';
  rowCount?: number | null;
}

/** Retención del registro de accesos: 12 meses (ARCHITECTURE §13.4.4, PM-M3). */
export const MARKETING_ACCESS_LOG_RETENTION_MONTHS = 12;

/** Corte de retención: el mismo instante de hace 12 meses (calendario UTC). Lo anterior se borra. */
export function accessLogRetentionCutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - MARKETING_ACCESS_LOG_RETENTION_MONTHS);
  return d;
}

@Injectable()
export class MarketingAccessLogService {
  private readonly logger = new Logger(MarketingAccessLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escribe la fila. Best-effort: si falla, NO tumba la respuesta de datos (pero se loguea el fallo,
   * nunca el contenido). El acceso ya ocurrió; perder la bitácora no debe negar el dato legítimo.
   */
  async record(entry: MarketingAccessEntry): Promise<void> {
    try {
      await this.prisma.marketingAccessLog.create({
        data: {
          actorUserId: entry.actorUserId ?? null,
          tokenId: entry.tokenId ?? null,
          screen: entry.screen,
          filters: entry.filters ?? Prisma.JsonNull,
          format: entry.format ?? null,
          rowCount: entry.rowCount ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`marketing access-log no escrito (${(e as Error).message})`);
    }
  }

  /**
   * Job `marketing-access-log-retention` (diario, cola `tcg-daily`): borra las filas con más de 12 meses (§13.4.4). Sin el
   * job, el plazo solo garantizaba «como mínimo» 12 meses (LIMPIEZA_DB §14.2.1, «Fuera de la limpieza»). Devuelve cuántas.
   */
  async purgeExpired(now = new Date()): Promise<number> {
    const { count } = await this.prisma.marketingAccessLog.deleteMany({ where: { at: { lt: accessLogRetentionCutoff(now) } } });
    this.logger.log(`marketing-access-log-retention: ${count} fila(s) de más de ${MARKETING_ACCESS_LOG_RETENTION_MONTHS} meses borradas`);
    return count;
  }
}
