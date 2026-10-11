/**
 * extra-charges.job.ts — 💰 D2d: el job `shipment-extra-charges` (API_CONTRACT §M4-SHIP.19.10 fila 3, §19.11, criterio 238;
 * cola `tcg-daily`, cron `SHIPMENT_EXTRA_CHARGES_CRON`, diario 08:30; disparable por `POST /admin/jobs/shipment-extra-charges`)
 * y AG-6 (§19.29.6, S-GAS-4).
 *
 * `port.extraCharges(now − 45 d, now)` paginado; por cada cargo cuyo `shipment_id` es una guía NUESTRA (la vigente de un
 * envío o cualquiera del libro de guías pagadas): `INSERT ShipmentCostAdjustment` (`providerChargeId @unique` ⇒ conflicto ⇒
 * no-op: **no duplica**, PS-80); `kind` por `charge_type`; `amountCents` bruto; `ivaCents = round(amount × 16/116)`
 * `'computed'`; `chargedAt` = la fecha del cargo (sin ella, `observedAt`, y se cuenta). Bitácora `shipment.cost_adjusted` y
 * AG-6 (⛔ la repetición no avisa; ⛔ un ajuste `cancel:` tampoco). ⛔ Nunca escribe `shippingCostCents` (T.7). Sin
 * correspondencia ⇒ log `warn` + contador. No-op con `shipping_provider='off'` y con el adaptador `noop`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ShipmentCostAdjustmentKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { skydropxComputedIvaCents } from '../../common/money';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ProviderExtraCharge } from '../shipping-provider/shipping-provider.port';
import { SpendAlertsService } from '../spend-alerts/spend-alerts.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { EXTRA_CHARGES_LOOKBACK_MS } from './label-verify.constants';
import { asRate } from './label-view';

const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export interface ExtraChargesResult {
  skipped?: 'provider_off' | 'not_configured' | 'running';
  seen: number;
  inserted: number;
  duplicates: number;
  unmatched: number;
  unreadable: number;
  chargedAtFallback: number;
}

/**
 * §19.10: `Overweight ⇒ overweight`, `ExtendedZone ⇒ extended_zone`, `Return ⇒ return`, otro ⇒ `other` (S-GAS-4: la lista
 * cerrada de `ShipmentCostAdjustmentKind`). Tolerante a la forma `ExtraCharge::Overweight` y a mayúsculas (NO MEDIDO, M-PRD-4).
 */
export function adjustmentKindOf(chargeType: string | null): ShipmentCostAdjustmentKind {
  const t = (chargeType ?? '').split('::').pop()?.trim().toLowerCase().replace(/[\s_-]/g, '') ?? '';
  if (t === 'overweight') return 'overweight';
  if (t === 'extendedzone') return 'extended_zone';
  if (t === 'return') return 'return';
  return 'other';
}

@Injectable()
export class ShipmentExtraChargesJob {
  private readonly logger = new Logger(ShipmentExtraChargesJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly alerts: SpendAlertsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
  ) {}

  async run(): Promise<ExtraChargesResult> {
    const out: ExtraChargesResult = { seen: 0, inserted: 0, duplicates: 0, unmatched: 0, unreadable: 0, chargedAtFallback: 0 };
    if ((await this.settings.get<string>(SettingKey.SHIPPING_PROVIDER)) !== 'skydropx') return { ...out, skipped: 'provider_off' };
    if (this.selection.kind === 'noop') return { ...out, skipped: 'not_configured' };
    if (this.running) return { ...out, skipped: 'running' };
    this.running = true;
    try {
      const now = this.clock.now();
      for await (const c of this.selection.port.extraCharges(new Date(now.getTime() - EXTRA_CHARGES_LOOKBACK_MS), now)) {
        out.seen += 1;
        await this.one(c, now, out);
      }
      if (out.unmatched > 0) this.logger.warn(`extra_charges_unmatched n=${out.unmatched}`);
      return out;
    } finally {
      this.running = false;
    }
  }

