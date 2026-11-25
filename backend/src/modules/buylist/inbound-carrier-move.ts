/**
 * inbound-carrier-move.ts — §BUYLIST-RASTREO (docs/DECISIONES.md): la paquetería escaneó el paquete de una solicitud de venta
 * (`aceptada`) ⇒ `en_transito` POR SISTEMA. Contradice a propósito D20 («solo `confirm-shipment`»): una PROMESA no mueve el
 * estado; un ESCANEO de la paquetería es un hecho. «Confirmar envío» (operador) y «Ya lo mandé» (vendedor) siguen de respaldo.
 *
 * ### Frontera money-safe
 * Solo escribe `status`, `shipmentConfirmedAt`, `shipmentConfirmedBy` y una fila de bitácora. ⛔ `payoutNetCents`,
 * `approvedTotalCents`, `guideActualCostCents`, pagos y `recibida`/`closedAt`: ninguno se toca (`delivered` tampoco recibe).
 * Idempotente: el CAS (`status='aceptada' ∧ closedAt IS NULL`) es la única puerta; reaplicar ⇒ 0 filas ⇒ 0 bitácora.
 * Se llama DENTRO de la transacción de `applyCarrierStatus`, que ya tomó `SellRequest FOR UPDATE` y luego la fila de entrada
 * (I-BSD-4, `lockSubjectRows`).
 */
import { CarrierStatus, Prisma } from '@prisma/client';
import { closeInboundShipment } from '../shipments/inbound-close';
import { CARRIER_CONFIRMER, INBOUND_MOVEMENT_LIST } from '../shipments/inbound-carrier';
import { monthCommittedGrossCents, monthStartUtc } from '../../common/buylist-aml';

export async function moveInboundRequestByCarrier(
  tx: Prisma.TransactionClient,
  sellRequestId: string,
  shipmentId: string,
  event: { status: CarrierStatus; occurredAt: Date },
  now: Date,
): Promise<boolean> {
  // El instante del escaneo (nunca en el futuro: un reloj adelantado del proveedor no debe dejar `shipmentConfirmedAt` > ahora).
  const at = event.occurredAt.getTime() > now.getTime() ? now : event.occurredAt;
  const moved = await tx.sellRequest.updateMany({
    where: { id: sellRequestId, status: 'aceptada', closedAt: null },
    data: { status: 'en_transito', shipmentConfirmedAt: at, shipmentConfirmedBy: CARRIER_CONFIRMER },
  });
  if (moved.count !== 1) return false;
  // I-BSD-1: salir de `aceptada` pasa por `closeInboundShipment` (con una guía en `guia` no toca la fila: viaja con el paquete).
  await closeInboundShipment(tx, sellRequestId, 'shipped', now);
  await tx.auditLog.create({
    data: {
      actorUserId: null,
      actorRole: null,
      action: 'buylist.shipment.confirm',
      entityType: 'SellRequest',
      entityId: sellRequestId,
      after: { carrierStatus: event.status, source: 'carrier', actor: CARRIER_CONFIRMER, shipmentId },
      createdAt: now,
    },
  });
  return true;
}

// ===================================================================================================
// Reapertura automática (§BUYLIST-RASTREO, dueño: B) — `expirada/not_shipped` ≤ 30 d con la guía VIVA y el paquete en movimiento
// ===================================================================================================

export const REOPEN_WINDOW_MS = 30 * 86_400_000;
/** G3-2/I-8: el PRIMER escaneo debe caer a más tardar 24 h (una vuelta del barrido) después del plazo de envío. */
export const REOPEN_SCAN_GRACE_MS = 24 * 3_600_000;

export type ReopenResult =
  | { reopened: true }
  | { reopened: false; reason: 'not_candidate' | 'paid' | 'inventory' | 'guide_canceled' | 'substitute_open' | 'aml_cap' | 'shipped_late' | 'race' };

/** Lo que `reopenByCarrier` necesita de fuera (el tope AML mensual del vendedor: override del KYC o dial). */
export interface ReopenDeps {
  capPerMonthCents: (userId: string) => Promise<number>;
}

/**
 * Reabre SOLO si TODAS las condiciones se cumplen (si falla una, NO reabre: queda listada en `docs/STATUS.md`):
 * cierre `expirada/not_shipped` de ≤ 30 d; sin pago (`paidAt`, `payoutNetCents`) ni conversión a inventario; la guía de entrada
 * es de Skydropx y NO está cancelada ante el proveedor (`providerCanceledAt IS NULL`); la solicitud no tiene sustituta abierta
 * del mismo vendedor (fail-closed: cualquier solicitud suya creada después del cierre y aún abierta); y reabrir no rebasa el tope
 * AML mensual; y el PRIMER escaneo de movimiento ≤ plazo de envío + 24 h (`shipped_late` si no). Todo en la transacción de `applyCarrierStatus` (candados `SellRequest` → `ShipmentRequest` ya tomados, I-BSD-4).
 * Efecto: `en_transito` (el escaneo ya ocurrió) con `system:carrier`, fila `cancelado → guia`, tarea manual de cancelar guía
 * cerrada, bitácora before/after. ⛔ La oferta (`offeredPriceCents`, `offerShippingFeeCents`, `offerGrossCents`) y `payoutNetCents`
 * no se tocan; ningún plazo de precio se renueva. Idempotente: el CAS exige `status='expirada'` ⇒ 2.º pase ⇒ 0 filas.
 */
