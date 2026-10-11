/**
 * spend-mail.service.ts — 💰 el DESPACHO de los correos al dueño (API_CONTRACT §19.29.5 «Correo inmediato (outbox)», «El lote»,
 * §19.30.1 (6) AG-21, §19.30.7 C-24). Es la mitad que faltaba del outbox: `raise` deja los 🔴 en `pending` dentro de la tx del
 * hecho y aquí se mandan.
 *
 * **A lo sumo una vez** (§19.29.5): bajo `pg_advisory_xact_lock(SPEND_MAIL_LOCK_KEY)` se cuentan los `sent|sending` con
 * `mailedAt` en la HORA DE RELOJ en curso y se decide, en la MISMA tx, `pending → sending` (con `mailedAt = now`) o `→ batched`.
 * El envío ocurre DESPUÉS del commit; un `sending` que nunca llega a `sent|failed` (proceso muerto) lo cierra `spend-watch` como
 * `failed_unknown` a los 10 min, ⛔ sin reintento (puede haber salido).
 *  - Cupo global: `SPEND_MAIL_HOURLY_MAX = 5` por hora (el correo de lote no cuenta).
 *  - Cupo por persona (C-24): con `subjectUserId ≠ null`, `SPEND_MAIL_PER_SUBJECT_HOURLY_MAX = 2` por persona y hora ⇒ el resto de
 *    esa persona va al lote aunque el global tenga sitio; los de sistema solo miran el global.
 *  - AG-21 ⛔ nunca va al lote (sale siempre individual) y va además a la cuenta ANTERIOR si sigue con correo y activa — la única
 *    excepción a «solo el dueño recibe».
 *  - Sin dueño ⇒ `no_recipient` + `warn` (el aviso sigue en el panel). ⛔ Nunca al personal ni a clientes.
 *  - `failed` se reintenta hasta `SPEND_MAIL_MAX_ATTEMPTS` (3).
 *
 * Escribe la tabla SOLO por `SpendAlertsService.mailTransition*` (censo `C-GAS-1`).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, Role, SpendAlertKind, SpendAlertMailStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MAIL_PORT, MailPort } from '../mail/mail.port';
import { isOwnerAccount, OWNER_SELECT } from './owner';
import { SpendAlertsService } from './spend-alerts.service';
import {
  SPEND_ALERTS_CLOCK,
  SPEND_MAIL_HOURLY_MAX,
  SPEND_MAIL_LOCK_KEY,
  SPEND_MAIL_MAX_ATTEMPTS,
  SPEND_MAIL_PER_SUBJECT_HOURLY_MAX,
  SPEND_MAIL_SENDING_STALE_MS,
  SpendClock,
} from './spend-alerts.constants';
import { ALERT_ROW_SELECT, loadAlertRefs, toMailView } from './spend-alert.view';
import { spendAlertBatchMail, spendAlertImmediateMail, SpendMailRecipient } from './spend-alert.mail';

type Db = Prisma.TransactionClient | PrismaService;
const HOUR_MS = 60 * 60 * 1000;

/** El inicio de la hora de reloj de `d` (México no tiene horario de verano y su desfase es de horas enteras: UTC sirve). */
export function hourStartOf(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
}

export interface OwnerRecipient extends SpendMailRecipient {
  userId: string;
}

const RECIPIENT_SELECT = { id: true, name: true, nameSource: true, locale: true, ...OWNER_SELECT } as const;

/** Las cuentas del dueño (`isOwnerAccount`, leído de la BASE): como mucho una por el índice parcial `user_single_owner`. */
export async function ownerRecipients(db: Db): Promise<OwnerRecipient[]> {
  const rows = await db.user.findMany({ where: { isOwner: true }, select: RECIPIENT_SELECT });
  return rows.filter((u) => isOwnerAccount(u)).map((u) => ({ userId: u.id, email: u.email!, name: u.name, nameSource: u.nameSource, locale: u.locale }));
}

export type DispatchOutcome = 'sent' | 'failed' | 'batched' | 'no_recipient' | 'skipped';

@Injectable()
export class SpendMailService {
  private readonly logger = new Logger(SpendMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SpendAlertsService,
    @Inject(SPEND_ALERTS_CLOCK) private readonly clock: SpendClock,
    @Optional() @Inject(MAIL_PORT) private readonly mail?: MailPort,
  ) {}

