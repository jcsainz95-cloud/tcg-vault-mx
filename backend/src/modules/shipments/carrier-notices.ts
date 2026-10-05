/**
 * carrier-notices.ts — la COSTURA hacia los correos al cliente que dispara el transportista (API_CONTRACT §M4-SHIP.19.3 paso 5
 * y §19.12). `applyCarrierStatus` (D2d) decide QUÉ hecho ocurrió (el evento es nuevo: el `@@unique` lo garantiza) y,
 * POST-COMMIT, se lo entrega a este puerto. ⭐ D2e: el proveedor real ({@link mailCarrierNotices}) sella y manda `AV-17`
 * (Entregado), `AV-18` (En sucursal) y `AV-19` (Intentaron entregarte) por `ShipmentsService.notifyCarrierNotice` — plantilla,
 * destinatario (§R.5) y sello (`deliveredNoticeSentAt`, `branchNoticeSentAt`, `lastDeliveryAttemptAt`). `C-AV-1` = 19.
 *
 * ⛔ El puerto NUNCA hace fallar al sondeo (best-effort, §R.4): el llamador traga y loguea cualquier excepción.
 */
import { CarrierStatus } from '@prisma/client';

export const CARRIER_NOTICES = 'CARRIER_NOTICES';

/** `AV-17` Entregado · `AV-18` En sucursal · `AV-19` Intentaron entregarte (§19.12). */
export type CarrierNotice = 'AV-17' | 'AV-18' | 'AV-19';

export interface CarrierNoticeEvent {
  status: CarrierStatus;
  occurredAt: Date;
  observedAt: Date;
  branchName: string | null;
  providerEventKey: string;
}

export interface CarrierNoticePort {
  notify(shipmentId: string, notice: CarrierNotice, event: CarrierNoticeEvent): Promise<void>;
}

/** ⭐ D2e — el proveedor real: delega en el cuerpo de los avisos de envío (un solo `claimAndNotify`, un solo §R.5). */
export function mailCarrierNotices(shipments: {
  notifyCarrierNotice(shipmentId: string, notice: CarrierNotice, event: CarrierNoticeEvent): Promise<void>;
}): CarrierNoticePort {
  return { notify: (shipmentId, notice, event) => shipments.notifyCarrierNotice(shipmentId, notice, event) };
}
