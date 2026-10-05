/**
 * customer-timeline.ts — ⭐ D2e: lo que el CLIENTE ve del rastreo (API_CONTRACT §M4-SHIP.19.12 «Lo que ve el cliente», T.8,
 * criterio 243; PS-89). UN cuerpo para las tres superficies: `GuestTrackingShippingDTO` (§4-G.3), `ClientShipmentDTO` (§5) y
 * `CustomerOrderShipmentDTO` (§M4-SHIP.16).
 *
 *  - Mapeo FIJO: `created→label_created`, `picked_up|in_transit→in_transit`, `last_mile→out_for_delivery`,
 *    `delivery_attempt→delivery_attempt`, `delivered_to_branch→at_branch` (+ `branchName?`), `delivered→delivered`;
 *    `shipped` = `shippedAt`. `exception|retained|in_return|destroyed|canceled` ⇒ NO aparecen (criterio 242, por ausencia).
 *  - ⛔ Sin `detail`, sin códigos de Skydropx, sin `providerShipmentId`, sin actores: lista BLANCA de claves (`kind`, `at`, y
 *    `branchName` solo en `at_branch` y solo si vino).
 *  - Guía manual (o sin guía de Skydropx) ⇒ solo lo derivado de las fechas (`shipped`, `delivered`), como hoy.
 *  - ⭐ v1.80.12.16 (§19.35.3 (2), B-2) — `delivered`, UN cuerpo para las dos guías: evento `delivered` de la guía vigente ⇒ su
 *    `occurredAt` (la fecha del transportista); si no hay, y `deliveredAt ≠ null` ⇒ `deliveredAt` (la de la tienda: Skydropx
 *    marcada `entregado` a mano, o guía manual). ⛔ Nunca dos `delivered` (ni evento + fecha, ni dos eventos: manda el primero).
 *    El título ya dice «entregado» (`publicStatus`) y la línea no puede contradecirlo; el `AV-17` sigue mudo en ese caso (242).
 *  - ⭐ v1.80.12.17 (§19.36.2 (2), B-6) — `shipped.at = min(shippedAt, primer occurredAt de un MOVIMIENTO de la guía vigente)`
 *    (`MOVEMENT_KINDS`): «Salió» no puede quedar después de que el transportista ya lo movió. ⛔ `shippedAt` en BD no cambia.
 *  - Solo los eventos de la guía VIGENTE (`providerShipmentId` del envío): una guía re-emitida no hereda la historia de la
 *    cancelada (decisión de D2e, BACKEND_NOTES §67).
 */
import { CarrierStatus } from '@prisma/client';

export type CustomerTimelineKind =
  | 'label_created'
  | 'shipped'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivery_attempt'
  | 'at_branch'
  | 'delivered';

export interface CustomerTimelineEntry {
  kind: CustomerTimelineKind;
  at: string;
  branchName?: string;
}

const KIND_OF: Partial<Record<CarrierStatus, CustomerTimelineKind>> = {
  created: 'label_created',
  picked_up: 'in_transit',
  in_transit: 'in_transit',
  last_mile: 'out_for_delivery',
  delivery_attempt: 'delivery_attempt',
  delivered_to_branch: 'at_branch',
  delivered: 'delivered',
};

/**
 * §19.36.2 (2): los `kind` que son MOVIMIENTO del transportista (acotan `shipped.at`). ⛔ Ni `label_created` (la guía existe, el
 * paquete no se ha movido) ni los estados sin `kind` (`exception`, `retained`, …).
 */
const MOVEMENT_KINDS: ReadonlySet<CustomerTimelineKind> = new Set(['in_transit', 'out_for_delivery', 'delivery_attempt', 'at_branch', 'delivered']);

export interface TimelineEventRow {
  status: CarrierStatus;
  occurredAt: Date;
  branchName: string | null;
  providerShipmentId: string;
}

export interface TimelineShipmentRow {
  labelSource: string | null;
  providerShipmentId: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
}

/**
 * ⭐ D2e (§19.12, PS-88) — la liga de rastreo que puede viajar al cliente: SOLO la de una guía de Skydropx (ya validada por
 * `assertProviderUrl` al escribirla, SEC-SDX-5); ⛔ nunca construida con la guía (`C-SDX-6`), ⛔ nunca la de una guía manual.
 */
export function providerTrackingUrlOf(s: { labelSource?: string | null; trackingUrl?: string | null }): string | null {
  return s.labelSource === 'skydropx' && s.trackingUrl ? s.trackingUrl : null;
}

/** La selección mínima de eventos que necesita el cuerpo (para el `include` de las tres superficies). */
export const CUSTOMER_TIMELINE_EVENTS_SELECT = {
  select: { status: true, occurredAt: true, branchName: true, providerShipmentId: true },
  orderBy: [{ occurredAt: 'asc' as const }, { observedAt: 'asc' as const }],
};

export function toCustomerTimeline(events: readonly TimelineEventRow[], shipment: TimelineShipmentRow): CustomerTimelineEntry[] {
  const out: { e: CustomerTimelineEntry; t: number; i: number }[] = [];
  const push = (e: CustomerTimelineEntry, t: number) => out.push({ e, t, i: out.length });
  const fromProvider = shipment.labelSource === 'skydropx' && !!shipment.providerShipmentId;
  if (shipment.shippedAt) {
    // ⭐ v1.80.12.17 (§19.36.2 (2), B-6): «Salió» se FECHA con la cota que da el propio dato — a más tardar el primer
    // movimiento del transportista en la guía vigente. ⛔ `shippedAt` en BD no cambia; sin movimientos (o guía manual) ⇒ igual.
    let t = shipment.shippedAt.getTime();
    if (fromProvider) {
      for (const ev of events) {
        if (ev.providerShipmentId !== shipment.providerShipmentId) continue;
        const kind = KIND_OF[ev.status];
        if (kind && MOVEMENT_KINDS.has(kind)) t = Math.min(t, ev.occurredAt.getTime());
      }
    }
    // Empuja PRIMERO: en un empate con ese movimiento, `shipped` va antes (el desempate de siempre, `i`).
    push({ kind: 'shipped', at: new Date(t).toISOString() }, t);
  }
  let delivered = false;
  if (fromProvider) {
    for (const ev of events) {
      if (ev.providerShipmentId !== shipment.providerShipmentId) continue;
      const kind = KIND_OF[ev.status];
      if (!kind) continue;
      if (kind === 'delivered') {
        if (delivered) continue; // ⛔ nunca dos: manda el primero (orden `occurredAt, observedAt`)
        delivered = true;
      }
      const entry: CustomerTimelineEntry = { kind, at: ev.occurredAt.toISOString() };
      const branch = ev.branchName?.trim();
      if (kind === 'at_branch' && branch) entry.branchName = branch;
      push(entry, ev.occurredAt.getTime());
    }
  }
  if (!delivered && shipment.deliveredAt) {
    push({ kind: 'delivered', at: shipment.deliveredAt.toISOString() }, shipment.deliveredAt.getTime());
  }
  out.sort((a, b) => a.t - b.t || a.i - b.i);
  return out.map((x) => x.e);
}
