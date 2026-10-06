/**
 * tracking-poll.job.ts — ⭐ D2d: el job `shipment-tracking-poll` (API_CONTRACT §M4-SHIP.19.10 fila 1; cola `tcg-daily`,
 * cron `SHIPMENT_TRACKING_POLL_CRON`, por defecto cada 10 min; disparable por `POST /admin/jobs/shipment-tracking-poll {shipmentId?}`)
 * y `POST /admin/shipments/:id/refresh-tracking` («Actualizar rastreo», el MISMO cuerpo con un envío).
 *
 * Toma hasta `TRACKING_POLL_BATCH` (50) envíos `labelSource='skydropx' ∧ status ∈ {guia, enviado} ∧ providerCanceledAt IS
 * NULL ∧ (carrierPolledAt IS NULL ∨ carrierPolledAt < now − shipping_tracking_poll_minutes)` por `carrierPolledAt asc`
 * (nulos primero) y aplica cada evento nuevo con `applyCarrierStatus`. Envíos `entregado`/`cancelado` y guías manuales ⛔ no
 * se consultan (criterio 241). No-op con `shipping_provider='off'` (SEC-SDX-12) y con el adaptador `noop`. Single-flight en
 * el proceso (la idempotencia la dan el `@@unique` del evento y los CAS; el candado evita trabajo doble).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ShippingProviderError } from '../shipping-provider/shipping-provider.errors';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { ShipmentCarrierService } from './carrier-status.service';
import { TRACKING_POLL_BATCH } from './label-verify.constants';
import { OUTBOUND_ONLY } from './label-subject';

export interface TrackingPollResult {
  skipped?: 'provider_off' | 'not_configured' | 'running';
  polled: number;
  events: number;
  applied: number;
  errors: number;
}

@Injectable()
export class ShipmentTrackingPollJob {
  private readonly logger = new Logger(ShipmentTrackingPollJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly carrier: ShipmentCarrierService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
  ) {}

  /** ¿Puede este proceso consultar al proveedor? (dial `shipping_provider` y adaptador configurado). */
  async gate(): Promise<'ok' | 'provider_off' | 'not_configured'> {
    if ((await this.settings.get<string>(SettingKey.SHIPPING_PROVIDER)) !== 'skydropx') return 'provider_off';
    if (this.selection.kind === 'noop') return 'not_configured';
    return 'ok';
  }

  async run(opts: { shipmentId?: string } = {}): Promise<TrackingPollResult> {
    const empty = { polled: 0, events: 0, applied: 0, errors: 0 };
    const g = await this.gate();
    if (g !== 'ok') return { skipped: g, ...empty };
    if (opts.shipmentId) {
      const row = await this.prisma.shipmentRequest.findUnique({ where: { id: opts.shipmentId } });
      if (!row) throw BusinessException.notFound();
      return this.pollRows([row]);
    }
    if (this.running) return { skipped: 'running', ...empty };
    this.running = true;
    try {
      const now = this.clock.now();
      const minutes = await this.settings.getNumber(SettingKey.SHIPPING_TRACKING_POLL_MINUTES);
      const rows = await this.prisma.shipmentRequest.findMany({
        where: {
          // rev BSD-1 (I-BSD-6, censo BSD-B23): la guía de ENTRADA no entra al sondeo (P-BSD-5) ⇒ tampoco a AV-17/18/19.
          ...OUTBOUND_ONLY,
          labelSource: 'skydropx',
          status: { in: ['guia', 'enviado'] },
          providerCanceledAt: null,
          providerShipmentId: { not: null },
          OR: [{ carrierPolledAt: null }, { carrierPolledAt: { lt: new Date(now.getTime() - minutes * 60_000) } }],
        },
        orderBy: [{ carrierPolledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: TRACKING_POLL_BATCH,
      });
      return await this.pollRows(rows);
    } finally {
      this.running = false;
    }
  }

  /** Un lote: cada envío por su cuenta (un error de uno ⛔ no detiene a los demás; ⛔ nunca un `500` del job). */
  private async pollRows(rows: ShipmentRequest[]): Promise<TrackingPollResult> {
    const out: TrackingPollResult = { polled: 0, events: 0, applied: 0, errors: 0 };
    for (const row of rows) {
      if (!this.pollable(row)) continue;
      out.polled += 1;
      try {
        const mode = row.status === 'picking' ? 'processing' : 'track';
        const r = await this.carrier.pollShipment(row, mode);
        out.events += r.events;
        out.applied += r.applied;
      } catch (e) {
        out.errors += 1;
        this.logger.warn(`tracking_poll_failed shipmentId=${row.id}: ${e instanceof ShippingProviderError ? e.code : e instanceof Error ? e.message : String(e)}`);
        // El intento cuenta como sondeo: un envío que falla siempre no tapa a los demás del lote (orden por `carrierPolledAt`).
        await this.prisma.shipmentRequest.updateMany({ where: { id: row.id }, data: { carrierPolledAt: this.clock.now() } });
      }
    }
    return out;
  }

  /**
   * El dominio del sondeo (§19.10): guía de Skydropx viva en `guia`/`enviado`; y, para el disparo de UN envío
   * (`refresh-tracking`), también la «guía en proceso» (en `picking`, con id y sin número), que lee su número.
   */
  pollable(row: ShipmentRequest): boolean {
    if (row.labelSource !== 'skydropx' || !row.providerShipmentId || row.providerCanceledAt !== null) return false;
    if (row.status === 'guia' || row.status === 'enviado') return true;
    return row.status === 'picking' && row.labelProcessingSince !== null && row.trackingNumber === null;
  }

  /**
   * `POST /admin/shipments/:id/refresh-tracking` (§19.10): el mismo cuerpo con `{shipmentId}`. Con el proveedor `off` ⇒
   * `404 FEATURE_DISABLED` (SEC-SDX-12); sin adaptador ⇒ `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['env']}`. Un
   * error del proveedor se propaga (`502`/`503`): la persona está delante. Guía manual, cancelada o envío cerrado ⇒ cero
   * llamadas al proveedor.
   */
  async refreshOne(shipmentId: string): Promise<void> {
    const g = await this.gate();
    if (g === 'provider_off') throw BusinessException.notFound('FEATURE_DISABLED', 'Shipping provider is off');
    if (g === 'not_configured') throw ShippingProviderError.notConfigured(['env']).toBusinessException();
    const row = await this.prisma.shipmentRequest.findUnique({ where: { id: shipmentId } });
    if (!row) throw BusinessException.notFound();
    if (!this.pollable(row)) return;
    try {
      await this.carrier.pollShipment(row, row.status === 'picking' ? 'processing' : 'track');
    } catch (e) {
      if (e instanceof ShippingProviderError) throw e.toBusinessException();
      throw e;
    }
  }
}
