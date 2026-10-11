/**
 * spend-alert.view.ts — 💰 de la fila `SpendAlert` a lo que ve el panel (`SpendAlertDTO`, API_CONTRACT §19.29.9 con §19.30.8
 * S-GAS-2 y §19.31.8 S-GAS-8) y a lo que ve un correo (`SpendAlertMailView`). UN cuerpo de lectura para los dos: el correo y la
 * pantalla dicen lo mismo (GAS-4).
 *
 * ⛔ Lista blanca: del envío salen `id`, `folio` y su tipo; del pedido, `id` y `orderNumber`; de las personas, `id` y `name`
 * (personal). Nada más se lee de la base: ni dirección, ni correo, ni teléfono, ni CLABE (GAS-2).
 */
import { Prisma, SpendAlert, SpendAlertKind, SpendAlertMailStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SPEND_ALERT_CODE_OF } from './spend-alerts.service';
import { FactValue, SpendAlertMailView } from './spend-alert-text';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * S-GAS-2 — el tipo de envío para elegir el enlace. ⚠️ Medido (§19.30.8 pedía medirlo): el tipo existente es
 * `ShipmentKind = 'guest_direct_ship' | 'vault_withdrawal'` (`shipments.service.ts:140`); `'order_ship'` NO existe en el
 * sistema y, como manda la errata, se usa el tipo existente. Misma regla que `ShipmentPrepService.kindOf` (sin pedido ⇒ retiro
 * de bóveda; pedido `direct_ship` ⇒ envío directo), sin su excepción: un aviso se muestra aunque el envío esté corrupto (`null`).
 */
export type SpendAlertShipmentKind = 'vault_withdrawal' | 'guest_direct_ship';

export interface SpendAlertDTO {
  id: string;
  code: string;
  kind: SpendAlertKind;
  severity: 'immediate' | 'digest';
  subject: { userId: string; name: string } | null;
  shipment: { id: string; folio: string; kind: SpendAlertShipmentKind | null } | null;
  order: { id: string; orderNumber: string | null } | null;
  amountCents: number | null;
  facts: Record<string, FactValue>;
  occurrenceCount: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  resolvedAt: string | null;
  seen: { at: string; by: { userId: string; name: string } } | null;
  mail: { status: SpendAlertMailStatus; at: string | null };
  muted: boolean;
}

export interface AlertRefs {
  users: Map<string, { id: string; name: string }>;
  shipments: Map<string, { id: string; folio: string; orderId: string | null; kind: SpendAlertShipmentKind | null }>;
  orders: Map<string, { id: string; orderNumber: string | null }>;
}

type AlertRow = Pick<
  SpendAlert,
  | 'id'
  | 'kind'
  | 'severity'
  | 'subjectUserId'
  | 'shipmentRequestId'
  | 'orderId'
  | 'amountCents'
  | 'facts'
  | 'occurrenceCount'
  | 'firstOccurredAt'
  | 'lastOccurredAt'
  | 'resolvedAt'
  | 'seenAt'
  | 'seenByUserId'
  | 'mailStatus'
  | 'mailedAt'
  | 'muted'
>;

/** Las referencias de un conjunto de avisos, en tres lecturas (lista blanca de columnas). */
export async function loadAlertRefs(db: Db, rows: readonly AlertRow[]): Promise<AlertRefs> {
  const userIds = new Set<string>();
  const shipmentIds = new Set<string>();
  const orderIds = new Set<string>();
  for (const r of rows) {
    if (r.subjectUserId) userIds.add(r.subjectUserId);
    if (r.seenByUserId) userIds.add(r.seenByUserId);
    if (r.shipmentRequestId) shipmentIds.add(r.shipmentRequestId);
    if (r.orderId) orderIds.add(r.orderId);
  }
  const shipments = shipmentIds.size
    ? await db.shipmentRequest.findMany({
        where: { id: { in: [...shipmentIds] } },
        select: { id: true, folio: true, orderId: true, order: { select: { fulfillmentMode: true } } },
      })
    : [];
  for (const s of shipments) if (s.orderId) orderIds.add(s.orderId);
  const [users, orders] = await Promise.all([
    userIds.size ? db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [],
    orderIds.size ? db.order.findMany({ where: { id: { in: [...orderIds] } }, select: { id: true, orderNumber: true } }) : [],
  ]);
  return {
    users: new Map(users.map((u) => [u.id, u])),
    shipments: new Map(
      shipments.map((s) => [
        s.id,
        {
          id: s.id,
          folio: s.folio,
          orderId: s.orderId,
          kind: s.orderId == null ? 'vault_withdrawal' : s.order?.fulfillmentMode === 'direct_ship' ? 'guest_direct_ship' : null,
        },
      ]),
    ),
    orders: new Map(orders.map((o) => [o.id, o])),
  };
}

function orderOf(r: AlertRow, refs: AlertRefs): { id: string; orderNumber: string | null } | null {
  const id = r.orderId ?? (r.shipmentRequestId ? refs.shipments.get(r.shipmentRequestId)?.orderId : null) ?? null;
  if (!id) return null;
  return refs.orders.get(id) ?? { id, orderNumber: null };
}

export function toSpendAlertDTO(r: AlertRow, refs: AlertRefs): SpendAlertDTO {
  const subject = r.subjectUserId ? { userId: r.subjectUserId, name: refs.users.get(r.subjectUserId)?.name ?? '' } : null;
  const ship = r.shipmentRequestId ? refs.shipments.get(r.shipmentRequestId) : undefined;
  return {
    id: r.id,
    code: SPEND_ALERT_CODE_OF[r.kind],
    kind: r.kind,
    severity: r.severity,
    subject,
    shipment: ship ? { id: ship.id, folio: ship.folio, kind: ship.kind } : null,
    order: orderOf(r, refs),
    amountCents: r.amountCents,
    facts: (r.facts ?? {}) as Record<string, FactValue>,
    occurrenceCount: r.occurrenceCount,
    firstOccurredAt: r.firstOccurredAt.toISOString(),
    lastOccurredAt: r.lastOccurredAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    seen:
      r.seenAt && r.seenByUserId
        ? { at: r.seenAt.toISOString(), by: { userId: r.seenByUserId, name: refs.users.get(r.seenByUserId)?.name ?? '' } }
        : null,
    mail: { status: r.mailStatus, at: r.mailedAt ? r.mailedAt.toISOString() : null },
    muted: r.muted,
  };
}

export function toMailView(r: AlertRow, refs: AlertRefs): SpendAlertMailView {
  const ship = r.shipmentRequestId ? refs.shipments.get(r.shipmentRequestId) : undefined;
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    facts: (r.facts ?? {}) as Record<string, FactValue>,
    amountCents: r.amountCents,
    subjectName: r.subjectUserId ? (refs.users.get(r.subjectUserId)?.name ?? null) : null,
    orderNumber: orderOf(r, refs)?.orderNumber ?? null,
    folio: ship?.folio ?? null,
    firstOccurredAt: r.firstOccurredAt,
  };
}

/** El `select` de una fila de aviso para el panel y el correo. */
export const ALERT_ROW_SELECT = {
  id: true,
  kind: true,
  severity: true,
  subjectUserId: true,
  shipmentRequestId: true,
  orderId: true,
  amountCents: true,
  facts: true,
  occurrenceCount: true,
  firstOccurredAt: true,
  lastOccurredAt: true,
  resolvedAt: true,
  seenAt: true,
  seenByUserId: true,
  mailStatus: true,
  mailedAt: true,
  muted: true,
} as const satisfies Prisma.SpendAlertSelect;
