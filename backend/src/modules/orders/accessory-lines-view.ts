/**
 * accessory-lines-view.ts — las LECTURAS de los renglones de accesorio de un pedido (API_CONTRACT §AC.12, §AC.19.1,
 * §AC.19.6). PURAS: reciben lo leído y proyectan.
 *
 * - `toOrderAccessoryLineDTO`: M3 (`GET /admin/orders/:id`) y seguimiento (`POST /orders/guest/track`). Lista blanca
 *   CAMPO POR CAMPO (⛔ `spread`): ni costo, ni `snapshot`, ni `accessoryId`, ni `status`, ni `settledWithoutStock`.
 *   `deliveredRefund` SOLO si se pasa (M3); ausente en el seguimiento.
 * - Foto VIGENTE (§AC.19.1): con `Accessory.photoVersion` de HOY, ⛔ con `snapshot.photoVersion` (una foto reemplazada
 *   tras la venta daría `404`). Paquete ⇒ `null`.
 * - 💰 `accessoryAmountByQtyCents`: `[k−1] = itemMissingRefundComponents(order, k × P).amountCents` — el MISMO cuerpo que
 *   el plan de `prepared` (§AC.9) y el verbo de entregado (§AC.10 (2)).
 * - 💰 `accessoryDeliveredRefundOf`: la vista `deliveredRefund` de M3 (v1.86.2), mismo orden de guardas que el verbo.
 * - `accessoryMailLinesOf`: los renglones del correo AV-2 / confirmación de invitado — ⛔ sin foto (§AC.19.1).
 */
import type { EnergyType, OrderStatus, PriceConvention } from '@prisma/client';
import { itemMissingRefundComponents } from '../../common/money';
import { AccessoryPhotoDTO, photoDTO } from '../accessories/accessory-dto';

export type AccessoryDeliveredRefundDTO =
  | { kind: 'refundable'; refundableQty: number; amountByQtyCents: number[] }
  | { kind: 'not_refundable'; reason: 'order_not_settled' | 'not_delivered' | 'fully_refunded' | 'bundle_requires_deck' };

export interface OrderAccessoryLineDTO {
  id: string;
  kind: 'accessory' | 'energy_bundle';
  name: string;
  photo: AccessoryPhotoDTO | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  refundedQty: number;
  deckName: string | null;
  components: { energyType: EnergyType; quantity: number }[];
  deliveredRefund?: AccessoryDeliveredRefundDTO;
}

/** Lo que las lecturas leen de un `OrderAccessoryLine` (+ su accesorio vigente y sus componentes). */
export interface AccessoryLineReadRow {
  id: string;
  kind: 'accessory' | 'energy_bundle';
  quantity: number;
  unitPriceCents: number;
  refundedQty: number;
  snapshot: unknown;
  deckName: string | null;
  accessoryId: string | null;
  accessory: { id: string; photoVersion: string | null } | null;
  components: { energyType: EnergyType; quantity: number }[];
}

/** El `include` que trae lo que `AccessoryLineReadRow` necesita (una consulta por pedido, ⛔ N+1). */
export const ACCESSORY_LINE_READ_INCLUDE = {
  accessory: { select: { id: true, photoVersion: true } },
  components: { select: { energyType: true, quantity: true }, orderBy: { energyType: 'asc' as const } },
} as const;

export interface AccessoryRefundOrderMoney {
  status: OrderStatus;
  priceConvention: PriceConvention;
  subtotalCents: number;
  shippingFeeCents: number;
  processingFeeCents: number;
  ivaCents: number;
  ivaRatePct: number;
  totalCents: number;
}

/** El nombre CONGELADO del renglón (lo que se compró): `snapshot.name`; en paquete, el deck. */
export function accessoryLineNameOf(row: { kind: string; snapshot: unknown; deckName: string | null }): string {
  if (row.kind === 'energy_bundle') return row.deckName ?? '';
  const snap = (row.snapshot ?? {}) as { name?: unknown };
  return typeof snap.name === 'string' ? snap.name : '';
}

