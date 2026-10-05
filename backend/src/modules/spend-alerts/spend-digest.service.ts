/**
 * spend-digest.service.ts — 💰 el job **`spend-digest`**: el resumen de las 08:00 de México (API_CONTRACT §19.29.7, §19.31.8).
 * El cron (`0 8 * * *` con `tz: 'America/Mexico_City'`: la BullMQ instalada admite `tz`, medido en C1) y
 * `POST /admin/jobs/spend-digest {day?}` son la costura C1 (§19.33.9, `jobs/`).
 *
 *  - `day` = AYER en México (del reloj del módulo). `INSERT SpendDigestRun(day) ON CONFLICT DO NOTHING` ⇒ si no insertó y su
 *    `status ≠ 'failed'`, no-op: **una vez por día**.
 *  - Avisos con `firstOccurredAt ∈ [day 00:00, day+1 00:00)` MX, de las dos gravedades (silenciados incluidos: salen como la
 *    línea «N avisos apagados»). Cero ⇒ `status='empty'`, **sin correo**.
 *  - Si no ⇒ **un** correo `AVG-3` a cada dueño con `summarizeSpendAlerts` del día (el MISMO cuerpo que `GET …/summary`) y los
 *    🔴 no silenciados en una línea cada uno.
 *  - `run({ day })` explícito (el re-envío manual de C1) solo re-manda un día `failed`.
 *  - Sin dueño, o el puerto de correo falla ⇒ `status='failed'` (se puede re-mandar).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { SPEND_ALERTS_CLOCK, SPEND_DIGEST_LOCK_KEY, SpendClock } from './spend-alerts.constants';
import { isYmd, mxDaysRange, yesterdayMx } from './mx-day';
import { summarizeSpendAlerts } from './spend-summary';
import { ownerRecipients } from './spend-mail.service';
import { ALERT_ROW_SELECT, loadAlertRefs, toMailView } from './spend-alert.view';
import { spendDigestMail } from './spend-alert.mail';
import { spendAlertTitle } from './spend-alert-text';
import { SPEND_ALERT_CODE_OF } from './spend-alerts.service';
import { SpendAlertKind } from '@prisma/client';

export type SpendDigestStatus = 'sent' | 'empty' | 'failed' | 'skipped';

const KIND_OF_CODE = new Map<string, SpendAlertKind>(Object.entries(SPEND_ALERT_CODE_OF).map(([k, c]) => [c, k as SpendAlertKind]));

@Injectable()
export class SpendDigestService {
  private readonly logger = new Logger(SpendDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SPEND_ALERTS_CLOCK) private readonly clock: SpendClock,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  async run(opts: { day?: string; now?: Date } = {}): Promise<{ day: string; status: SpendDigestStatus; alertCount: number }> {
    const now = opts.now ?? this.clock.now();
    const explicit = opts.day !== undefined;
    if (explicit && !isYmd(opts.day)) throw new Error(`spend-digest: day '${String(opts.day)}' no es YYYY-MM-DD`);
    const day = explicit ? (opts.day as string) : yesterdayMx(now);
    const dayDate = new Date(`${day}T00:00:00.000Z`); // columna @db.Date: solo la fecha civil
    const range = mxDaysRange(day, day);

    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SPEND_DIGEST_LOCK_KEY})`;
      // `POST /admin/jobs/spend-digest {day}` re-manda SOLO un `failed`: un día que nunca corrió se deja al cron.
      const inserted = explicit
        ? 0
        : await tx.$executeRaw`
            INSERT INTO "SpendDigestRun" (day, status, "alertCount", attempts) VALUES (${dayDate}::date, 'sending', 0, 1)
            ON CONFLICT (day) DO NOTHING`;
      if (inserted === 0) {
        const row = await tx.spendDigestRun.findUnique({ where: { day: dayDate } });
        if (!row || row.status !== 'failed') return null;
        await tx.spendDigestRun.update({ where: { day: dayDate }, data: { status: 'sending', attempts: { increment: 1 } } });
      }
      return true;
    });
    if (!claim) return { day, status: 'skipped', alertCount: 0 };

    const alertCount = await this.prisma.spendAlert.count({ where: { firstOccurredAt: { gte: range.gte, lt: range.lt } } });
    if (alertCount === 0) {
      await this.prisma.spendDigestRun.update({ where: { day: dayDate }, data: { status: 'empty', alertCount: 0 } });
      return { day, status: 'empty', alertCount: 0 };
    }
    try {
      const recipients = await ownerRecipients(this.prisma);
      if (recipients.length === 0) throw new Error('sin cuenta de dueño con correo');
      if (!this.mail) throw new Error('MAIL_PORT no disponible');
      const summary = await summarizeSpendAlerts(this.prisma, { from: day, to: day, range });
      const rows = await this.prisma.spendAlert.findMany({
        where: { firstOccurredAt: { gte: range.gte, lt: range.lt }, severity: 'immediate', muted: false },
        select: ALERT_ROW_SELECT,
        orderBy: { firstOccurredAt: 'asc' },
      });
      const refs = await loadAlertRefs(this.prisma, rows);
      const immediates = rows.map((r) => toMailView(r, refs));
      const titleOfCode = (code: string, l: 'es' | 'en') => {
        const kind = KIND_OF_CODE.get(code);
        return kind ? spendAlertTitle({ kind, facts: {} }, l) : code;
      };
      for (const r of recipients) await this.mail.send({ to: r.email, ...spendDigestMail(day, summary, immediates, r, titleOfCode) });
      await this.prisma.spendDigestRun.update({ where: { day: dayDate }, data: { status: 'sent', alertCount, sentAt: now } });
      return { day, status: 'sent', alertCount };
    } catch (e) {
      this.logger.error(`spend-digest ${day} falló: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.spendDigestRun.update({ where: { day: dayDate }, data: { status: 'failed', alertCount } });
      return { day, status: 'failed', alertCount };
    }
  }
}
