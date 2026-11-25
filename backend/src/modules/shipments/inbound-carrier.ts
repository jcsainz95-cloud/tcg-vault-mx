/**
 * inbound-carrier.ts — §BUYLIST-RASTREO (docs/DECISIONES.md): lo que la paquetería dice de la guía de ENTRADA de una solicitud
 * de venta (buylist). Fichero LIGERO (solo `@prisma/client`): lo importan el rastreo (`carrier-status`), el barrido y las
 * proyecciones admin/vendedor sin ciclos.
 *
 * ⛔ Nada de aquí mueve dinero. Un ESCANEO de la paquetería (hecho, no promesa) detiene el reloj del vendedor y suma a «en
 * camino»; `delivered` NO marca `recibida` (eso es la revisión física del operador).
 */
import { CarrierStatus } from '@prisma/client';

/** Estados con movimiento real del paquete: mueven `aceptada → en_transito` (por sistema) y bloquean la regla 2 del barrido. */
export const INBOUND_MOVEMENT_STATUSES: ReadonlySet<CarrierStatus> = new Set<CarrierStatus>([
  'picked_up',
  'in_transit',
  'last_mile',
  'delivery_attempt',
  'delivered_to_branch',
  'delivered',
]);
export const INBOUND_MOVEMENT_LIST: CarrierStatus[] = [...INBOUND_MOVEMENT_STATUSES];

/** Entregado por la paquetería (sella `deliveredAt`; ⛔ no `recibida`). */
export const INBOUND_DELIVERED_STATUSES: ReadonlySet<CarrierStatus> = new Set<CarrierStatus>(['delivered', 'delivered_to_branch']);

/** Quien firma la transición automática (`SellRequest.shipmentConfirmedBy`). */
export const CARRIER_CONFIRMER = 'system:carrier';

/** Regla 2 (cinturón): con guía viva, un último sondeo exitoso de más de 24 h pospone el cierre… */
export const INBOUND_POLL_STALE_MS = 24 * 3_600_000;
/** …pero nunca más de 48 h después del plazo (nuestra falla de rastreo no cancela la venta del vendedor, ni para siempre). */
export const INBOUND_POSTPONE_MAX_MS = 48 * 3_600_000;
/** Tras 3 ciclos sin sondeo exitoso la ficha dice «Rastreo no disponible, reintentando». */
export const INBOUND_POLL_ERROR_CYCLES = 3;

/** Tope de llamadas al proveedor del sondeo previo al barrido de las 08:00 (acotado). */
export const SWEEP_PRE_POLL_LIMIT = 25;

export interface InboundCarrierRow {
  labelSource: string | null;
  providerShipmentId: string | null;
  providerCanceledAt: Date | null;
  carrierStatus: CarrierStatus | null;
  carrierStatusAt: Date | null;
  carrierPolledAt: Date | null;
  requestedAt: Date;
}

/**
 * `inboundCarrier` en `AdminBuylistDTO` y en el DTO del vendedor. `null` ⇔ no hay guía VIVA de Skydropx (guía manual, cancelada o
 * sin guía): el front pinta «Sin rastreo automático». Todo DERIVADO de la fila de entrada (⛔ sin columnas nuevas).
 *  - `status`: último estado crudo de la paquetería (`null` = aún sin primera lectura).
 *  - `estimatedDeliveryAt`: siempre `null` hoy (NO MEDIDO: el adaptador de Skydropx no entrega fecha estimada).
 *  - `deliveredAt`: instante del último cambio si el estado es `delivered`/`delivered_to_branch`.
 *  - `pollError`: `true` solo con la solicitud `aceptada`/`en_transito`, el proveedor activo y ≥ 3 ciclos sin un sondeo exitoso
 *    (en esta clase de fila un fallo NO sella `carrierPolledAt`). En `recibida` o posteriores, o con el proveedor apagado ⇒ `false`.
 *  - `stalledDays` (G3-3): solicitud `en_transito` sin `delivered`, con proveedor activo y SIN un escaneo nuevo hace ≥ N días
 *    (`buylist_inbound_stalled_days`, 10) ⇒ los días; si no `null`. Alerta de la ficha: no mueve estado ni dinero.
 */
