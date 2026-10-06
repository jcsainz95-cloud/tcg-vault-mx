/**
 * inbound-close.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.4.8, I-BSD-1): `closeInboundShipment(tx, sellRequestId, mode)`, UN
 * cuerpo para todo lo que saca una solicitud de `aceptada`.
 *
 * ### La invariante que sostiene (I-BSD-1)
 * Fila de entrada en `solicitado` ⇒ su solicitud está `aceptada` ∧ `closedAt IS NULL`. Por eso **toda** transición que
 * saca una solicitud de `aceptada` llama a esto **en la misma transacción** (candado BSD-B25 (b)): regla 2 y regla 8 del
 * barrido, `decline-accepted` (`mode='close'`) y `adminConfirmShipment` (`mode='shipped'`).
 *
 * ### Qué hace
 *  - Toma los candados en el orden de I-BSD-4: `SellRequest` (el llamador ya la tiene por su `updateMany`; repetirlo en la
 *    misma transacción no espera) y DESPUÉS la fila de entrada, si existe.
 *  - `mode='close'`: `solicitado | guia ⇒ cancelado` y `cancelProviderLabelIfAny(tx, id, 'auto_close')` — **el mismo cuerpo**
 *    que usan los reembolsos y el contracargo (`label-auto-close.ts`). Devuelve su resultado
 *    (`'none' | 'in_flight' | 'sealed' | 'live'`).
 *  - `mode='shipped'`: solo `solicitado ⇒ cancelado` (una guía ya emitida es la que viaja: ⛔ no se toca). Una compra «en
 *    vuelo» la resuelve `casZero` rama (3) cuando vuelva la respuesta (la fila ya está `cancelado`).
 *
 * ### Qué NO hace (es del llamador, §BSD.4.8)
 *  - Escribir `guideCancellationPendingAt` en la solicitud: SOLO si la guía es manual o el resultado es `'live'` ⇒
 *    `needsGuideCancelTask(…)`, abajo, es la regla en una función pura.
 *  - El post-commit: `afterAutoCloseVia(moduleRef, [shipmentId])` cuando `outcome === 'sealed'`.
 *  - ⛔ Nunca red: esto corre dentro de la transacción del escritor.
 */
import { Prisma } from '@prisma/client';
import { AutoCloseOutcome, cancelProviderLabelIfAny } from './label-auto-close';

export type InboundCloseMode = 'close' | 'shipped';

export interface InboundCloseResult {
  /** La fila de entrada de la solicitud, o `null` si no tiene. */
  readonly shipmentId: string | null;
  /** `'none' | 'in_flight' | 'sealed' | 'live'` (§BSD.4.8). `'sealed'` ⇒ el llamador hace `afterAutoCloseVia` post-commit. */
  readonly outcome: AutoCloseOutcome;
  /** Había guía VIVA de Skydropx en la fila de entrada ANTES de cerrar (`labelSource='skydropx'`, id, sin cancelar). */
  readonly liveSkydropxGuide: boolean;
  /** La fila pasó a `cancelado` en esta llamada. */
  readonly rowCancelled: boolean;
}

const NO_ROW: InboundCloseResult = { shipmentId: null, outcome: 'none', liveSkydropxGuide: false, rowCancelled: false };

export async function closeInboundShipment(
  tx: Prisma.TransactionClient,
  sellRequestId: string,
  mode: InboundCloseMode,
  now: Date = new Date(),
): Promise<InboundCloseResult> {
  // I-BSD-4: primero la solicitud, después la fila de entrada.
  await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${sellRequestId} FOR UPDATE`;
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ShipmentRequest" WHERE "sellRequestId" = ${sellRequestId} FOR UPDATE`;
  if (locked.length === 0) return NO_ROW;
  const shipmentId = locked[0].id;
  const row = await tx.shipmentRequest.findUnique({
    where: { id: shipmentId },
    select: { status: true, labelSource: true, providerShipmentId: true, providerCanceledAt: true, labelProcessingSince: true },
  });
  if (!row) return NO_ROW;
  const liveSkydropxGuide = row.labelSource === 'skydropx' && row.providerShipmentId !== null && row.providerCanceledAt === null;

  if (mode === 'shipped') {
    const moved = await tx.shipmentRequest.updateMany({ where: { id: shipmentId, status: 'solicitado' }, data: { status: 'cancelado' } });
    const inFlight = moved.count === 1 && row.labelProcessingSince !== null && row.providerShipmentId === null;
    return { shipmentId, outcome: inFlight ? 'in_flight' : 'none', liveSkydropxGuide, rowCancelled: moved.count === 1 };
  }

  const moved = await tx.shipmentRequest.updateMany({
    where: { id: shipmentId, status: { in: ['solicitado', 'guia'] } },
    data: { status: 'cancelado' },
  });
  const outcome = await cancelProviderLabelIfAny(tx, shipmentId, 'auto_close', now);
  return { shipmentId, outcome, liveSkydropxGuide, rowCancelled: moved.count === 1 };
}

/**
 * §BSD.4.8 / §BSD.7.3 — **¿abre la tarea «cancelar guía no usada» (criterio 139)?** SOLO si:
 *  - la guía es **manual**: hay número en la solicitud y NO había guía viva de Skydropx en la fila de entrada (con guía de
 *    entrada viva el número de la solicitud ES el de Skydropx, I-BSD-2); o
 *  - el resultado es `'live'` (el paquete ya se movió: no se puede cancelar sola y alguien tiene que mirarla).
 * Con guía de Skydropx `'sealed'` NO hay tarea: el post-commit la cancela y, si `port.cancel` falla, el servicio de
 * cancelación la abre él (§BSD.4.8). Con guía manual: **bit a bit como hoy** (criterio 549).
 */
export function needsGuideCancelTask(
  sellRequest: { readonly shipmentTrackingNumber: string | null; readonly guideCancellationDoneAt?: Date | null },
  res: Pick<InboundCloseResult, 'outcome' | 'liveSkydropxGuide'>,
): boolean {
  if (sellRequest.guideCancellationDoneAt != null) return false;
  if (res.outcome === 'live') return true;
  return sellRequest.shipmentTrackingNumber != null && !res.liveSkydropxGuide;
}
