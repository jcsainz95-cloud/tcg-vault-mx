/**
 * §BMK.3 (API_CONTRACT, NORMATIVA) · ARCHITECTURE §4.BMK (c) — el ÚNICO cuerpo del cliente que decide
 * si una línea del cotizador de venta enseña «Valor de mercado».
 *
 *   visible ⇔ referencePrice.status === "priced"
 *           ∧ quote.status === "cotizada"
 *           ∧ priceMxnCents es entero > 0
 *
 * Devuelve los centavos a pintar o `null`. Con `null` el par (rótulo + cifra) NO existe en el DOM:
 * ⛔ nunca «MX$0.00», «—», tachado ni atenuado en su lugar.
 *
 * - Repite a propósito la regla del emisor (BMK.2, `toQuotePayload`): defensa en profundidad ante
 *   cotizaciones guardadas en `localStorage` (carrito) o un servidor sin BMK.2 (guardarraíl: precio
 *   pendiente con mercado `priced`). Por eso NO depende de que el backend ya filtre.
 * - ⛔ No mira `priceBasis` (diferencia deliberada con la ficha de la tienda, §N.7): con bounty,
 *   precio a mano o bin el mercado se ve igual (P-BMK-1/2).
 * - ⛔ No produce importes: no compara ni combina el mercado con la cifra a pagar (§BMK.5).
 *
 * Teja del binder, ventana de detalle, teja de producto aparte y renglón del carrito la llaman;
 * ninguna superficie reimplementa el predicado (DESIGN_SYSTEM §BMK.12, N-BMK-2).
 */
export interface SellMarketInput {
  quote: { status: 'cotizada' | 'precio_pendiente' };
  referencePrice: { status: 'priced' | 'pending'; priceMxnCents?: number };
}

export function visibleMarketCents(q: SellMarketInput | null | undefined): number | null {
  if (!q || !q.quote || !q.referencePrice) return null;
  if (q.quote.status !== 'cotizada') return null;
  if (q.referencePrice.status !== 'priced') return null;
  const cents = q.referencePrice.priceMxnCents;
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) return null;
  return cents;
}
