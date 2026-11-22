/**
 * §BUYLIST-FLUJO F2 (docs/API_CONTRACT_BUYLIST_FLUJO.md §3–§6) — llamadas REALES al servidor: bajar precio, vista previa del
 * neto, recoger, «Convertir todas» y las dos respuestas del vendedor. Un archivo por dominio (deuda DT-API).
 * ⛔ El front no suma dinero: lo que muestra (`payout`, `netIfAcceptedCents`) lo calcula el servidor.
 * El servidor FALSO vive en `lib/mock/buylist-flujo.ts` y `api.ts` decide entre los dos (regla R1 de mock-boundary).
 */
import { apiRequest } from '../api-client';
import type {
  AdminBuylistDTO,
  BuylistConvertAllResponse,
  BuylistPickupMethod,
  BuylistRevisePreviewDTO,
  BuylistReviseReasonCode,
  SellItemDTO,
  SellRequestDetailDTO,
} from '@/types/contract';

export interface RevisePriceInput {
  revisedPriceCents: number;
  reasonCode: BuylistReviseReasonCode;
  /** 3–500; obligatoria con `other`. */
  note?: string;
}

/** `POST /admin/buylist/items/:itemId/revise-price` (staff) ⇒ 200 request DTO; correo C3 al vendedor. */
export function reviseBuylistItemPrice(itemId: string, input: RevisePriceInput): Promise<AdminBuylistDTO> {
  return apiRequest<AdminBuylistDTO>(`/admin/buylist/items/${itemId}/revise-price`, { method: 'POST', body: input });
}

/**
 * `GET /admin/buylist/items/:itemId/revise-price/preview?revisedPriceCents=` (staff, solo lectura): el `payout` que
 * tendría la solicitud si el vendedor acepta. El front lo llama con debounce y solo lo pinta.
 */
export function previewBuylistRevision(itemId: string, revisedPriceCents: number): Promise<BuylistRevisePreviewDTO> {
  return apiRequest<BuylistRevisePreviewDTO>(`/admin/buylist/items/${itemId}/revise-price/preview`, {
    query: { revisedPriceCents },
  });
}

/** `POST /admin/buylist/items/:itemId/pickup-done` (staff, atajo opcional; 200 idempotente). */
export function markBuylistPickupDone(itemId: string): Promise<SellItemDTO> {
  return apiRequest<SellItemDTO>(`/admin/buylist/items/${itemId}/pickup-done`, { method: 'POST', body: {} });
}

/** `POST /admin/buylist/:id/convert-all` (staff): éxito parcial por línea; reintento seguro. */
export function convertAllBuylist(requestId: string, locationId?: string): Promise<BuylistConvertAllResponse> {
  return apiRequest<BuylistConvertAllResponse>(`/admin/buylist/${requestId}/convert-all`, {
    method: 'POST',
    body: locationId ? { locationId } : {},
  });
}

/**
 * `POST /buylist/requests/:id/items/:itemId/revision-response` (cuenta, dueño) ⇒ la SOLICITUD completa. `accept` lleva
 * `expectedRevisedPriceCents` = el monto que el vendedor VIO (CAS del servidor): si cambió ⇒ 409 `REVISION_CHANGED`
 * `details:{expected…,current…}`; la decisión contraria o una baja retirada ⇒ 409 `REVISION_ALREADY_RESOLVED`.
 * `decline` no lleva monto. Misma decisión repetida ⇒ 200.
 */
export function respondBuylistRevision(
  requestId: string,
  itemId: string,
  decision: 'accept' | 'decline',
  expectedRevisedPriceCents?: number,
): Promise<SellRequestDetailDTO> {
  return apiRequest<SellRequestDetailDTO>(`/buylist/requests/${requestId}/items/${itemId}/revision-response`, {
    method: 'POST',
    body: decision === 'accept' ? { decision, expectedRevisedPriceCents } : { decision },
  });
}

/** `POST /buylist/requests/:id/items/:itemId/pickup` (cuenta) ⇒ la SOLICITUD completa; tras «Entregada» ⇒ 409 `PICKUP_ALREADY_DONE`. */
export function chooseBuylistPickup(requestId: string, itemId: string, method: BuylistPickupMethod): Promise<SellRequestDetailDTO> {
  return apiRequest<SellRequestDetailDTO>(`/buylist/requests/${requestId}/items/${itemId}/pickup`, {
    method: 'POST',
    body: { method },
  });
}
