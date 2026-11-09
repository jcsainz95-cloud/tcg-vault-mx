/**
 * marketing-weekly-digest.service.ts — job `marketing-weekly-digest` (MKT_PANEL_V2 §3): el correo del lunes (CDMX) con r1 + r2.
 * Idempotente por restricción de BD: `INSERT … ON CONFLICT DO NOTHING` sobre `MarketingWeeklyDigest(weekStart)`; solo quien
 * RECLAMA la fila (`pending` y `claimedAt` nulo o > 15 min) envía. `sent`/`skipped` ⇒ no-op. Un fallo suma `attempts` y deja la fila
 * `pending` para el siguiente tick (cada hora hasta las 20:00). Destinatarios: `ownerRecipients`. Régimen SIEMPRE `small_cells`.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MAIL_PORT, type MailPort } from '../mail/mail.port';
import { ownerRecipients } from '../spend-alerts/spend-mail.service';
import { addDays } from '../sales-analytics/sales-period';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { lastClosedWeekStart, resolveMarketingPeriod } from './marketing-period';
import { weeklyDigestMail } from './marketing-weekly-digest.mail';

export const WEEKLY_DIGEST_FLAG = 'marketing_weekly_digest';
export const WEEKLY_DIGEST_CLAIM_STALE_MS = 15 * 60 * 1000;
export type WeeklyDigestOutcome = 'sent' | 'skipped' | 'noop' | 'failed' | 'off';

@Injectable()
export class MarketingWeeklyDigestService {
  private readonly logger = new Logger(MarketingWeeklyDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: MarketingAnalyticsService,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  private panelUrl(): string {
    const base = (this.config?.get<string>('APP_BASE_URL') ?? '').split(',')[0].trim().replace(/\/+$/, '') || 'https://tcghunt.mx';
    return `${base}/es/admin/marketing`;
  }

  async run(now = new Date()): Promise<{ job: 'marketing-weekly-digest'; weekStart: string; outcome: WeeklyDigestOutcome }> {
    const weekStart = lastClosedWeekStart(now);
    const done = (outcome: WeeklyDigestOutcome) => ({ job: 'marketing-weekly-digest' as const, weekStart, outcome });
    const flag = await this.prisma.configSetting.findUnique({ where: { key: WEEKLY_DIGEST_FLAG }, select: { valueJson: true } });
    if (flag?.valueJson === 'off') return done('off');

    await this.prisma.$executeRaw`INSERT INTO "MarketingWeeklyDigest" ("weekStart", "status", "attempts") VALUES (${weekStart}::date, 'pending', 0) ON CONFLICT ("weekStart") DO NOTHING`;
    const day = new Date(`${weekStart}T00:00:00.000Z`);
    const claim = await this.prisma.marketingWeeklyDigest.updateMany({
      where: { weekStart: day, status: 'pending', OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - WEEKLY_DIGEST_CLAIM_STALE_MS) } }] },
      data: { claimedAt: now },
    });
    if (claim.count === 0) return done('noop');

    try {
      const recipients = await ownerRecipients(this.prisma);
      if (recipients.length === 0) {
        await this.prisma.marketingWeeklyDigest.update({ where: { weekStart: day }, data: { status: 'skipped', claimedAt: null } });
        this.logger.warn(`marketing-weekly-digest ${weekStart}: sin cuenta de dueño con correo ⇒ skipped`);
        return done('skipped');
      }
      if (!this.mail) throw new Error('MAIL_PORT no disponible');
      const period = resolveMarketingPeriod({ weekStart }, now);
      // ⛔ SIEMPRE small_cells: el correo sale a un proveedor externo; `r3` (diario) no existe en este régimen.
      const payload = await this.analytics.screen('r', period, now, 'small_cells');
      const r1 = payload.tables.find((t) => t.id === 'r1');
      const r2 = payload.tables.find((t) => t.id === 'r2');
      if (!r1 || !r2) throw new Error('r1/r2 ausentes');
      const msg = weeklyDigestMail(r1, r2, period.from, addDays(period.from, 6), this.panelUrl());
      for (const r of recipients) await this.mail.send({ to: r.email, ...msg });
      await this.prisma.marketingWeeklyDigest.update({ where: { weekStart: day }, data: { status: 'sent', sentAt: now, claimedAt: null } });
      return done('sent');
    } catch (e) {
      await this.prisma.marketingWeeklyDigest.update({ where: { weekStart: day }, data: { attempts: { increment: 1 }, claimedAt: null } });
      this.logger.error(`marketing-weekly-digest ${weekStart} falló: ${e instanceof Error ? e.message : String(e)}`);
      return done('failed');
    }
  }
}
