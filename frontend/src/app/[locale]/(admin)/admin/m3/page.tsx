import { M3View } from './M3View';
import { parseRefundReview } from './filters';
import { parseMismatch, parseModeFilter } from '@/lib/api/vault-unassigned';

/**
 * `/admin/m3` — «Ventas». `?refundReview=pending` llega YA filtrado (destino de la tarjeta del tablero y del enlace de
 * «Reembolsos», `DESIGN_SYSTEM §40.3 (b)`/§40.6). El parseo vive en `filters.ts` (módulo sin `'use client'`).
 */
export default async function M3Page({
  searchParams,
}: {
  searchParams: Promise<{ refundReview?: string | string[]; mismatch?: string | string[]; fulfillmentMode?: string | string[] }>;
}) {
  const { refundReview, mismatch, fulfillmentMode } = await searchParams;
  return (
    <M3View
      initialRefundReview={parseRefundReview(refundReview)}
      initialMismatch={parseMismatch(mismatch)}
      initialMode={parseModeFilter(fulfillmentMode)}
    />
  );
}
