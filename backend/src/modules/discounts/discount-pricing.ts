/**
 * discount-pricing.ts — 💰 ORDEN DEL CÁLCULO con código de descuento (API_CONTRACT §DSC.4). PURO: sin BD ni reloj.
 *
 *  1. Líneas y `S = Σ P·q` como hoy. 2. Descuento (`discountOf` + `allocateDiscount`, `common/money.ts`) ⇒ `D`, `S' = S − D`.
 *  3. Clase del envío (no depende del descuento). 4. Umbral sobre `S'` [D2]; con envío gratis, `E_regla = 0`.
 *  5. Caja grande gana sobre las dos. 6. IVA por resta y comisión con LA MISMA llamada de hoy (I-2): el envío directo pasa
 *     por `directShipBreakdownOf` (la cadena única de `shipping-rule.ts`, TL-ENV-1) y la bóveda por `computeCartBreakdown`,
 *     las dos con `representableOrThrow` (TL-ENV-4: `422 AMOUNT_TOO_LARGE`, nunca un 500).
 *  7. `totalCents < MIN_CHARGE_CENTS` ⇒ `TOTAL_BELOW_MINIMUM` (no se recorta el descuento).
 *  8. v1.112.1 (§DSC.3, I-7, DSC-B-6): `kind ≠ free_shipping ∧ D = 0` (`floor` a 0, `B = U` o el residuo no cabe) ⇒
 *     `ZERO_DISCOUNT {}`: ⛔ ningún uso sin beneficio. El envío gratis tiene su propio «sin beneficio» (4 y 5).
 *
 * **Precedencia de `not_applicable` (v1.110.3, §DSC.4, DCO-B20; gana el primero que se cumple):**
 *  1 `NO_SHIPPING` · 2 `DESTINATION` · 3 `NO_ELIGIBLE_ITEMS` · 4 `LARGE_BOX` · 5 `ALREADY_FREE_SHIPPING` · 6 `MIN_SUBTOTAL` ·
 *  7 `TOTAL_BELOW_MINIMUM` · 8 `ZERO_DISCOUNT` (v1.112.1). 1, 4 y 5 solo los da el envío gratis; 8 solo `%`/monto. `discountOf` ya devuelve 2 → 3 → 6 en ese orden; aquí se
 *  intercalan 1, 4 y 5 y, por eso, el `MIN_SUBTOTAL` del envío gratis se GUARDA hasta después de 4 y 5.
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
  discountOf,
} from '../../common/money';
import { BoxChoice } from '../orders/box-fit';
import { DirectShipDials, DirectShipFee, ShippingRuleKind, directShipBreakdownOf, directShipFeeOf } from '../orders/shipping-rule';
import { representableOrThrow } from '../orders/representable';

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
  | 'ZERO_DISCOUNT'
  | 'WITHDRAWAL_ONLY_FREE_SHIPPING'
  | 'WITHDRAWAL_FILTERED'
  | 'NOT_COMBINABLE';

/** `details` (v1.110.3, §DSC.6): solo lo que el texto del motivo usa — `MIN_SUBTOTAL {missingCents}`, `NO_ELIGIBLE_ITEMS {productScopes}`, `TOTAL_BELOW_MINIMUM {minTotalCents}`; el resto `{}`. */
export type NotApplicable = { outcome: 'not_applicable'; reason: DiscountNotApplicableReason; details: Record<string, number | string[]> };

/** Lo que todo cálculo con código que APLICA devuelve, sea pedido o retiro (lo que el bloque `discount` necesita). */
export interface AppliedPrice {
  outcome: 'applied';
  /** `S` — mercancía ANTES del descuento (elegibles + no elegibles). Retiro: 0. */
  merchandiseBeforeDiscountCents: number;
  /** `D` — lo que ve el cliente y lo que se cobra de menos (nunca `D0`). */
  discountCents: number;
  /** Tipo c: la `E` que no se cobra; si no, 0. */
  shippingWaivedCents: number;
}

/** El envío directo del carrito (para el bóveda, `null`). */
export interface DirectShipContext {
  kind: ShippingRuleKind | null;
  dials: DirectShipDials;
  choice: BoxChoice | null;
}

