/**
 * label-view.ts — las proyecciones de la guía de Skydropx para los DTO de admin (API_CONTRACT §M4-SHIP.19.7
 * `ShipmentLabelDTO`, §19.20.2 `labelPending`/`labelAlert` con §19.27.9 y §19.28.11, §19.19.7 `labelOptions` con §19.29.4
 * `limit`). Funciones PURAS sobre la fila (⛔ ninguna tabla nueva: misma doctrina que `carrierAlert`, §19.3).
 * ⛔ `labelUrl`, `rawResponseJson`, `providerRateId` y los sellos NO entran (lista blanca).
 */
import { Role, ShipmentRequest } from '@prisma/client';
import { ShipmentRateDTO } from './label-dto';
import { T_CANCEL_MS, T_STUCK_MS } from './label-verify.constants';

export interface ShipmentLabelDTO {
  source: 'skydropx';
  providerShipmentId: string;
  carrierName: string;
  serviceName: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** ⇔ `labelUrl ≠ null` (⛔ la URL cruda NUNCA viaja: §19.8). */
  labelAvailable: boolean;
  purchasedAt: string;
  chosenBy: { userId: string; name: string | null };
  chosenAt: string;
  chosen: ShipmentRateDTO;
  recommended: ShipmentRateDTO | null;
  wasRecommended: boolean;
  cost: { grossCents: number; ivaCents: number; ivaSource: string; insuranceCents: number; netCents: number; marginCents: number };
  carrierStatus: string | null;
  carrierStatusAt: string | null;
  processing: boolean;
  canceledAt: string | null;
  cancelReason: string | null;
}

export type InFlightUncertainReason = 'conflict' | 'charged_not_found' | 'ambiguous' | 'balance_moved' | 'unreadable' | 'not_calibrated' | 'duplicate';

export interface LabelPendingDTO {
  since: string;
  state: 'in_flight' | 'processing';
  carrierLabel: string | null;
  serviceName: string | null;
  chosenBy: { userId: string; name: string | null } | null;
  priceCents: number | null;
  /** §19.27.9: `in_flight` ⇒ `since + T_UNKNOWN`; `processing` ⇒ `null`. */
  verifyingUntil: string | null;
  /** §19.28.11: el token del reclamo vigente (de su intento), «busca en el panel: Pedido ENV-000045-01». */
  providerReference: string | null;
}

export type LabelAlertKind = 'label_live_on_cancelled' | 'label_orphan' | 'label_cancel_failed' | 'label_unknown' | 'label_processing_stuck';

export interface LabelAlertDTO {
  kind: LabelAlertKind;
  since: string;
  /** ⇔ `kind = 'label_unknown'` ∧ actor `super_admin` (P-SDX-REL sigue en (a)). */
  canRelease: boolean;
  reason: InFlightUncertainReason | null;
}

export interface LabelOptionsDTO {
  provider: 'off' | 'skydropx';
  purchase: 'disabled' | 'super_admin_only' | 'operators';
  /** Calculado PARA EL ACTOR (dial + rol + env). ⛔ No dice cuál llave falta. */
  canPurchase: boolean;
  /** §19.29.4: `reissue` si el envío ya agotó sus guías; `daily_spend` si el actor ya llegó al tope (sin la cifra); `null` para el dueño. */
  limit: 'daily_spend' | 'reissue' | null;
}

export function asRate(v: unknown): ShipmentRateDTO | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as ShipmentRateDTO) : null;
}