  private async one(c: ProviderExtraCharge, now: Date, out: ExtraChargesResult): Promise<void> {
    if (!Number.isInteger(c.amountCents) || c.amountCents <= 0) {
      out.unreadable += 1;
      this.logger.warn(`extra_charge_not_positive providerChargeId=${c.providerChargeId}: se omite (CHECK amountCents > 0)`);
      return;
    }
    const target = c.providerShipmentId ? await this.shipmentOf(c.providerShipmentId) : null;
    if (!target) {
      out.unmatched += 1;
      this.logger.warn(`extra_charge_unmatched providerChargeId=${c.providerChargeId}`);
      return;
    }
    const parsed = c.chargedAt ? Date.parse(c.chargedAt) : NaN;
    const chargedAt = Number.isFinite(parsed) ? new Date(parsed) : now;
    if (!Number.isFinite(parsed)) out.chargedAtFallback += 1;
    const kind = adjustmentKindOf(c.chargeType);
    const ivaCents = skydropxComputedIvaCents(c.amountCents);
    const inserted = await this.prisma.$transaction(async (tx) => {
      const ins = await tx.shipmentCostAdjustment.createMany({
        data: [{
          shipmentRequestId: target.id,
          kind,
          providerChargeId: c.providerChargeId,
          providerChargeType: c.chargeType ?? 'unknown',
          amountCents: c.amountCents,
          ivaCents,
          ivaSource: 'computed',
          chargedAt,
          observedAt: now,
        }],
        skipDuplicates: true,
      });
      if (ins.count !== 1) return false;
      const adj = await tx.shipmentCostAdjustment.findUniqueOrThrow({ where: { providerChargeId: c.providerChargeId }, select: { id: true } });
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.cost_adjusted',
          entityType: 'ShipmentRequest',
          entityId: target.id,
          after: { adjustmentId: adj.id, providerChargeId: c.providerChargeId, kind, amountCents: c.amountCents, ivaCents, chargedAt: chargedAt.toISOString(), actor: 'system:extra-charges' },
          createdAt: now,
        },
      });
      // AG-6 (§19.29.6): 🟡; 🔴 si supera el dial. ⛔ Un ajuste `cancel:` (lo no devuelto de una cancelación) no avisa aquí.
      if (!c.providerChargeId.startsWith('cancel:')) {
        const big = await this.settings.getNumber(SettingKey.SPEND_ALERT_EXTRA_CHARGE_IMMEDIATE_CENTS, tx);
        await this.alerts.raise(
          tx,
          {
            kind: 'carrier_extra_charge',
            severity: c.amountCents > big ? 'immediate' : 'digest',
            dedupKey: `ag6:${adj.id}`,
            shipmentRequestId: target.id,
            orderId: target.orderId,
            amountCents: c.amountCents,
            facts: { kind, carrierName: target.carrierName, amountCents: c.amountCents },
          },
          now,
        );
      }
      return true;
    }, TX);
    if (inserted) out.inserted += 1;
    else out.duplicates += 1;
  }

  /** La guía es nuestra si es la vigente de un envío o cualquiera del libro de guías pagadas (una re-emitida también cobra). */
  private async shipmentOf(providerShipmentId: string): Promise<{ id: string; orderId: string | null; carrierName: string | null } | null> {
    const direct = await this.prisma.shipmentRequest.findUnique({
      where: { providerShipmentId },
      select: { id: true, orderId: true, carrier: true, chosenRateJson: true },
    });
    const paid = direct ? null : await this.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId }, select: { shipmentRequestId: true } });
    const row = direct ?? (paid ? await this.prisma.shipmentRequest.findUnique({ where: { id: paid.shipmentRequestId }, select: { id: true, orderId: true, carrier: true, chosenRateJson: true } }) : null);
    if (!row) return null;
    return { id: row.id, orderId: row.orderId, carrierName: row.carrier ?? asRate(row.chosenRateJson)?.carrierName ?? null };
  }
}
