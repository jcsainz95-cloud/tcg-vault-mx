/**
 * carrier-notices.ts — ⭐ D2d: la COSTURA hacia los correos al cliente que dispara el transportista (API_CONTRACT
 * §M4-SHIP.19.3 paso 5 «marcar AV-17/AV-18/AV-19 pendiente» y §19.12). `applyCarrierStatus` (D2d) decide QUÉ hecho
 * ocurrió (el evento es nuevo: el `@@unique` lo garantiza) y, POST-COMMIT, se lo entrega a este puerto; los correos, su
 * plantilla y su SELLO (`deliveredNoticeSentAt`, `branchNoticeSentAt`, `lastDeliveryAttemptAt`) son de **D2e**
 * (§19.31.10 fila 3a), que sustituye el proveedor por defecto. Hasta entonces: no-op con log `info` (⛔ ningún correo al
 * cliente sale de D2d; `C-AV-1` sigue en 19 hasta que D2e cuente las tres filas nuevas).
 *
 * ⛔ El puerto NUNCA hace fallar al sondeo (best-effort, §R.4): el llamador traga y loguea cualquier excepción.
 */
import { Logger } from '@nestjs/common';
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

const logger = new Logger('CarrierNotices');

/** El proveedor por defecto hasta D2e: registra el hecho y no manda nada. */
export const pendingCarrierNotices: CarrierNoticePort = {
  async notify(shipmentId, notice, event) {
    logger.log(`carrier_notice_pending shipmentId=${shipmentId} notice=${notice} status=${event.status} (correo: D2e)`);
  },
};
