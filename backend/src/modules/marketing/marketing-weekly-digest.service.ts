/**
 * marketing-weekly-digest.service.ts — job `marketing-weekly-digest` (MKT_PANEL_V2 §3): el correo del lunes (CDMX) con r1 + r2.
 * Idempotente POR DESTINATARIO por restricción de BD: `INSERT … ON CONFLICT DO NOTHING` sobre `MarketingWeeklyDigest(weekStart,
 * recipientKey)` (`recipientKey` = 16 hex de SHA-256 del correo en minúsculas; el correo no se guarda). Solo quien RECLAMA su fila
 * (`pending` y `claimedAt` nulo o > 15 min) envía a ese destinatario; `sent`/`skipped`/`failed` ⇒ no-op. Un fallo suma `attempts` y
 * deja la fila `pending` para el siguiente tick (cada hora hasta las 20:00); a `attempts ≥ 5` ⇒ `failed`, sin más reintentos. Un
 * fallo de A NO reenvía a B. Sin destinatarios ⇒ una fila `none/skipped`. Régimen SIEMPRE `small_cells`.
 * ⛔ El registro nunca lleva el correo ni el mensaje del proveedor (puede citar al destinatario): solo la clase del error.
 */
import { createHash } from 'node:crypto';
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
export const WEEKLY_DIGEST_MAX_ATTEMPTS = 5;
/** 16 hex de SHA-256 del correo en minúsculas: identifica al destinatario sin guardar su correo. */
export const recipientKeyOf = (email: string): string => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
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

    const day = new Date(`${weekStart}T00:00:00.000Z`);
    const recipients = await ownerRecipients(this.prisma);
    if (recipients.length === 0) {
      const n = await this.insertRow(weekStart, 'none', 'skipped');
      if (n > 0) this.logger.warn(`marketing-weekly-digest ${weekStart}: sin cuenta de dueño con correo ⇒ skipped`);
      return done(n > 0 ? 'skipped' : 'noop');
    }
    const keyed = recipients.map((r) => ({ email: r.email, key: recipientKeyOf(r.email) }));
    for (const r of keyed) await this.insertRow(weekStart, r.key, 'pending');

    const staleBefore = new Date(now.getTime() - WEEKLY_DIGEST_CLAIM_STALE_MS);
    const claimed: typeof keyed = [];
    for (const r of keyed) {
      const c = await this.prisma.marketingWeeklyDigest.updateMany({
        where: { weekStart: day, recipientKey: r.key, status: 'pending', sentAt: null, OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] },
        data: { claimedAt: now },
      });
      if (c.count > 0) claimed.push(r);
    }
    if (claimed.length === 0) return done('noop');

    const fail = async (r: { key: string }, idx: number, e: unknown) => {
      const row = await this.prisma.marketingWeeklyDigest.update({
        where: { weekStart_recipientKey: { weekStart: day, recipientKey: r.key } },
        data: { attempts: { increment: 1 }, claimedAt: null, sentAt: null },
      });
      if (row.attempts >= WEEKLY_DIGEST_MAX_ATTEMPTS) {
        await this.prisma.marketingWeeklyDigest.update({ where: { weekStart_recipientKey: { weekStart: day, recipientKey: r.key } }, data: { status: 'failed' } });
      }
      // ⛔ sin correo ni `e.message` del proveedor: solo la clase y el número de intento.
      this.logger.error(`marketing-weekly-digest ${weekStart} destinatario ${idx + 1}/${keyed.length} falló (${e instanceof Error ? e.constructor.name : 'error'}), intento ${row.attempts}${row.attempts >= WEEKLY_DIGEST_MAX_ATTEMPTS ? ' ⇒ failed' : ''}`);
    };

    let msg: ReturnType<typeof weeklyDigestMail>;
    try {
      if (!this.mail) throw new Error('MAIL_PORT no disponible');
      const period = resolveMarketingPeriod({ weekStart }, now);
      // ⛔ SIEMPRE small_cells: el correo sale a un proveedor externo; `r3` (diario) no existe en este régimen.
      const payload = await this.analytics.screen('r', period, now, 'small_cells');
      const r1 = payload.tables.find((t) => t.id === 'r1');
      const r2 = payload.tables.find((t) => t.id === 'r2');
      if (!r1 || !r2) throw new Error('r1/r2 ausentes');
      msg = weeklyDigestMail(r1, r2, period.from, addDays(period.from, 6), this.panelUrl());
    } catch (e) {
      for (const r of claimed) await fail(r, keyed.indexOf(r), e);
      return done('failed');
    }

    let sent = 0;
    let failed = 0;
    for (const r of claimed) {
      try {
        // Marca intermedia ANTES de enviar (`sentAt`): si el envío sale y luego falla el `update` a `sent`, la fila sigue
        // con `sentAt` y ningún reclamo posterior (exige `sentAt: null`) la reenvía. Si el envío falla, `fail` la libera.
        await this.prisma.marketingWeeklyDigest.update({ where: { weekStart_recipientKey: { weekStart: day, recipientKey: r.key } }, data: { sentAt: now } });
      } catch (e) {
        failed += 1;
        await fail(r, keyed.indexOf(r), e);
        continue;
      }
      try {
        await this.mail!.send({ to: keyed.find((k) => k.key === r.key)!.email, ...msg });
      } catch (e) {
        failed += 1;
        await fail(r, keyed.indexOf(r), e);
        continue;
      }
      sent += 1;
      try {
        await this.prisma.marketingWeeklyDigest.update({ where: { weekStart_recipientKey: { weekStart: day, recipientKey: r.key } }, data: { status: 'sent', sentAt: now, claimedAt: null } });
      } catch (e) {
        // Ya salió: no es un fallo de envío ni se reenvía (la marca `sentAt` lo impide).
        this.logger.error(`marketing-weekly-digest ${weekStart} destinatario ${keyed.indexOf(r) + 1}/${keyed.length}: enviado pero no se pudo marcar 'sent' (${e instanceof Error ? e.constructor.name : 'error'})`);
      }
    }
    return done(failed > 0 ? 'failed' : sent > 0 ? 'sent' : 'noop');
  }

  private async insertRow(weekStart: string, recipientKey: string, status: 'pending' | 'skipped'): Promise<number> {
    return this.prisma.$executeRaw`INSERT INTO "MarketingWeeklyDigest" ("weekStart", "recipientKey", "status", "attempts") VALUES (${weekStart}::date, ${recipientKey}, ${status}, 0) ON CONFLICT ("weekStart", "recipientKey") DO NOTHING`;
  }
}
