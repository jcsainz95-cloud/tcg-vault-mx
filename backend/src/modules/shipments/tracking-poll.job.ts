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
import { INBOUND_ONLY, OUTBOUND_ONLY, isBuylistInbound } from './label-subject';
import { INBOUND_DELIVERED_STATUSES, INBOUND_MOVEMENT_LIST, SWEEP_PRE_POLL_LIMIT } from './inbound-carrier';
import { REOPEN_WINDOW_MS } from '../buylist/inbound-carrier-move';

/** m-2: las guías de ENTRADA ocupan como máximo 25 de los 50 lugares del lote (20 vivas + 5 de reapertura): las de salida nunca se quedan sin cupo. */
const INBOUND_LIVE_SHARE = 20;
const INBOUND_REOPEN_SHARE = 5;

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
  /** m-2: guías de ENTRADA cuyo sondeo falló, id → instante. Salen del lote durante un ciclo para no taparle el lugar a las de salida. */
  private readonly inboundBackoff = new Map<string, number>();

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
      const due = (m: number) => [{ carrierPolledAt: null }, { carrierPolledAt: { lt: new Date(now.getTime() - m * 60_000) } }];
      const outbound = await this.prisma.shipmentRequest.findMany({
        where: {
          ...OUTBOUND_ONLY,
          labelSource: 'skydropx',
          status: { in: ['guia', 'enviado'] },
          providerCanceledAt: null,
          providerShipmentId: { not: null },
          OR: due(minutes),
        },
        orderBy: [{ carrierPolledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: TRACKING_POLL_BATCH,
      });
      // §BUYLIST-RASTREO: la guía de ENTRADA de una solicitud viva (`aceptada`/`en_transito`, sin cerrar) y aún no entregada.
      const inboundMinutes = await this.settings.getNumber(SettingKey.BUYLIST_INBOUND_TRACKING_POLL_MINUTES);
      // m-2: un fallo del proveedor en una guía de entrada la saca del lote durante un ciclo (no sella `carrierPolledAt`).
      for (const [id, at] of this.inboundBackoff) if (now.getTime() - at >= inboundMinutes * 60_000) this.inboundBackoff.delete(id);
      const backedOff = [...this.inboundBackoff.keys()];
      const inbound = await this.prisma.shipmentRequest.findMany({
        where: {
          ...INBOUND_ONLY,
          ...this.inboundLiveWhere(),
          id: { notIn: backedOff },
          AND: [{ OR: due(inboundMinutes) }],
        },
        orderBy: [{ carrierPolledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: INBOUND_LIVE_SHARE,
      });
      // Reapertura (dueño: B): `expirada/not_shipped` de ≤ 30 d con la guía VIVA (nunca cancelada ante el proveedor) y aún sin
      // lectura de movimiento: si la paquetería la muestra en camino, `applyCarrierStatus` la reabre (o la deja listada).
      const reopenable = await this.prisma.shipmentRequest.findMany({
        where: {
          ...INBOUND_ONLY,
          labelSource: 'skydropx',
          status: 'cancelado',
          providerCanceledAt: null,
          providerShipmentId: { not: null },
          id: { notIn: backedOff },
          sellRequest: {
            is: {
              status: 'expirada',
              expiredReason: 'not_shipped',
              closedAt: { gte: new Date(now.getTime() - REOPEN_WINDOW_MS) },
              paidAt: null,
              payoutNetCents: null,
            },
          },
          AND: [{ OR: due(inboundMinutes) }, { OR: [{ carrierStatus: null }, { carrierStatus: { notIn: INBOUND_MOVEMENT_LIST } }] }],
        },
        orderBy: [{ carrierPolledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
        take: INBOUND_REOPEN_SHARE,
      });
      // Misma cola y mismo tope (50) para entradas y salidas: orden `carrierPolledAt asc nulls first`.
      const rows = [...outbound, ...inbound, ...reopenable]
        .sort((a, b) => (a.carrierPolledAt?.getTime() ?? -1) - (b.carrierPolledAt?.getTime() ?? -1) || (a.id < b.id ? -1 : 1))
        .slice(0, TRACKING_POLL_BATCH);
      return await this.pollRows(rows);
    } finally {
      this.running = false;
    }
  }

  /** La guía de entrada VIVA de una solicitud que aún puede moverse: Skydropx, en `guia`, sin cancelar, solicitud abierta, no entregada. */
  private inboundLiveWhere() {
    return {
      labelSource: 'skydropx' as const,
      status: 'guia' as const,
      providerCanceledAt: null,
      providerShipmentId: { not: null },
      sellRequest: { is: { status: { in: ['aceptada', 'en_transito'] as ('aceptada' | 'en_transito')[] }, closedAt: null } },
      OR: [{ carrierStatus: null }, { carrierStatus: { notIn: [...INBOUND_DELIVERED_STATUSES] } }],
    };
  }

  /**
   * §BUYLIST-RASTREO — el sondeo ACOTADO que corre al inicio del barrido de las 08:00: SOLO las `aceptada` con plazo vencido y sin
   * señal (las que la regla 2 miraría), hasta `SWEEP_PRE_POLL_LIMIT` llamadas. Nunca lanza (un proveedor caído ⇒ la regla 2 pospone).
   */
  async pollOverdueInbound(now: Date): Promise<TrackingPollResult> {
    const empty = { polled: 0, events: 0, applied: 0, errors: 0 };
    try {
      const g = await this.gate();
      if (g !== 'ok') return { skipped: g, ...empty };
      if (this.running) return { skipped: 'running', ...empty };
      this.running = true;
      try {
        const rows = await this.prisma.shipmentRequest.findMany({
          where: {
            ...INBOUND_ONLY,
            ...this.inboundLiveWhere(),
            sellRequest: {
              is: {
                status: 'aceptada',
                closedAt: null,
                shipDeadlineAt: { not: null, lte: now },
                sellerShippedDeclaredAt: null,
                shipmentConfirmedAt: null,
              },
            },
          },
          orderBy: [{ carrierPolledAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
          take: SWEEP_PRE_POLL_LIMIT,
        });
        return await this.pollRows(rows);
      } finally {
        this.running = false;
      }
    } catch (e) {
      this.logger.warn(`buylist_pre_poll_failed: ${e instanceof Error ? e.message : String(e)}`);
      return { ...empty, errors: 1 };
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
        // ⛔ Excepto la guía de ENTRADA: ahí `carrierPolledAt` = último sondeo EXITOSO (la regla 2 del barrido y `pollError` lo leen);
        // un fallo del proveedor no lo sella ni mueve nada, y reintenta en el siguiente ciclo.
        if (isBuylistInbound(row)) this.inboundBackoff.set(row.id, this.clock.now().getTime());
        else await this.prisma.shipmentRequest.updateMany({ where: { id: row.id }, data: { carrierPolledAt: this.clock.now() } });
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
    // §BUYLIST-RASTREO (reapertura): la guía de entrada de una solicitud cerrada por «no envió», aún viva ante el proveedor.
    if (isBuylistInbound(row) && row.status === 'cancelado') return true;
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
