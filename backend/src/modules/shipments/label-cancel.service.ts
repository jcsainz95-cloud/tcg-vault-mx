/**
 * label-cancel.service.ts — 💰 cancelar la guía de Skydropx (API_CONTRACT §M4-SHIP.19.8 «label/cancel» y «Cancelación
 * automática», con §19.18.3, §19.20.2, §19.29.4 tabla del libro y §19.29.6 AG-4 (ii)(iii) / AG-8 (a)).
 *
 *  - `POST /admin/shipments/:id/label/cancel` (operador+, re-emitir, T.4.8): sello por CAS bajo candado, `port.cancel` FUERA
 *    de la tx; rechazo ⇒ CAS inverso y `422`; aceptado ⇒ `guia → picking` (la ÚNICA transición hacia atrás, `C-SDX-4`) con
 *    todo lo de la guía a `NULL` y el costo a 0, libro de guías pagadas (`cancelKind:'reissue'`), ajuste por lo no devuelto
 *    (SEC-SDX-11), AG-8 (a) y AG-4. ⛔ `AV-6` no sale (el envío no se cancela). Con el proveedor `off` sigue (SEC-SDX-12).
 *  - `cancelProviderLabelIfAny(tx, shipmentId, 'auto_close')`: dentro de la tx de los DOS escritores automáticos de
 *    `cancelado` (contracargo de un directo, cierre por reembolso total). Sella; el `cancel` va post-commit con
 *    `afterAutoClose(ids)` (best-effort; si falla, la alerta `label_cancel_failed` y el reintento por el verbo).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { CancelResult } from '../shipping-provider/shipping-provider.port';
import { SpendAlertsService, dayMx } from '../spend-alerts/spend-alerts.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { LabelActor, ShipmentLabelService } from './label-purchase.service';
import { asRate } from './label-view';
import { LabelAutoCloser } from './label-auto-close';

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 30_000 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `{ reason: string (3..200) }` ⇒ `400 VALIDATION_ERROR {field:'reason'}`. */
export function parseCancelBody(raw: unknown): { reason: string } {
  const b = (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const r = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (r.length < 3 || r.length > 200) throw BusinessException.badRequest('VALIDATION_ERROR', 'reason must be 3..200 characters', { field: 'reason' });
  return { reason: r };
}

/** Lo que la bitácora `label_cancel_unknown` guarda del error: código y, si lo hay, `status`/`reason` (⛔ nunca cuerpos). */
function cancelErrorOf(e: unknown): Record<string, unknown> {
  if (e instanceof ShippingProviderError) {
    const d = e.details as { status?: unknown; reason?: unknown };
    return { code: e.code, status: d.status ?? null, ...(d.reason !== undefined ? { reason: d.reason } : {}) };
  }
  return { code: 'UNKNOWN' };
}

@Injectable()
export class ShipmentLabelCancelService implements LabelAutoCloser {
  private readonly logger = new Logger(ShipmentLabelCancelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly labels: ShipmentLabelService,
    private readonly alerts: SpendAlertsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
  ) {}

  /** `POST …/label/cancel` (§19.8). */
  async cancel(shipmentId: string, raw: unknown, actor: LabelActor): Promise<{ outcome: 'cancelled' | 'already_cancelled'; shipment: unknown }> {
    const { reason } = parseCancelBody(raw);
    // SEC-SDX-12: con `off` sigue; sin credenciales ⇒ 409 {missing:['env']}.
    if (this.selection.kind === 'noop') throw ShippingProviderError.notConfigured(['env']).toBusinessException();
    const exists = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!exists) throw BusinessException.notFound();

    const sealedAt = this.clock.now();
    const sealed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      if (row.labelSource !== 'skydropx' || row.providerShipmentId === null) {
        throw new BusinessException('LABEL_NOT_CANCELLABLE', 409, 'Only a Skydropx label can be cancelled', { reason: 'not_provider' });
      }
      if (row.carrierStatus !== null && row.carrierStatus !== 'created') {
        throw new BusinessException('LABEL_NOT_CANCELLABLE', 409, 'The carrier already picked up the parcel', { reason: 'already_picked_up', carrierStatus: row.carrierStatus });
      }
      // Reintento de una cancelación automática que falló (§19.8): `cancelado` con sello `auto_close` sin confirmar.
      const retry = row.status === 'cancelado' && row.providerCanceledAt !== null && row.providerCancelReason === 'auto_close' && row.providerCancelConfirmedAt === null;
      if (retry) return { kind: 'retry' as const, row };
      // Ya sellada (por el verbo o por la cancelación automática) ⇒ `200 already_cancelled` (PS-83: «`label/cancel` sobre él
      // ⇒ `already_cancelled`»), sin red.
      if (row.providerCanceledAt !== null) return { kind: 'already' as const, row };
      if (row.status !== 'picking' && row.status !== 'guia') {
        throw new BusinessException('LABEL_NOT_CANCELLABLE', 409, 'The shipment is not in preparation', { reason: 'status', status: row.status });
      }
      const cas = await tx.shipmentRequest.updateMany({
        where: { id: shipmentId, labelSource: 'skydropx', providerCanceledAt: null, OR: [{ carrierStatus: null }, { carrierStatus: 'created' }] },
        data: { providerCanceledAt: sealedAt, providerCancelReason: 'reissue' },
      });
      if (cas.count !== 1) return { kind: 'already' as const, row };
      return { kind: 'sealed' as const, row };
    }, TX);
    if (sealed.kind === 'already') return { outcome: 'already_cancelled', shipment: (await this.labels.respond(shipmentId, actor, 'in_progress')).shipment };

    const providerShipmentId = sealed.row.providerShipmentId as string;
    let res: CancelResult;
    try {
      res = await this.selection.port.cancel(providerShipmentId, reason);
    } catch (e) {
      // §19.31.6 (1): SIN respuesta legible (timeout, 5xx, red). Con persona delante (`reissue`) se REVIERTE el sello: un
      // sello sin confirmar sobre un envío en `guia` no tendría camino de reintento (el CAS exige `providerCanceledAt IS
      // NULL` ⇒ `already_cancelled` sin red). La guía se tiene por viva hasta que Skydropx confirme; el reintento está a un
      // clic. Bitácora `label_cancel_unknown` FUERA de toda tx. El reintento de un `auto_close` conserva su sello (punto 3).
      if (sealed.kind === 'sealed') {
        await this.unseal(shipmentId, sealedAt);
        await this.labels.audit(this.prisma, actor, shipmentId, 'shipment.label_cancel_unknown', {
          providerShipmentId,
          error: cancelErrorOf(e),
        });
      }
      throw e instanceof ShippingProviderError ? e.toBusinessException() : e;
    }
    let via: 'provider_already_cancelled' | null = null;
    if (!res.ok) {
      // §19.31.6 (2): antes de revertir, ¿ya está cancelada en Skydropx? (el primer `cancel` sí entró y éste se rechaza).
      // Lectura legible con `canceled` ⇒ se trata como ACEPTADA con `refundedCents: null` (AG-8 (b) vigila el reembolso).
      if (await this.providerSaysCanceled(providerShipmentId)) {
        res = { ok: true, refundedCents: null };
        via = 'provider_already_cancelled';
      } else {
        if (sealed.kind === 'sealed') await this.unseal(shipmentId, sealedAt);
        throw new BusinessException('SHIPPING_PROVIDER_REJECTED', 422, 'The provider rejected the cancellation', {
          provider: 'skydropx',
          op: 'cancel',
          providerCode: res.code,
          providerMessage: res.message,
        });
      }
    }
    if (sealed.kind === 'retry') {
      await this.labels.confirmCancellation(shipmentId, providerShipmentId, res.refundedCents, 'auto_close', null, reason);
      await this.labels.audit(this.prisma, actor, shipmentId, 'shipment.label_cancelled', { reason, refundedCents: res.refundedCents, retryOf: 'auto_close', ...(via ? { via } : {}) }, this.clock.now(), { providerShipmentId });
      return { outcome: 'cancelled', shipment: (await this.labels.respond(shipmentId, actor, 'in_progress')).shipment };
    }
    await this.applyReissue(shipmentId, providerShipmentId, sealedAt, sealed.row, res.refundedCents, reason, actor, via);
    return { outcome: 'cancelled', shipment: (await this.labels.respond(shipmentId, actor, 'in_progress')).shipment };
  }

  /** §19.31.6 (2): `getShipment` legible con `carrierStatus = 'canceled'`. Ilegible o con otro estado ⇒ `false`. */
  private async providerSaysCanceled(providerShipmentId: string): Promise<boolean> {
    try {
      const s = await this.selection.port.getShipment(providerShipmentId);
      return s.carrierStatus === 'canceled';
    } catch {
      return false;
    }
  }

  /** CAS inverso del sello (la guía sigue viva). */
  private async unseal(shipmentId: string, sealedAt: Date): Promise<void> {
    await this.prisma.shipmentRequest.updateMany({
      where: { id: shipmentId, providerCanceledAt: sealedAt, providerCancelReason: 'reissue', providerCancelConfirmedAt: null },
      data: { providerCanceledAt: null, providerCancelReason: null },
    });
  }

  /** Aceptada (§19.8): `guia → picking` conservando `preparedAt`, todo lo de la guía a `NULL`, costo 0; libro y avisos. */
  private async applyReissue(
    shipmentId: string,
    providerShipmentId: string,
    sealedAt: Date,
    before: { carrier: string | null; trackingNumber: string | null; chosenRateJson: Prisma.JsonValue; shippingCostCents: number },
    refundedCents: number | null,
    reason: string,
    actor: LabelActor,
    via: 'provider_already_cancelled' | null = null,
  ): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      // Libro, ajuste por lo no devuelto (SEC-SDX-11) y AG-8 (a): UN cuerpo con la cancelación automática.
      await this.labels.confirmCancellation(shipmentId, providerShipmentId, refundedCents, 'reissue', actor.id, reason, tx);
      // ⚠️ `status:'picking'` desde `guia`: el ÚNICO retroceso del sistema (`C-SDX-4`), con la precondición en el `WHERE`.
      const r = await tx.shipmentRequest.updateMany({
        where: { id: shipmentId, status: { in: ['guia', 'picking'] }, providerShipmentId, providerCanceledAt: sealedAt },
        data: {
          status: 'picking',
          labelSource: null,
          providerShipmentId: null,
          carrier: null,
          trackingNumber: null,
          labelUrl: null,
          trackingUrl: null,
          carrierStatus: null,
          carrierStatusAt: null,
          labelProcessingSince: null,
          providerCanceledAt: null,
          providerCancelReason: null,
          providerCancelConfirmedAt: null,
          labelPurchasedAt: null,
          shippingCostCents: 0,
          shippingCostIvaCents: 0,
          insuranceCostCents: 0,
          shippingIvaSource: null,
        },
      });
      if (r.count !== 1) {
        // Otro camino movió la fila (p. ej. un contracargo la cerró): la guía YA está cancelada en Skydropx; se deja el
        // sello confirmado y la fila como está.
        this.logger.error(`label/cancel: la fila ${shipmentId} cambió entre el sello y la confirmación; guía ${providerShipmentId} cancelada`);
        await tx.shipmentRequest.updateMany({
          where: { id: shipmentId, providerShipmentId, providerCancelConfirmedAt: null },
          data: { providerCancelConfirmedAt: now },
        });
      }
      await this.labels.audit(
        tx,
        actor,
        shipmentId,
        'shipment.label_cancelled',
        { reason, refundedCents, ...(via ? { via } : {}) },
        now,
        { providerShipmentId, carrier: before.carrier, trackingNumber: before.trackingNumber, priceCents: asRate(before.chosenRateJson)?.priceCents ?? before.shippingCostCents },
      );
      await this.reissueAlerts(tx, shipmentId, actor, now);
    }, TX);
  }

  /** AG-4 (ii) por envío y (iii) por persona (§19.29.6). ⛔ `auto_close`/`orphan_*` no cuentan; el dueño no se avisa a sí mismo. */
  private async reissueAlerts(tx: Tx, shipmentId: string, actor: LabelActor, now: Date): Promise<void> {
    const perShipment = await this.settings.getNumber(SettingKey.SPEND_ALERT_SHIPMENT_CANCEL_COUNT, tx);
    const perPerson = await this.settings.getNumber(SettingKey.SPEND_ALERT_PERSON_CANCEL_COUNT_24H, tx);
    const facts = await this.labels.reissueFacts(shipmentId, tx);
    if (facts.cancelledCount >= perShipment) {
      await this.alerts.raise(tx, { kind: 'label_reissue_loop', severity: 'immediate', dedupKey: `ag4:s:${shipmentId}`, subjectUserId: actor.id, shipmentRequestId: shipmentId, facts: { ...facts, triggers: ['shipment_cancels'] } }, now);
    }
    const mine = await tx.shipmentPaidLabel.findMany({
      where: { cancelKind: 'reissue', cancelledByUserId: actor.id, cancelledAt: { gt: new Date(now.getTime() - DAY_MS) } },
      select: { unrefundedCents: true },
    });
    if (mine.length >= perPerson) {
      const names = await tx.user.findMany({ where: { id: actor.id }, select: { name: true } });
      await this.alerts.raise(tx, {
        kind: 'label_reissue_loop',
        severity: 'immediate',
        dedupKey: `ag4:u:${actor.id}:${dayMx(now)}`,
        subjectUserId: actor.id,
        facts: {
          cancelledCount: mine.length,
          unrecoveredCents: mine.reduce((s, m) => s + (m.unrefundedCents ?? 0), 0),
          unknownRefunds: mine.filter((m) => m.unrefundedCents === null).length,
          actors: names.map((n) => n.name),
          triggers: ['person_cancels_24h'],
        },
      }, now);
    }
  }

  /**
   * Post-commit de los escritores automáticos de `cancelado` (§19.8): por cada envío sellado `auto_close` sin confirmar,
   * `port.cancel` best-effort. ⛔ Nunca lanza (el webhook o el reembolso ya comitearon).
   */
  async afterAutoClose(shipmentIds: readonly string[]): Promise<void> {
    if (shipmentIds.length === 0) return;
    try {
      const rows = await this.prisma.shipmentRequest.findMany({
        where: { id: { in: [...shipmentIds] }, providerCancelReason: 'auto_close', providerCanceledAt: { not: null }, providerCancelConfirmedAt: null, providerShipmentId: { not: null } },
        select: { id: true, providerShipmentId: true },
      });
      for (const r of rows) await this.labels.autoCancelPaid(r.id, r.providerShipmentId as string, 'auto_close');
    } catch (e) {
      this.logger.error(`afterAutoClose falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
