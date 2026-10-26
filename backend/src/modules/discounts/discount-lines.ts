/**
 * discount-lines.ts — 💰 el PUENTE entre las líneas del checkout y la aritmética del descuento (§DSC.2–§DSC.3), y el
 * PROYECTOR ÚNICO de la línea con rebaja (§DSC.6 v1.110.3). Puro.
 *
 * Ids de línea (únicos dentro del carrito; el orden canónico del reparto lo pone `allocateDiscount` por `group` + `id`):
 *  - pieza ⇒ su `inventoryItemId` (`group: 'piece'`, tipo = `productType`);
 *  - renglón de accesorio suelto ⇒ `acc:<accessoryId>:<índice>` (`group: 'accessory'`, tipo `accessory`, energía incluida);
 *  - paquete de energías ⇒ `bundle:<índice>` (`group: 'bundle'`, tipo `energy_bundle`: ⛔ nunca elegible [D9]).
 *
 * Dos verbos, dos papeles (⛔ no se mezclan):
 *  - `chargedPieceLine` / `chargedAccessoryLine`: del precio EXHIBIDO a lo COBRADO (I-3) — la fila que se PERSISTE
 *    (`OrderItem`, `OrderAccessoryLine`) y la base del DTO del quote vivo.
 *  - `projectLineDiscount`: sobre una línea YA cobrada, los campos de lectura `unitDiscountCents`,
 *    `unitPriceBeforeDiscountCents` y, si la línea trae `lineTotalCents`, `lineTotalBeforeDiscountCents`; SOLO con rebaja > 0
 *    (I-1: sin rebaja, ni el campo). Quotes, sesiones, detalles, seguimiento, orden congelada y correos pasan por aquí.
 */
import { ProductType } from '@prisma/client';
import type { DiscountCartLine, DiscountLineType } from '../../common/money';

/** Los campos de lectura de una línea con rebaja (§DSC.6 v1.110.3). Todos presentes o todos ausentes. */
export interface LineDiscountProjection {
  unitDiscountCents?: number;
  unitPriceBeforeDiscountCents?: number;
  lineTotalBeforeDiscountCents?: number;
}

/**
 * EL proyector: `line.unitPriceCents` es lo COBRADO por unidad y `unitDiscountCents` su rebaja congelada. Con rebaja > 0:
 * `unitPriceBeforeDiscountCents = cobrado + rebaja` y, si la línea lleva `lineTotalCents`, `lineTotalBeforeDiscountCents =
 * quantity × (cobrado + rebaja)`. Sin rebaja ⇒ la línea tal cual (⛔ ni `0` ni `null`).
 */
export function projectLineDiscount<T extends { unitPriceCents: number; quantity?: number; lineTotalCents?: number }>(
  line: T,
  unitDiscountCents: number | null | undefined,
): T & LineDiscountProjection {
  const u = unitDiscountCents ?? 0;
  if (u <= 0) return line;
  const before = line.unitPriceCents + u;
  return {
    ...line,
    unitDiscountCents: u,
    unitPriceBeforeDiscountCents: before,
    ...(line.lineTotalCents !== undefined ? { lineTotalBeforeDiscountCents: before * (line.quantity ?? 1) } : {}),
  };
}

/**
 * TL-DSC-3 — el tipo de cada pieza para el filtro `productScopes`. Una línea sin su pieza en `items` es un defecto del
 * llamador: ⛔ no se adivina (`sealed` en silencio cambiaba la elegibilidad y el envío), se LANZA.
 */
export function pieceDiscountLines(
  items: readonly { id: string; productType: ProductType }[],
  lines: readonly { inventoryItemId: string; unitPriceCents: number }[],
): DiscountCartLine[] {
  const typeOf = new Map(items.map((i) => [i.id, i.productType]));
  return lines.map((l) => {
    const type = typeOf.get(l.inventoryItemId);
    if (type === undefined) throw new Error(`pieceDiscountLines: la línea ${l.inventoryItemId} no tiene su pieza (TL-DSC-3)`);
    return { id: l.inventoryItemId, group: 'piece' as const, type: type as DiscountLineType, unitPriceCents: l.unitPriceCents, quantity: 1 };
  });
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
 * La FILA de pieza ya descontada (I-3): `unitPriceCents` = lo COBRADO y `unitDiscountCents` SOLO si > 0 (la columna de
 * `OrderItem`; sin descuento, el `INSERT` de hoy). ⛔ No lleva los campos de lectura: eso es `projectLineDiscount`.
 */
export function chargedPieceLine<T extends { inventoryItemId: string; unitPriceCents: number }>(
  line: T,
  unitDiscount: ReadonlyMap<string, number>,
): T & { unitDiscountCents?: number } {
  const u = unitDiscount.get(line.inventoryItemId) ?? 0;
  return u > 0 ? { ...line, unitPriceCents: line.unitPriceCents - u, unitDiscountCents: u } : line;
}

/** El renglón de accesorio de índice `i` del quote/sesión vivo: cobrado (con su `lineTotalCents`) y proyectado. */
export function discountedAccessoryLine<T extends { accessoryId: string; unitPriceCents: number; quantity: number; lineTotalCents?: number }>(
  line: T,
  index: number,
  unitDiscount: ReadonlyMap<string, number>,
): T & LineDiscountProjection {
  const u = unitDiscount.get(accessoryLineId(line.accessoryId, index)) ?? 0;
  if (u <= 0) return line;
  const unitPriceCents = line.unitPriceCents - u;
  const charged = { ...line, unitPriceCents, ...(line.lineTotalCents !== undefined ? { lineTotalCents: unitPriceCents * line.quantity } : {}) };
  return projectLineDiscount(charged, u);
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
): T & LineDiscountProjection {
  const f = frozen.get(line.accessoryId);
  if (!f || f.unitDiscountCents <= 0) return line;
  const charged = {
    ...line,
    unitPriceCents: f.unitPriceCents,
    ...(line.lineTotalCents !== undefined ? { lineTotalCents: f.unitPriceCents * line.quantity } : {}),
  };
  return projectLineDiscount(charged, f.unitDiscountCents);
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