const componentsOf = (row: AccessoryLineReadRow) =>
  row.kind === 'energy_bundle' ? row.components.map((c) => ({ energyType: c.energyType, quantity: c.quantity })) : [];

/** Foto VIGENTE del accesorio; paquete o sin foto ⇒ `null`. */
export function currentAccessoryPhotoOf(row: { kind: string; accessory: { id: string; photoVersion: string | null } | null }): AccessoryPhotoDTO | null {
  if (row.kind !== 'accessory' || !row.accessory || !row.accessory.photoVersion) return null;
  return photoDTO(row.accessory.id, row.accessory.photoVersion);
}

export function toOrderAccessoryLineDTO(row: AccessoryLineReadRow, deliveredRefund?: AccessoryDeliveredRefundDTO): OrderAccessoryLineDTO {
  const dto: OrderAccessoryLineDTO = {
    id: row.id,
    kind: row.kind,
    name: accessoryLineNameOf(row),
    photo: currentAccessoryPhotoOf(row),
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    lineTotalCents: row.unitPriceCents * row.quantity,
    refundedQty: row.refundedQty,
    deckName: row.kind === 'energy_bundle' ? row.deckName : null,
    components: componentsOf(row),
  };
  if (deliveredRefund !== undefined) dto.deliveredRefund = deliveredRefund;
  return dto;
}

/** `[k−1] = itemMissingRefundComponents(order, k × P).amountCents`, k = 1..n. */
export function accessoryAmountByQtyCents(order: AccessoryRefundOrderMoney, unitPriceCents: number, n: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= n; k += 1) out.push(itemMissingRefundComponents(order, k * unitPriceCents).amountCents);
  return out;
}

/**
 * La vista de M3 (§AC.12 v1.86.2). Guardas en el orden del verbo: orden liquidada → todo reembolsado → entregado →
 * (paquete) deck reembolsado entero (P-EN-5). Paquete ⇒ entero (`refundableQty` 1).
 */
export function accessoryDeliveredRefundOf(input: {
  order: AccessoryRefundOrderMoney;
  line: { kind: 'accessory' | 'energy_bundle'; quantity: number; refundedQty: number; unitPriceCents: number };
  shipmentStatus: string | null;
  deckCovered: boolean;
}): AccessoryDeliveredRefundDTO {
  const { order, line } = input;
  if (order.status !== 'settled') return { kind: 'not_refundable', reason: 'order_not_settled' };
  const refundableQty = line.quantity - line.refundedQty;
  if (refundableQty <= 0) return { kind: 'not_refundable', reason: 'fully_refunded' };
  if (input.shipmentStatus !== 'entregado') return { kind: 'not_refundable', reason: 'not_delivered' };
  if (line.kind === 'energy_bundle' && !input.deckCovered) return { kind: 'not_refundable', reason: 'bundle_requires_deck' };
  return { kind: 'refundable', refundableQty, amountByQtyCents: accessoryAmountByQtyCents(order, line.unitPriceCents, refundableQty) };
}

export interface AccessoryMailLine {
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  deckName: string | null;
  components: { energyType: EnergyType; quantity: number }[];
}

/** Los renglones del correo: nombre, cantidad, unitario, total y, en paquete, deck y componentes. ⛔ Sin foto. */
export function accessoryMailLinesOf(rows: readonly AccessoryLineReadRow[]): AccessoryMailLine[] {
  return rows.map((r) => ({
    name: accessoryLineNameOf(r),
    quantity: r.quantity,
    unitPriceCents: r.unitPriceCents,
    lineTotalCents: r.unitPriceCents * r.quantity,
    deckName: r.kind === 'energy_bundle' ? r.deckName : null,
    components: componentsOf(r),
  }));
}
