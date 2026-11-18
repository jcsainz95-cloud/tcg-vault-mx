import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailPort } from '../mail/mail.port';
import { headingRow, mailShell, proseRow, spacerRow } from '../buylist/mail-shell';
import { ownerRecipients } from '../spend-alerts/spend-mail.service';
import { PatternPlan, PlannedCombo } from './pattern-plan';
import { pauseSeries } from './pattern-streak';

/** Máximo de ítems del informe `pricing.pattern_reclassify_run` (6.3) y de los «mayores» que lleva el correo. */
export const PATTERN_ITEMS_MAX = 500;
export const PATTERN_MAIL_TOP = 20;
/** Auto-pausa (6.2): este número de corridas SEGUIDAS con pendientes crecientes; la pausa dura {@link PATTERN_PAUSE_DAYS} y se reanuda sola. */
export const PATTERN_PAUSE_STREAK = 3;
export const PATTERN_PAUSE_DAYS = 3;

/** Lo que el informe necesita de una corrida (subconjunto de `PatternReclassifyResult`). */
export interface PatternRunFacts {
  trialRejected: number;
  quarantined: number;
  quarantinedCards: { cardId: string; reasons: string[] }[];
  failedBatches: number;
}
export type MeasuredCombo = { cardId: string; finish: string; fromCents: number; toCents: number };