export interface AppliedCartDiscount<B extends BreakdownDTO> extends AppliedPrice {
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

const totalBelowMinimum = () => notApplicable('TOTAL_BELOW_MINIMUM', { minTotalCents: DISCOUNT_MIN_TOTAL_CENTS });
/** Precedencia 8 (v1.112.1, I-7, DCO-B22): `%`/monto con `D = 0` no aplica — sin `details`, sin uso apartado, cuenta como intento. */
const zeroDiscount = () => notApplicable('ZERO_DISCOUNT');

/** Pasos 1–7 para un pedido de BÓVEDA (cuenta, sin envío). */
export function priceVaultCartWithCode(
  lines: readonly DiscountCartLine[],
  terms: DiscountTerms,
  ivaRatePct: number,
  fee: StripeFeeConfig,
): AppliedCartDiscount<BreakdownDTO> | NotApplicable {
  // Precedencia 1: el envío gratis a la bóveda no tiene envío que perdonar — gana a destino, filtros y mínimo (DCO-B20 a/b).
  if (terms.kind === 'free_shipping') return notApplicable('NO_SHIPPING');
  const S = merchandiseOf(lines);
  const d = discountOf(lines, terms, { destination: 'vault' });
  if (!d.ok) return notApplicable(d.reason, d.details);
  const alloc = allocateDiscount(d.eligible, d.nominalCents);
  const breakdown = representableOrThrow(() => computeCartBreakdown(S - alloc.discountCents, ivaRatePct, fee));
  if (breakdown.totalCents < DISCOUNT_MIN_TOTAL_CENTS) return totalBelowMinimum();
  if (alloc.discountCents === 0) return zeroDiscount();
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
  // 2 `DESTINATION` y 3 `NO_ELIGIBLE_ITEMS` ganan siempre; el 6 `MIN_SUBTOTAL` del envío gratis espera a 4 y 5.
  if (!d.ok && (terms.kind !== 'free_shipping' || d.reason !== 'MIN_SUBTOTAL')) return notApplicable(d.reason, d.details);
  if (terms.kind === 'free_shipping') {
    // §DSC.4 (v1.110.1/v1.110.3): `E` sin código ya es 0 (umbral sobre `S`, aquí `S'` con D = 0, o el dial de la clase en
    // 0) ⇒ `ALREADY_FREE_SHIPPING`; caja grande ⇒ `LARGE_BOX` (se cobra completa). ⛔ Nunca se aparta un uso con
    // `shippingWaivedCents = 0` (el bóveda, `NO_SHIPPING`, va en `priceVaultCartWithCode`).
    if (ship.kind === null) return notApplicable('NO_ELIGIBLE_ITEMS', { productScopes: [...terms.productScopes] });
    if (directShipFeeOf(ship.kind, S, ship.dials, ship.choice).boxFeeApplies) return notApplicable('LARGE_BOX');
    const classFeeCents = ship.kind === 'cards_only' ? ship.dials.cardsFeeCents : ship.dials.sealedFeeCents;
    if (S >= ship.dials.freeFromCents || classFeeCents <= 0) return notApplicable('ALREADY_FREE_SHIPPING');
    if (!d.ok) return notApplicable(d.reason, d.details);
    const { ship: shipFee, breakdown } = directShipBreakdownOf({ ...ship, subtotalCents: S, ivaRatePct, fee, waiveRuleFee: true });
    if (breakdown.totalCents < DISCOUNT_MIN_TOTAL_CENTS) return totalBelowMinimum();
    return {
      outcome: 'applied',
      merchandiseBeforeDiscountCents: S,
      discountCents: 0,
      shippingWaivedCents: classFeeCents,
      unitDiscountCents: new Map(),
      breakdown,
      shipFee,
      freeShippingByCode: true,
    };
  }
  if (!d.ok) return notApplicable(d.reason, d.details); // (inalcanzable: ya devuelto arriba; lo pide el tipo)
  const alloc = allocateDiscount(d.eligible, d.nominalCents);
  // [D2]: el umbral y la caja se miden sobre `S'` con la MISMA cadena de hoy.
  const { ship: shipFee, breakdown } = directShipBreakdownOf({ ...ship, subtotalCents: S - alloc.discountCents, ivaRatePct, fee });
  if (breakdown.totalCents < DISCOUNT_MIN_TOTAL_CENTS) return totalBelowMinimum();
  if (alloc.discountCents === 0) return zeroDiscount();
  return {
    outcome: 'applied',
    merchandiseBeforeDiscountCents: S,
    discountCents: alloc.discountCents,
    shippingWaivedCents: 0,
    unitDiscountCents: alloc.unitDiscountCents,
    breakdown,
    shipFee,
    freeShippingByCode: false,
  };
}

/**
 * §DSC.8 — retiro de bóveda: solo `free_shipping` sin mínimo ni filtros de tipo y con destino vacío o `direct_ship`.
 * Precedencia: `WITHDRAWAL_ONLY_FREE_SHIPPING` → `WITHDRAWAL_FILTERED` → `DESTINATION` → `ALREADY_FREE_SHIPPING`.
 * Devuelve la `E` que se perdona (el `subtotalCents` del desglose de hoy) o el motivo.
 */
export function withdrawalCodeOutcome(
  terms: DiscountTerms,
  withdrawalFeeCents: number,
): { outcome: 'applied'; shippingWaivedCents: number } | NotApplicable {
  if (terms.kind !== 'free_shipping') return notApplicable('WITHDRAWAL_ONLY_FREE_SHIPPING');
  if (terms.minSubtotalCents !== null || terms.productScopes.length > 0) return notApplicable('WITHDRAWAL_FILTERED');
  // v1.110.3 (§DSC.6 `details` mínimos): `DESTINATION` se pinta por pantalla ⇒ `{}`.
  if (terms.destinations.length > 0 && !terms.destinations.includes('direct_ship')) return notApplicable('DESTINATION');
  // v1.110.1 (§DSC.4/§DSC.8): el dial del retiro en 0 ⇒ ya es gratis ⇒ ⛔ no se gasta un uso sin beneficio.
  if (withdrawalFeeCents <= 0) return notApplicable('ALREADY_FREE_SHIPPING');
  return { outcome: 'applied', shippingWaivedCents: withdrawalFeeCents };
}

/** El retiro como `AppliedPrice` (sin mercancía: `merchandiseBeforeDiscountCents = discountCents = 0`, §DSC.8). */
export function withdrawalPriceOf(terms: DiscountTerms, withdrawalFeeCents: number): (AppliedPrice & { outcome: 'applied' }) | NotApplicable {
  const out = withdrawalCodeOutcome(terms, withdrawalFeeCents);
  return out.outcome === 'applied' ? { outcome: 'applied', merchandiseBeforeDiscountCents: 0, discountCents: 0, shippingWaivedCents: out.shippingWaivedCents } : out;
}

function merchandiseOf(lines: readonly DiscountCartLine[]): number {
  return lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
}
