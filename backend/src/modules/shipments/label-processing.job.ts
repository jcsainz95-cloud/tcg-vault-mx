/**
 * label-processing.job.ts — ⭐💰 D2d: el job `shipment-label-processing` (API_CONTRACT §M4-SHIP.19.10 fila 2 con §19.27.4–.7,
 * §19.28.4–.9, §19.29.1.5, §19.30.6; cola `tcg-daily`, cron `SHIPMENT_LABEL_PROCESSING_CRON`, cada minuto; disparable por
 * `POST /admin/jobs/shipment-label-processing`). No-op con `shipping_provider='off'` y con el adaptador `noop`.
 *
 * En cada corrida, en este orden:
 *  1. **Guía en proceso** (`picking` con id y sin número): `getShipment` ⇒ si trae número, `applyCarrierStatus(created…)`
 *     (`setTrackingFromProvider`, AV-4 una vez). Más de 30 min ⇒ la alerta `label_processing_stuck` la DERIVA el DTO.
 *  2. **Compra en vuelo** (reclamo sin id): `recoverInFlightLabel` — el SEGUNDO llamador (`C-SDX-5`) — desde `since +
 *     PURCHASE_MAX_LIFE` cada minuto hasta `T_UNKNOWN`, luego cada 10 min hasta `since + T_VERIFY_TAIL`. `found` ⇒ adopta
 *     (`recent_list`, cable trampa); `not_sent` ⇒ libera (`auto_not_sent`, también pasadas 24 h: es un hecho local);
 *     `not_charged` ⇒ libera (`auto_verified`, solo con la evidencia negativa encendida); `duplicate` ⇒ dos filas
 *     `origin:'duplicate'`; a `T_UNKNOWN`, `label_verify_uncertain {reason}` una vez (AG-9 (a) con `charged_not_found`).
 *  3. **Huérfanas** en los listados que ya se leyeron (⛔ sin peticiones nuevas) y su conciliación (C-14 + C-19, fusible).
 *  4. **Calibración pasiva** (§19.27.7): minutos 1…5 tras cada compra que sí respondió ⇒ log `inflight_calibration`.
 *  5. **Purga** (SEC-SDX-6) en la primera corrida del día: cotizaciones vencidas hace > 30 d que no son la comprada.
 *
 * ⛔ Nunca `purchase` (PS-99, PS-117: «comprar, con clic»). La ÚNICA `cancel` del job vive en la conciliación de huérfanas
 * (`orphan-reconcile.service.ts`) y en §19.18.3 (`casZero`, vía la adopción), y ambas exigen folio.
 */
import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { RecentShipmentsResult } from '../shipping-provider/shipping-provider.port';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { dayMx } from '../spend-alerts/spend-alerts.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { ShipmentCarrierService } from './carrier-status.service';
import { ShipmentLabelRecoveryService } from './label-recovery.service';
import { ReconcileResult, ShipmentOrphanService } from './orphan-reconcile.service';
import {
  CALIBRATION_MINUTES,
  LABEL_VERIFY_CONFIG,
  LabelVerifyConfig,
  QUOTE_PURGE_AFTER_MS,
  T_VERIFY_TAIL_EVERY_MS,
} from './label-verify.constants';

const MIN = 60_000;

export interface LabelProcessingResult {
  skipped?: 'provider_off' | 'not_configured' | 'running';
  processing: { checked: number; errors: number };
  inFlight: { checked: number; adopted: number; released: number; uncertain: number; duplicates: number; errors: number };
  orphans: { late: number } & ReconcileResult;
  calibration: number;
  purgedQuotes: number;
}

