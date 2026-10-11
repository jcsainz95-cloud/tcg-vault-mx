/**
 * label-verify.constants.ts — 💰 las constantes de la compra de guías y de su verificación (API_CONTRACT §M4-SHIP.19.20.2,
 * §19.27.7, §19.28.2, §19.28.8, §19.28.9, §19.29.1.5, §19.30.6). ⛔ No son env ni dial: son hechos medidos o mecanismo;
 * cambian por errata del arquitecto. Las pruebas NO cambian este fichero: inyectan `LabelVerifyConfig` (§19.27.8).
 */
import { SKYDROPX_PURCHASE_TIMEOUT_MS } from '../shipping-provider/http/skydropx-client';
import { RECENT_SHIPMENTS_ORDER_VERIFIED as ORDER_VERIFIED } from '../shipping-provider/skydropx.adapter';

const MIN = 60_000;

/** §19.20.2: umbral de «compra en vuelo sin respuesta» (= `too_early` de `label/release` = la alerta del job). UNA constante. */
export const T_UNKNOWN_MS = 15 * MIN;
/** §19.20.2: «guía en proceso» sin número. */
export const T_STUCK_MS = 30 * MIN;
/** §19.20.2: cancelación sin confirmar. */
export const T_CANCEL_MS = 2 * MIN;

/** §19.27.7: mientras sea `false` no existe `not_charged` (sin hallazgo ⇒ `uncertain('not_calibrated')`). */
export const INFLIGHT_NEGATIVE_VERIFIED = false;
/** §19.27.7: `coversFrom` solo por `total_count` (el valor vive en el adaptador, que lo lee al paginar). */
export const RECENT_SHIPMENTS_ORDER_VERIFIED = ORDER_VERIFIED;
export const T_VERIFY_MIN_MS = 5 * MIN;
export const T_VERIFY_GAP_MS = 2 * MIN;
export const T_VERIFY_SKEW_MS = 2 * MIN;
export const T_VERIFY_TAIL_MS = 24 * 60 * MIN;
/** §19.28.4: lecturas de detalle por corrida para leer el folio de candidatos sin folio en el listado. */
export const RECENT_DETAIL_MAX = 5;

/** §19.28.2: plazo para que SALGA un intento de compra, desde el reclamo (`notAfter = since + esto`). */
export const PURCHASE_SEND_DEADLINE_MS = 120_000;
/** §19.28.2: vida máxima de una compra = plazo de salida + timeout de la compra + 30 s de margen para la tx del paso 9. DERIVADA. */
export const PURCHASE_MAX_LIFE_MS = PURCHASE_SEND_DEADLINE_MS + SKYDROPX_PURCHASE_TIMEOUT_MS + 30_000;

/** §19.28.8: cuánto bloquea una compra en vuelo a las demás (hoy 3 min; con la evidencia negativa encendida, más). */
export function inflightBlockMs(negativeVerified: boolean, verifyMinMs: number, verifyGapMs: number): number {
  return negativeVerified ? verifyMinMs + verifyGapMs + MIN : PURCHASE_MAX_LIFE_MS;
}
export const T_INFLIGHT_BLOCK_MS = inflightBlockMs(INFLIGHT_NEGATIVE_VERIFIED, T_VERIFY_MIN_MS, T_VERIFY_GAP_MS);

/** §19.28.9: NO MEDIDOS ⇒ 30 días (falla cerrado: con un reembolso en el último mes, el saldo no vota). */
export const T_REFUND_LAG_MS = 30 * 24 * 60 * MIN;
export const T_DEBIT_LAG_MS = 30 * 24 * 60 * MIN;

/** §19.28.4: interruptor de emergencia de la adopción por folio (las pruebas lo inyectan en `false`). */
export const INFLIGHT_ADOPTION_ENABLED = true;

