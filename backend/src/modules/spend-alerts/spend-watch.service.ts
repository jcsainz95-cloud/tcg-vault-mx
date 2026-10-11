/**
 * spend-watch.service.ts — 💰 el job **`spend-watch`** (API_CONTRACT §19.29.7, §19.30.1 (5), §19.31.10 fila 2b). Cada 5 min (el
 * cron y el registro en `jobs/` son la costura C1, §19.33.9: `scheduler.service.ts` y `POST /admin/jobs/spend-watch`).
 *
 *  (0) 🔒 C-20 (b): **la marca del dueño.** `actual` = id del único `User` con `isOwner` que cumple `isOwnerAccount`, o `null`.
 *      Sin fila en `SpendOwnerWatch` ⇒ la inserta (y con `actual = null` crea AG-21 `no_owner`); con fila y `actual ≠
 *      ownerUserId` ⇒ **AG-21 🔴** y actualiza la fila en la MISMA tx; igual ⇒ solo `observedAt`. Sin dueño ⇒ `error`
 *      `NO_OWNER_ACCOUNT` en el log. Corre también con el proveedor `off`. Único escritor de `SpendOwnerWatch`.
 *  (1) Correos `pending`/`failed` (≤ 3 intentos) y `sending` vencidos (`SpendMailService.dispatchPending`).
 *  (2) El lote de cada hora cerrada con `batched` (`SpendMailService.sendBatches`).
 *  (3) Solo con `shipping_provider = 'skydropx'`: saldo por la lectura cacheada (⇒ `observeBalance`, AG-7); **AG-8 (b)**:
 *      `ShipmentPaidLabel` cancelada con `unrefundedCents IS NULL`, `cancelledAt ≤ now − dial días` y `refundAlertedAt IS NULL`
 *      ⇒ avisa y SELLA (con `CANCEL_REFUND_VERIFIABLE = false`, toda cancelación sin cifra avisa al día 3, criterio 326); **AG-10**:
 *      guía de Skydropx en `guia`, sin cancelar, sin movimiento y comprada hace ≥ dial días ⇒ 🟡; en la misma corrida resuelve
 *      los abiertos cuyo paquete salió o cuya guía se canceló.
 *
 * Single-flight: `pg_try_advisory_xact_lock(SPEND_WATCH_LOCK_KEY)` en el paso (0); otra corrida viva ⇒ esta no hace nada.
 */
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { CANCEL_REFUND_VERIFIABLE } from '../shipments/label-verify.constants';
import { isOwnerAccount, OWNER_SELECT } from './owner';
import { SpendAlertsService, SpendFacts } from './spend-alerts.service';
import { SpendMailService } from './spend-mail.service';
import { ProviderBalanceService } from './provider-balance.service';
import { SPEND_ALERTS_CLOCK, SPEND_WATCH_LOCK_KEY, SpendClock } from './spend-alerts.constants';
import { OUTBOUND_ONLY } from '../shipments/label-subject';

const DAY_MS = 24 * 60 * 60 * 1000;
type Db = Prisma.TransactionClient | PrismaService;

export interface SpendWatchResult {
  skipped?: 'already_running';
  owner: { ownerUserId: string | null; changed: boolean; alertId: string | null };
  mail: { staleUnknown: number; sent: number; failed: number; batched: number; noRecipient: number };
  batches: { batches: number; alerts: number };
  provider: 'skydropx' | 'off';
  balanceCents: number | null;
  ag8: number;
  ag10: { raised: number; resolved: number };
}

/** El dueño ACTUAL según la marca: el único marcado que cumple `isOwnerAccount`, o `null`. */
export async function currentOwner(db: Db): Promise<{ id: string; name: string } | null> {
  const rows = await db.user.findMany({ where: { isOwner: true }, select: { id: true, name: true, ...OWNER_SELECT } });
  const ok = rows.filter((u) => isOwnerAccount(u));
  return ok.length === 1 ? { id: ok[0].id, name: ok[0].name } : null;
}

