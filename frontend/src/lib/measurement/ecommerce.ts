/**
 * Eventos de comercio de §MKT.H.4 armados desde las formas del contrato (cotización y sesión de
 * checkout). Solo ids opacos (`cardId`, `Order.id`), nombre, categoría y montos en pesos con IVA.
 * ⛔ Nunca `orderNumber` (folio que el cliente comparte), correo ni dirección.
 */

import type { BreakdownDTO, OrderItemPreview } from '@/types/contract';
import { centsToValue, track, type TrackItem } from './track';

export function itemsFromQuote(items: readonly OrderItemPreview[] | undefined): TrackItem[] {
  return (items ?? []).map((it) => ({
    item_id: it.card.cardId,
    item_name: it.card.name,
    item_category: it.card.productType === 'sealed' ? 'sealed' : 'card',
    price: centsToValue(it.unitPriceCents),
  }));
}

/** `purchase` del navegador: SOLO cuando `confirmPayment` vuelve `succeeded` sin redirección. */
export function trackPurchase(orderId: string, breakdown: BreakdownDTO, items: readonly OrderItemPreview[] | undefined): void {
  track('purchase', {
    transaction_id: orderId,
    items: itemsFromQuote(items),
    value: centsToValue(breakdown.totalCents),
    currency: 'MXN',
    ...(typeof breakdown.shippingFeeCents === 'number' ? { shipping_cents: breakdown.shippingFeeCents } : {}),
  });
}

/** `begin_checkout`: cotización recibida. */
export function trackBeginCheckout(breakdown: BreakdownDTO, items: readonly OrderItemPreview[] | undefined): void {
  const list = itemsFromQuote(items);
  track('begin_checkout', {
    items: list,
    value: centsToValue(breakdown.totalCents),
    currency: 'MXN',
    n_items: list.length,
    ...(typeof breakdown.shippingFeeCents === 'number' ? { shipping_cents: breakdown.shippingFeeCents } : {}),
  });
}