  /** Post-commit de quien levantó un 🔴 (outbox): ⛔ nunca lanza. `spend-watch` recoge lo que se quede `pending`. */
  async dispatchImmediate(alertId: string): Promise<void> {
    try {
      await this.dispatchOne(alertId, this.clock.now());
    } catch (e) {
      this.logger.error(`dispatchImmediate(${alertId}) falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Destinatarios de un aviso: el dueño; en AG-21 además la cuenta anterior si sigue con correo y activa. */
  private async recipientsFor(db: Db, kind: SpendAlertKind, facts: unknown): Promise<{ r: OwnerRecipient; previousOwner: boolean }[]> {
    const owners = (await ownerRecipients(db)).map((r) => ({ r, previousOwner: false }));
    if (kind !== 'owner_account_changed') return owners;
    const prev = (facts as { previousOwner?: { userId?: unknown } | null } | null)?.previousOwner;
    const prevId = prev && typeof prev.userId === 'string' ? prev.userId : null;
    if (!prevId || owners.some((o) => o.r.userId === prevId)) return owners;
    const u = await db.user.findUnique({ where: { id: prevId }, select: RECIPIENT_SELECT });
    if (u && u.email && u.status === UserStatus.active && u.deletedAt === null && (u.role === Role.super_admin || u.role === Role.vault_operator)) {
      owners.push({ r: { userId: u.id, email: u.email, name: u.name, nameSource: u.nameSource, locale: u.locale }, previousOwner: true });
    }
    return owners;
  }

  /** Despacha UN aviso (`pending`, o `failed` con intentos libres). Devuelve qué pasó. */
  async dispatchOne(alertId: string, now: Date): Promise<DispatchOutcome> {
    const hour = hourStartOf(now);
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SPEND_MAIL_LOCK_KEY})`;
      const row = await tx.spendAlert.findUnique({ where: { id: alertId }, select: { ...ALERT_ROW_SELECT, mailAttempts: true } });
      if (!row || row.muted) return { kind: 'skipped' as const };
      const eligible = row.mailStatus === 'pending' || (row.mailStatus === 'failed' && row.mailAttempts < SPEND_MAIL_MAX_ATTEMPTS);
      if (!eligible) return { kind: 'skipped' as const };
      const from: SpendAlertMailStatus[] = [row.mailStatus];
      const recipients = await this.recipientsFor(tx, row.kind, row.facts);
      if (recipients.length === 0) {
        await this.alerts.mailTransition(tx, row.id, from, { mailStatus: 'no_recipient' });
        return { kind: 'no_recipient' as const };
      }
      if (row.kind !== 'owner_account_changed') {
        const inHour = { mailStatus: { in: ['sent', 'sending'] as SpendAlertMailStatus[] }, mailedAt: { gte: hour, lt: new Date(hour.getTime() + HOUR_MS) } };
        const global = await tx.spendAlert.count({ where: inHour });
        const perSubject = row.subjectUserId ? await tx.spendAlert.count({ where: { ...inHour, subjectUserId: row.subjectUserId } }) : 0;
        if (global >= SPEND_MAIL_HOURLY_MAX || (row.subjectUserId && perSubject >= SPEND_MAIL_PER_SUBJECT_HOURLY_MAX)) {
          await this.alerts.mailTransition(tx, row.id, from, { mailStatus: 'batched', batchHour: hour });
          return { kind: 'batched' as const };
        }
      }
      const moved = await this.alerts.mailTransition(tx, row.id, from, { mailStatus: 'sending', mailedAt: now });
      if (moved !== 1) return { kind: 'skipped' as const };
      const refs = await loadAlertRefs(tx, [row]);
      return { kind: 'send' as const, view: toMailView(row, refs), recipients };
    });
    if (claim.kind === 'no_recipient') {
      this.logger.warn(`aviso ${alertId}: sin cuenta de dueño con correo — no_recipient (sigue en el panel)`);
      return 'no_recipient';
    }
    if (claim.kind !== 'send') return claim.kind;
    try {
      if (!this.mail) throw new Error('MAIL_PORT no disponible');
      for (const { r, previousOwner } of claim.recipients) {
        await this.mail.send({ to: r.email, ...spendAlertImmediateMail(claim.view, r, { previousOwner }) });
      }
      await this.alerts.mailTransition(this.prisma, alertId, ['sending'], { mailStatus: 'sent' });
      return 'sent';
    } catch (e) {
      this.logger.error(`correo del aviso ${alertId} falló: ${e instanceof Error ? e.message : String(e)}`);
      await this.alerts.mailTransition(this.prisma, alertId, ['sending'], { mailStatus: 'failed', incrementAttempts: true });
      return 'failed';
    }
  }

