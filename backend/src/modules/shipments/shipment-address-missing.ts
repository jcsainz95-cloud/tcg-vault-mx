/**
 * shipment-address-missing.ts — ⭐ v1.80.12.2 (API_CONTRACT §M4-SHIP.19.22.2). Fichero propio (sin dependencias de
 * servicios) para que lo lean `shipments.service.ts` (el DTO) y D2 (`quote`/`label`) sin ciclo de imports.
 */
import { AddressMissingField, addressMissing } from '../users/address-rules';

/** ⭐ v1.80.12.2 (§M4-SHIP.19.22.2): lo que le falta al SNAPSHOT del envío para una guía, en orden fijo. */
export type ShipmentAddressMissingField = 'recipientName' | 'line1' | AddressMissingField;

/**
 * EL cuerpo de `AdminShipmentDTO.address.missing` y del `422 SHIPMENT_ADDRESS_INCOMPLETE {missing}` de `quote`/`label`
 * (D2): `recipientName` y `line1` vacíos tras trim, y luego `addressMissing` de la libreta (`users/address-rules.ts`) —
 * se COMPONE, ⛔ no se copia la regla.
 */
export function shipmentAddressMissing(snapshot: unknown): ShipmentAddressMissingField[] {
  const s = (snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}) as Record<string, unknown>;
  const blank = (v: unknown) => typeof v !== 'string' || v.trim().length === 0;
  const out: ShipmentAddressMissingField[] = [];
  if (blank(s.recipientName)) out.push('recipientName');
  if (blank(s.line1)) out.push('line1');
  return [...out, ...addressMissing(s)];
}

