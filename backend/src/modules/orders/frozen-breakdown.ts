import type { Order } from '@prisma/client';
import { BreakdownDTO, DirectShipBreakdownDTO, ivaIsIncluded } from '../../common/money';
import type { ShippingBoxSnapshot } from './box-fit';
import { DirectShipDials, GuestShippingRuleDTO, ShippingRuleKind, shippingRuleDtoOf } from './shipping-rule';

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
 * TL-ENV-2 — el `shippingRule` del quote que devuelve el CONGELADO de la orden propia: describe la `E` que su PI cobra (la del
 * `breakdown` de la MISMA respuesta), ⛔ no la de los diales de hoy. `freeShippingApplied ⇔ E = 0` (§4-G.12, v1.109.2) y
 * `boxFeeApplies` ⇔ la caja congelada cobró más que el `E_sellado` de entonces (`shippingBoxSnapshot.baseFeeCents`).
 * `freeFromCents` y «te faltan» siguen la fórmula de §4-G.12 punto 4 (`T` vivo contra el `subtotalCents` de la respuesta);
 * con envío gratis por código (`shippingWaivedCents > 0`) ⇒ `freeShippingRemainingCents: null`, como en el quote vivo (§DSC.4).
 */
export function frozenShippingRuleOf(
  kind: ShippingRuleKind | null,
  order: Pick<Order, 'subtotalCents' | 'shippingFeeCents' | 'shippingWaivedCents' | 'shippingBoxSnapshot'>,
  dials: DirectShipDials,
): GuestShippingRuleDTO {
  const snap = order.shippingBoxSnapshot as Partial<ShippingBoxSnapshot> | null;
  const boxFeeApplies = !!snap && typeof snap.customerFeeCents === 'number' && typeof snap.baseFeeCents === 'number' && snap.customerFeeCents > snap.baseFeeCents;
  const fee = { feeCents: order.shippingFeeCents, baseFeeCents: snap?.baseFeeCents ?? dials.sealedFeeCents, freeShippingApplied: order.shippingFeeCents === 0, boxFeeApplies };
  const dto = shippingRuleDtoOf(kind, order.subtotalCents, dials, fee);
  return (order.shippingWaivedCents ?? 0) > 0 ? { ...dto, freeShippingRemainingCents: null } : dto;
}
