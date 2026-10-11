/**
 * 💰 rev BSD-1, errata BSD-1.2 (API_CONTRACT §BSD.16, ARCHITECTURE §4.BSD (l)) — la guía y la tarifa del buylist en el
 * P&L de M7. Cuerpo PURO (sin Prisma): `AdminService.pnl()` lee y estas funciones deciden cuánto cuenta cada fila.
 *
 * ### Las tres reglas, en un solo sitio
 *  - **Lo retenido** a una solicitud pagada es lo que de verdad NO se le pagó: el bruto con el que se calculó el pago
 *    menos `payoutNetCents` (la columna sellada en la misma tx que `pagada`). Así cubre el `max(0, …)`: si el bruto fue
 *    menor que la tarifa, se retuvo el bruto. ⛔ Nunca `offerShippingFeeCents` a secas ni el dial.
 *  - **El costo de la guía de Skydropx de entrada** es NETO (`shippingCostCents − shippingCostIvaCents`, BSD-1.1 C-5),
 *    salvo que su cancelación esté CONFIRMADA (`providerCancelConfirmedAt`): entonces lo no devuelto ya vive en «ajustes
 *    de paquetería» (`ShipmentCostAdjustment`) y contarla aquí sería doble cuenta. Cancelación sin confirmar ⇒ cuenta.
 *  - **El costo de una guía manual** es `guideActualCostCents` tal cual (⛔ sin IVA acreditable: nadie lo capturó).
 *    Sin captura ⇒ costo 0 y la solicitud se SEÑALA (`buylistGuideCostMissingCount`), para que no pase por margen limpio.
 *
 * Una solicitud es «de Skydropx» si su fila de entrada (`SellRequest.inboundShipment`, a lo sumo una, I-BSD-3) lleva
 * `labelSource = 'skydropx'`; si no, su guía es manual.
 */
import { ShipmentLabelSource } from '@prisma/client';
import { brutoConsumado } from '../../common/buylist-aml';
import { netShippingCostCents } from '../../common/money';

/** Lo que el P&L lee de una guía de Skydropx de entrada. */
export interface InboundGuideCostRow {
  labelSource: ShipmentLabelSource | null;
  providerCancelConfirmedAt: Date | null;
  shippingCostCents: number;
  shippingCostIvaCents: number;
}

/** Lo que el P&L lee de una solicitud (pagada o con guía manual). */
export interface SellRequestGuideRow {
  approvedTotalCents: number | null;
  offerGrossCents: number | null;
  quotedTotalCents: number | null;
  payoutNetCents: number | null;
  guideSentAt: Date | null;
  guideActualCostCents: number | null;
  inboundShipment: InboundGuideCostRow | null;
}

/**
 * Lo retenido de verdad a una solicitud PAGADA. `brutoConsumado` es la MISMA cascada con la que `paySpei` calculó
 * `payoutNetCents = max(0, bruto − tarifa)` (`buylist.service.ts`, sitio (c) de §4.39i.4-bis): con `approvedTotalCents`
 * poblado es exactamente `approvedTotalCents − payoutNetCents` (§BSD.16); con él nulo, la resta del contrato no está
 * definida y se usa el bruto que de verdad se pagó. `payoutNetCents = null` (fila pre-M-46) ⇒ no se le descontó nada ⇒ 0.
 */
export function retainedShippingFeeCents(sr: Pick<SellRequestGuideRow, 'approvedTotalCents' | 'offerGrossCents' | 'quotedTotalCents' | 'payoutNetCents'>): number {
  if (sr.payoutNetCents == null) return 0;
  return brutoConsumado(sr) - sr.payoutNetCents;
}

/** ¿La fila de entrada es una guía de Skydropx? (la solicitud cuenta por (a), nunca por (b)). */
export function isSkydropxInbound(row: Pick<InboundGuideCostRow, 'labelSource'> | null): boolean {
  return row?.labelSource === 'skydropx';
}

/** (a) El costo NETO de una guía de Skydropx de entrada; 0 si su cancelación está confirmada (va a «ajustes»). */
export function skydropxInboundGuideCostCents(row: InboundGuideCostRow): number {
  if (row.providerCancelConfirmedAt != null) return 0;
  return netShippingCostCents(row);
}

/**
 * El costo de la guía de ESTA solicitud (para el margen por solicitud) y si falta su captura.
 * `missing` solo con guía MANUAL entregada (`guideSentAt`) y sin `guideActualCostCents`: una solicitud sin guía no tiene
 * costo que capturar (p. ej. las pre-M-46).
 */
export function guideCostOfRequest(sr: Pick<SellRequestGuideRow, 'guideSentAt' | 'guideActualCostCents' | 'inboundShipment'>): {
  costCents: number;
  missing: boolean;
} {
  if (sr.inboundShipment && isSkydropxInbound(sr.inboundShipment)) {
    return { costCents: skydropxInboundGuideCostCents(sr.inboundShipment), missing: false };
  }
  if (sr.guideActualCostCents != null) return { costCents: sr.guideActualCostCents, missing: false };
  return { costCents: 0, missing: sr.guideSentAt != null };
}
