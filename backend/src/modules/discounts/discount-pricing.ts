/**
 * discount-pricing.ts — 💰 ORDEN DEL CÁLCULO con código de descuento (API_CONTRACT §DSC.4). PURO: sin BD ni reloj.
 *
 *  1. Líneas y `S = Σ P·q` como hoy. 2. Descuento (`discountOf` + `allocateDiscount`, `common/money.ts`) ⇒ `D`, `S' = S − D`.
 *  3. Clase del envío (no depende del descuento). 4. Umbral sobre `S'` [D2]; con envío gratis, `E_regla = 0`.
 *  5. Caja grande gana sobre las dos. 6. IVA por resta y comisión con LA MISMA llamada de hoy (I-2):
 *     `computeDirectShipBreakdown(S', E, r, fee)` / `computeCartBreakdown(S', r, fee)`.
 *  7. `totalCents < MIN_CHARGE_CENTS` ⇒ `TOTAL_BELOW_MINIMUM` (no se recorta el descuento).
 *
 * ⛔ Aquí no hay fórmula de dinero nueva: los pasos 4–6 son `directShipFeeOf` y los desgloses de siempre con `S'`.
 */
import {
  BreakdownDTO,
  DirectShipBreakdownDTO,
  DiscountCartLine,
  DiscountTerms,
  StripeFeeConfig,
  allocateDiscount,
  computeCartBreakdown,
  computeDirectShipBreakdown,
  discountOf,
} from '../../common/money';
import { BoxChoice } from '../orders/box-fit';
import { DirectShipDials, DirectShipFee, ShippingRuleKind, directShipFeeOf } from '../orders/shipping-rule';

/** `StripeService.MIN_CHARGE_CENTS` (1000), repetido aquí como NÚMERO para que lo puro no importe un servicio. Candado: DCO-B2. */
export const DISCOUNT_MIN_TOTAL_CENTS = 1000;

/** Los motivos de `not_applicable` (§DSC.6). `NOT_COMBINABLE` existe en el DTO pero hoy no se emite (§AC.2-6). */
export type DiscountNotApplicableReason =
  | 'MIN_SUBTOTAL'
  | 'NO_ELIGIBLE_ITEMS'
  | 'DESTINATION'
  | 'NO_SHIPPING'
  | 'ALREADY_FREE_SHIPPING'
  | 'LARGE_BOX'
  | 'TOTAL_BELOW_MINIMUM'
  | 'WITHDRAWAL_ONLY_FREE_SHIPPING'
  | 'WITHDRAWAL_FILTERED'
  | 'NOT_COMBINABLE';

export type NotApplicable = { outcome: 'not_applicable'; reason: DiscountNotApplicableReason; details: Record<string, number | string[]> };

/** El envío directo del carrito (para el bóveda, `null`). */
export interface DirectShipContext {
  kind: ShippingRuleKind | null;
  dials: DirectShipDials;
  choice: BoxChoice | null;
}

export interface AppliedCartDiscount<B extends BreakdownDTO> {
  outcome: 'applied';
  /** `S` — mercancía ANTES del descuento (elegibles + no elegibles). */
  merchandiseBeforeDiscountCents: number;
  /** `D` — lo que ve el cliente y lo que se cobra de menos (nunca `D0`). */
  discountCents: number;
  /** Tipo c: la `E` de la clase que no se cobra; si no, 0. */
  shippingWaivedCents: number;
  /** Rebaja POR UNIDAD por id de línea (las no elegibles no aparecen ⇒ 0). */
  unitDiscountCents: Map<string, number>;
  /** El desglose cobrado: `S'`, `E` y la comisión sobre `S' + E`. */
  breakdown: B;
  /** Solo envío directo: la `E` resultante con su bandera de caja (para el `shippingRule` del quote). */
  shipFee: DirectShipFee | null;
  /** Solo envío directo: el envío gratis lo puso el código (⇒ `freeShippingApplied: true`, `freeShippingRemainingCents: null`). */
  freeShippingByCode: boolean;
}

function notApplicable(reason: DiscountNotApplicableReason, details: Record<string, number | string[]> = {}): NotApplicable {
  return { outcome: 'not_applicable', reason, details };
}

