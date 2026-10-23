import type { Order } from '@prisma/client';
import { BreakdownDTO, DirectShipBreakdownDTO, ivaIsIncluded } from '../../common/money';

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