  /** Paso (1) de `spend-watch`: `sending` vencidos ⇒ `failed_unknown`; luego `pending` y `failed` con intentos libres, en orden. */
  async dispatchPending(now: Date): Promise<{ staleUnknown: number; outcomes: Record<DispatchOutcome, number> }> {
    const staleUnknown = await this.alerts.mailTransitionMany(
      this.prisma,
      { from: ['sending'], mailedBefore: new Date(now.getTime() - SPEND_MAIL_SENDING_STALE_MS) },
      { mailStatus: 'failed_unknown' },
    );
    if (staleUnknown > 0) this.logger.warn(`${staleUnknown} correo(s) de aviso en 'sending' > 10 min ⇒ failed_unknown (sin reintento)`);
    const due = await this.prisma.spendAlert.findMany({
      where: { muted: false, OR: [{ mailStatus: 'pending' }, { mailStatus: 'failed', mailAttempts: { lt: SPEND_MAIL_MAX_ATTEMPTS } }] },
      orderBy: { firstOccurredAt: 'asc' },
      select: { id: true },
    });
    const outcomes: Record<DispatchOutcome, number> = { sent: 0, failed: 0, batched: 0, no_recipient: 0, skipped: 0 };
    for (const { id } of due) outcomes[await this.dispatchOne(id, now)] += 1;
    return { staleUnknown, outcomes };
  }

  /**
   * Paso (2) de `spend-watch`: por cada hora CERRADA con avisos `batched`, UN correo «y N avisos más» a cada dueño y los avisos a
   * `batch_sent` (antes de enviar, en la tx del candado: a lo sumo una vez). Si el envío falla de forma conocida, vuelven a
   * `batched` y la siguiente corrida lo reintenta.
   */
  async sendBatches(now: Date): Promise<{ batches: number; alerts: number }> {
    const current = hourStartOf(now);
    const hours = await this.prisma.spendAlert.findMany({
      where: { mailStatus: 'batched', batchHour: { lt: current } },
      distinct: ['batchHour'],
      select: { batchHour: true },
      orderBy: { batchHour: 'asc' },
    });
    let batches = 0;
    let alerts = 0;
    for (const { batchHour } of hours) {
      if (!batchHour) continue;
      const claim = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SPEND_MAIL_LOCK_KEY})`;
        const rows = await tx.spendAlert.findMany({ where: { mailStatus: 'batched', batchHour }, select: ALERT_ROW_SELECT, orderBy: { firstOccurredAt: 'asc' } });
        if (rows.length === 0) return null;
        const ids = rows.map((r) => r.id);
        const recipients = await ownerRecipients(tx);
        if (recipients.length === 0) {
          await this.alerts.mailTransitionMany(tx, { ids, from: ['batched'] }, { mailStatus: 'no_recipient' });
          return { ids, recipients, views: [] };
        }
        await this.alerts.mailTransitionMany(tx, { ids, from: ['batched'] }, { mailStatus: 'batch_sent', mailedAt: now });
        const refs = await loadAlertRefs(tx, rows);
        return { ids, recipients, views: rows.map((r) => toMailView(r, refs)) };
      });
      if (!claim) continue;
      if (claim.recipients.length === 0) {
        this.logger.warn(`lote de ${batchHour.toISOString()}: sin cuenta de dueño con correo — no_recipient`);
        continue;
      }
      try {
        if (!this.mail) throw new Error('MAIL_PORT no disponible');
        for (const r of claim.recipients) await this.mail.send({ to: r.email, ...spendAlertBatchMail(claim.views, batchHour, r) });
        batches += 1;
        alerts += claim.ids.length;
      } catch (e) {
        this.logger.error(`lote de ${batchHour.toISOString()} falló: ${e instanceof Error ? e.message : String(e)} — vuelve a 'batched'`);
        await this.alerts.mailTransitionMany(this.prisma, { ids: claim.ids, from: ['batch_sent'] }, { mailStatus: 'batched', mailedAt: null });
      }
    }
    return { batches, alerts };
  }
}