/** Informe, correo al dueño y auto-pausa del job `pattern-reclassify` (extraído del servicio; sin estado, best-effort). */
export class PatternReporter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
    private readonly audit?: AuditService,
    private readonly mail?: MailPort,
  ) {}

  /**
   * Informe de la corrida (6.3/6.6) y vigilancia de la fuente (6.2). Solo se llama con ≥ 1 combo corregido, diferido, rechazado por la prueba o lote fallido (PP-12; `plan` es `null` en la reversa del dial). Best-effort:
   * un fallo de auditoría o de correo NO cambia lo ya confirmado. NO MIENTE: `applied` y los `items` aplicados son lo MEDIDO en la prueba (referencia en vivo
   * antes/después); lo planeado que no cambió (override manual) o se rechazó no aparece como corregido. Los diferidos llevan los valores del plan. El correo
   * va SOLO si `applied ≥ 1` o `deferred ≥ 1` (una cuarentena nueva sin cambios de precio queda en Auditoría).
   */
  async report(plan: PatternPlan | null, now: Date, measured: MeasuredCombo[], out: PatternRunFacts): Promise<void> {
    const ordered: { cardId: string; finish: string; fromCents: number; toCents: number }[] = [...measured, ...(plan?.deferred ?? []).map((d: PlannedCombo) => ({ cardId: d.cardId, finish: d.finish, fromCents: d.fromCents, toCents: d.toCents }))];
    const shown = ordered.slice(0, PATTERN_ITEMS_MAX);
    const cards = await this.prisma.card.findMany({
      where: { id: { in: [...new Set(shown.map((c) => c.cardId))] } },
      select: { id: true, name: true, set: { select: { name: true } } },
    });
    const byCard = new Map(cards.map((c) => [c.id, c]));
    const items = shown.map((c) => ({
      cardId: c.cardId,
      name: byCard.get(c.cardId)?.name ?? null,
      set: byCard.get(c.cardId)?.set?.name ?? null,
      finish: c.finish,
      fromCents: c.fromCents,
      toCents: c.toCents,
    }));
    await this.audit
      ?.log({
        action: 'pricing.pattern_reclassify_run',
        entityType: 'CardProduct',
        after: {
          applied: measured.length, planned: plan?.applied.length ?? 0, deferred: plan?.deferred.length ?? 0, exposed: (plan?.applied.length ?? 0) + (plan?.deferred.length ?? 0),
          trialRejected: out.trialRejected, quarantined: out.quarantined, failedBatches: out.failedBatches, quarantinedCards: out.quarantinedCards, items, truncated: ordered.length > shown.length,
        },
      })
      .catch((e: Error) => this.logger.warn(`pattern-reclassify: no se pudo auditar la corrida: ${e.message}`));
    if (measured.length + (plan?.deferred.length ?? 0) > 0) await this.mailRun(measured.length, plan?.deferred.length ?? 0, out.quarantined, items.slice(0, PATTERN_MAIL_TOP));
    await this.checkStreak(now);
  }

  /** Auto-pausa: las últimas {@link PATTERN_PAUSE_STREAK} corridas (cada una a ≤ 48 h de la anterior, tras la última pausa) con (diferidos + cuarentenas activas + lotes fallidos) > 0 y CRECIENTES. */
  private async checkStreak(now: Date): Promise<void> {
    try {
      const lastPause = await this.prisma.auditLog.findFirst({ where: { action: 'pricing.pattern_reclassify_paused' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      const runs = await this.prisma.auditLog.findMany({
        where: { action: 'pricing.pattern_reclassify_run', ...(lastPause ? { createdAt: { gt: lastPause.createdAt } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PATTERN_PAUSE_STREAK,
        select: { createdAt: true, after: true },
      });
      const pending = pauseSeries(runs, PATTERN_PAUSE_STREAK); // 6.6 (2) + PP-12: diferidos + cuarentenas activas + lotes fallidos, crecientes
      if (!pending) return;
      await this.audit?.log({ action: 'pricing.pattern_reclassify_paused', entityType: 'CardProduct', after: { deferred: pending, pausedDays: PATTERN_PAUSE_DAYS, at: now.toISOString() } });
      this.logger.error(`pattern-reclassify: AUTO-PAUSA: ${PATTERN_PAUSE_STREAK} corridas seguidas con pendientes (diferidos + cuarentena) crecientes (${pending.join(' → ')}).`);
      await this.sendOwners(
        'TCG HUNT: la corrección de precios se pausó sola',
        [`La corrección automática de precios de versiones «Pattern/Ball» frenó ${PATTERN_PAUSE_STREAK} corridas seguidas y la lista de pendientes sigue creciendo (${pending.join(' → ')}). Parece una anomalía de la fuente de precios, no una corrección normal: el proceso se pausó ${PATTERN_PAUSE_DAYS} días y se reanuda solo. No tienes que hacer nada; si quieres revisar, está en Auditoría (pricing.pattern_reclassify_run).`],
      );
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo evaluar la auto-pausa: ${(e as Error).message}`);
    }
  }

  private async mailRun(applied: number, deferred: number, quarantined: number, top: { name: string | null; set: string | null; finish: string; fromCents: number; toCents: number }[]): Promise<void> {
    const mxn = (c: number) => `$${(c / 100).toFixed(2)}`;
    const lines = top.map((t) => `${t.name ?? '?'} (${t.set ?? '?'}, ${t.finish}): ${mxn(t.fromCents)} → ${mxn(t.toCents)}`);
    const head =
      `Corrección automática de precios de versiones «Pattern/Ball»: ${applied} corregidas hoy` +
      (deferred > 0 ? `, ${deferred} pendientes para la siguiente corrida diaria (límite de seguridad por día)` : '') +
      (quarantined > 0 ? `. ${quarantined} en cuarentena (detalle en Auditoría): la prueba previa vio que habrían subido de precio o quedado sin precio, así que no se tocaron` : '') +
      `. Solo bajan precios inflados; no necesitas aprobar nada. Las ${lines.length} de mayor diferencia (lista completa en Auditoría, pricing.pattern_reclassify_run):`;
    await this.sendOwners('TCG HUNT: corrección automática de precios', [head, ...lines]);
  }

  /** Correo al dueño: `paragraphs[0]` es el texto principal; el resto, líneas de detalle. Best-effort. */
  private async sendOwners(subject: string, paragraphs: string[]): Promise<void> {
    if (!this.mail) return;
    try {
      const owners = await ownerRecipients(this.prisma);
      const text = paragraphs.join('\n');
      const html = mailShell({
        locale: 'es', title: subject, preheader: paragraphs[0].slice(0, 90),
        blocks: [headingRow(subject, 22), spacerRow(24), ...paragraphs.map((l) => proseRow(l)), spacerRow(16)],
        footerWhy: 'Recibes este aviso porque eres el dueño de la tienda.',
      });
      for (const o of owners) await this.mail.send({ to: o.email, subject, html, text });
    } catch (e) {
      this.logger.warn(`pattern-reclassify: no se pudo avisar al dueño: ${(e as Error).message}`);
    }
  }
}
