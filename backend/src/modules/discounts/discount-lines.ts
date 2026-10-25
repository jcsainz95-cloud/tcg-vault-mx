/**
 * discount-lines.ts — 💰 el PUENTE entre las líneas del checkout y la aritmética del descuento (§DSC.2–§DSC.3). Puro.
 *
 * Ids de línea (únicos dentro del carrito; el orden canónico del reparto lo pone `allocateDiscount` por `group` + `id`):
 *  - pieza ⇒ su `inventoryItemId` (`group: 'piece'`, tipo = `productType`);
 *  - renglón de accesorio suelto ⇒ `acc:<accessoryId>:<índice>` (`group: 'accessory'`, tipo `accessory`, energía incluida);
 *  - paquete de energías ⇒ `bundle:<índice>` (`group: 'bundle'`, tipo `energy_bundle`: ⛔ nunca elegible [D9]).
 */
import { ProductType } from '@prisma/client';
import type { DiscountCartLine, DiscountLineType } from '../../common/money';

export function pieceDiscountLines(
  items: readonly { id: string; productType: ProductType }[],
  lines: readonly { inventoryItemId: string; unitPriceCents: number }[],
): DiscountCartLine[] {
  const typeOf = new Map(items.map((i) => [i.id, i.productType]));
  return lines.map((l) => ({
    id: l.inventoryItemId,
    group: 'piece' as const,
    type: (typeOf.get(l.inventoryItemId) ?? 'sealed') as DiscountLineType,
    unitPriceCents: l.unitPriceCents,
    quantity: 1,
  }));
}

export const accessoryLineId = (accessoryId: string, index: number) => `acc:${accessoryId}:${index}`;

export function accessoryDiscountLines(lines: readonly { accessoryId: string; unitPriceCents: number; quantity: number }[]): DiscountCartLine[] {
  return lines.map((l, i) => ({
    id: accessoryLineId(l.accessoryId, i),
    group: 'accessory' as const,
    type: 'accessory' as const,
    unitPriceCents: l.unitPriceCents,
    quantity: l.quantity,
  }));
}

export function bundleDiscountLines(bundles: readonly { priceCents: number }[]): DiscountCartLine[] {
  return bundles.map((b, i) => ({ id: `bundle:${i}`, group: 'bundle' as const, type: 'energy_bundle' as const, unitPriceCents: b.priceCents, quantity: 1 }));
}

/**
 * La línea de pieza YA descontada (I-3): `unitPriceCents` = lo COBRADO y `unitDiscountCents` SOLO si > 0 (I-1: sin
 * descuento, ni el campo). Sirve igual para la fila `OrderItem` y para el DTO del quote.
 */
export function discountedPieceLine<T extends { inventoryItemId: string; unitPriceCents: number }>(
  line: T,
  unitDiscount: ReadonlyMap<string, number>,
): T & { unitDiscountCents?: number } {
  const u = unitDiscount.get(line.inventoryItemId) ?? 0;
  return u > 0 ? { ...line, unitPriceCents: line.unitPriceCents - u, unitDiscountCents: u } : line;
}

/** Lo mismo para un renglón de accesorio de índice `i` (con su `lineTotalCents` si lo trae). */
export function discountedAccessoryLine<T extends { accessoryId: string; unitPriceCents: number; quantity: number; lineTotalCents?: number }>(
  line: T,
  index: number,
  unitDiscount: ReadonlyMap<string, number>,
): T & { unitDiscountCents?: number } {
  const u = unitDiscount.get(accessoryLineId(line.accessoryId, index)) ?? 0;
  if (u <= 0) return line;
  const unitPriceCents = line.unitPriceCents - u;
  return {
    ...line,
    unitPriceCents,
    ...(line.lineTotalCents !== undefined ? { lineTotalCents: unitPriceCents * line.quantity } : {}),
    unitDiscountCents: u,
  };
}

/** La rebaja congelada de un renglón suelto: lo COBRADO por unidad y su `unitDiscountCents`. */
export type FrozenAccessoryPrice = { unitPriceCents: number; unitDiscountCents: number };

/**
 * v1.110.1 (§DSC.6, DCO-B5) — el quote que devuelve el CONGELADO de la orden propia con su mismo código: el renglón de
 * accesorio sale de `OrderAccessoryLine` (lo COBRADO y su `unitDiscountCents`), ⛔ no del precio de hoy. Solo se anota si la
 * fila congelada lleva rebaja (> 0); sin rebaja, el renglón es el de hoy (I-1).
 */
export function frozenAccessoryLine<T extends { accessoryId: string; unitPriceCents: number; quantity: number; lineTotalCents?: number }>(
  line: T,
  frozen: ReadonlyMap<string, FrozenAccessoryPrice>,
): T & { unitDiscountCents?: number } {
  const f = frozen.get(line.accessoryId);
  if (!f || f.unitDiscountCents <= 0) return line;
  return {
    ...line,
    unitPriceCents: f.unitPriceCents,
    ...(line.lineTotalCents !== undefined ? { lineTotalCents: f.unitPriceCents * line.quantity } : {}),
    unitDiscountCents: f.unitDiscountCents,
  };
}

/** Las filas sueltas congeladas de una orden, por accesorio (un accesorio en dos filas ⇒ fuera: ambiguo, se queda el de hoy). */
export function frozenAccessoryMapOf(
  rows: readonly { kind: string; accessoryId: string | null; unitPriceCents: number; unitDiscountCents: number }[],
): Map<string, FrozenAccessoryPrice> {
  const out = new Map<string, FrozenAccessoryPrice>();
  const dup = new Set<string>();
  for (const r of rows) {
    if (r.kind !== 'accessory' || !r.accessoryId) continue;
    if (out.has(r.accessoryId)) dup.add(r.accessoryId);
    out.set(r.accessoryId, { unitPriceCents: r.unitPriceCents, unitDiscountCents: r.unitDiscountCents });
  }
  for (const id of dup) out.delete(id);
  return out;
}