export async function reopenByCarrier(
  tx: Prisma.TransactionClient,
  sellRequestId: string,
  shipmentId: string,
  event: { status: CarrierStatus; occurredAt: Date; observedAt: Date },
  now: Date,
  deps: ReopenDeps,
): Promise<ReopenResult> {
  const sr = await tx.sellRequest.findUnique({
    where: { id: sellRequestId },
    select: {
      status: true,
      expiredReason: true,
      closedAt: true,
      paidAt: true,
      payoutNetCents: true,
      userId: true,
      createdAt: true,
      offerGrossCents: true,
      quotedTotalCents: true,
      guideCancellationPendingAt: true,
      shipDeadlineAt: true,
      items: { select: { id: true } },
    },
  });
  if (!sr || sr.status !== 'expirada' || sr.expiredReason !== 'not_shipped' || !sr.closedAt) return { reopened: false, reason: 'not_candidate' };
  if (now.getTime() - sr.closedAt.getTime() > REOPEN_WINDOW_MS) return { reopened: false, reason: 'not_candidate' };
  if (sr.paidAt != null || sr.payoutNetCents != null) return { reopened: false, reason: 'paid' };
  const converted = await tx.inventoryItem.count({ where: { sourceSellRequestItemId: { in: sr.items.map((i) => i.id) } } });
  if (converted > 0) return { reopened: false, reason: 'inventory' };
  const row = await tx.shipmentRequest.findUnique({
    where: { id: shipmentId },
    select: { status: true, labelSource: true, providerShipmentId: true, providerCanceledAt: true },
  });
  if (!row || row.status !== 'cancelado' || row.labelSource !== 'skydropx' || !row.providerShipmentId) return { reopened: false, reason: 'not_candidate' };
  if (row.providerCanceledAt != null) return { reopened: false, reason: 'guide_canceled' };
  // G3-2: `T1` = el PRIMER evento de movimiento de la guía (no el último): un envío hecho DESPUÉS del plazo + 24 h no reabre
  // (el vendedor no obtiene una opción gratis de 30 d sobre un precio caducado); se lista con motivo `shipped_late`.
  const first = await tx.shipmentCarrierEvent.aggregate({
    where: { shipmentRequestId: shipmentId, status: { in: INBOUND_MOVEMENT_LIST } },
    _min: { occurredAt: true },
  });
  const t1 = first._min.occurredAt ?? event.occurredAt;
  if (!sr.shipDeadlineAt || t1.getTime() > sr.shipDeadlineAt.getTime() + REOPEN_SCAN_GRACE_MS) return { reopened: false, reason: 'shipped_late' };
  const substitute = await tx.sellRequest.count({
    where: { userId: sr.userId, id: { not: sellRequestId }, createdAt: { gt: sr.closedAt }, closedAt: null },
  });
  if (substitute > 0) return { reopened: false, reason: 'substitute_open' };
  // Tope AML mensual: el cupo que `expirada` había liberado se vuelve a consumir con el MISMO bruto ofertado.
  if (sr.createdAt >= monthStartUtc(now)) {
    const used = await monthCommittedGrossCents(tx, sr.userId, now);
    const cap = await deps.capPerMonthCents(sr.userId);
    if (used + (sr.offerGrossCents ?? sr.quotedTotalCents ?? 0) > cap) return { reopened: false, reason: 'aml_cap' };
  }
  const at = event.occurredAt.getTime() > now.getTime() ? now : event.occurredAt;
  const moved = await tx.sellRequest.updateMany({
    where: {
      id: sellRequestId,
      status: 'expirada',
      expiredReason: 'not_shipped',
      closedAt: { gte: new Date(now.getTime() - REOPEN_WINDOW_MS) },
      paidAt: null,
      payoutNetCents: null,
    },
    data: {
      status: 'en_transito',
      closedAt: null,
      expiredReason: null,
      shipmentConfirmedAt: at,
      shipmentConfirmedBy: CARRIER_CONFIRMER,
      guideCancellationPendingAt: null,
    },
  });
  if (moved.count !== 1) return { reopened: false, reason: 'race' };
  await tx.shipmentRequest.updateMany({ where: { id: shipmentId, status: 'cancelado' }, data: { status: 'guia' } });
  await tx.auditLog.create({
    data: {
      actorUserId: null,
      actorRole: null,
      action: 'buylist.reopen_by_carrier',
      entityType: 'SellRequest',
      entityId: sellRequestId,
      before: {
        status: sr.status,
        closedAt: sr.closedAt.toISOString(),
        expiredReason: sr.expiredReason,
        guideCancellationPendingAt: sr.guideCancellationPendingAt ? sr.guideCancellationPendingAt.toISOString() : null,
        inboundStatus: row.status,
      },
      after: {
        status: 'en_transito',
        closedAt: null,
        expiredReason: null,
        guideCancellationPendingAt: null,
        inboundStatus: 'guia',
        carrierStatus: event.status,
        carrierStatusAt: event.occurredAt.toISOString(),
        source: 'carrier',
        actor: CARRIER_CONFIRMER,
        shipmentId,
      },
      createdAt: now,
    },
  });
  return { reopened: true };
}
