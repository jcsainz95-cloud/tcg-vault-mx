/**
 * inbound-address-sync.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.4.1 paso 3 y §BSD.4.5): **el domicilio de ORIGEN de la guía de
 * entrada sigue al de la solicitud mientras la fila esté en `solicitado`.**
 *
 *  - La copia de `pickupAddressSnapshot` es `inboundAddressSnapshotOf` (`shipments/label-inbound.ts`, de B-2): UNA función para
 *    la creación de la fila (§BSD.4.1 paso 3) y para esta re-sincronía.
 *  - `resyncInboundAddress(tx, …)` — `PATCH …/pickup-address` (vendedor y admin): si hay fila de entrada en `solicitado`, EN LA
 *    MISMA tx su `addressSnapshot` se reemplaza, `addressVersion += 1` (invalida las cotizaciones) y queda una
 *    `ShipmentAddressRevision` (`correctedByUserId` = el vendedor: la dirección es de su libreta) con las claves corregibles que cambiaron.
 *    ⚠️ `phone` NO es corregible (P-ADR-1, CHECK `shipment_address_revision_changed_keys_known`): si solo cambia el teléfono,
 *    el snapshot y la versión se mueven y la revisión no se escribe (el CHECK exige ≥ 1 clave).
 *
 * El llamador ya tiene la solicitud y la fila de entrada bajo candado (I-BSD-4).
 */
import { Prisma } from '@prisma/client';
import { CORRECTABLE_SNAPSHOT_KEYS } from '../shipments/shipment-address.service';
import { inboundAddressSnapshotOf } from '../shipments/label-inbound';

type Tx = Pick<Prisma.TransactionClient, 'shipmentRequest' | 'shipmentAddressRevision'>;

export async function resyncInboundAddress(
  tx: Tx,
  sellRequestId: string,
  pickup: unknown,
  correctedByUserId: string,
  now: Date,
): Promise<'none' | 'unchanged' | 'synced'> {
  const row = await tx.shipmentRequest.findUnique({
    where: { sellRequestId },
    select: { id: true, status: true, addressSnapshot: true, addressVersion: true },
  });
  if (!row || row.status !== 'solicitado') return 'none';
  const prev = (row.addressSnapshot ?? {}) as Record<string, unknown>;
  const next = inboundAddressSnapshotOf(pickup) as Record<string, unknown>;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const differs = [...keys].some((k) => (prev[k] ?? null) !== (next[k] ?? null));
  if (!differs) return 'unchanged';
  const changed = CORRECTABLE_SNAPSHOT_KEYS.filter((k) => (prev[k] ?? null) !== (next[k] ?? null));
  const moved = await tx.shipmentRequest.updateMany({
    // CAS por id + versión + estado: la fila sigue siendo la que se leyó bajo el candado.
    where: { id: row.id, status: 'solicitado', addressVersion: row.addressVersion },
    data: {
      addressSnapshot: next as Prisma.InputJsonValue,
      addressVersion: { increment: 1 },
      addressCorrectedAt: now,
      addressCorrectedByUserId: correctedByUserId,
    },
  });
  if (moved.count !== 1) return 'none';
  if (changed.length > 0) {
    await tx.shipmentAddressRevision.create({
      data: {
        shipmentRequestId: row.id,
        fromVersion: row.addressVersion,
        changedKeys: [...changed],
        before: Object.fromEntries(changed.map((k) => [k, (prev[k] as string | undefined) ?? null])) as Prisma.InputJsonValue,
        after: Object.fromEntries(changed.map((k) => [k, (next[k] as string | null | undefined) ?? null])) as Prisma.InputJsonValue,
        correctedByUserId,
      },
    });
  }
  return 'synced';
}
