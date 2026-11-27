import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { autoLinkEnabled } from './catalog-auto-link.service';
import { countsInUnlinkedCards, nextAutoLinkRun, unlinkedBySet, utcDayStart } from './auto-link-stats';

/** Contrato §2 `summary` (+ `autoLinkEnabled`, aditivo: el frontend lo pide para decir «se reintenta solo» solo con la fase 2 encendida, §7.4). */
export interface LinkSummary {
  unlinkedCards: number;
  unlinkedSets: number;
  repairedYesterday: number;
  pricedYesterday: number;
  lastRunAt: string | null;
  nextRunAt: string;
  waitingDecision: number;
  autoLinkEnabled: boolean;
}

/** §AUTO-ENLACE fases 2-3 — lectura de la lista de excepciones y el contador de M2. Solo lectura local (0 llamadas a proveedores). */
@Injectable()
export class LinkExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /** `summary` del contrato: «quedan X · ayer Y (Z con precio)». «Ayer» = día UTC anterior, de las filas `catalog.auto_link_run`. */
  async summary(now = new Date()): Promise<LinkSummary> {
    const today = utcDayStart(now);
    const yesterday = new Date(today.getTime() - 86_400_000);
    const [sets, runs, last, enabled] = await Promise.all([
      unlinkedBySet(this.prisma),
      this.prisma.auditLog.findMany({ where: { action: 'catalog.auto_link_run', createdAt: { gte: yesterday, lt: today } }, select: { after: true } }),
      this.prisma.auditLog.findFirst({ where: { action: 'catalog.auto_link_run' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      autoLinkEnabled(this.settings),
    ]);
    const counted = sets.filter((s) => countsInUnlinkedCards(s));
    const sum = (k: 'linked' | 'priced'): number => runs.reduce((n, r) => n + (Number((r.after as Record<string, unknown> | null)?.[k]) || 0), 0);
    return {
      unlinkedCards: counted.reduce((n, s) => n + s.unlinked, 0),
      unlinkedSets: counted.length,
      repairedYesterday: sum('linked'),
      pricedYesterday: sum('priced'),
      lastRunAt: last?.createdAt.toISOString() ?? null,
      nextRunAt: nextAutoLinkRun(now).toISOString(),
      waitingDecision: 0,
      autoLinkEnabled: enabled,
    };
  }
}
