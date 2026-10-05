/**
 * orphan-reconcile.service.ts — 💰🔒 D2d: la conciliación de guías pagadas que NO son la del paquete (API_CONTRACT
 * §M4-SHIP.19.28.6 con §19.29.1.5 (C-14) y §19.30.6 (C-19); §19.29.4 tabla del libro; §19.29.6 AG-9 (b)(c)(d)).
 *
 *  1. `detectLate(listados)` — huérfanas TARDÍAS en los listados que el job YA leyó (⛔ sin peticiones nuevas): envío con
 *     NUESTRO folio legible, id desconocido, `createdAt ≤ now − PURCHASE_MAX_LIFE`, cuyo intento `(folio, NN)` NO es el
 *     reclamo vigente de su envío ⇒ `ShipmentPaidLabel {origin:'orphan', attemptId}` + `shipment.label_orphan
 *     {cause:'late'}` (una vez por id: el `@unique` del libro).
 *  2. `reconcile()` — cada guía pagada `orphan`/`duplicate` sin cancelar, sin intención y aún no evaluada: se cancela SOLA
 *     **solo si se cumplen las CINCO** (C-14 + C-19): (a) `getShipment(Y)` legible con rastreo `t_Y`; (e) sin movimiento de
 *     paquetería (`carrierStatus ∈ {null, created}`, ni un estado desconocido); (b) su envío está `cancelado` o su guía
 *     vigente es `skydropx` con id ≠ Y (⛔ una guía vigente `manual` ⇒ nunca); (c) `normalizeTracking(t_Y)` no es el rastreo
 *     de NINGÚN envío nuestro; (d) el fusible (intenciones ESCRITAS antes de `cancel`, bajo `ORPHAN_FUSE_LOCK_KEY`).
 *     Falta una ⇒ **0** `cancel`, AG-9 🔴 (`ag9:o:<Y>`) y la alerta `label_orphan` (derivada de la bitácora) para una persona.
 *
 * ⛔ Nunca `purchase` (PS-99). La ÚNICA `cancel` de este fichero exige folio atribuido (la fila del libro la creó la
 * atribución por folio, §19.28.7) y las cinco condiciones.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ShipmentPaidLabel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { RecentProviderShipment, RecentShipmentsResult } from '../shipping-provider/shipping-provider.port';
import { SpendAlertsService, dayMx } from '../spend-alerts/spend-alerts.service';
import { LABEL_VERIFY_CONFIG, LabelVerifyConfig, ORPHAN_AUTO_CANCEL_MAX_24H, ORPHAN_FUSE_LOCK_KEY } from './label-verify.constants';
import { VERIFY_ACTOR } from './label-recovery.service';

const TX = { maxWait: 10_000, timeout: 30_000 } as const;
const DAY = 24 * 60 * 60 * 1000;

/**
 * §19.30.6 (1) C-19 — UNA función a los dos lados de la comparación: NFKC, mayúsculas, solo alfanumérico.
 * `"1Z-999-AA1"` ≡ `"1Z999AA1"`. El lado de la base hace lo mismo en SQL (`normalize(…, NFKC)`, `upper`, `[^A-Z0-9]`).
 */
