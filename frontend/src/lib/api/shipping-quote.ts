/**
 * §ENV3 — `POST /checkout/shipping-quote` (público; `docs/API_CONTRACT.md`, `docs/DECISIONES.md` §ENV3).
 * Body `{cp, items[]}` ⇒ `{quoteId, shippingFeeCents, service, etaDays, expiresAt}`. ⛔ El cliente NO manda peso ni costo:
 * solo qué lleva el carrito; el servidor deriva perfil, tabla de respaldo y cobro. El `quoteId` (HMAC, 30 min) viaja a
 * `quote` y `session` como `shippingQuoteId`; caducado o carrito/CP distinto ⇒ `409 SHIPPING_QUOTE_STALE`
 * con `details.newQuote` (misma forma que la respuesta).
 * Latencia medida del cotizador en vivo: p95 ≈ 6 s (timeout duro del servidor, luego respaldo por tabla ⇒ misma forma).
 */
import { apiRequest } from '../api-client';
import { config } from '../config';

export interface ShippingQuoteDTO {
  quoteId: string;
  /** Centavos, IVA dentro, ya con MX$20 de margen y zona extendida; 0 si el pedido llega al umbral de envío gratis. */
  shippingFeeCents: number;
  /** Servicio cotizado (p. ej. `FedEx Standard Overnight`). */
  service: string;
  etaDays: number;
  expiresAt: string;
}

export type ShippingQuoteItemInput =
  | { inventoryItemId: string }
  | { accessoryId: string; quantity: number }
  | { pullToken: string; withEnergyBundle: boolean };

export interface ShippingQuoteRequest {
  cp: string;
  items: ShippingQuoteItemInput[];
}

/** `ApiClientError.code` del 409 de sesión/cotización con cotización caducada o desfasada. */
export const SHIPPING_QUOTE_STALE = 'SHIPPING_QUOTE_STALE';

const MOCKS_BUILD = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

export async function postShippingQuote(input: ShippingQuoteRequest, signal?: AbortSignal): Promise<ShippingQuoteDTO> {
  if (!(MOCKS_BUILD && config.useMocks)) {
    return apiRequest<ShippingQuoteDTO>('/checkout/shipping-quote', { method: 'POST', body: input, signal });
  }
  // MOCK: determinista (el servidor real decide); el CP solo cambia el importe para poder probar la re-cotización.
  const lastDigit = Number(input.cp.slice(-1)) || 0;
  return {
    quoteId: `mock-sq-${input.cp}-${input.items.length}`,
    shippingFeeCents: 12000 + lastDigit * 100,
    service: 'FedEx Standard Overnight',
    etaDays: 1,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}

/** Lee `details.newQuote` del 409 `SHIPPING_QUOTE_STALE`; `null` si falta o no tiene forma. */
export function newQuoteFromStale(details: unknown): ShippingQuoteDTO | null {
  const q = (details as { newQuote?: Partial<ShippingQuoteDTO> } | null | undefined)?.newQuote;
  if (!q || typeof q.quoteId !== 'string' || typeof q.shippingFeeCents !== 'number') return null;
  return {
    quoteId: q.quoteId,
    shippingFeeCents: q.shippingFeeCents,
    service: q.service ?? '',
    etaDays: q.etaDays ?? 0,
    expiresAt: q.expiresAt ?? '',
  };
}
