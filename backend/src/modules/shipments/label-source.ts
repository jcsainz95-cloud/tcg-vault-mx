/**
 * label-source.ts — §19.2 / §19.23.3 (1): `labelSourceOf(row) = row.labelSource ?? (row.trackingNumber ? 'manual' : null)`.
 * UN helper (fichero propio, sin dependencias de servicios: lo leen `shipments.service.ts`, la corrección de dirección y la
 * compra sin ciclo de imports). Sin backfill (`ARCHITECTURE §11`): una fila con número y `labelSource` nulo es una guía
 * manual anterior a v1.81.
 */
import { ShipmentLabelSource, ShipmentRequest } from '@prisma/client';

export function labelSourceOf(row: Pick<ShipmentRequest, 'labelSource' | 'trackingNumber'>): ShipmentLabelSource | null {
  return row.labelSource ?? (row.trackingNumber ? 'manual' : null);
}
