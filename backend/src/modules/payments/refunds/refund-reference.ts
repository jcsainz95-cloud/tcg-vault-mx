/**
 * 💰 §M4-SHIP.15.5 / v1.82 §PNL.3 — LAS REFERENCIAS Y LOS TOPES DE DEDO de un monto que CAPTURA el súper-admin (D-12 del
 * dueño, `HECHOS.md:32`: «más de 2× max(pagado, mercado) ⇒ volver a escribir el monto; más de 5× ⇒ bloqueado»).
 *
 * UN cuerpo para los dos verbos que capturan un monto: el reembolso de un caso «Por reponer»
 * (`ReplacementCaseService.refund` y su preview) y la devolución SPEI de una carta de un retiro ENTREGADO
 * (`WithdrawalDeliveredRefundService`, §PNL.3). ⛔ Un segundo juego de topes sería dos reglas para el mismo error humano
 * (ARCHITECTURE §4.61.3): mismos multiplicadores, mismo dial `case_refund_hard_multiplier`, mismos códigos.
 *
 *  - `Q` (`paidReferenceCents`): lo pagado por la carta (`P + floor(F·P/G)` de su orden de origen), o `null` sin origen.
 *  - `M` (`market`): el valor de mercado de hoy (`VaultService.marketRefOf`), o `null`.
 *  - `R = max(Q ?? 0, M ?? 0)` · `confirmAbove = 2·R` · `limit = k·R`.
 */
import { BusinessException } from '../../../common/business.exception';
import { CASE_REFUND_CONFIRM_MULTIPLIER } from '../../vault/replacement-case.rules';

export interface MarketRef {
  cents: number;
  capturedDate: string;
}

export interface RefundReference {
  paidReferenceCents: number | null;
  market: MarketRef | null;
  referenceCents: number;
  confirmAboveCents: number;
  limitCents: number;
}

export type RefundConfirmation = 'none' | 'reinforced' | 'blocked';

/** `R`, `2R`, `kR` — `k` es el dial `case_refund_hard_multiplier` (lo lee el llamador, con su `db`). */
export function refundReferenceOf(paidCents: number | null, market: MarketRef | null, k: number): RefundReference {
  const referenceCents = Math.max(paidCents ?? 0, market?.cents ?? 0);
  return {
    paidReferenceCents: paidCents,
    market,
    referenceCents,
    confirmAboveCents: CASE_REFUND_CONFIRM_MULTIPLIER * referenceCents,
    limitCents: k * referenceCents,
  };
}

/** `A ≤ 2R` ⇒ `none` · `A ≤ kR` ⇒ `reinforced` · si no ⇒ `blocked`. */
export function refundConfirmationOf(a: number, ref: Pick<RefundReference, 'confirmAboveCents' | 'limitCents'>): RefundConfirmation {
  if (a <= ref.confirmAboveCents) return 'none';
  if (a <= ref.limitCents) return 'reinforced';
  return 'blocked';
}

/**
 * Los topes, con sus códigos: `blocked` ⇒ `422 CASE_REFUND_ABOVE_LIMIT`; `reinforced` sin `confirmAboveReference:true` ⇒
 * `422 CASE_REFUND_CONFIRMATION_REQUIRED`. Devuelve la confirmación (para congelar `aboveRefConfirmed`).
 */
export function assertCapturedAmountWithinLimits(
  a: number,
  ref: Pick<RefundReference, 'referenceCents' | 'confirmAboveCents' | 'limitCents'>,
  confirmAboveReference: boolean | undefined,
): RefundConfirmation {
  const confirmation = refundConfirmationOf(a, ref);
  if (confirmation === 'blocked') {
    throw BusinessException.validation('CASE_REFUND_ABOVE_LIMIT', 'Amount exceeds the hard limit', { referenceCents: ref.referenceCents, limitCents: ref.limitCents });
  }
  if (confirmation === 'reinforced' && confirmAboveReference !== true) {
    throw BusinessException.validation('CASE_REFUND_CONFIRMATION_REQUIRED', 'Amount above 2× the reference requires confirmation', {
      referenceCents: ref.referenceCents,
      confirmAboveCents: ref.confirmAboveCents,
      limitCents: ref.limitCents,
    });
  }
  return confirmation;
}
