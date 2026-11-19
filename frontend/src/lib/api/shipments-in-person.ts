/**
 * §PERSONA — `POST /admin/shipments/:id/delivered-in-person` (staff, `docs/API_CONTRACT.md`).
 * Body `{}`; 200 ⇒ envío `entregado` con `labelSource='in_person'`. 409: `SHIPMENT_NOT_PREPARED` | `SHIPMENT_HAS_LABEL` | `CONFLICT`.
 * ⛔ Sin mock: el servidor manda (preparado, guía, idempotencia); el front solo repite el predicado para mostrar el botón.
 */
import { apiRequest } from '../api-client';
import type { AdminShipmentDTO, ShipPreparationOrderDTO } from '@/types/contract';

export function deliverShipmentInPerson(id: string): Promise<AdminShipmentDTO> {
  return apiRequest<AdminShipmentDTO>(`/admin/shipments/${id}/delivered-in-person`, { method: 'POST', body: {} });
}

/** Mismo predicado que el servidor (DECISIONES §PERSONA.9): `picking` ∧ preparado ∧ sin guía ∧ sin compra de guía en curso (`labelPending`). */
export function canDeliverInPerson(s: Pick<AdminShipmentDTO, 'status' | 'preparedAt' | 'labelSource' | 'trackingNumber' | 'labelPending'>): boolean {
  return s.status === 'picking' && !!s.preparedAt && !s.labelSource && !s.trackingNumber && !s.labelPending;
}

/**
 * Misma regla para la tarjeta de «Preparar», que NO trae `status`/`labelSource`/`trackingNumber` (ver `ShipPreparationOrderDTO`):
 * estar en la cola ⇒ `picking`; `preparation.status==='prepared'` ⇒ `preparedAt`; sin `labelPending` ⇒ sin guía en curso.
 * Solo decide si se PINTA el botón; el servidor responde 409 `SHIPMENT_HAS_LABEL`/`SHIPMENT_NOT_PREPARED` si no aplica.
 */
export function canDeliverInPersonFromCard(o: Pick<ShipPreparationOrderDTO, 'preparation' | 'labelPending'>): boolean {
  return canDeliverInPerson({
    status: 'picking',
    preparedAt: o.preparation.status === 'prepared' ? o.preparation.preparedAt : null,
    labelSource: null,
    trackingNumber: null,
    labelPending: o.labelPending ?? null,
  });
}
