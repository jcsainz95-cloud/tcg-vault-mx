/**
 * §RETIRO-SALIDA.3 — `POST /admin/shipments/:id/return-received` (personal). Solo retiros `enviado|entregado`:
 * `withdrawn → in_custody` (no `missing`, del dueño) y el envío queda `entregado` + `returnedAt`.
 * ⛔ Aislado a propósito: si el dueño no aprueba la acción, se borra este archivo + `ReturnReceivedControl.tsx` + 1 línea en `ShipmentsQueue`.
 */
import { apiRequest } from '../api-client';
import type { AdminShipmentDTO, ReturnReceivedResponse } from '@/types/contract';

/** 200 `{shipment, restored, skipped, won}`; 409 `RETURN_NOT_APPLICABLE` | `RETURN_NOTHING_TO_RESTORE`. */
export function markShipmentReturnReceived(id: string): Promise<ReturnReceivedResponse> {
  return apiRequest<ReturnReceivedResponse>(`/admin/shipments/${id}/return-received`, { method: 'POST', body: {} });
}

/** Mismo predicado que DECISIONES §RETIRO-SALIDA.3: retiro de bóveda en `enviado|entregado` aún sin marca de devuelto. El servidor decide con 409. */
export function canMarkReturnReceived(s: Pick<AdminShipmentDTO, 'status' | 'kind' | 'orderId' | 'returnedAt'>): boolean {
  const isWithdrawal = s.kind === 'vault_withdrawal' || (!s.kind && !s.orderId);
  return isWithdrawal && (s.status === 'enviado' || s.status === 'entregado') && !s.returnedAt;
}
