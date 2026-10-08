/**
 * accessory-prep.ts — 💰 los RENGLONES DE ACCESORIO en «Pedidos por preparar» (API_CONTRACT §AC.9, §AC.19.5).
 *
 * - `loadAccessoryPrepLines`: las `ShipmentAccessoryLine` de un envío directo con su renglón, su accesorio VIGENTE (la
 *   foto de hoy, §AC.19.1), los componentes del paquete, su fila de faltante (`acc-item:<id>`) y lo que el plan necesita.
 * - `ShipAccessoryLineDTO` (§AC.9 + v1.86.1 + §AC.19.5): el `refund` lo calcula el SERVIDOR con el MISMO cuerpo que el
 *   plan de `prepared` (`itemMissingRefundComponents(order, k × P)`), así el número que ve el operador es el que se escribe.
 *   ⛔ La pantalla no lo calcula. `deckShipmentItemIds` / `deckAllMissing`: lectura derivada para la SUGERENCIA de la
 *   pantalla (el servidor no marca ni reembolsa nada por ese campo).
 * - `parseAccessoryMarkBody`: el paso 1 del `PATCH …/prep-accessory-lines/:lineId` (dominio ⇒ `400 {field}`).
 *
 * ⛔ Conteos: `ShipPreparationCounts` sigue contando SOLO cartas (§AC.19.5); los renglones se cuentan desde
 * `accessoryLines[].prepStatus`.
 */
import { EnergyType, MissingReason, PaymentRefund, PreparationItemStatus, Prisma } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { MISSING_REASON_VALUES, PREPARATION_ITEM_STATUS_VALUES } from '../../common/enum-values';
import { AccessoryPhotoDTO } from '../accessories/accessory-dto';
import {
  ACCESSORY_LINE_READ_INCLUDE,
  AccessoryRefundOrderMoney,
  accessoryAmountByQtyCents,
  accessoryLineNameOf,
  currentAccessoryPhotoOf,
} from '../orders/accessory-lines-view';
import type { PaymentRefundDTO } from '../payments/refunds/refund-ledger.service';

type Db = Prisma.TransactionClient;

export type ShipAccessoryLineRefund =
  | { kind: 'refundable'; amountByQtyCents: number[]; amountCents: number }
  | { kind: 'refunded'; refund: PaymentRefundDTO }
  | { kind: 'not_refundable'; reason: 'order_not_settled' };

export interface ShipAccessoryLineDTO {
  id: string;
  kind: 'accessory' | 'energy_bundle';
  name: string;
  photo: AccessoryPhotoDTO | null;
  quantity: number;
  deckName: string | null;
  components: { energyType: EnergyType; quantity: number }[];
  prepStatus: PreparationItemStatus;
  missingQty: number;
  missingReason: MissingReason | null;
  settledWithoutStock: boolean;
  refunded: boolean;
  refund: ShipAccessoryLineRefund;
  deckShipmentItemIds: string[];
  deckAllMissing: boolean;
}

/** Lo que los verbos deciden (interno; la DTO es `ShipAccessoryLineDTO`). */
export interface AccessoryPrepLine {
  dto: ShipAccessoryLineDTO;
  id: string;
  orderAccessoryLineId: string;
  kind: 'accessory' | 'energy_bundle';
  quantity: number;
  unitPriceCents: number;
  refundedQty: number;
  prepStatus: PreparationItemStatus;
  missingQty: number;
  missingReason: MissingReason | null;
  refundRow: PaymentRefund | null;
}

/** Las líneas de carta del MISMO envío, como las ve la vista (para `deckShipmentItemIds` / `deckAllMissing`). */
export interface CardLineLite {
  shipmentItemId: string;
  inventoryItemId: string;
  prepStatus: PreparationItemStatus;
  available: boolean;
}

/**
 * Las líneas de accesorio de un envío DIRECTO, en orden de alta. Tres consultas (líneas, filas del libro, piezas del
 * deck), ⛔ sin N+1. `order` = las columnas de dinero de la orden del envío.
 */