export interface InboundCarrierDTO {
  status: CarrierStatus | null;
  statusAt: string | null;
  estimatedDeliveryAt: string | null;
  polledAt: string | null;
  deliveredAt: string | null;
  pollError: boolean;
  stalledDays: number | null;
}

export interface InboundCarrierCtx {
  /** Estado de la SOLICITUD (decide `pollError`/`stalledDays`). */
  requestStatus: string;
  /** `shipping_provider='skydropx'` (con `off`/`noop` no hay «error de sondeo»: la ficha dice «Sin rastreo automático»). */
  providerOn: boolean;
  pollMinutes: number;
  stalledDays: number;
}

export function isLiveSkydropxInbound(r: Pick<InboundCarrierRow, 'labelSource' | 'providerShipmentId' | 'providerCanceledAt'>): boolean {
  return r.labelSource === 'skydropx' && !!r.providerShipmentId && r.providerCanceledAt == null;
}

const DAY_MS = 86_400_000;

export function inboundCarrierOf(row: InboundCarrierRow | null | undefined, now: Date, ctx: InboundCarrierCtx): InboundCarrierDTO | null {
  if (!row || !isLiveSkydropxInbound(row)) return null;
  const delivered = !!row.carrierStatus && INBOUND_DELIVERED_STATUSES.has(row.carrierStatus);
  const open = ctx.requestStatus === 'aceptada' || ctx.requestStatus === 'en_transito';
  const since = row.carrierPolledAt ?? row.requestedAt;
  const pollError = open && ctx.providerOn && !delivered && now.getTime() - since.getTime() >= INBOUND_POLL_ERROR_CYCLES * ctx.pollMinutes * 60_000;
  const lastScan = row.carrierStatusAt;
  const stalled =
    ctx.requestStatus === 'en_transito' && ctx.providerOn && !delivered && lastScan != null && now.getTime() - lastScan.getTime() >= ctx.stalledDays * DAY_MS
      ? Math.floor((now.getTime() - lastScan.getTime()) / DAY_MS)
      : null;
  return {
    status: row.carrierStatus,
    statusAt: row.carrierStatusAt ? row.carrierStatusAt.toISOString() : null,
    estimatedDeliveryAt: null,
    polledAt: row.carrierPolledAt ? row.carrierPolledAt.toISOString() : null,
    deliveredAt: delivered && row.carrierStatusAt ? row.carrierStatusAt.toISOString() : null,
    pollError,
    stalledDays: stalled,
  };
}

/**
 * Regla 2 del barrido — ¿se POSPONE el cierre por la paquetería? (función PURA, con reloj inyectado).
 *  - fila de entrada con movimiento ⇒ `'moving'` (no se cierra; el sondeo la moverá a `en_transito`);
 *  - guía viva con último sondeo exitoso de > 24 h (o nunca) y plazo vencido hace < 48 h ⇒ `'provider_stale'`;
 *  - `providerLive=false` (proveedor apagado/sin configurar: no hay «caída») ⇒ solo cuenta el movimiento;
 *  - si no ⇒ `null` (la regla sigue como siempre).
 */
export function sweepHoldReason(
  row: InboundCarrierRow | null | undefined,
  shipDeadlineAt: Date,
  now: Date,
  providerLive = true,
): 'moving' | 'provider_stale' | null {
  if (!row || !isLiveSkydropxInbound(row)) return null;
  if (row.carrierStatus && INBOUND_MOVEMENT_STATUSES.has(row.carrierStatus)) return 'moving';
  const lastOk = row.carrierPolledAt;
  const stale = lastOk == null || now.getTime() - lastOk.getTime() > INBOUND_POLL_STALE_MS;
  if (providerLive && stale && now.getTime() - shipDeadlineAt.getTime() < INBOUND_POSTPONE_MAX_MS) return 'provider_stale';
  return null;
}