function fp(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

@Injectable()
export class ShipmentLabelProcessingJob {
  private readonly logger = new Logger(ShipmentLabelProcessingJob.name);
  private running = false;
  /** Cadencia de cola (§19.27.5): la última mirada de cada reclamo pasada `T_UNKNOWN` (`id:since` ⇒ epoch ms). */
  private readonly lastTailCheck = new Map<string, number>();
  /** Calibración pasiva: cada (compra, minuto) se mide una vez. */
  private readonly calibrated = new Set<string>();
  private lastPurgeDay: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly carrier: ShipmentCarrierService,
    private readonly recovery: ShipmentLabelRecoveryService,
    private readonly orphans: ShipmentOrphanService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
    @Inject(LABEL_VERIFY_CONFIG) private readonly cfg: LabelVerifyConfig,
  ) {}

  async run(): Promise<LabelProcessingResult> {
    const out: LabelProcessingResult = {
      processing: { checked: 0, errors: 0 },
      inFlight: { checked: 0, adopted: 0, released: 0, uncertain: 0, duplicates: 0, errors: 0 },
      orphans: { late: 0, evaluated: 0, cancelled: 0, kept: 0, fused: 0, cancelUnknown: 0 },
      calibration: 0,
      purgedQuotes: 0,
    };
    if ((await this.settings.get<string>(SettingKey.SHIPPING_PROVIDER)) !== 'skydropx') return { ...out, skipped: 'provider_off' };
    if (this.selection.kind === 'noop') return { ...out, skipped: 'not_configured' };
    if (this.running) return { ...out, skipped: 'running' };
    this.running = true;
    try {
      const now = this.clock.now();
      await this.processing(out);
      const listings = await this.inFlight(now, out);
      out.calibration = await this.calibrate(now, listings);
      out.orphans.late = await this.orphans.detectLate(listings, now);
      Object.assign(out.orphans, await this.orphans.reconcile(now));
      out.purgedQuotes = await this.purgeQuotes(now);
      return out;
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------- 1. guía en proceso

  private async processing(out: LabelProcessingResult): Promise<void> {
    const rows = await this.prisma.shipmentRequest.findMany({
      where: {
        labelSource: 'skydropx',
        status: 'picking',
        providerShipmentId: { not: null },
        labelProcessingSince: { not: null },
        trackingNumber: null,
        providerCanceledAt: null,
      },
      orderBy: { labelProcessingSince: 'asc' },
    });
    for (const row of rows) {
      out.processing.checked += 1;
      try {
        await this.carrier.pollShipment(row, 'processing');
      } catch (e) {
        out.processing.errors += 1;
        this.logger.warn(`label_processing_read_failed shipmentId=${row.id}: ${e instanceof ShippingProviderError ? e.code : e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ---------------------------------------------------------------- 2. compra en vuelo

  private async inFlight(now: Date, out: LabelProcessingResult): Promise<RecentShipmentsResult[]> {
    const listings: RecentShipmentsResult[] = [];
    const rows = await this.prisma.shipmentRequest.findMany({
      where: { labelProcessingSince: { not: null }, providerShipmentId: null },
      orderBy: { labelProcessingSince: 'asc' },
      select: { id: true, labelProcessingSince: true },
    });
    for (const r of rows) {
      const since = r.labelProcessingSince as Date;
      const age = now.getTime() - since.getTime();
      // §19.28.4: la primera mirada, a la vida máxima de la compra (ninguna respuesta viva llega después de una adopción).
      if (age < this.cfg.purchaseMaxLifeMs) continue;
      const key = `${r.id}:${since.toISOString()}`;
      if (age >= this.cfg.tVerifyTailMs) {
        // Pasadas 24 h solo queda «Liberar» — salvo `not_sent`, que es un hecho LOCAL (la compra no salió): se libera igual.
        const att = await this.prisma.shipmentLabelAttempt.findUnique({ where: { shipmentRequestId_since: { shipmentRequestId: r.id, since } }, select: { sentAt: true } });
        if (att && att.sentAt === null && (await this.recovery.autoRelease(r.id, since, 'auto_not_sent', now))) out.inFlight.released += 1;
        continue;
      }
      if (age >= this.cfg.tUnknownMs) {
        const last = this.lastTailCheck.get(key);
        if (last !== undefined && now.getTime() - last < T_VERIFY_TAIL_EVERY_MS) continue;
        this.lastTailCheck.set(key, now.getTime());
      }
      out.inFlight.checked += 1;
      try {
        const read = await this.recovery.recoverInFlightLabel(r.id, now);
        if (read.listing) listings.push(read.listing);
        const v = read.verdict;
        if (v.outcome === 'found' && read.detail) {
          try {
            if ((await this.recovery.adoptFound(r.id, since, v.providerShipmentId, read.detail, now)) === 'adopted') out.inFlight.adopted += 1;
          } catch (e) {
            // Las ramas `409` de la clasificación (`stale_purchase_response`, `SHIPMENT_NOT_IN_PREPARATION` con la guía ya
            // cancelada sola): son el resultado, no un fallo del job.
            if (!(e instanceof BusinessException)) throw e;
            out.inFlight.adopted += 1;
            this.logger.warn(`inflight_adoption_classified shipmentId=${r.id} code=${e.code}`);
          }
        } else if (v.outcome === 'not_sent') {
          if (await this.recovery.autoRelease(r.id, since, 'auto_not_sent', now)) out.inFlight.released += 1;
        } else if (v.outcome === 'not_charged') {
          if (await this.recovery.autoRelease(r.id, since, 'auto_verified', now, read.clean)) out.inFlight.released += 1;
        } else if (v.outcome === 'uncertain') {
          if (v.reason === 'duplicate') {
            out.inFlight.duplicates += await this.recovery.recordDuplicates(r.id, since, read.duplicates, now);
          } else if (await this.recovery.markUncertain(r.id, since, v.reason, 0, now)) {
            out.inFlight.uncertain += 1;
          }
          if (v.reason !== 'duplicate' && age >= this.cfg.tUnknownMs) {
            // §19.28.7: un envío `cancelado` cuyo reclamo no se pudo atribuir ⇒ log (la alerta `label_unknown` ya existe).
            const st = await this.prisma.shipmentRequest.findUnique({ where: { id: r.id }, select: { status: true } });
            if (st?.status === 'cancelado') this.logger.warn(`inflight_unattributed_on_cancelled shipmentId=${r.id} reason=${v.reason}`);
          }
        }
      } catch (e) {
        out.inFlight.errors += 1;
        this.logger.error(`inflight_verify_failed shipmentId=${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return listings;
  }

  // ---------------------------------------------------------------- 4. calibración pasiva (§19.27.7, §19.28.9)

  /**
   * Tras cada compra REAL que sí respondió (`labelPurchasedAt` en los últimos `CALIBRATION_MINUTES + 1` min, con su
   * `label_purchase_sent` y sin otro reclamo posterior), una vez por minuto en los minutos 1…5: saldo y listado (reusa los
   * listados de esta corrida si los hay) ⇒ log `info inflight_calibration {fp, offsetMin, debited, deltaCents, listed,
   * folioEchoed, fields}`. ⛔ Sin CP, sin dirección, sin el saldo absoluto. Contaminada ⇒ `skip` y log. Solo LEE.
   */
  private async calibrate(now: Date, listings: RecentShipmentsResult[]): Promise<number> {
    const from = new Date(now.getTime() - (CALIBRATION_MINUTES + 1) * MIN);
    const rows = await this.prisma.shipmentRequest.findMany({
      where: { labelSource: 'skydropx', providerShipmentId: { not: null }, labelPurchasedAt: { gte: from, lte: new Date(now.getTime() - MIN) } },
      select: { id: true, providerShipmentId: true, labelPurchasedAt: true },
    });
    const targets: { id: string; psid: string; offsetMin: number; since: Date; expected: number; providerReference: string | null }[] = [];
    for (const r of rows) {
      const offsetMin = Math.floor((now.getTime() - (r.labelPurchasedAt as Date).getTime()) / MIN);
      if (offsetMin < 1 || offsetMin > CALIBRATION_MINUTES) continue;
      const key = `${r.id}:${offsetMin}`;
      if (this.calibrated.has(key)) continue;
      this.calibrated.add(key);
      const paid = await this.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId: r.providerShipmentId as string }, select: { origin: true, attemptId: true } });
      if (!paid || paid.origin !== 'response' || !paid.attemptId) continue;
      const att = await this.prisma.shipmentLabelAttempt.findUnique({ where: { id: paid.attemptId }, select: { since: true, sentAt: true, expectedChargeCents: true, providerReference: true } });
      if (!att?.sentAt) continue;
      const later = await this.prisma.auditLog.findFirst({ where: { action: 'shipment.label_requested', entityId: { not: r.id }, createdAt: { gt: att.since } }, select: { id: true } });
      if (later) {
        this.logger.log(`inflight_calibration skip=contaminated fp=${fp(r.providerShipmentId as string)} offsetMin=${offsetMin}`);
        continue;
      }
      targets.push({ id: r.id, psid: r.providerShipmentId as string, offsetMin, since: att.since, expected: att.expectedChargeCents, providerReference: att.providerReference });
    }
    if (targets.length === 0) return 0;
    let balance: number | null = null;
    try {
      balance = (await this.selection.port.balance()).balanceCents;
    } catch {
      balance = null;
    }
    let listing = listings.find((l) => l.readable) ?? null;
    if (!listing) {
      try {
        const oldest = Math.min(...targets.map((t) => t.since.getTime()));
        listing = await this.selection.port.recentShipments(new Date(oldest - this.cfg.tVerifySkewMs));
        // La conciliación de huérfanas reusa TODO listado que la corrida ya leyó (§19.28.6: sin peticiones nuevas).
        listings.push(listing);
      } catch {
        listing = null;
      }
    }
    let n = 0;
    for (const t of targets) {
      const sent = await this.prisma.auditLog.findFirst({
        where: { entityId: t.id, action: 'shipment.label_purchase_sent', after: { path: ['since'], equals: t.since.toISOString() } },
        select: { after: true },
      });
      const before = (sent?.after as { balanceBeforeCents?: unknown } | null)?.balanceBeforeCents;
      const deltaCents = typeof before === 'number' && balance !== null ? before - balance : null;
      const item = listing?.readable ? listing.shipments.find((s) => s.providerShipmentId === t.psid) ?? null : null;
      this.logger.log(
        `inflight_calibration ${JSON.stringify({
          fp: fp(t.psid),
          offsetMin: t.offsetMin,
          debited: deltaCents !== null && deltaCents === t.expected,
          deltaCents,
          listed: !!item,
          folioEchoed: !!item && item.providerReference !== null && item.providerReference === t.providerReference,
          fields: {
            createdAt: !!item?.createdAt,
            carrier: !!item?.carrierName,
            total: item?.totalCents != null,
            postalCode: !!item?.postalCodeTo,
            source: item?.source != null,
          },
        })}`,
      );
      n += 1;
    }
    return n;
  }

  // ---------------------------------------------------------------- 5. purga (SEC-SDX-6)

  /** Primera corrida de cada día MX: `ShipmentQuote` vencidas hace > 30 d cuya cotización NO es la comprada del envío. */
  private async purgeQuotes(now: Date): Promise<number> {
    const day = dayMx(now);
    if (this.lastPurgeDay === day) return 0;
    this.lastPurgeDay = day;
    const before = new Date(now.getTime() - QUOTE_PURGE_AFTER_MS);
    return this.prisma.$executeRaw`
      DELETE FROM "ShipmentQuote" q
       USING "ShipmentRequest" s
       WHERE q."shipmentRequestId" = s.id
         AND q."expiresAt" < ${before}
         AND (s."providerQuotationId" IS NULL OR q."providerQuotationId" <> s."providerQuotationId")`;
  }
}