/** Pasos 1–7 para un pedido de BÓVEDA (cuenta, sin envío). */
export function priceVaultCartWithCode(
  lines: readonly DiscountCartLine[],
  terms: DiscountTerms,
  ivaRatePct: number,
  fee: StripeFeeConfig,
): AppliedCartDiscount<BreakdownDTO> | NotApplicable {
  const S = merchandiseOf(lines);
  const d = discountOf(lines, terms, { destination: 'vault' });
  if (!d.ok) return notApplicable(d.reason, d.details);
  if (terms.kind === 'free_shipping') return notApplicable('NO_SHIPPING');
  const alloc = allocateDiscount(d.eligible, d.nominalCents);
  const breakdown = computeCartBreakdown(S - alloc.discountCents, ivaRatePct, fee);
  if (breakdown.totalCents < DISCOUNT_MIN_TOTAL_CENTS) return notApplicable('TOTAL_BELOW_MINIMUM', { minTotalCents: DISCOUNT_MIN_TOTAL_CENTS });
  return {
    outcome: 'applied',
    merchandiseBeforeDiscountCents: S,
    discountCents: alloc.discountCents,
    shippingWaivedCents: 0,
    unitDiscountCents: alloc.unitDiscountCents,
    breakdown,
    shipFee: null,
    freeShippingByCode: false,
  };
}

/** Pasos 1–7 para un pedido con ENVÍO DIRECTO (invitado). */
export function priceDirectShipCartWithCode(
  lines: readonly DiscountCartLine[],
  terms: DiscountTerms,
  ship: DirectShipContext,
  ivaRatePct: number,
  fee: StripeFeeConfig,
): AppliedCartDiscount<DirectShipBreakdownDTO> | NotApplicable {
  const S = merchandiseOf(lines);
  const d = discountOf(lines, terms, { destination: 'direct_ship' });
  if (!d.ok) return notApplicable(d.reason, d.details);
  let discountCents = 0;
  let unitDiscountCents = new Map<string, number>();
  let shippingWaivedCents = 0;
  let shipFee: DirectShipFee;
  let freeShippingByCode = false;
  if (terms.kind === 'free_shipping') {
    // §DSC.4: no aplica, con su motivo — ya gratis por umbral (sobre `S`, que aquí es `S'`: D = 0) · caja grande.
    const today = directShipFeeOf(ship.kind, S, ship.dials, ship.choice);
    if (ship.kind === null) return notApplicable('NO_ELIGIBLE_ITEMS', { productScopes: [...terms.productScopes] });
    if (today.boxFeeApplies) return notApplicable('LARGE_BOX');
    if (S >= ship.dials.freeFromCents) return notApplicable('ALREADY_FREE_SHIPPING');
    shippingWaivedCents = ship.kind === 'cards_only' ? ship.dials.cardsFeeCents : ship.dials.sealedFeeCents;
    shipFee = { ...today, feeCents: 0, freeShippingApplied: true };
    freeShippingByCode = true;
  } else {
    const alloc = allocateDiscount(d.eligible, d.nominalCents);
    discountCents = alloc.discountCents;
    unitDiscountCents = alloc.unitDiscountCents;
    // [D2]: el umbral y la caja se miden sobre `S'` con la MISMA función de hoy.
    shipFee = directShipFeeOf(ship.kind, S - discountCents, ship.dials, ship.choice);
  }
  const breakdown = computeDirectShipBreakdown(S - discountCents, shipFee.feeCents, ivaRatePct, fee);
  if (breakdown.totalCents < DISCOUNT_MIN_TOTAL_CENTS) return notApplicable('TOTAL_BELOW_MINIMUM', { minTotalCents: DISCOUNT_MIN_TOTAL_CENTS });
  return {
    outcome: 'applied',
    merchandiseBeforeDiscountCents: S,
    discountCents,
    shippingWaivedCents,
    unitDiscountCents,
    breakdown,
    shipFee,
    freeShippingByCode,
  };
}

/**
 * §DSC.8 — retiro de bóveda: solo `free_shipping` sin mínimo ni filtros de tipo y con destino vacío o `direct_ship`.
 * Devuelve la `E` que se perdona (el `subtotalCents` del desglose de hoy) o el motivo.
 */
export function withdrawalCodeOutcome(
  terms: DiscountTerms,
  withdrawalFeeCents: number,
): { outcome: 'applied'; shippingWaivedCents: number } | NotApplicable {
  if (terms.kind !== 'free_shipping') return notApplicable('WITHDRAWAL_ONLY_FREE_SHIPPING');
  if (terms.minSubtotalCents !== null || terms.productScopes.length > 0) return notApplicable('WITHDRAWAL_FILTERED');
  if (terms.destinations.length > 0 && !terms.destinations.includes('direct_ship')) {
    return notApplicable('DESTINATION', { destinations: [...terms.destinations] });
  }
  return { outcome: 'applied', shippingWaivedCents: withdrawalFeeCents };
}

function merchandiseOf(lines: readonly DiscountCartLine[]): number {
  return lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
}