/** `ShipmentLabelDTO` ⇔ guía de Skydropx (`labelSource='skydropx'` con id). */
export function toShipmentLabelDTO(
  row: ShipmentRequest,
  chosenByName: string | null,
  chargedNetCents: number,
  adjustmentsNetCents: number,
): ShipmentLabelDTO | null {
  if (row.labelSource !== 'skydropx' || !row.providerShipmentId) return null;
  const chosen = asRate(row.chosenRateJson);
  const recommended = asRate(row.recommendedRateJson);
  const netCents = row.shippingCostCents - row.shippingCostIvaCents;
  return {
    source: 'skydropx',
    providerShipmentId: row.providerShipmentId,
    carrierName: row.carrier ?? chosen?.carrierName ?? '',
    serviceName: chosen?.serviceName ?? '',
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    labelAvailable: row.labelUrl !== null,
    purchasedAt: (row.labelPurchasedAt ?? row.rateChosenAt ?? new Date(0)).toISOString(),
    chosenBy: { userId: row.rateChosenByUserId ?? '', name: chosenByName },
    chosenAt: (row.rateChosenAt ?? new Date(0)).toISOString(),
    chosen: chosen as ShipmentRateDTO,
    recommended,
    wasRecommended: !!chosen && !!recommended && chosen.rateId === recommended.rateId,
    cost: {
      grossCents: row.shippingCostCents,
      ivaCents: row.shippingCostIvaCents,
      ivaSource: row.shippingIvaSource ?? 'provider',
      insuranceCents: row.insuranceCostCents,
      netCents,
      marginCents: chargedNetCents - netCents - adjustmentsNetCents,
    },
    carrierStatus: row.carrierStatus,
    carrierStatusAt: row.carrierStatusAt ? row.carrierStatusAt.toISOString() : null,
    processing: row.labelProcessingSince !== null,
    canceledAt: row.providerCanceledAt ? row.providerCanceledAt.toISOString() : null,
    cancelReason: row.providerCancelReason,
  };
}

/** §19.20.2 — `labelPending` ⇔ `labelProcessingSince ≠ null`. */
export function toLabelPendingDTO(
  row: ShipmentRequest,
  chosenByName: string | null,
  providerReference: string | null,
  tUnknownMs: number,
): LabelPendingDTO | null {
  if (!row.labelProcessingSince) return null;
  const chosen = asRate(row.chosenRateJson);
  const inFlight = row.providerShipmentId == null;
  return {
    since: row.labelProcessingSince.toISOString(),
    state: inFlight ? 'in_flight' : 'processing',
    carrierLabel: chosen?.carrierLabel ?? null,
    serviceName: chosen?.serviceName ?? null,
    chosenBy: row.rateChosenByUserId ? { userId: row.rateChosenByUserId, name: chosenByName } : null,
    priceCents: chosen?.priceCents ?? null,
    verifyingUntil: inFlight ? new Date(row.labelProcessingSince.getTime() + tUnknownMs).toISOString() : null,
    providerReference,
  };
}

/**
 * §19.20.2 — la derivación de la alerta (una por envío, con PRECEDENCIA de arriba abajo; `label_orphan` va justo después
 * de `label_live_on_cancelled`, §19.28.6). `reason` solo con `label_unknown` (de la última `label_verify_uncertain`).
 */
export function labelAlertOf(
  row: ShipmentRequest,
  now: Date,
  actorRole: Role | null,
  opts: { tUnknownMs: number; orphanSince?: Date | null; uncertainReason?: InFlightUncertainReason | null },
): LabelAlertDTO | null {
  const t = now.getTime();
  // `!= null` (no `!==`): las filas parciales (dobles de pruebas legacy, `select` acotados) traen `undefined`.
  if (row.status === 'cancelado' && row.labelSource === 'skydropx' && row.providerCanceledAt == null) {
    const since = row.carrierStatusAt ?? row.labelPurchasedAt ?? row.rateChosenAt ?? now;
    return { kind: 'label_live_on_cancelled', since: since.toISOString(), canRelease: false, reason: null };
  }
  if (opts.orphanSince) return { kind: 'label_orphan', since: opts.orphanSince.toISOString(), canRelease: false, reason: null };
  if (
    row.providerShipmentId != null &&
    row.providerCanceledAt != null &&
    row.providerCancelConfirmedAt == null &&
    row.providerCanceledAt.getTime() <= t - T_CANCEL_MS
  ) {
    return { kind: 'label_cancel_failed', since: row.providerCanceledAt.toISOString(), canRelease: false, reason: null };
  }
  if (row.labelProcessingSince != null && row.providerShipmentId == null && row.labelProcessingSince.getTime() <= t - opts.tUnknownMs) {
    return {
      kind: 'label_unknown',
      since: row.labelProcessingSince.toISOString(),
      canRelease: actorRole === Role.super_admin,
      reason: opts.uncertainReason ?? null,
    };
  }
  if (
    row.labelProcessingSince != null &&
    row.providerShipmentId != null &&
    row.trackingNumber == null &&
    row.labelProcessingSince.getTime() <= t - T_STUCK_MS
  ) {
    return { kind: 'label_processing_stuck', since: row.labelProcessingSince.toISOString(), canRelease: false, reason: null };
  }
  return null;
}