/** §19.28.8 (C-11 (b)): la clave del candado consultivo de la compra (censada: distinta de toda otra `_LOCK_KEY`). */
export const SKYDROPX_PURCHASE_LOCK_KEY = 65_310_701;
/** §19.30.6 (C-19): el fusible de cancelaciones automáticas de huérfanas. */
export const ORPHAN_FUSE_LOCK_KEY = 65_310_703;
/** §19.29.1.5 (d): cancelaciones automáticas de huérfanas en 24 h antes del fusible. */
export const ORPHAN_AUTO_CANCEL_MAX_24H = 3;

/** §19.28.9 (cable trampa): con una `shipment.inflight_negative_violated` en esta ventana NO existe `not_charged`. */
export const NEGATIVE_TRIPWIRE_MS = 30 * 24 * 60 * MIN;

// ⭐💰 D2d (§19.10, §19.27.5, §19.27.7, §19.28.6) — los jobs. Mecanismo, ⛔ no env ni dial.
/** §19.10: envíos por corrida del sondeo de rastreo (a ≤ 2 req/s ⇒ ≤ 25 s por lote). */
export const TRACKING_POLL_BATCH = 50;
/** §19.27.5: pasada `T_UNKNOWN`, la compra en vuelo se mira cada 10 min hasta `since + T_VERIFY_TAIL`. */
export const T_VERIFY_TAIL_EVERY_MS = 10 * MIN;
/** §19.27.7: la calibración pasiva lee saldo y listado en los minutos 1…5 tras una compra que sí respondió. */
export const CALIBRATION_MINUTES = 5;
/** §19.10: ventana del job de cargos extra (`port.extraCharges(now − 45 d, now)`). */
export const EXTRA_CHARGES_LOOKBACK_MS = 45 * 24 * 60 * MIN;
/** §19.10 (SEC-SDX-6): en la primera corrida del día se purgan cotizaciones vencidas hace más de esto (salvo la comprada). */
export const QUOTE_PURGE_AFTER_MS = 30 * 24 * 60 * MIN;
/** §19.28.6: sin poder leerla, la alerta `label_orphan` vive 7 días (luego queda solo la bitácora). */
export const ORPHAN_ALERT_TTL_MS = 7 * 24 * 60 * MIN;

/** §19.29.6 AG-8: hoy el reembolso de una cancelación NO se puede comprobar ⇒ toda cancelación sin cifra avisa al día N. */
export const CANCEL_REFUND_VERIFIABLE = false;

/** Lo que las pruebas inyectan (⛔ no se cambia este fichero en una prueba). */
export interface LabelVerifyConfig {
  negativeVerified: boolean;
  adoptionEnabled: boolean;
  tUnknownMs: number;
  tVerifyMinMs: number;
  tVerifyGapMs: number;
  tVerifySkewMs: number;
  tVerifyTailMs: number;
  tRefundLagMs: number;
  tDebitLagMs: number;
  purchaseSendDeadlineMs: number;
  purchaseMaxLifeMs: number;
}

export const LABEL_VERIFY_CONFIG = 'LABEL_VERIFY_CONFIG';

export const DEFAULT_LABEL_VERIFY_CONFIG: LabelVerifyConfig = {
  negativeVerified: INFLIGHT_NEGATIVE_VERIFIED,
  adoptionEnabled: INFLIGHT_ADOPTION_ENABLED,
  tUnknownMs: T_UNKNOWN_MS,
  tVerifyMinMs: T_VERIFY_MIN_MS,
  tVerifyGapMs: T_VERIFY_GAP_MS,
  tVerifySkewMs: T_VERIFY_SKEW_MS,
  tVerifyTailMs: T_VERIFY_TAIL_MS,
  tRefundLagMs: T_REFUND_LAG_MS,
  tDebitLagMs: T_DEBIT_LAG_MS,
  purchaseSendDeadlineMs: PURCHASE_SEND_DEADLINE_MS,
  purchaseMaxLifeMs: PURCHASE_MAX_LIFE_MS,
};

/** `T_INFLIGHT_BLOCK` de una configuración (§19.28.8). */
export function inflightBlockOf(c: LabelVerifyConfig): number {
  return c.negativeVerified ? c.tVerifyMinMs + c.tVerifyGapMs + MIN : c.purchaseMaxLifeMs;
}
