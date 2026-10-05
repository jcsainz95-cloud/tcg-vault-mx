/**
 * carrier-status.service.ts — ⭐💰 D2d: el rastreo de una guía de Skydropx (API_CONTRACT §M4-SHIP.19.3, §19.10,
 * §19.18.1–.2, §19.19.9–.10, §19.29.6 AG-11/AG-12).
 *
 *  - `applyCarrierStatus(shipmentId, event)` — UN cuerpo, normativo. Lo llaman el sondeo (`shipment-tracking-poll`), el job
 *    de la guía en proceso (`shipment-label-processing`) y `refresh-tracking` (mismo cuerpo que el sondeo con `{shipmentId}`).
 *    Un webhook futuro sería su cuarto llamador (`C-SDX-5`). Idempotente: el `@@unique` del evento es el primer candado y
 *    los CAS de estado el segundo (criterio 241, PS-72).
 *  - `pollShipment(row, mode)` — una lectura `getShipment` ⇒ eventos nuevos en orden ⇒ `applyCarrierStatus`; relleno de
 *    `labelUrl` nula (§19.19.9); estado desconocido ⇒ log + bitácora, ⛔ nunca un `500` (§19.19.10).
 *
 * ⛔ Este fichero no compra ni cancela: solo `getShipment` del puerto (PS-99, PS-117).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CarrierStatus, Prisma, ShipmentRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { ProviderShipmentState } from '../shipping-provider/shipping-provider.port';
import { providerUrlsFrom } from '../shipping-provider/provider-url';
import { SpendAlertsService } from '../spend-alerts/spend-alerts.service';
import { ShipmentsService } from './shipments.service';
import { ShipmentPrepService } from './shipment-prep.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { CARRIER_NOTICES, CarrierNotice, CarrierNoticePort } from './carrier-notices';
import { asRate } from './label-view';
import { safeErrorTag } from './guest-mail-link';

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 30_000 } as const;
/** Actor de las escrituras del rastreo en la bitácora (sin persona: `actorUserId` nulo). */
export const CARRIER_ACTOR = 'system:carrier-poll';

/** §19.3: el evento que `applyCarrierStatus` aplica. `observedAt` = el `now` del sondeo que lo vio (SEC-SDX-1/2). */
export interface CarrierEventInput {
  status: CarrierStatus;
  occurredAt: Date;
  observedAt: Date;
  detail?: string | null;
  branchName?: string | null;
  trackingNumber?: string | null;
  /** Ya VALIDADAS por `providerUrlsFrom` (SEC-SDX-5); ⛔ nunca la URL cruda del proveedor. */
  trackingUrl?: string | null;
  labelUrl?: string | null;
  providerEventKey: string;
  /** Construido a partir del estado actual porque la API no dio historial (§19.18.2). */
  synthetic: boolean;
}

export interface ApplyResult {
  applied: boolean;
  reason?: 'not_found' | 'not_provider' | 'unchanged' | 'duplicate';
  /** Qué ganó este evento (los correos post-commit salen SOLO de aquí: el ganador del CAS y nadie más). */
  labeled?: boolean;
  shipped?: boolean;
  delivered?: boolean;
  notices: CarrierNotice[];
}

/** §19.29.6 AG-11 (🔴, con correo al dueño, `HECHOS.md:62`) y AG-12 (🟡). */
const AG11: ReadonlySet<CarrierStatus> = new Set<CarrierStatus>(['in_return', 'destroyed']);
const AG12: ReadonlySet<CarrierStatus> = new Set<CarrierStatus>(['exception', 'retained', 'delivery_attempt']);

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * ⭐ D2e (§19.33.2) — el valor crudo de un estado que NO es uno de los 12: recortado a 64 y sin caracteres de control (la
 * MISMA forma para la bitácora `carrier_status_unknown`, el `detail` y la llave).
 */
export function unknownStatusValue(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
}

