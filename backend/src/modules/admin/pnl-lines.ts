/**
 * pnl-lines.ts — 💰 §REPORTES-CEO F2b (API_CONTRACT_REPORTES §3): el P&L de M7 repartido por LÍNEA DE NEGOCIO
 * (sellado · raw · gradeadas · accesorios · `unassigned` = «Sin línea»).
 *
 * ⛔ No inventa una cifra: lee los MISMOS conjuntos, con los MISMOS predicados y helpers de `common/money.ts`, que `pnlBuckets`
 * (`pnl-core.ts`) y reparte cada monto de un pedido entre las partidas de ESE pedido con la regla única de mayor residuo
 * (`pnl-allocation.ts`). Cada pedido se reparte por sí solo ⇒ la suma por línea y por periodo es exacta, y
 *   Σ(5 líneas) = total  y  total.contributionCents == profitCents del P&L plano del mismo rango (candado, sin condición).
 *
 * Qué va a dónde (contrato §3):
 *  - directo a su partida: costo de lo vendido (pieza ⇒ su `productType`; renglón de accesorio ⇒ `accessory`); reembolso con
 *    `orderItemId` ⇒ la línea de esa pieza; con `orderAccessoryLineId` ⇒ `accessory`;
 *  - por `cobrado` (todo lo demás del pedido): ingreso sin IVA, comisión de pago, envío cobrado, envío/ajustes de sus
 *    `ShipmentRequest` con `orderId`, y los reembolsos de pedido completo/resto;
 *  - descuento: por `unitDiscountCents × cantidad` (si todo es 0 ⇒ por `cobrado`);
 *  - `unassigned`: lo que no nace de un pedido de venta (retiros de bóveda, reembolsos sin pedido, buylist).
 * Una partida es cada `OrderItem` y cada `OrderAccessoryLine` del pedido (cualquier `status`: el `subtotalCents` las incluye).
 */
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  ivaIsIncluded,
  netRevenueCents,
  netShippingCostCents,
  netShippingRevenueCents,
  shipmentNetRevenueCents,
  taxBaseCentsOf,
} from '../../common/money';
import { OUTBOUND_ONLY } from '../shipments/label-subject';
import { accessoryCogsCents, buylistRowsInPeriod, makeStripeCostOf, refundRowsInPeriod } from './pnl-core';
import { isSkydropxInbound, retainedShippingFeeCents, skydropxInboundGuideCostCents } from './pnl-buylist';
import { allocateLargestRemainder, bpsOf, LineKey, PNL_LINES, Weighted } from './pnl-allocation';

type LinesDb = Pick<
  PrismaService,
  'order' | 'orderItem' | 'configSetting' | 'shipmentRequest' | 'shipmentCostAdjustment' | 'paymentRefund' | 'manualRefund' | 'sellRequest'
>;

/** Acumulador de una línea en un cubo (centavos enteros). */
export interface LineAcc {
  grossSalesCents: number;
  discountsCents: number;
  /** Mercancía neta devuelta + comisión de pago devuelta + compensaciones (el envío devuelto resta de `shippingResultCents`). */
  refundsCents: number;
  cogsCents: number;
  paymentFeeCents: number;
  /** Con signo: + = el envío dejó ganancia. Incluye, en `unassigned`, la tarifa retenida y la guía de entrada del buylist. */
  shippingResultCents: number;
}
export type LineSet = Record<LineKey, LineAcc>;

export const zeroAcc = (): LineAcc => ({ grossSalesCents: 0, discountsCents: 0, refundsCents: 0, cogsCents: 0, paymentFeeCents: 0, shippingResultCents: 0 });
export const zeroLineSet = (): LineSet => ({ sealed: zeroAcc(), raw: zeroAcc(), graded: zeroAcc(), accessory: zeroAcc(), unassigned: zeroAcc() });

export function addAcc(a: LineAcc, b: LineAcc): LineAcc {
  return {
    grossSalesCents: a.grossSalesCents + b.grossSalesCents,
    discountsCents: a.discountsCents + b.discountsCents,
    refundsCents: a.refundsCents + b.refundsCents,
    cogsCents: a.cogsCents + b.cogsCents,
    paymentFeeCents: a.paymentFeeCents + b.paymentFeeCents,
    shippingResultCents: a.shippingResultCents + b.shippingResultCents,
  };
}
export const totalOf = (s: LineSet): LineAcc => PNL_LINES.reduce((t, l) => addAcc(t, s[l]), zeroAcc());
export function addLineSets(a: LineSet, b: LineSet): LineSet {
  const o = zeroLineSet();
  for (const l of PNL_LINES) o[l] = addAcc(a[l], b[l]);
  return o;
}

