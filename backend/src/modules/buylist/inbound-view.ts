/**
 * inbound-view.ts — 💰 rev BSD-1 (API_CONTRACT §BSD.5 `AdminBuylistDTO.inboundShipment`, §BSD.17 punto 4): **la guía de ENTRADA
 * vista desde M5** — el bloque `inboundShipment` (con `labelAlert`), el filtro `?inboundLabelAlert=true` y los dos contadores
 * hermanos del tablero (`workQueue.buylistGuideDueSoon`, `workQueue.buylistInboundLabelAlert`).
 *
 * ### Un solo cuerpo de la alerta (BSD-1.3 punto 4)
 * `labelAlert` sale de **`labelAlertOf`** (`shipments/label-view.ts`), el MISMO que pinta M4 — ⛔ nunca una copia de la regla.
 * La consulta de aquí es solo un SUPERCONJUNTO ancho (los predicados de las alertas sin umbral de tiempo, como
 * `labelAlertShipmentIds` de M4); quién tiene alerta lo decide `labelAlertOf` fila a fila. Lo que cambia respecto de M4 es la
 * CLASE de fila: aquí `INBOUND_ONLY` (censo BSD-B23, clase `inbound_only`), allá `OUTBOUND_ONLY`.
 * ⚠️ `tUnknownMs`/`orphanSince`: M4 los toma del token `LABEL_VERIFY_CONFIG` y de la bitácora `shipment.label_orphan`. Aquí se
 * usa la MISMA constante de producción (`T_UNKNOWN_MS`, el valor que ese token lleva fuera de las pruebas) y la MISMA bitácora.
 *
 * ⛔ `labelUrl` nunca (la etiqueta se sirve por proxy). ⛔ `inboundGuideClockStartedAt` nunca viaja (admin-only interno).
 */
import { Prisma, Role, ShipmentRequest } from '@prisma/client';
import { LabelAlertDTO, labelAlertOf } from '../shipments/label-view';
import { INBOUND_ONLY } from '../shipments/label-subject';
import { ORPHAN_ALERT_TTL_MS, T_UNKNOWN_MS } from '../shipments/label-verify.constants';
import { GuideClockDials, guideDueSoonWhere } from './guide-clock';

/** Las columnas de la fila de entrada que lee M5 (y `labelAlertOf`). ⛔ `labelUrl` fuera. */
export const INBOUND_SHIPMENT_SELECT = {
  id: true,
  folio: true,
  status: true,
  labelSource: true,
  labelProcessingSince: true,
  carrier: true,
  trackingNumber: true,
  trackingUrl: true,
  shippingCostCents: true,
  shippingCostIvaCents: true,
  insuranceCostCents: true,
  providerShipmentId: true,
  providerCanceledAt: true,
  providerCancelConfirmedAt: true,
  carrierStatusAt: true,
  labelPurchasedAt: true,
  rateChosenAt: true,
} as const satisfies Prisma.ShipmentRequestSelect;

export type InboundShipmentRow = Prisma.ShipmentRequestGetPayload<{ select: typeof INBOUND_SHIPMENT_SELECT }>;

/** `AdminBuylistDTO.inboundShipment` (§BSD.5 + BSD-1.3 punto 4). */
export interface AdminInboundShipmentDTO {
  id: string;
  folio: string;
  status: 'solicitado' | 'guia' | 'cancelado';
  labelSource: InboundShipmentRow['labelSource'];
  labelProcessing: boolean;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** BSD-1.1 C-5: bruto pagado a Skydropx (con IVA y seguro); `costIvaCents`/`insuranceCostCents` son desglose DENTRO. */
  costCents: number;
  costIvaCents: number;
  insuranceCostCents: number;
  providerCanceledAt: string | null;
  cancelConfirmed: boolean;
  labelAlert: LabelAlertDTO | null;
}

export interface InboundAlertOpts {
  /** Hora de la bitácora `shipment.label_orphan` de esta fila en los últimos 7 días, o `null`. */
  orphanSince?: Date | null;
}

/** La alerta de la fila de entrada con el MISMO cuerpo de M4. `actorRole` solo decide `canRelease`. */
export function inboundLabelAlertOf(row: InboundShipmentRow, now: Date, actorRole: Role | null, opts: InboundAlertOpts = {}): LabelAlertDTO | null {
  // `labelAlertOf` tolera filas parciales (`!= null` en cada lectura); el `select` de arriba trae todo lo que lee.
  return labelAlertOf(row as unknown as ShipmentRequest, now, actorRole, { tUnknownMs: T_UNKNOWN_MS, orphanSince: opts.orphanSince ?? null });
}

