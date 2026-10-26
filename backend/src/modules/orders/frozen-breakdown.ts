import type { Order } from '@prisma/client';
import { BreakdownDTO, DirectShipBreakdownDTO, ivaIsIncluded } from '../../common/money';
import type { ShippingBoxSnapshot } from './box-fit';
import { DirectShipDials, GuestShippingRuleDTO, ShippingRuleKind } from './shipping-rule';

/** Las columnas de la orden que forman su desglose congelado. */
export type FrozenBreakdownRow = Pick<
  Order,
  'subtotalCents' | 'ivaCents' | 'ivaRatePct' | 'processingFeeCents' | 'totalCents' | 'priceConvention'
>;

/**
 * El desglose CONGELADO de una orden (lo que su PaymentIntent cobró), único constructor para toda
 * vista del pedido (`OrdersService.breakdownOf`, quote/sesión de invitado y seguimiento §4-G.3).
 * Función pura: no lee el dial vivo ni re-precia (§4-R.2 regla 5).
 */
export function frozenBreakdownOf(order: FrozenBreakdownRow): BreakdownDTO {
  return {
    subtotalCents: order.subtotalCents,
    ivaCents: order.ivaCents,
    ivaRatePct: order.ivaRatePct,
    processingFeeCents: order.processingFeeCents,
    totalCents: order.totalCents,
    currency: 'MXN',
    // ⭐⭐ `IVA-3`: la convención sale de **la columna de ESA fila**, ⛔ jamás del dial vivo ni de
    // la constante de filas nuevas. Es lo que hace que una orden cobrada bajo `IVA_EXCLUSIVE` se
    // siga renderizando **idéntica al centavo** después del corte, y también después de mover el
    // dial. *Una orden ya cobrada no se reinterpreta sola.* `ivaIsIncluded` LANZA ante un valor
    // desconocido o ausente: no hay `??` que adivine.
    priceConvention: order.priceConvention,
    ivaIncluded: ivaIsIncluded(order.priceConvention),
  };
}

/** `frozenBreakdownOf` + la línea de envío cobrada en el MISMO PaymentIntent (`direct_ship`, invitado). */
export function frozenDirectShipBreakdownOf(order: FrozenBreakdownRow & Pick<Order, 'shippingFeeCents'>): DirectShipBreakdownDTO {
  return { ...frozenBreakdownOf(order), shippingFeeCents: order.shippingFeeCents };
}

/**
 * TL-ENV-2 (v1.112.1, §4-G.12 punto 4) — el `shippingRule` del quote que devuelve el CONGELADO de la orden propia.
 *  - `kind`: la clase del carrito, que es el de la orden (el congelado solo rige si la reserva cubre el carrito).
 *  - `freeShippingApplied` ⇔ la `E` CONGELADA es 0; `boxFeeApplies` ⇔ la caja congelada cobró más que el `E_sellado` de
 *    entonces (`shippingBoxSnapshot.baseFeeCents`). ⛔ Nada de esto sale de los diales de hoy.
 *  - `freeFromCents` = `T` VIVO; `freeShippingRemainingCents = applied ? 0 : (¬box ∧ T > S ? T − S : null)`: cambiar el carrito
 *    sustituye la orden y cotiza con `T` vivo, así que «te faltan» es cumplible; ⛔ «te faltan» con `E = 0`, ⛔ «te faltan 0»
 *    pagando envío. Invariante: `freeShippingApplied ⇒ remaining ∈ {0, null}`.
 *  - `freeShippingByCode` (el código de la orden es `free_shipping`, lo dice su `DiscountRedemption` — I-7, ⛔ no los importes)
 *    ⇒ `remaining: null`, como en el quote vivo (§DSC.4).
 */
export function frozenShippingRuleOf(
  kind: ShippingRuleKind | null,
  order: Pick<Order, 'subtotalCents' | 'shippingFeeCents' | 'shippingBoxSnapshot'>,
  dials: DirectShipDials,
  freeShippingByCode: boolean,
): GuestShippingRuleDTO {
  if (kind === null) return { kind: null, freeFromCents: null, freeShippingRemainingCents: null, freeShippingApplied: false, boxFeeApplies: false };
  const snap = order.shippingBoxSnapshot as Partial<ShippingBoxSnapshot> | null;
  const boxFeeApplies = !!snap && typeof snap.customerFeeCents === 'number' && typeof snap.baseFeeCents === 'number' && snap.customerFeeCents > snap.baseFeeCents;
  const applied = order.shippingFeeCents === 0;
  const T = dials.freeFromCents;
  const S = order.subtotalCents;
  const remaining = freeShippingByCode ? null : applied ? 0 : !boxFeeApplies && T > S ? T - S : null;
  return { kind, freeFromCents: T, freeShippingRemainingCents: remaining, freeShippingApplied: applied, boxFeeApplies };
}
