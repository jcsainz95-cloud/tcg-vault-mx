/**
 * Eventos de comercio de §MKT.H.4 armados desde las formas del contrato (cotización y sesión de
 * checkout). Solo ids canónicos (`measurementItemOf`, `Order.id`), nombre, categoría y montos en pesos con IVA.
 * ⛔ Nunca `orderNumber` (folio que el cliente comparte), correo ni dirección.
 */

import type { BreakdownDTO, OrderItemPreview } from '@/types/contract';
import { centsToValue, track, type TrackItem } from './track';
import { measurementItemOf } from './item';

/** Identidad canónica (§MKT.H.4, `measurementItemOf`); una línea sin identidad no viaja. */
export function itemsFromQuote(items: readonly OrderItemPreview[] | undefined): TrackItem[] {
  const out: TrackItem[] = [];
  for (const it of items ?? []) {
    const id = measurementItemOf(it.card);
    if (id) out.push({ ...id, price: centsToValue(it.unitPriceCents) });
  }
  return out;
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