export function toAdminInboundShipmentDTO(
  row: InboundShipmentRow | null | undefined,
  now: Date,
  actorRole: Role | null,
  opts: InboundAlertOpts = {},
): AdminInboundShipmentDTO | null {
  if (!row) return null;
  return {
    id: row.id,
    folio: row.folio,
    status: row.status as AdminInboundShipmentDTO['status'],
    labelSource: row.labelSource,
    labelProcessing: row.labelProcessingSince != null,
    carrier: row.carrier,
    trackingNumber: row.trackingNumber,
    trackingUrl: row.trackingUrl,
    costCents: row.shippingCostCents,
    costIvaCents: row.shippingCostIvaCents,
    insuranceCostCents: row.insuranceCostCents,
    providerCanceledAt: row.providerCanceledAt ? row.providerCanceledAt.toISOString() : null,
    cancelConfirmed: row.providerCancelConfirmedAt != null,
    labelAlert: inboundLabelAlertOf(row, now, actorRole, opts),
  };
}

type AlertDb = Pick<Prisma.TransactionClient, 'shipmentRequest' | 'auditLog'>;

/** `shipment.label_orphan` de los últimos 7 días por fila (la misma ventana que M4). */
export async function inboundOrphanSince(db: Pick<Prisma.TransactionClient, 'auditLog'>, shipmentIds: readonly string[], now: Date): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (shipmentIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { action: 'shipment.label_orphan', entityType: 'ShipmentRequest', entityId: { in: [...shipmentIds] }, createdAt: { gt: new Date(now.getTime() - ORPHAN_ALERT_TTL_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, createdAt: true },
  });
  for (const o of rows) if (o.entityId && !out.has(o.entityId)) out.set(o.entityId, o.createdAt);
  return out;
}

/**
 * Las SOLICITUDES cuya guía de entrada tiene `labelAlert ≠ null`: alimenta `GET /admin/buylist?inboundLabelAlert=true` y
 * `workQueue.buylistInboundLabelAlert`. Superconjunto en SQL, veredicto de `labelAlertOf`.
 */
export async function inboundLabelAlertSellRequestIds(db: AlertDb, now: Date): Promise<string[]> {
  const orphans = await db.auditLog.findMany({
    where: { action: 'shipment.label_orphan', entityType: 'ShipmentRequest', createdAt: { gt: new Date(now.getTime() - ORPHAN_ALERT_TTL_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, createdAt: true },
  });
  const orphanSince = new Map<string, Date>();
  for (const o of orphans) if (o.entityId && !orphanSince.has(o.entityId)) orphanSince.set(o.entityId, o.createdAt);
  const candidates = await db.shipmentRequest.findMany({
    where: {
      // rev BSD-1 (censo BSD-B23, `inbound_only`): las guías de ENTRADA atascadas se ven en M5 y en su contador del tablero.
      ...INBOUND_ONLY,
      OR: [
        { status: 'cancelado', labelSource: 'skydropx', providerCanceledAt: null },
        { providerShipmentId: { not: null }, providerCanceledAt: { not: null }, providerCancelConfirmedAt: null },
        { labelProcessingSince: { not: null } },
        ...(orphanSince.size > 0 ? [{ id: { in: [...orphanSince.keys()] } }] : []),
      ],
    },
    select: { ...INBOUND_SHIPMENT_SELECT, sellRequestId: true },
  });
  return candidates
    .filter((row) => inboundLabelAlertOf(row, now, null, { orphanSince: orphanSince.get(row.id) ?? null }) !== null)
    .flatMap((row) => (row.sellRequestId ? [row.sellRequestId] : []));
}

/**
 * Los dos contadores HERMANOS del tablero (BSD-1.1 C-3, BSD-1.3 punto 4). ⛔ `workQueue.buylist` sigue siendo un número.
 *  - `buylistGuideDueSoon` = solicitudes con `guideDueSoon = true` (la forma Prisma de `guideDueSoonOf`).
 *  - `buylistInboundLabelAlert` = solicitudes cuya guía de entrada está atascada (`labelAlertOf ≠ null`).
 * Silenciar AG-23 NO los toca (son derivados, C-7).
 */
export async function buylistWorkQueueOf(
  db: AlertDb & Pick<Prisma.TransactionClient, 'sellRequest'>,
  dials: GuideClockDials,
  now: Date,
): Promise<{ buylistGuideDueSoon: number; buylistInboundLabelAlert: number }> {
  const [buylistGuideDueSoon, alertIds] = await Promise.all([
    db.sellRequest.count({ where: guideDueSoonWhere(now, dials) }),
    inboundLabelAlertSellRequestIds(db, now),
  ]);
  return { buylistGuideDueSoon, buylistInboundLabelAlert: new Set(alertIds).size };
}
