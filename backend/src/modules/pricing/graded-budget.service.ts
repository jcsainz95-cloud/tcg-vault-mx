/**
 * graded-budget.service.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.4.6, criterio 301): el panel de presupuesto PSA,
 * `GET /admin/pricing/graded-estimates/budget` (`super_admin`). Solo LECTURA: los mismos insumos y las mismas funciones puras
 * (`graded-turns.ts`) que el ingest usa para decidir y para AG-24 — una sola cuenta.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { businessDateCdmx } from '../../common/graded-estimate';
import { prevYmd } from '../spend-alerts/mx-day';
import { PptApiClient } from './providers/ppt-api.client';
import { GRADED_TURN_CYCLE_DAYS, cycleProjection, estimateSetCredits } from './graded-turns';

export interface GradedBudgetDTO {
  hookEnabled: boolean;
  dailyCreditCap: number;
  creditsToday: number;
  creditsLast7Days: number;
  creditsTodayAllMeasured: boolean;
  providerDailyQuota: number | null;
  providerDailyRemaining: number | null;
  publishedCards: number;
  cardsScannedLast7Days: number;
  cardsUnmapped: number;
  weeklyCreditsNeeded: number;
  cycleDays: number | null;
  capToCoverWeek: number;
}

const dbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

@Injectable()
export class GradedBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
    private readonly ppt: PptApiClient,
  ) {}

  async budget(): Promise<GradedBudgetDTO> {
    const now = new Date();
    const today = businessDateCdmx(now);
    let from = today;
    for (let i = 1; i < GRADED_TURN_CYCLE_DAYS; i++) from = prevYmd(from);
    const [hook, cap] = await Promise.all([
      this.settings.getString(SettingKey.GRADING_HOOK_ENABLED),
      this.settings.getNumber(SettingKey.GRADED_ESTIMATE_DAILY_CREDIT_CAP),
    ]);

    // Alcance = el del ingest (§DYN.4.1): cartas raw publicadas de plataforma, agrupadas por set.
    const published = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'platform', status: 'listed', productType: 'raw' },
      select: { cardId: true },
    });
    const cardIds = [...new Set(published.map((r) => r.cardId))];
    const cards = cardIds.length
      ? await this.prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, setId: true, set: true } })
      : [];
    const setMapped = new Map<string, boolean>();
    let cardsUnmapped = 0;
    for (const c of cards) {
      const mapped = c.set?.pptSetId != null;
      setMapped.set(c.setId, mapped);
      if (!mapped) cardsUnmapped += 1;
    }
    const setIds = [...setMapped.keys()];

    const [lastOkRows, counts, recent, scannedRecently] = await Promise.all([
      setIds.length
        ? this.prisma.gradedEstimateSetScan.findMany({
            where: { setId: { in: setIds }, outcome: 'ok' },
            orderBy: [{ setId: 'asc' }, { startedAt: 'desc' }],
            distinct: ['setId'],
            select: { setId: true, creditsMeasured: true },
          })
        : Promise.resolve([] as { setId: string; creditsMeasured: number | null }[]),
      setIds.length
        ? this.prisma.card.groupBy({ by: ['setId'], where: { setId: { in: setIds } }, _count: { _all: true } })
        : Promise.resolve([] as { setId: string; _count: { _all: number } }[]),
      this.prisma.gradedEstimateSetScan.findMany({
        where: { businessDate: { gte: dbDate(from) } },
        select: { businessDate: true, creditsMeasured: true, creditsCharged: true },
      }),
      cardIds.length
        ? this.prisma.gradedEstimateCardScan.count({
            where: { cardId: { in: cardIds }, lastScannedAt: { gte: new Date(now.getTime() - GRADED_TURN_CYCLE_DAYS * 86_400_000) } },
          })
        : Promise.resolve(0),
    ]);

    const lastOk = new Map(lastOkRows.map((r) => [r.setId, r.creditsMeasured]));
    const catalog = new Map(counts.map((c) => [c.setId, c._count._all]));
    let weeklyCreditsNeeded = 0;
    for (const [setId, mapped] of setMapped) {
      if (!mapped) continue;
      weeklyCreditsNeeded += estimateSetCredits(lastOk.get(setId) ?? null, catalog.get(setId) ?? 0);
    }
    const todayRows = recent.filter((r) => r.businessDate.toISOString().slice(0, 10) === today);
    const quotaRaw = this.config.get<string>('POKEMONPRICETRACKER_DAILY_QUOTA');
    const quota = quotaRaw != null && /^\d+$/.test(String(quotaRaw).trim()) ? Number(quotaRaw) : null;
    const { cycleDays, capToCoverWeek } = cycleProjection(weeklyCreditsNeeded, cap);
    return {
      hookEnabled: hook === 'on',
      dailyCreditCap: cap,
      creditsToday: todayRows.reduce((a, r) => a + r.creditsCharged, 0),
      creditsLast7Days: recent.reduce((a, r) => a + r.creditsCharged, 0),
      creditsTodayAllMeasured: todayRows.every((r) => r.creditsMeasured != null || r.creditsCharged === 0),
      providerDailyQuota: quota,
      providerDailyRemaining: this.ppt.dailyRemaining(),
      publishedCards: cardIds.length,
      cardsScannedLast7Days: scannedRecently,
      cardsUnmapped,
      weeklyCreditsNeeded,
      cycleDays,
      capToCoverWeek,
    };
  }
}