export function normalizeTracking(t: string): string {
  return t.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Por qué una guía huérfana NO se canceló sola (va al log; ⛔ no a `facts`, que es lista blanca). */
export type OrphanKeepReason = 'unreadable' | 'no_tracking' | 'carrier_movement' | 'no_other_live_label' | 'tracking_matches' | 'fused';

export interface ReconcileResult {
  evaluated: number;
  cancelled: number;
  kept: number;
  fused: number;
  cancelUnknown: number;
}

@Injectable()
export class ShipmentOrphanService {
  private readonly logger = new Logger(ShipmentOrphanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: SpendAlertsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(LABEL_VERIFY_CONFIG) private readonly cfg: LabelVerifyConfig,
  ) {}

  // ================================================================ 1. huérfanas tardías (§19.28.6)

  async detectLate(listings: readonly RecentShipmentsResult[], now: Date): Promise<number> {
    const byId = new Map<string, RecentProviderShipment>();
    for (const l of listings) {
      if (!l.readable) continue;
      for (const s of l.shipments) {
        if (s.providerReference === null || s.createdAt === null) continue;
        const t = Date.parse(s.createdAt);
        if (!Number.isFinite(t) || t > now.getTime() - this.cfg.purchaseMaxLifeMs) continue;
        byId.set(s.providerShipmentId, s);
      }
    }
    if (byId.size === 0) return 0;
    const ids = [...byId.keys()];
    const [rows, paid] = await Promise.all([
      this.prisma.shipmentRequest.findMany({ where: { providerShipmentId: { in: ids } }, select: { providerShipmentId: true } }),
      this.prisma.shipmentPaidLabel.findMany({ where: { providerShipmentId: { in: ids } }, select: { providerShipmentId: true } }),
    ]);
    const known = new Set<string>([...rows.map((r) => r.providerShipmentId as string), ...paid.map((p) => p.providerShipmentId)]);
    let n = 0;
    for (const s of byId.values()) {
      if (known.has(s.providerShipmentId)) continue;
      const attempt = await this.prisma.shipmentLabelAttempt.findUnique({
        where: { providerReference: s.providerReference as string },
        select: { id: true, since: true, shipmentRequestId: true, expectedChargeCents: true, providerReference: true },
      });
      if (!attempt) {
        this.logger.warn(`orphan_folio_unknown providerShipmentId=${s.providerShipmentId} providerReference=${s.providerReference}`);
        continue;
      }
      const sr = await this.prisma.shipmentRequest.findUnique({
        where: { id: attempt.shipmentRequestId },
        select: { labelProcessingSince: true, providerShipmentId: true },
      });
      // El reclamo VIGENTE (en vuelo) es terreno de la adopción (§19.28.4), no de la conciliación.
      if (sr && sr.providerShipmentId === null && sr.labelProcessingSince?.getTime() === attempt.since.getTime()) continue;
      const wrote = await this.prisma.$transaction(async (tx) => {
        const ins = await tx.shipmentPaidLabel.createMany({
          data: [{ providerShipmentId: s.providerShipmentId, shipmentRequestId: attempt.shipmentRequestId, attemptId: attempt.id, origin: 'orphan', chargedCents: attempt.expectedChargeCents }],
          skipDuplicates: true,
        });
        if (ins.count !== 1) return false;
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            actorRole: null,
            action: 'shipment.label_orphan',
            entityType: 'ShipmentRequest',
            entityId: attempt.shipmentRequestId,
            after: { since: attempt.since.toISOString(), providerShipmentId: s.providerShipmentId, providerReference: attempt.providerReference, cause: 'late', actor: VERIFY_ACTOR },
            createdAt: now,
          },
        });
        return true;
      }, TX);
      if (wrote) {
        n += 1;
        this.logger.error(`label_orphan cause=late shipmentId=${attempt.shipmentRequestId} providerShipmentId=${s.providerShipmentId} providerReference=${attempt.providerReference}`);
      }
    }
    return n;
  }

  // ================================================================ 2. ¿se cancela sola? (C-14 + C-19)

  async reconcile(now: Date): Promise<ReconcileResult> {
    const out: ReconcileResult = { evaluated: 0, cancelled: 0, kept: 0, fused: 0, cancelUnknown: 0 };
    const pending = await this.prisma.shipmentPaidLabel.findMany({
      where: { origin: { in: ['orphan', 'duplicate'] }, cancelledAt: null, autoCancelIntentAt: null },
      orderBy: { createdAt: 'asc' },
    });
    for (const y of pending) {
      // Evaluada ⇔ ya tiene su AG-9 (`ag9:o:<Y>`): una persona la atiende; ⛔ no se re-evalúa cada minuto.
      const done = await this.prisma.spendAlert.findUnique({ where: { dedupKey: `ag9:o:${y.providerShipmentId}` }, select: { id: true } });
      if (done) continue;
      out.evaluated += 1;
      try {
        await this.evaluate(y, now, out);
      } catch (e) {
        this.logger.error(`orphan_reconcile_failed providerShipmentId=${y.providerShipmentId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
  }

  private async evaluate(y: ShipmentPaidLabel, now: Date, out: ReconcileResult): Promise<void> {
    const keep = await this.keepReason(y);
    if (keep) {
      out.kept += 1;
      this.logger.warn(`orphan_kept providerShipmentId=${y.providerShipmentId} reason=${keep}`);
      await this.raiseAg9(y, y.origin === 'duplicate' ? 'duplicate' : 'orphan', 'immediate', now);
      return;
    }
    // (d) El fusible: cuenta INTENCIONES (escritas antes de `cancel`), no éxitos ni la bitácora posterior.
    const intent = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ORPHAN_FUSE_LOCK_KEY}::bigint)`;
      const recent = await tx.shipmentPaidLabel.count({ where: { autoCancelIntentAt: { gt: new Date(now.getTime() - DAY) } } });
      if (recent >= ORPHAN_AUTO_CANCEL_MAX_24H) return 'fused' as const;
      const w = await tx.shipmentPaidLabel.updateMany({
        where: { id: y.id, autoCancelIntentAt: null, cancelledAt: null },
        data: { autoCancelIntentAt: now },
      });
      if (w.count !== 1) return 'raced' as const;
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.orphan_cancel_intent',
          entityType: 'ShipmentRequest',
          entityId: y.shipmentRequestId,
          after: { providerShipmentId: y.providerShipmentId, origin: y.origin, actor: VERIFY_ACTOR },
          createdAt: now,
        },
      });
      return 'intent' as const;
    }, TX);
    if (intent === 'raced') return;
    if (intent === 'fused') {
      out.fused += 1;
      this.logger.error(`orphan_cancel_fused providerShipmentId=${y.providerShipmentId}: ${ORPHAN_AUTO_CANCEL_MAX_24H} intenciones en 24 h`);
      await this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.orphan_cancel_fused',
          entityType: 'ShipmentRequest',
          entityId: y.shipmentRequestId,
          after: { providerShipmentId: y.providerShipmentId, actor: VERIFY_ACTOR },
          createdAt: now,
        },
      });
      await this.raiseAg9(y, 'orphan_fuse', 'immediate', now, `ag9:fuse:${dayMx(now)}`);
      await this.raiseAg9(y, y.origin === 'duplicate' ? 'duplicate' : 'orphan', 'immediate', now);
      return;
    }
    // Después del commit de la intención: `cancel(Y)`.
    let res: Awaited<ReturnType<ShippingProviderSelection['port']['cancel']>>;
    try {
      res = await this.selection.port.cancel(y.providerShipmentId, 'orphan_auto');
    } catch (e) {
      // Resultado DESCONOCIDO (timeout, red, 5xx): la intención sigue contando; ⛔ no se reintenta sola.
      out.cancelUnknown += 1;
      this.logger.error(`orphan_cancel_unknown providerShipmentId=${y.providerShipmentId}: ${e instanceof Error ? e.message : String(e)}`);
      await this.raiseAg9(y, 'orphan_cancel_unknown', 'immediate', now);
      return;
    }
    if (!res.ok) {
      out.kept += 1;
      this.logger.error(`orphan_cancel_rejected providerShipmentId=${y.providerShipmentId} code=${res.code}`);
      await this.raiseAg9(y, y.origin === 'duplicate' ? 'duplicate' : 'orphan', 'immediate', now);
      return;
    }
    out.cancelled += 1;
    const unrefunded = res.refundedCents === null ? null : Math.max(0, y.chargedCents - res.refundedCents);
    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentPaidLabel.updateMany({
        where: { id: y.id, cancelledAt: null },
        data: { cancelledAt: now, cancelKind: 'orphan_auto', cancelledByUserId: null, unrefundedCents: unrefunded },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.label_orphan_cancelled',
          entityType: 'ShipmentRequest',
          entityId: y.shipmentRequestId,
          after: { providerShipmentId: y.providerShipmentId, origin: y.origin, refundedCents: res.ok ? res.refundedCents : null, actor: VERIFY_ACTOR },
          createdAt: now,
        },
      });
    }, TX);
    await this.raiseAg9(y, 'orphan_auto_cancelled', 'digest', now);
  }

  /** (a)(e)(b)(c) — en ESTA corrida, justo antes de `cancel`, sin caché. `null` ⇔ las cuatro en verde. */
  private async keepReason(y: ShipmentPaidLabel): Promise<OrphanKeepReason | null> {
    let state;
    try {
      state = await this.selection.port.getShipment(y.providerShipmentId);
    } catch {
      return 'unreadable';
    }
    const t = state.trackingNumber?.trim() || null;
    if (!t) return 'no_tracking';
    // (e) C-19: sin movimiento de paquetería. Un estado desconocido también es movimiento (falla cerrado).
    if (state.unknownCarrierStatus || (state.carrierStatus !== null && state.carrierStatus !== 'created')) return 'carrier_movement';
    // (b) su envío está `cancelado`, o su guía VIGENTE es de Skydropx y con otro id (⛔ manual ⇒ nunca).
    const s = await this.prisma.shipmentRequest.findUnique({
      where: { id: y.shipmentRequestId },
      select: { status: true, labelSource: true, providerShipmentId: true },
    });
    if (!s) return 'no_other_live_label';
    const otherLive = s.labelSource === 'skydropx' && s.providerShipmentId !== null && s.providerShipmentId !== y.providerShipmentId;
    if (s.status !== 'cancelado' && !otherLive) return 'no_other_live_label';
    // (c) C-19: el rastreo normalizado de Y no es el de NINGÚN envío nuestro, de cualquier origen.
    const n = normalizeTracking(t);
    if (n === '') return 'no_tracking';
    const hit = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ShipmentRequest"
       WHERE "trackingNumber" IS NOT NULL
         AND regexp_replace(upper(normalize("trackingNumber", NFKC)), '[^A-Z0-9]', '', 'g') = ${n}
       LIMIT 1`;
    if (hit.length > 0) return 'tracking_matches';
    return null;
  }

  /** AG-9 (§19.29.6): `facts` por LISTA BLANCA (`cause`, `expectedChargeCents`, `providerReference`). */
  private async raiseAg9(
    y: ShipmentPaidLabel,
    cause: 'orphan' | 'duplicate' | 'orphan_auto_cancelled' | 'orphan_fuse' | 'orphan_cancel_unknown',
    severity: 'immediate' | 'digest',
    now: Date,
    dedupKey = `ag9:o:${y.providerShipmentId}`,
  ): Promise<void> {
    const att = y.attemptId
      ? await this.prisma.shipmentLabelAttempt.findUnique({ where: { id: y.attemptId }, select: { expectedChargeCents: true, providerReference: true } })
      : null;
    await this.alerts.raise(
      this.prisma,
      {
        kind: 'label_charged_unexplained',
        severity,
        dedupKey,
        shipmentRequestId: y.shipmentRequestId,
        amountCents: y.chargedCents,
        facts: { cause, expectedChargeCents: att?.expectedChargeCents ?? y.chargedCents, providerReference: att?.providerReference ?? null },
      },
      now,
    );
  }
}
