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
}