/**
 * §19.10 + §19.18.2 — los eventos de UNA lectura, en orden `occurredAt asc`. Con historial: uno por evento legible (llave:
 * el id del evento si viene; si no, `estado:fecha`). Sin historial: UN evento sintético `{status, occurredAt: updated_at ??
 * now, synthetic:true, providerEventKey: updated_at ? status+':'+updated_at : status}` — 🔒 la llave NUNCA lleva `now`.
 * ⭐ D2e (§19.33.2): un valor fuera de los 12 se aplica COMO `exception` con `detail = 'Estado no reconocido: ' + v` (+ ' · ' +
 * el detalle crudo) y el «estado» de la llave = `'unknown:' + v` (⛔ nunca `exception`: un `exception` real del mismo instante
 * es OTRO evento).
 * Función PURA (la prueba la usa directamente).
 */
export function carrierEventsOf(
  state: Pick<ProviderShipmentState, 'events' | 'carrierStatus' | 'statusUpdatedAt' | 'trackingNumber'> &
    Partial<Pick<ProviderShipmentState, 'unknownCarrierStatus'>>,
  observedAt: Date,
  urls: { trackingUrl: string | null; labelUrl: string | null },
): CarrierEventInput[] {
  const updatedAt = state.statusUpdatedAt?.trim() || null;
  const common = { observedAt, trackingNumber: state.trackingNumber ?? null, trackingUrl: urls.trackingUrl, labelUrl: urls.labelUrl };
  const unknownDetail = (v: string, raw?: string | null) => `Estado no reconocido: ${v}${raw?.trim() ? ` · ${raw.trim()}` : ''}`;
  const history = (state.events ?? [])
    .map((e) => {
      if (e.status !== null) return { e, status: e.status as CarrierStatus, keyState: e.status as string, detail: e.detail ?? null };
      const v = e.rawStatus ? unknownStatusValue(e.rawStatus) : '';
      if (!v) return null;
      return { e, status: 'exception' as CarrierStatus, keyState: `unknown:${v}`, detail: unknownDetail(v, e.detail) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (history.length > 0) {
    const out = history.map(({ e, status, keyState, detail }, i) => {
      const at = parseDate(e.occurredAt);
      const providerEventKey = e.providerEventId ? `id:${e.providerEventId}` : at ? `${keyState}:${e.occurredAt?.trim()}` : keyState;
      return {
        i,
        ev: {
          ...common,
          status,
          occurredAt: at ?? parseDate(updatedAt) ?? observedAt,
          detail,
          branchName: e.branchName ?? null,
          providerEventKey,
          synthetic: false,
        } as CarrierEventInput,
      };
    });
    out.sort((a, b) => a.ev.occurredAt.getTime() - b.ev.occurredAt.getTime() || a.i - b.i);
    return out.map((x) => x.ev);
  }
  if (!state.carrierStatus) {
    const v = state.unknownCarrierStatus ? unknownStatusValue(state.unknownCarrierStatus) : '';
    if (!v) return [];
    return [
      {
        ...common,
        status: 'exception',
        occurredAt: parseDate(updatedAt) ?? observedAt,
        detail: unknownDetail(v),
        providerEventKey: updatedAt ? `unknown:${v}:${updatedAt}` : `unknown:${v}`,
        synthetic: true,
      },
    ];
  }
  return [
    {
      ...common,
      status: state.carrierStatus as CarrierStatus,
      occurredAt: parseDate(updatedAt) ?? observedAt,
      providerEventKey: updatedAt ? `${state.carrierStatus}:${updatedAt}` : state.carrierStatus,
      synthetic: true,
    },
  ];
}

@Injectable()
export class ShipmentCarrierService {
  private readonly logger = new Logger(ShipmentCarrierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: ShipmentsService,
    private readonly prep: ShipmentPrepService,
    private readonly alerts: SpendAlertsService,
    @Inject(SHIPPING_PROVIDER_SELECTION) private readonly selection: ShippingProviderSelection,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
    @Inject(CARRIER_NOTICES) private readonly notices: CarrierNoticePort,
  ) {}

  // ================================================================ applyCarrierStatus (§19.3)

  async applyCarrierStatus(shipmentId: string, event: CarrierEventInput): Promise<ApplyResult> {
    const now = this.clock.now();
    const res = await this.prisma.$transaction(async (tx) => {
      // 1. La MISMA puerta de §M4-SHIP.5: el candado de la fila, primera sentencia.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ShipmentRequest" WHERE id = ${shipmentId} FOR UPDATE`;
      if (locked.length === 0) return { applied: false, reason: 'not_found', notices: [] } as ApplyResult;
      const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shipmentId } });
      // 2. Criterio 241: una guía manual NUNCA se sondea.
      if (row.labelSource !== 'skydropx' || !row.providerShipmentId) {
        this.logger.error(`applyCarrierStatus sobre una guía que no es de Skydropx shipmentId=${shipmentId}`);
        return { applied: false, reason: 'not_provider', notices: [] } as ApplyResult;
      }
      // «Guía en proceso» que recibe su número: el `created` lleva el número aunque el estado no cambie (no es «sin cambio»).
      const processingCreated =
        event.status === 'created' && row.labelProcessingSince !== null && row.trackingNumber === null && !!event.trackingNumber;
      // 2b. 🔒 SEC-SDX-2: sintético con el mismo estado ⇒ solo `carrierPolledAt` (ni fila, ni correo, ni bitácora).
      if (event.synthetic && event.status === row.carrierStatus && !processingCreated) {
        await tx.shipmentRequest.updateMany({ where: { id: shipmentId }, data: { carrierPolledAt: now } });
        return { applied: false, reason: 'unchanged', notices: [] } as ApplyResult;
      }
      // 3. El evento (único por guía y llave). Conflicto ⇒ ⛔ nada más se escribe. `createMany … skipDuplicates` (ON CONFLICT
      //    DO NOTHING): un P2002 dentro de una tx interactiva la abortaría entera.
      const ins = await tx.shipmentCarrierEvent.createMany({
        data: [
          {
            shipmentRequestId: shipmentId,
            providerShipmentId: row.providerShipmentId,
            status: event.status,
            occurredAt: event.occurredAt,
            detail: event.detail ?? null,
            branchName: event.branchName ?? null,
            providerEventKey: event.providerEventKey,
            observedAt: event.observedAt,
          },
        ],
        skipDuplicates: true,
      });
      if (ins.count !== 1) return { applied: false, reason: 'duplicate', notices: [] } as ApplyResult;
      // 4. 🔒 SEC-SDX-9: un evento más viejo que el último cambio NO retrocede `carrierStatus` (los efectos de 5 siguen).
      //    ⭐ D2e (§19.33.4): `created` es el MÍNIMO del orden — desde `created` (lo escribió la compra con NUESTRO reloj) avanza
      //    cualquier estado aunque venga fechado unos segundos antes (desfase de relojes). Para todo lo demás, SEC-SDX-9 intacta.
      //    (`next` con nombre propio: el censo de escritores de `status` lee `x.status` suelto como un `status` abreviado.)
      const next: CarrierStatus = event.status;
      await tx.shipmentRequest.updateMany({
        where: {
          id: shipmentId,
          OR: [{ carrierStatus: null }, { carrierStatus: { not: next } }],
          AND: [{ OR: [{ carrierStatusAt: null }, { carrierStatusAt: { lte: event.occurredAt } }, { carrierStatus: 'created' }] }],
        },
        data: { carrierStatus: next, carrierStatusAt: event.occurredAt },
      });
      // 5. Efectos, TODOS con su precondición en el `WHERE`.
      const out: ApplyResult = { applied: true, notices: [] };
      const transition = async (to: 'enviado' | 'entregado', deliveredAt?: Date) => {
        try {
          const t = await this.shipments.transitionFromProvider(tx, shipmentId, to, { now, deliveredAt });
          out.shipped = out.shipped || t.shipped;
          out.delivered = out.delivered || t.delivered;
        } catch (e) {
          // Una guarda de §M4-SHIP.6 (pedido devuelto, origen reembolsado, nada que enviar): el evento queda registrado y el
          // envío NO avanza; lo resuelve una persona. ⛔ Nunca un `500` del job.
          const code = e instanceof BusinessException ? e.code : 'UNKNOWN';
          this.logger.warn(`carrier_transition_blocked shipmentId=${shipmentId} to=${to} code=${code}`);
        }
      };
      switch (event.status) {
        case 'created':
          if (processingCreated) out.labeled = await this.setTrackingFromProvider(tx, row, event, now);
          break;
        case 'picked_up':
        case 'in_transit':
        case 'last_mile':
          await transition('enviado');
          break;
        case 'delivered': {
          // 🔒 SEC-SDX-1: la fecha desde la que corre el plazo es la de cuando NOSOTROS lo supimos.
          const deliveredAt = new Date(Math.max(event.occurredAt.getTime(), event.observedAt.getTime()));
          await transition('entregado', deliveredAt);
          out.notices.push('AV-17'); // el hecho «la paquetería confirmó» ocurrió, gane o no el CAS de estado (PS-75)
          break;
        }
        case 'delivered_to_branch':
          await transition('enviado'); // ⛔ NUNCA `entregado` (decisión 6)
          out.notices.push('AV-18');
          break;
        case 'delivery_attempt':
          out.notices.push('AV-19');
          break;
        default:
          // exception | retained | in_return | destroyed | canceled: sin cambio de estado; ⛔ sin correo al cliente. La
          // alerta del operador se DERIVA (`carrierAlertActive`); `canceled` con `providerCanceledAt` ⇒ nada (lo cancelamos).
          break;
      }
      // AG-11 / AG-12 (§19.29.6): avisos al dueño (Sistema), en la tx del hecho (outbox: el correo lo despacha D2g).
      if (AG11.has(event.status) || AG12.has(event.status)) {
        const carrierName = row.carrier ?? asRate(row.chosenRateJson)?.carrierName ?? null;
        const immediate = AG11.has(event.status);
        await this.alerts.raise(
          tx,
          {
            kind: immediate ? 'parcel_returned' : 'parcel_problem',
            severity: immediate ? 'immediate' : 'digest',
            dedupKey: immediate
              ? `ag11:${shipmentId}:${event.status}`
              : event.status === 'delivery_attempt'
                ? `ag12:${shipmentId}:${event.status}:${event.providerEventKey}`
                : `ag12:${shipmentId}:${event.status}`,
            shipmentRequestId: shipmentId,
            orderId: row.orderId,
            amountCents: immediate ? row.shippingCostCents : null,
            facts: immediate ? { status: event.status, carrierName, chargedCents: row.shippingCostCents } : { status: event.status, carrierName },
          },
          now,
        );
      }
      // 6. Último sondeo.
      await tx.shipmentRequest.updateMany({ where: { id: shipmentId }, data: { carrierPolledAt: now } });
      // 7. Bitácora.
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.carrier_event',
          entityType: 'ShipmentRequest',
          entityId: shipmentId,
          after: {
            status: event.status,
            occurredAt: event.occurredAt.toISOString(),
            providerShipmentId: row.providerShipmentId,
            synthetic: event.synthetic,
            ...(out.labeled || out.shipped || out.delivered
              ? { transition: out.delivered ? 'entregado' : out.shipped ? 'enviado' : 'guia' }
              : {}),
            actor: CARRIER_ACTOR,
          },
          createdAt: now,
        },
      });
      return out;
    }, TX);

    // Post-commit, best-effort (§R.4): ⛔ nada de esto puede tumbar el sondeo.
    if (res.labeled) await this.shipments.notifyLabelCaptured(shipmentId); // AV-4 (su sello)
    if (res.shipped) await this.shipments.notifyShipped(shipmentId); // AV-5 al ganador del CAS
    for (const notice of res.notices) {
      try {
        await this.notices.notify(shipmentId, notice, {
          status: event.status,
          occurredAt: event.occurredAt,
          observedAt: event.observedAt,
          branchName: event.branchName ?? null,
          providerEventKey: event.providerEventKey,
        });
      } catch (e) {
        // ⛔ Nunca `e.message` (QA M-1 sobre 7d930c4e, como D-8): el aviso arma el enlace con token del correo.
        this.logger.error(`carrier_notice_failed shipmentId=${shipmentId} notice=${notice} (${safeErrorTag(e)})`);
      }
    }
    return res;
  }

  /**
   * §19.3 paso 5 `created` — `setTrackingFromProvider`: la «guía en proceso» recibe su número. El MISMO hecho que
   * `setTracking` (el par, `status:'guia'`, `trackingNoticeSentAt` limpio para que AV-4 salga UNA vez) con las guardas de la
   * guía (§M4-SHIP.6) y el reclamo EXACTO en el `WHERE` (`labelProcessingSince` leído bajo el candado, la guía vigente,
   * sin número). `count 0` ⇒ nada.
   */
  private async setTrackingFromProvider(tx: Tx, row: ShipmentRequest, event: CarrierEventInput, now: Date): Promise<boolean> {
    try {
      await this.prep.assertCanAdvance(tx, row.id, 'guia');
    } catch (e) {
      this.logger.warn(`carrier_label_blocked shipmentId=${row.id} code=${e instanceof BusinessException ? e.code : 'UNKNOWN'}`);
      return false;
    }
    const carrier = row.carrier ?? asRate(row.chosenRateJson)?.carrierName ?? null;
    const r = await tx.shipmentRequest.updateMany({
      where: {
        id: row.id,
        status: 'picking',
        preparedAt: { not: null },
        labelSource: 'skydropx',
        providerShipmentId: row.providerShipmentId,
        labelProcessingSince: row.labelProcessingSince,
        trackingNumber: null,
        replacementCases: { none: { status: 'open' } },
      },
      data: {
        status: 'guia',
        carrier,
        trackingNumber: event.trackingNumber ?? null,
        trackingNoticeSentAt: null,
        labelProcessingSince: null,
        ...(row.trackingUrl === null && event.trackingUrl ? { trackingUrl: event.trackingUrl } : {}),
        ...(row.labelUrl === null && event.labelUrl ? { labelUrl: event.labelUrl } : {}),
      },
    });
    if (r.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        actorUserId: null,
        actorRole: null,
        action: 'shipment.tracking',
        entityType: 'ShipmentRequest',
        entityId: row.id,
        after: {
          carrier,
          trackingNumber: event.trackingNumber ?? null,
          labelSource: 'skydropx',
          providerShipmentId: row.providerShipmentId,
          via: 'processing',
          actor: CARRIER_ACTOR,
        },
        createdAt: now,
      },
    });
    return true;
  }

  // ================================================================ una lectura del proveedor

  /**
   * UNA lectura de la guía vigente ⇒ los eventos nuevos por `applyCarrierStatus`. `mode='processing'` (guía en proceso, en
   * `picking`): SOLO actúa si la lectura trae número (§19.10: «si trae número, `applyCarrierStatus(created, …)`»), y el
   * `created` va primero aunque el historial no lo traiga. Errores del proveedor: los propaga (el job los cuenta).
   */
  async pollShipment(row: ShipmentRequest, mode: 'track' | 'processing'): Promise<{ events: number; applied: number }> {
    const providerShipmentId = row.providerShipmentId as string;
    const now = this.clock.now();
    const state = await this.selection.port.getShipment(providerShipmentId);
    const urls = providerUrlsFrom(state, this.selection.urlHosts);
    await this.fillLabelUrl(row, urls, now);
    if (state.unknownCarrierStatus) await this.recordUnknownStatus(row.id, state.unknownCarrierStatus, now);
    for (const e of state.events ?? []) if (e.status === null && e.rawStatus) await this.recordUnknownStatus(row.id, e.rawStatus, now);

    let events = carrierEventsOf(state, now, urls);
    if (mode === 'processing') {
      if (!state.trackingNumber) {
        await this.touchPolled(row.id, now);
        return { events: 0, applied: 0 };
      }
      if (!events.some((e) => e.status === 'created')) {
        const updatedAt = state.statusUpdatedAt?.trim() || null;
        events = [
          {
            status: 'created',
            occurredAt: parseDate(updatedAt) ?? now,
            observedAt: now,
            trackingNumber: state.trackingNumber,
            trackingUrl: urls.trackingUrl,
            labelUrl: urls.labelUrl,
            providerEventKey: 'created',
            synthetic: true,
          },
          ...events,
        ];
      } else {
        // El `created` va PRIMERO (el número se escribe antes de que `picked_up` intente `guia → enviado`).
        events = [...events.filter((e) => e.status === 'created'), ...events.filter((e) => e.status !== 'created')];
      }
    }
    let applied = 0;
    for (const ev of events) {
      const r = await this.applyCarrierStatus(row.id, ev);
      if (r.applied) applied += 1;
    }
    await this.touchPolled(row.id, now);
    return { events: events.length, applied };
  }

  private async touchPolled(id: string, now: Date): Promise<void> {
    await this.prisma.shipmentRequest.updateMany({ where: { id }, data: { carrierPolledAt: now } });
  }

  /**
   * §19.19.9 — la guía nació sin `labelUrl` (host no admitido o la API aún no la daba): el sondeo la RELLENA cuando está
   * `null` y la lectura trae una válida (mismo `providerUrlsFrom`). Una rechazada deja `shipment.provider_url_rejected
   * {field, host}` UNA vez por campo y host (⛔ sin la URL entera).
   */
  private async fillLabelUrl(row: ShipmentRequest, urls: ReturnType<typeof providerUrlsFrom>, now: Date): Promise<void> {
    if (row.labelUrl === null && urls.labelUrl) {
      await this.prisma.shipmentRequest.updateMany({
        where: { id: row.id, providerShipmentId: row.providerShipmentId, labelUrl: null },
        data: { labelUrl: urls.labelUrl },
      });
    }
    for (const r of urls.rejected) {
      if (r.field === 'labelUrl' && row.labelUrl !== null) continue;
      const seen = await this.prisma.auditLog.findFirst({
        where: { entityId: row.id, action: 'shipment.provider_url_rejected', after: { path: ['host'], equals: r.host ?? '' } },
        select: { id: true },
      });
      if (seen) continue;
      await this.prisma.auditLog.create({
        data: {
          actorUserId: null,
          actorRole: null,
          action: 'shipment.provider_url_rejected',
          entityType: 'ShipmentRequest',
          entityId: row.id,
          after: { field: r.field, host: r.host ?? '', actor: CARRIER_ACTOR },
          createdAt: now,
        },
      });
    }
  }

  /**
   * §19.19.10 — un estado que no es uno de los 12: evento NO aplicado, log `warn unknown_carrier_status {value}` y la
   * bitácora `shipment.carrier_status_unknown {value}` (UNA vez por envío y valor). ⛔ Nunca un `500`.
   */
  private async recordUnknownStatus(shipmentId: string, value: string, now: Date): Promise<void> {
    const v = unknownStatusValue(value);
    if (!v) return;
    this.logger.warn(`unknown_carrier_status shipmentId=${shipmentId} value=${v}`);
    const seen = await this.prisma.auditLog.findFirst({
      where: { entityId: shipmentId, action: 'shipment.carrier_status_unknown', after: { path: ['value'], equals: v } },
      select: { id: true },
    });
    if (seen) return;
    await this.prisma.auditLog.create({
      data: {
        actorUserId: null,
        actorRole: null,
        action: 'shipment.carrier_status_unknown',
        entityType: 'ShipmentRequest',
        entityId: shipmentId,
        after: { value: v, actor: CARRIER_ACTOR },
        createdAt: now,
      },
    });
  }
}
