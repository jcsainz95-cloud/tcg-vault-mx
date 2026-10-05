/**
 * label-auto-close.ts — 💰 la cancelación automática de la guía (API_CONTRACT §M4-SHIP.19.8 «Cancelación automática»,
 * criterio 244, `C-SDX-5`; SEC-SDX-3). Fichero LIGERO a propósito: lo importan `payments/` (los dos escritores automáticos
 * de `cancelado`) sin arrastrar `shipments.service` (⛔ ciclo de imports).
 *
 *  - `cancelProviderLabelIfAny(tx, id, 'auto_close')` — DENTRO de la tx del escritor: sella; nunca red.
 *  - `afterAutoCloseVia(moduleRef, ids)` — POST-commit: `port.cancel` best-effort por el servicio de cancelación,
 *    resuelto por token (`LABEL_AUTO_CLOSE`) para no crear un ciclo de módulos. ⛔ Nunca lanza.
 */
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';

export const LABEL_AUTO_CLOSE = 'LABEL_AUTO_CLOSE';

export interface LabelAutoCloser {
  afterAutoClose(shipmentIds: readonly string[]): Promise<void>;
}

export type AutoCloseOutcome = 'sealed' | 'live' | 'in_flight' | 'none';

const logger = new Logger('LabelAutoClose');

/**
 * Dentro de la tx del escritor de `cancelado` (la fila ya está bajo su candado). UN cuerpo, dos llamadores (`C-SDX-5`):
 * `FullRefundService.cancelShipment` y el contracargo de `PaymentsService.onDisputeCreated…`.
 *  - guía de Skydropx viva, `carrierStatus ∈ {null,'created'}` ⇒ sello `providerCanceledAt/Reason='auto_close'` (`'sealed'`);
 *  - ya salió ⇒ ⛔ no se intenta (`'live'`: la alerta `label_live_on_cancelled` la deriva el DTO);
 *  - compra en vuelo sin id ⇒ `'in_flight'` + log (lo resuelve la rama de §19.18.3 cuando vuelva la respuesta).
 */
export async function cancelProviderLabelIfAny(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  reason: 'auto_close',
  now: Date = new Date(),
): Promise<AutoCloseOutcome> {
  const row = await tx.shipmentRequest.findUnique({
    where: { id: shipmentId },
    select: { labelSource: true, providerShipmentId: true, providerCanceledAt: true, carrierStatus: true, labelProcessingSince: true },
  });
  if (!row) return 'none';
  if (row.labelProcessingSince !== null && row.providerShipmentId === null) {
    logger.warn(`label_purchase_in_flight shipmentId=${shipmentId} (cancelado durante la compra)`);
    return 'in_flight';
  }
  if (row.labelSource !== 'skydropx' || row.providerShipmentId === null || row.providerCanceledAt !== null) return 'none';
  if (row.carrierStatus !== null && row.carrierStatus !== 'created') return 'live';
  const r = await tx.shipmentRequest.updateMany({
    where: { id: shipmentId, labelSource: 'skydropx', providerCanceledAt: null, OR: [{ carrierStatus: null }, { carrierStatus: 'created' }] },
    data: { providerCanceledAt: now, providerCancelReason: reason },
  });
  return r.count === 1 ? 'sealed' : 'none';
}

/** POST-commit, best-effort. Sin el servicio (pruebas unitarias legacy, app sin `ShipmentsModule`) ⇒ no-op. */
export async function afterAutoCloseVia(moduleRef: ModuleRef | undefined, shipmentIds: readonly string[]): Promise<void> {
  if (!moduleRef || shipmentIds.length === 0) return;
  try {
    const closer = moduleRef.get<LabelAutoCloser>(LABEL_AUTO_CLOSE, { strict: false });
    await closer.afterAutoClose(shipmentIds);
  } catch (e) {
    logger.error(`afterAutoClose no corrió: ${e instanceof Error ? e.message : String(e)}`);
  }
}
