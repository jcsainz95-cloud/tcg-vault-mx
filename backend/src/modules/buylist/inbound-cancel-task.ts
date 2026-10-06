/**
 * inbound-cancel-task.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.4.8 último párrafo, BSD-B14): **si la cancelación automática de la
 * guía de entrada no se confirmó, la tarea «cancelar guía no usada» se abre YA** (criterio 139), con el número a la vista.
 *
 * Lo llaman, POST-commit y DESPUÉS de `afterAutoCloseVia`, los dos cierres de B-3 que pueden sellar una guía viva de Skydropx:
 * la regla 8/2 del barrido (`closeWithGuideTask`) y `decline-accepted`. `afterAutoCloseVia` es síncrono (espera a
 * `port.cancel`): si al volver la fila sigue con `providerCanceledAt` y sin `providerCancelConfirmedAt`, Skydropx no dijo `ok`
 * (o no se pudo llamar) y alguien tiene que mirarla. Sin esto la tarea esperaría a la regla 10 (1 h).
 *
 * ⚠️ §BSD.4.8 asigna esta escritura al «servicio de cancelación» (`shipments/`, B-2). Aquí la hace el LLAMADOR, con la misma
 * guarda (`guideCancellationPendingAt IS NULL ∧ guideCancellationDoneAt IS NULL`): si B-2 también la escribe, la segunda no
 * casa (idempotente). Decisión anotada en `BACKEND_NOTES §78.B3`.
 */
import { Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'shipmentRequest' | 'sellRequest'>;

export async function openGuideTaskIfCancelUnconfirmed(db: Db, sellRequestId: string, shipmentId: string, now: Date): Promise<boolean> {
  const row = await db.shipmentRequest.findUnique({
    where: { id: shipmentId },
    select: { providerCanceledAt: true, providerCancelConfirmedAt: true },
  });
  if (!row || row.providerCanceledAt == null || row.providerCancelConfirmedAt != null) return false;
  const opened = await db.sellRequest.updateMany({
    where: { id: sellRequestId, guideCancellationPendingAt: null, guideCancellationDoneAt: null },
    data: { guideCancellationPendingAt: now },
  });
  return opened.count === 1;
}