/** `PnlColumn` (contrato §3): todo entero. `fixedCostsCents`/`resultCents` solo viajan en `total` (null hasta F3). */
export interface PnlColumn {
  grossSalesCents: number;
  discountsCents: number;
  refundsCents: number;
  netSalesCents: number;
  cogsCents: number;
  grossProfitCents: number;
  marginBps: number | null;
  sellingCosts: { paymentFeeCents: number; shippingResultCents: number };
  contributionCents: number;
  fixedCostsCents?: null;
  resultCents?: null;
}

export function columnOf(a: LineAcc, withFixed = false): PnlColumn {
  const netSalesCents = a.grossSalesCents - a.discountsCents - a.refundsCents;
  const grossProfitCents = netSalesCents - a.cogsCents;
  const col: PnlColumn = {
    grossSalesCents: a.grossSalesCents,
    discountsCents: a.discountsCents,
    refundsCents: a.refundsCents,
    netSalesCents,
    cogsCents: a.cogsCents,
    grossProfitCents,
    marginBps: netSalesCents > 0 ? bpsOf(grossProfitCents, netSalesCents) : null,
    sellingCosts: { paymentFeeCents: a.paymentFeeCents, shippingResultCents: a.shippingResultCents },
    contributionCents: grossProfitCents - a.paymentFeeCents + a.shippingResultCents,
  };
  if (withFixed) {
    col.fixedCostsCents = null;
    col.resultCents = null;
  }
  return col;
}

/** `Renglón` del contrato (las nueve cifras que se comparan con `Delta`). */
export const RENGLONES = ['grossSalesCents', 'discountsCents', 'refundsCents', 'netSalesCents', 'cogsCents', 'grossProfitCents', 'paymentFeeCents', 'shippingResultCents', 'contributionCents'] as const;
export type Renglon = (typeof RENGLONES)[number];
export function renglonOf(c: PnlColumn, r: Renglon): number {
  if (r === 'paymentFeeCents') return c.sellingCosts.paymentFeeCents;
  if (r === 'shippingResultCents') return c.sellingCosts.shippingResultCents;
  return c[r];
}

/** Contadores visibles en la cifra (regla AUTO): nunca listas. */
export interface LineCounters {
  costMissingCount: number;
  allocationMismatchOrders: number;
}
/** Informativos del `memo` que salen de las mismas lecturas (no suman). */
export interface LineMemo {
  insuranceCents: number;
  adjustmentsCents: number;
  retainedFeeCents: number;
  guideCostCents: number;
}

/** Una partida del pedido: pieza (`OrderItem`) o renglón de accesorio. */
export interface Partida extends Weighted {
  line: Exclude<LineKey, 'unassigned'>;
  /** Peso `cobrado`. */
  weight: number;
  /** Peso del descuento: `unitDiscountCents × cantidad`. */
  discWeight: number;
}

export function partidasOf(o: {
  items: readonly { id: string; unitPriceCents: number; unitDiscountCents: number; inventoryItem: { productType: string } }[];
  accessoryLines: readonly { id: string; quantity: number; unitPriceCents: number; unitDiscountCents: number }[];
}): Partida[] {
  const out: Partida[] = [];
  for (const it of o.items) {
    out.push({ id: it.id, line: it.inventoryItem.productType as Partida['line'], weight: it.unitPriceCents, discWeight: it.unitDiscountCents });
  }
  for (const l of o.accessoryLines) {
    out.push({ id: l.id, line: 'accessory', weight: l.unitPriceCents * l.quantity, discWeight: l.unitDiscountCents * l.quantity });
  }
  return out;
}

/** Reparte `amount` entre las partidas y lo suma a `field` de la línea de cada una; sin partidas ⇒ todo a `unassigned`. */
function spread(set: LineSet, parts: readonly Partida[], amount: number, field: keyof LineAcc, sign: 1 | -1 = 1, byDisc = false): void {
  if (amount === 0) return;
  if (parts.length === 0) {
    set.unassigned[field] += sign * amount;
    return;
  }
  const w = parts.map((p) => ({ id: p.id, weight: byDisc ? p.discWeight : p.weight }));
  const alloc = allocateLargestRemainder(amount, w);
  parts.forEach((p, i) => {
    set[p.line][field] += sign * alloc[i];
  });
}

const PARTS_SELECT = {
  id: true,
  items: { select: { id: true, unitPriceCents: true, unitDiscountCents: true, inventoryItem: { select: { productType: true } } } },
  accessoryLines: { select: { id: true, quantity: true, unitPriceCents: true, unitDiscountCents: true } },
} satisfies Prisma.OrderSelect;

const chunk = <T,>(xs: T[], n = 5000): T[][] => {
  const o: T[][] = [];
  for (let i = 0; i < xs.length; i += n) o.push(xs.slice(i, i + n));
  return o;
};

