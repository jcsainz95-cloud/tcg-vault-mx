/**
 * §PERSONA — `POST /admin/shipments/:id/delivered-in-person` (staff, `docs/API_CONTRACT.md`).
 * Body `{}`; 200 ⇒ envío `entregado` con `labelSource='in_person'`. 409: `SHIPMENT_NOT_PREPARED` | `SHIPMENT_HAS_LABEL` | `CONFLICT`.
 * ⛔ Sin mock: el servidor manda (preparado, guía, idempotencia); el front solo repite el predicado para mostrar el botón.
 */
import { apiRequest } from '../api-client';
import type { AdminShipmentDTO } from '@/types/contract';

export function deliverShipmentInPerson(id: string): Promise<AdminShipmentDTO> {
  return apiRequest<AdminShipmentDTO>(`/admin/shipments/${id}/delivered-in-person`, { method: 'POST', body: {} });
}

/** Mismo predicado que el servidor (DECISIONES §PERSONA.9): `picking` ∧ preparado ∧ sin guía. */
export function canDeliverInPerson(s: Pick<AdminShipmentDTO, 'status' | 'preparedAt' | 'labelSource' | 'trackingNumber'>): boolean {
  return s.status === 'picking' && !!s.preparedAt && !s.labelSource && !s.trackingNumber;
}
