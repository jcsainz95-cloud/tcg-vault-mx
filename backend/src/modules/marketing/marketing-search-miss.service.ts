/**
 * marketing-search-miss.service.ts — c6 (MKT_PANEL_V2 §6.4, §7): registro de búsquedas SIN resultado, anónimo.
 * ⛔ Sin usuario, sin IP, sin cookie: solo (término normalizado × día CDMX) → conteo. El término pasa el filtro PII
 * (`marketing-pii-filter.ts`, el mismo de h1) ANTES de normalizarse y DESPUÉS; si el filtro lo descarta, no se guarda nada y
 * quien llama no se entera (204). Apagable con el interruptor `marketing_search_log` (ausente = encendido).
 * Retención: bajo el umbral (≥ 5 en ≥ 2 días) 30 días; sobre el umbral, 90.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { toMexicoCityDateKey } from '../../common/business-days';
import { addDays } from '../sales-analytics/sales-period';
import { containsPii } from './marketing-pii-filter';

export const SEARCH_MISS_TERM_MAX = 40;
export const SEARCH_MISS_FLAG = 'marketing_search_log';
export const SEARCH_MISS_RETENTION_BELOW_DAYS = 30;
export const SEARCH_MISS_RETENTION_VISIBLE_DAYS = 90;
const SEARCH_MISS_THRESHOLD = { count: 5, days: 2 } as const;

/** Término listo para guardar (`[a-z0-9ñ ._-]`, ≤ 40) o `null` si no se debe guardar. PURO. */
export function normalizeSearchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 80) return null;
  if (containsPii(raw)) return null;
  const t = raw
    .toLowerCase()
    .replace(/ñ/g, '\u0001')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ')
    .replace(/[^a-z0-9ñ ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_MISS_TERM_MAX)
    .trim();
  if (t.length < 2) return null;
  if (containsPii(t)) return null; // segunda pasada sobre el texto normalizado
  return t;
}

@Injectable()
export class MarketingSearchMissService {
  private readonly logger = new Logger(MarketingSearchMissService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async enabled(): Promise<boolean> {
    const row = await this.prisma.configSetting.findUnique({ where: { key: SEARCH_MISS_FLAG }, select: { valueJson: true } });
    return row?.valueJson !== 'off';
  }

  /** Cuenta una búsqueda sin resultado. ⛔ Nunca lanza hacia fuera (el endpoint responde 204 siempre). */
  async record(rawTerm: unknown, now = new Date()): Promise<boolean> {
    try {
      const term = normalizeSearchTerm(rawTerm);
      if (term === null || !(await this.enabled())) return false;
      const day = toMexicoCityDateKey(now);
      await this.prisma.$executeRaw`
        INSERT INTO "SearchNoResultDaily" ("id", "termNormalized", "day", "count")
        VALUES (gen_random_uuid()::text, ${term}, ${day}::date, 1)
        ON CONFLICT ("termNormalized", "day") DO UPDATE SET "count" = "SearchNoResultDaily"."count" + 1`;
      return true;
    } catch (e) {
      this.logger.warn(`search-miss no registrado (${e instanceof Error ? e.constructor.name : 'error'})`);
      return false;
    }
  }

  /** Job `marketing-search-miss-retention` (diario): ver cabecera. Devuelve cuántas filas borró. */
  async purgeExpired(now = new Date()): Promise<number> {
    const today = toMexicoCityDateKey(now);
    const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    const visibleCutoff = dayDate(addDays(today, -SEARCH_MISS_RETENTION_VISIBLE_DAYS));
    const belowCutoff = dayDate(addDays(today, -SEARCH_MISS_RETENTION_BELOW_DAYS));
    const old = await this.prisma.searchNoResultDaily.deleteMany({ where: { day: { lt: visibleCutoff } } });
    const grouped = await this.prisma.searchNoResultDaily.groupBy({ by: ['termNormalized'], _sum: { count: true }, _count: { _all: true } });
    const keep = grouped
      .filter((g) => (g._sum.count ?? 0) >= SEARCH_MISS_THRESHOLD.count && g._count._all >= SEARCH_MISS_THRESHOLD.days)
      .map((g) => g.termNormalized);
    const below = await this.prisma.searchNoResultDaily.deleteMany({ where: { day: { lt: belowCutoff }, termNormalized: { notIn: keep } } });
    this.logger.log(`marketing-search-miss-retention: ${old.count + below.count} fila(s) borradas`);
    return old.count + below.count;
  }
}