export async function loadAccessoryPrepLines(
  db: Db,
  shipmentId: string,
  order: AccessoryRefundOrderMoney,
  cards: readonly CardLineLite[],
  toDtos: (rows: PaymentRefund[]) => Promise<PaymentRefundDTO[]>,
): Promise<AccessoryPrepLine[]> {
  const sal = await db.shipmentAccessoryLine.findMany({
    where: { shipmentRequestId: shipmentId },
    include: { orderAccessoryLine: { include: ACCESSORY_LINE_READ_INCLUDE } },
    orderBy: [{ orderAccessoryLine: { createdAt: 'asc' } }, { id: 'asc' }],
  });
  if (sal.length === 0) return [];
  const refundRows = await db.paymentRefund.findMany({ where: { shipmentAccessoryLineId: { in: sal.map((l) => l.id) } } });
  const refundDtos = await toDtos(refundRows);
  const refundByLine = new Map(refundRows.map((r, i) => [r.shipmentAccessoryLineId as string, { row: r, dto: refundDtos[i] }]));
  const deckOrderItemIds = [...new Set(sal.flatMap((l) => l.orderAccessoryLine.deckOrderItemIds ?? []))];
  const deckPieces = deckOrderItemIds.length
    ? await db.orderItem.findMany({ where: { id: { in: deckOrderItemIds } }, select: { id: true, inventoryItemId: true } })
    : [];
  const pieceOfOrderItem = new Map(deckPieces.map((p) => [p.id, p.inventoryItemId]));
  return sal.map((l) => {
    const oal = l.orderAccessoryLine;
    const kind = oal.kind as 'accessory' | 'energy_bundle';
    const rf = refundByLine.get(l.id) ?? null;
    let refund: ShipAccessoryLineRefund;
    if (rf) refund = { kind: 'refunded', refund: rf.dto };
    else if (order.status !== 'settled') refund = { kind: 'not_refundable', reason: 'order_not_settled' };
    else {
      // Paquete: un solo elemento (P-AC-3, entero). Suelto: k = 1..quantity.
      const amountByQtyCents = accessoryAmountByQtyCents(order, oal.unitPriceCents, kind === 'energy_bundle' ? 1 : l.quantity);
      const k = l.prepStatus === 'missing' ? l.missingQty : l.quantity;
      refund = { kind: 'refundable', amountByQtyCents, amountCents: amountByQtyCents[Math.min(Math.max(k, 1), amountByQtyCents.length) - 1] };
    }
    let deckShipmentItemIds: string[] = [];
    let deckAllMissing = false;
    if (kind === 'energy_bundle') {
      const pieces = new Set((oal.deckOrderItemIds ?? []).map((id) => pieceOfOrderItem.get(id)).filter((x): x is string => !!x));
      const mine = cards.filter((c) => pieces.has(c.inventoryItemId));
      deckShipmentItemIds = mine.map((c) => c.shipmentItemId);
      deckAllMissing = mine.length > 0 && mine.every((c) => c.prepStatus === 'missing' || !c.available);
    }
    const dto: ShipAccessoryLineDTO = {
      id: l.id,
      kind,
      // §AC.19.5: en paquete `name = deckName` (el título lo pone la pantalla por `kind`); en suelto, `snapshot.name`.
      name: accessoryLineNameOf(oal),
      photo: currentAccessoryPhotoOf(oal),
      quantity: l.quantity,
      deckName: kind === 'energy_bundle' ? oal.deckName : null,
      components: kind === 'energy_bundle' ? oal.components.map((c) => ({ energyType: c.energyType, quantity: c.quantity })) : [],
      prepStatus: l.prepStatus,
      missingQty: l.missingQty,
      missingReason: l.missingReason,
      settledWithoutStock: oal.settledWithoutStock,
      refunded: refund.kind === 'refunded',
      refund,
      deckShipmentItemIds,
      deckAllMissing,
    };
    return {
      dto,
      id: l.id,
      orderAccessoryLineId: oal.id,
      kind,
      quantity: l.quantity,
      unitPriceCents: oal.unitPriceCents,
      refundedQty: oal.refundedQty,
      prepStatus: l.prepStatus,
      missingQty: l.missingQty,
      missingReason: l.missingReason,
      refundRow: rf?.row ?? null,
    };
  });
}

export interface AccessoryMark {
  status: PreparationItemStatus;
  missingQty?: number;
  missingReason?: MissingReason;
}

/** Paso 1 (forma): `status` del enum; `missing` exige `missingQty` entero y `missingReason`; con `pending|picked` ⛔ ninguno. */
export function parseAccessoryMarkBody(body: unknown): AccessoryMark {
  const b = (typeof body === 'object' && body !== null ? body : {}) as { status?: unknown; missingQty?: unknown; missingReason?: unknown };
  const allowed = PREPARATION_ITEM_STATUS_VALUES as string[];
  if (typeof b.status !== 'string' || !allowed.includes(b.status)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid preparation status', { field: 'status', allowed });
  }
  const status = b.status as PreparationItemStatus;
  const reasons = MISSING_REASON_VALUES as string[];
  const hasQty = b.missingQty !== undefined && b.missingQty !== null;
  const hasReason = b.missingReason !== undefined && b.missingReason !== null;
  if (status !== 'missing') {
    if (hasQty) throw BusinessException.badRequest('VALIDATION_ERROR', 'missingQty only applies to status=missing', { field: 'missingQty' });
    if (hasReason) throw BusinessException.badRequest('VALIDATION_ERROR', 'missingReason only applies to status=missing', { field: 'missingReason' });
    return { status };
  }
  if (typeof b.missingQty !== 'number' || !Number.isInteger(b.missingQty) || b.missingQty < 1) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'missingQty is required with status=missing (1..quantity)', { field: 'missingQty' });
  }
  if (typeof b.missingReason !== 'string' || !reasons.includes(b.missingReason)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', 'missingReason is required with status=missing', { field: 'missingReason', allowed: reasons });
  }
  return { status, missingQty: b.missingQty, missingReason: b.missingReason as MissingReason };
}

/** Paso 1 (con la línea): `missingQty ≤ quantity`; en paquete, solo `1` (P-AC-3: el paquete entero). */
export function assertMarkFitsLine(mark: AccessoryMark, line: { kind: string; quantity: number }): void {
  if (mark.status !== 'missing') return;
  const max = line.kind === 'energy_bundle' ? 1 : line.quantity;
  if ((mark.missingQty as number) > max) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `missingQty must be 1..${max}`, { field: 'missingQty', max });
  }
}

/** Σ asegurado de los renglones (§AC.9 «Seguro», criterio 714): `(quantity − missingQty) × P` de `picked|missing`. */
export function accessoryInsuredCents(lines: readonly Pick<AccessoryPrepLine, 'prepStatus' | 'quantity' | 'missingQty' | 'unitPriceCents'>[]): number {
  return lines
    .filter((l) => l.prepStatus === 'picked' || l.prepStatus === 'missing')
    .reduce((a, l) => a + Math.max(0, l.quantity - l.missingQty) * l.unitPriceCents, 0);
}
