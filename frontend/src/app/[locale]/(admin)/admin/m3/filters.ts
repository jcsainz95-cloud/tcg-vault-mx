/**
 * `?refundReview=pending` de «Ventas» (`DESIGN_SYSTEM §40.3 (b)`, `API_CONTRACT §M4-SHIP.18.12 (7)`: clase L, UN solo
 * valor; cualquier otro ⇒ `400`). Cualquier otro valor (o ninguno) ⇒ casilla desmarcada y ⛔ el parámetro NO se manda.
 *
 * ⚠️ Sin `'use client'` a propósito (misma lección que `refunds/tabs.ts`): `page.tsx` es componente de SERVIDOR y
 * llama a esta función.
 */
export function parseRefundReview(raw: string | string[] | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'pending';
}