/**
 * El P&L por línea por cubos. `keyOf(fecha)` decide el cubo de cada componente con la MISMA tabla de fechas de `pnlBuckets`.
 * Un cubo sin movimientos NO aparece en el mapa. `counters`/`memo`/`estimate` son opcionales y se acumulan (todo el rango).
 */
export async function pnlLinesBuckets(
  db: LinesDb,
  range: Prisma.DateTimeFilter | undefined,
  keyOf: (d: Date | null) => string,
  opts: { estimate?: { orders: number; cents: number }; counters?: LineCounters; memo?: LineMemo } = {},
): Promise<Map<string, LineSet>> {
  const out = new Map<string, LineSet>();
  const stripeCostOf = makeStripeCostOf(db, opts.estimate);
  const at = (d: Date | null | undefined): LineSet => {
    const k = keyOf(d ?? null);
    let b = out.get(k);
    if (!b) {
      b = zeroLineSet();
      out.set(k, b);
    }
    return b;
  };
  const partsCache = new Map<string, Partida[]>();

  // 1) Pedidos liquidados del rango (mismo predicado que `pnlBuckets`). Aquí SÍ se leen los renglones de accesorio de TODO
  //    `status` (pesos), y el costo solo cuenta los `sold` (como `pnlBuckets`).
  const settledOrders = await db.order.findMany({
    where: { status: { in: ['settled', 'refunded'] }, settledAt: range ?? { not: null } },
    include: {
      items: { include: { inventoryItem: true } },
      accessoryLines: {
        select: {
          id: true,
          kind: true,
          status: true,
          quantity: true,
          unitPriceCents: true,
          unitDiscountCents: true,
          unitCostCents: true,
          shipmentLine: { select: { missingQty: true } },
          components: { select: { quantity: true, unitCostCents: true } },
        },
      },
    },
  });
  // 2) Lecturas del resto (mismos predicados que `pnlBuckets`).
  const [shipments, adjustments, refundRows, buylist] = await Promise.all([
    db.shipmentRequest.findMany({
      where: { ...OUTBOUND_ONLY, status: { in: ['picking', 'guia', 'enviado', 'entregado'] }, ...(range ? { pickingAt: range } : {}) },
    }),
    db.shipmentCostAdjustment.findMany({
      where: range ? { chargedAt: range } : {},
      select: { amountCents: true, ivaCents: true, chargedAt: true, shipmentRequest: { select: { orderId: true } } },
    }),
    refundRowsInPeriod(db, range),
    buylistRowsInPeriod(db, range),
  ]);

  // 3) A qué pedido/partida se atribuye lo que no es un pedido liquidado del rango.
  for (const o of settledOrders) partsCache.set(o.id, partidasOf(o));
  const itemIds = [...new Set(refundRows.map((r) => r.orderItemId).filter((x): x is string => !!x))];
  const refundShipIds = [...new Set(refundRows.map((r) => r.shipmentRequestId).filter((x): x is string => !!x))];
  const itemInfo = new Map<string, { line: Partida['line'] }>();
  for (const ids of chunk(itemIds)) {
    for (const it of await db.orderItem.findMany({ where: { id: { in: ids } }, select: { id: true, inventoryItem: { select: { productType: true } } } })) {
      itemInfo.set(it.id, { line: it.inventoryItem.productType as Partida['line'] });
    }
  }
  const shipOrder = new Map<string, string | null>();
  for (const ids of chunk(refundShipIds)) {
    for (const s of await db.shipmentRequest.findMany({ where: { id: { in: ids } }, select: { id: true, orderId: true } })) shipOrder.set(s.id, s.orderId);
  }
  const wanted = new Set<string>();
  for (const s of shipments) if (s.orderId) wanted.add(s.orderId);
  for (const a of adjustments) if (a.shipmentRequest.orderId) wanted.add(a.shipmentRequest.orderId);
  for (const r of refundRows) {
    if (r.orderId) wanted.add(r.orderId);
    const so = r.shipmentRequestId ? shipOrder.get(r.shipmentRequestId) : null;
    if (so) wanted.add(so);
  }
  for (const ids of chunk([...wanted].filter((id) => !partsCache.has(id)))) {
    for (const o of await db.order.findMany({ where: { id: { in: ids } }, select: PARTS_SELECT })) partsCache.set(o.id, partidasOf(o));
  }
  const partsOf = (orderId: string | null | undefined): Partida[] => (orderId ? (partsCache.get(orderId) ?? []) : []);

  // 4) Pedidos liquidados.
  for (const o of settledOrders) {
    const set = at(o.settledAt);
    const parts = partsCache.get(o.id)!;
    if (opts.counters && parts.reduce((s, p) => s + p.weight, 0) !== o.subtotalCents) opts.counters.allocationMismatchOrders += 1;
    // Ingreso sin IVA y descuento sin IVA (bruto − descuento = neto, exacto).
    const net = netRevenueCents(o);
    const discountNet = ivaIsIncluded(o.priceConvention)
      ? taxBaseCentsOf(o.subtotalCents + o.discountCents, o.ivaRatePct) - taxBaseCentsOf(o.subtotalCents, o.ivaRatePct)
      : o.discountCents;
    if (parts.length === 0) {
      set.unassigned.grossSalesCents += net + discountNet;
      set.unassigned.discountsCents += discountNet;
    } else {
      const netA = allocateLargestRemainder(net, parts);
      const useDisc = parts.some((p) => p.discWeight > 0);
      const discA = allocateLargestRemainder(
        discountNet,
        parts.map((p) => ({ id: p.id, weight: useDisc ? p.discWeight : p.weight })),
      );
      parts.forEach((p, i) => {
        set[p.line].grossSalesCents += netA[i] + discA[i];
        set[p.line].discountsCents += discA[i];
      });
    }
    spread(set, parts, await stripeCostOf(o), 'paymentFeeCents');
    if (o.fulfillmentMode === 'direct_ship') spread(set, parts, netShippingRevenueCents(o), 'shippingResultCents');
    // Costo de lo vendido: directo a la línea de su partida (mismo neto de IVA que `pnlBuckets`).
    for (const it of o.items) {
      if (it.inventoryItem.acquisitionCostCents == null && opts.counters) opts.counters.costMissingCount += 1;
      set[it.inventoryItem.productType].cogsCents += (it.inventoryItem.acquisitionCostCents ?? 0) - (it.inventoryItem.acquisitionCostIvaCents ?? 0);
    }
    set.accessory.cogsCents += accessoryCogsCents(o.accessoryLines.filter((l) => l.status === 'sold'));
  }

  // 5) Envíos (retiros de bóveda y fulfillment): con `orderId` ⇒ por `cobrado` de ese pedido; sin pedido ⇒ `unassigned`.
  for (const s of shipments) {
    const set = at(s.pickingAt);
    const parts = partsOf(s.orderId);
    spread(set, parts, shipmentNetRevenueCents(s), 'shippingResultCents');
    spread(set, parts, netShippingCostCents(s), 'shippingResultCents', -1);
    spread(set, parts, await stripeCostOf(s), 'paymentFeeCents');
    if (opts.memo) opts.memo.insuranceCents += s.insuranceCostCents ?? 0;
  }
  for (const a of adjustments) {
    const net = a.amountCents - a.ivaCents;
    spread(at(a.chargedAt), partsOf(a.shipmentRequest.orderId), net, 'shippingResultCents', -1);
    if (opts.memo) opts.memo.adjustmentsCents += net;
  }

  // 6) Reembolsos: la mercancía (+ comisión devuelta + compensación) a `refundsCents`; el envío neto resta de `shippingResultCents`.
  for (const r of refundRows) {
    const set = at(r.at);
    const merch = r.merchNetCents + r.processingFeeCents + r.compensationCents;
    const itemLine = r.orderItemId ? itemInfo.get(r.orderItemId) : undefined;
    if (itemLine) {
      set[itemLine.line].refundsCents += merch;
      set[itemLine.line].shippingResultCents -= r.shippingNetCents;
    } else if (r.orderAccessoryLineId) {
      set.accessory.refundsCents += merch;
      set.accessory.shippingResultCents -= r.shippingNetCents;
    } else {
      const orderId = r.orderId ?? (r.shipmentRequestId ? shipOrder.get(r.shipmentRequestId) : null) ?? null;
      const parts = partsOf(orderId);
      spread(set, parts, merch, 'refundsCents');
      spread(set, parts, r.shippingNetCents, 'shippingResultCents', -1);
    }
  }

  // 7) Buylist: todo `unassigned` (tarifa retenida +, guía de entrada −).
  for (const g of buylist.skydropxGuides) {
    const c = skydropxInboundGuideCostCents(g);
    at(g.labelPurchasedAt).unassigned.shippingResultCents -= c;
    if (opts.memo) opts.memo.guideCostCents += c;
  }
  for (const sr of buylist.manualGuides) {
    if (isSkydropxInbound(sr.inboundShipment)) continue;
    const c = sr.guideActualCostCents ?? 0;
    at(sr.guideSentAt ?? sr.shipmentConfirmedAt).unassigned.shippingResultCents -= c;
    if (opts.memo) opts.memo.guideCostCents += c;
  }
  for (const sr of buylist.paid) {
    const retained = retainedShippingFeeCents(sr);
    at(sr.paidAt).unassigned.shippingResultCents += retained;
    if (opts.memo) opts.memo.retainedFeeCents += retained;
  }
  return out;
}