@Injectable()
export class SpendWatchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SpendWatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SpendAlertsService,
    private readonly mail: SpendMailService,
    private readonly balance: ProviderBalanceService,
    private readonly settings: SettingsService,
    @Inject(SPEND_ALERTS_CLOCK) private readonly clock: SpendClock,
  ) {}

  /** §19.30.1 (4): el arranque registra `NO_OWNER_ACCOUNT` (⛔ no tumba la aplicación: la tienda sigue vendiendo). */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if (!(await currentOwner(this.prisma))) {
        this.logger.error('NO_OWNER_ACCOUNT: ninguna cuenta cumple isOwnerAccount — nadie exento de topes, nadie mueve los diales del dueño, los correos de avisos quedan no_recipient');
      }
    } catch (e) {
      this.logger.warn(`comprobación de dueño al arrancar falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async run(now: Date = this.clock.now()): Promise<SpendWatchResult> {
    const owner = await this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SPEND_WATCH_LOCK_KEY}) AS locked`;
      if (!locked) return null;
      return this.watchOwner(tx, now);
    });
    const empty: SpendWatchResult = {
      owner: { ownerUserId: null, changed: false, alertId: null },
      mail: { staleUnknown: 0, sent: 0, failed: 0, batched: 0, noRecipient: 0 },
      batches: { batches: 0, alerts: 0 },
      provider: 'off',
      balanceCents: null,
      ag8: 0,
      ag10: { raised: 0, resolved: 0 },
    };
    if (!owner) return { ...empty, skipped: 'already_running' };
    if (owner.alertId) await this.mail.dispatchImmediate(owner.alertId);

    const pending = await this.mail.dispatchPending(now);
    const batches = await this.mail.sendBatches(now);
    const result: SpendWatchResult = {
      ...empty,
      owner,
      mail: {
        staleUnknown: pending.staleUnknown,
        sent: pending.outcomes.sent,
        failed: pending.outcomes.failed,
        batched: pending.outcomes.batched,
        noRecipient: pending.outcomes.no_recipient,
      },
      batches,
    };
    const provider = await this.settings.get<string>(SettingKey.SHIPPING_PROVIDER);
    if (provider !== 'skydropx') return result;
    result.provider = 'skydropx';
    result.balanceCents = await this.balance.read();
    result.ag8 = await this.sweepRefunds(now);
    result.ag10 = await this.sweepNotShipped(now);
    // Lo que (3) levantó en 🔴 sale en esta misma corrida.
    const again = await this.mail.dispatchPending(now);
    result.mail.sent += again.outcomes.sent;
    result.mail.failed += again.outcomes.failed;
    result.mail.batched += again.outcomes.batched;
    result.mail.noRecipient += again.outcomes.no_recipient;
    return result;
  }

  /** Paso (0). Dentro de la tx del candado de `spend-watch`. */
  private async watchOwner(tx: Prisma.TransactionClient, now: Date): Promise<SpendWatchResult['owner']> {
    const actual = await currentOwner(tx);
    if (!actual) this.logger.error('NO_OWNER_ACCOUNT: ninguna cuenta cumple isOwnerAccount (spend-watch)');
    const row = await tx.spendOwnerWatch.findUnique({ where: { id: 1 } });
    if (!row) {
      await tx.spendOwnerWatch.create({ data: { id: 1, ownerUserId: actual?.id ?? null, observedAt: now } });
      if (actual) return { ownerUserId: actual.id, changed: false, alertId: null };
      const alertId = await this.raiseOwnerChanged(tx, null, null, now);
      return { ownerUserId: null, changed: true, alertId };
    }
    if ((row.ownerUserId ?? null) === (actual?.id ?? null)) {
      await tx.spendOwnerWatch.update({ where: { id: 1 }, data: { observedAt: now } });
      return { ownerUserId: actual?.id ?? null, changed: false, alertId: null };
    }
    const prev = row.ownerUserId
      ? ((await tx.user.findUnique({ where: { id: row.ownerUserId }, select: { id: true, name: true } })) ?? { id: row.ownerUserId, name: '' })
      : null;
    const alertId = await this.raiseOwnerChanged(tx, prev, actual, now);
    await tx.spendOwnerWatch.update({ where: { id: 1 }, data: { ownerUserId: actual?.id ?? null, observedAt: now } });
    return { ownerUserId: actual?.id ?? null, changed: true, alertId };
  }

  /** AG-21 (§19.30.1 (6)) — 🔴, `ag21:<anterior|none>:<actual|none>:<instante>` (G4), nombres del personal (⛔ correos). */
  private async raiseOwnerChanged(
    tx: Prisma.TransactionClient,
    prev: { id: string; name: string } | null,
    curr: { id: string; name: string } | null,
    now: Date,
  ): Promise<string | null> {
    // G2 (§19.33.7): los dueños son el objeto persona de `SpendFactValue` (⛔ sin cast).
    const facts: SpendFacts = {
      cause: curr ? 'changed' : 'no_owner',
      previousOwner: prev ? { userId: prev.id, name: prev.name } : null,
      currentOwner: curr ? { userId: curr.id, name: curr.name } : null,
    };
    // G4 (§19.33.7): cada cambio de la marca es un hecho NUEVO ⇒ la llave lleva el instante de la corrida que lo detecta
    // (A→B→A→B ⇒ tres avisos). «A lo sumo una vez por cambio» lo sigue dando la fila de `SpendOwnerWatch`, actualizada en la
    // MISMA tx bajo el candado de `spend-watch`.
    const dedupKey = `ag21:${prev?.id ?? 'none'}:${curr?.id ?? 'none'}:${now.toISOString()}`;
    const res = await this.alerts.raise(
      tx,
      { kind: 'owner_account_changed', severity: 'immediate', dedupKey, facts },
      now,
    );
    return res?.id ?? null;
  }

  /** AG-8 (b) — avisa y sella cada cancelación sin cifra de reembolso al cumplir el dial de días (desde `cancelledAt`). */
  private async sweepRefunds(now: Date): Promise<number> {
    const days = await this.settings.getNumber(SettingKey.SPEND_ALERT_CANCEL_REFUND_DAYS);
    // ⚠️ `CANCEL_REFUND_VERIFIABLE = false` (§19.29.6 AG-8): hoy no se puede comprobar el reembolso ⇒ TODA cancelación sin cifra
    // avisa al cumplir el plazo. Con `true` (errata con la medición) aquí iría la comprobación; hoy no hay rama que la salte.
    if (CANCEL_REFUND_VERIFIABLE) this.logger.warn('CANCEL_REFUND_VERIFIABLE = true sin comprobación construida: se avisa igual (falla cerrado)');
    const due = await this.prisma.shipmentPaidLabel.findMany({
      where: { cancelledAt: { not: null, lte: new Date(now.getTime() - days * DAY_MS) }, unrefundedCents: null, refundAlertedAt: null },
      select: { id: true, chargedCents: true, cancelKind: true, shipmentRequestId: true },
      orderBy: { cancelledAt: 'asc' },
    });
    const orderOf = new Map(
      (due.length
        ? await this.prisma.shipmentRequest.findMany({ where: { id: { in: [...new Set(due.map((p) => p.shipmentRequestId))] } }, select: { id: true, orderId: true } })
        : []
      ).map((s) => [s.id, s.orderId]),
    );
    let raised = 0;
    for (const p of due) {
      const ok = await this.prisma.$transaction(async (tx) => {
        const sealed = await tx.shipmentPaidLabel.updateMany({ where: { id: p.id, refundAlertedAt: null }, data: { refundAlertedAt: now } });
        if (sealed.count !== 1) return null;
        return this.alerts.raise(
          tx,
          {
            kind: 'cancel_refund_missing',
            severity: 'immediate',
            dedupKey: `ag8:${p.id}`,
            shipmentRequestId: p.shipmentRequestId,
            orderId: orderOf.get(p.shipmentRequestId) ?? null,
            amountCents: p.chargedCents,
            facts: { chargedCents: p.chargedCents, refundedCents: null, unrefundedCents: null, cancelKind: p.cancelKind ?? null },
          },
          now,
        );
      });
      if (ok) raised += 1;
    }
    return raised;
  }

  /** AG-10 — guía comprada que no sale (🟡) y su resolución automática. */
  private async sweepNotShipped(now: Date): Promise<{ raised: number; resolved: number }> {
    const days = await this.settings.getNumber(SettingKey.SPEND_ALERT_LABEL_NOT_SHIPPED_DAYS);
    const candidates = await this.prisma.shipmentRequest.findMany({
      where: {
        // rev BSD-1 (I-BSD-6, censo BSD-B23): AG-10 no es para la guía de ENTRADA (la lleva el vendedor; el plazo es suyo).
        ...OUTBOUND_ONLY,
        labelSource: 'skydropx',
        status: 'guia',
        providerCanceledAt: null,
        OR: [{ carrierStatus: null }, { carrierStatus: 'created' }],
        labelPurchasedAt: { lte: new Date(now.getTime() - days * DAY_MS) },
        providerShipmentId: { not: null },
      },
      select: { id: true, orderId: true, carrier: true, labelPurchasedAt: true, providerShipmentId: true },
    });
    let raised = 0;
    for (const s of candidates) {
      const paid = await this.prisma.shipmentPaidLabel.findUnique({
        where: { providerShipmentId: s.providerShipmentId! },
        select: { id: true, chargedCents: true, cancelledAt: true },
      });
      if (!paid || paid.cancelledAt) continue;
      const dedupKey = `ag10:${paid.id}`;
      if (await this.prisma.spendAlert.findUnique({ where: { dedupKey }, select: { id: true } })) continue;
      await this.alerts.raise(
        this.prisma,
        {
          kind: 'label_not_shipped',
          severity: 'digest',
          dedupKey,
          shipmentRequestId: s.id,
          orderId: s.orderId,
          amountCents: paid.chargedCents,
          facts: {
            daysSincePurchase: Math.floor((now.getTime() - s.labelPurchasedAt!.getTime()) / DAY_MS),
            chargedCents: paid.chargedCents,
            carrierName: s.carrier ?? null,
          },
        },
        now,
      );
      raised += 1;
    }
    const open = await this.prisma.spendAlert.findMany({ where: { kind: 'label_not_shipped', resolvedAt: null }, select: { dedupKey: true } });
    let resolved = 0;
    for (const a of open) {
      const paidId = a.dedupKey.replace(/^ag10:/, '');
      const paid = await this.prisma.shipmentPaidLabel.findUnique({
        where: { id: paidId },
        select: { cancelledAt: true, providerShipmentId: true, shipmentRequestId: true },
      });
      const s = paid
        ? await this.prisma.shipmentRequest.findUnique({
            where: { id: paid.shipmentRequestId },
            select: { status: true, carrierStatus: true, providerCanceledAt: true, providerShipmentId: true },
          })
        : null;
      const gone =
        !paid ||
        !s ||
        paid.cancelledAt !== null ||
        s.providerCanceledAt !== null ||
        s.providerShipmentId !== paid.providerShipmentId ||
        s.status === 'enviado' ||
        s.status === 'entregado' ||
        (s.carrierStatus !== null && s.carrierStatus !== 'created');
      if (gone && (await this.alerts.resolve(this.prisma, a.dedupKey, now))) resolved += 1;
    }
    return { raised, resolved };
  }
}
