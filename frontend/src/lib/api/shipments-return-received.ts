/**
 * §RETIRO-SALIDA.3 — `POST /admin/shipments/:id/return-received` (personal). Solo retiros `enviado|entregado`:
 * `withdrawn → in_custody` (no `missing`, del dueño) y el envío queda `entregado` + `returnedAt`.
 * ⛔ Aislado a propósito: si el dueño no aprueba la acción, se borra este archivo + `ReturnReceivedControl.tsx` + 1 línea en `ShipmentsQueue`.
 * ⚠️ `returnedAt` aún NO está en `AdminShipmentDTO` (contrato pendiente): se lee de forma opcional.
 */
import { apiRequest } from '../api-client';
import type { AdminShipmentDTO } from '@/types/contract';

export function markShipmentReturnReceived(id: string): Promise<AdminShipmentDTO> {
  return apiRequest<AdminShipmentDTO>(`/admin/shipments/${id}/return-received`, { method: 'POST', body: {} });
}

/** Mismo predicado que DECISIONES §RETIRO-SALIDA.3: retiro de bóveda en `enviado|entregado` aún sin marca de devuelto. El servidor decide con 409. */
export function canMarkReturnReceived(s: Pick<AdminShipmentDTO, 'status' | 'kind' | 'orderId'> & { returnedAt?: string | null }): boolean {
  const isWithdrawal = s.kind === 'vault_withdrawal' || (!s.kind && !s.orderId);
  return isWithdrawal && (s.status === 'enviado' || s.status === 'entregado') && !s.returnedAt;
}
