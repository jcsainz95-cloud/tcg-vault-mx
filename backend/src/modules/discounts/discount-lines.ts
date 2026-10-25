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
