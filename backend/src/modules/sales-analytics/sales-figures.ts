/**
 * sales-figures.ts — 💰 una definición por cifra (API_CONTRACT §15.3 / §15.4). Puro: entra lo leído de la base, sale el DTO.
 *
 * ⛔ El ingreso sin IVA pasa por `netRevenueCents` de `common/money.ts` — el MISMO helper que M7 (criterio 602). ⛔ Nada de
 * fórmulas propias del IVA aquí: la venta por renglón de «lo más vendido» usa `ivaIsIncluded` + `taxBaseCentsOf`, también de
 * `money.ts`.
 */
import { FulfillmentMode, OrderStatus, PriceConvention } from '@prisma/client';
import { netRevenueCents } from '../../common/money';
import type { PnlComponents } from '../admin/pnl-core';
import type { RefundRow } from '../admin/pnl-core';

/** Lo que se lee de un pedido R-2 (columnas enumeradas). */
export interface OrderLite {
  id: string;
  settledAt: Date;
  status: OrderStatus;
  totalCents: number;
  subtotalCents: number;
  ivaRatePct: number;
  priceConvention: PriceConvention;
  fulfillmentMode: FulfillmentMode;
  guestEmail: string | null;
  pieces: number;
}

export interface Delta {
  diff: number | null;
  pct: number | null;
}

export interface SalesFigures {
  orders: number;
  chargedCents: number;
  netSalesCents: number;
  refunds: {
    count: number;
    amountCents: number;
    netCents: number;
    byChannel: { card: { count: number; amountCents: number }; spei: { count: number; amountCents: number } };
  };
  netSalesAfterRefundsCents: number;
  pieces: number;
  avgTicketCents: number | null;
  piecesPerOrder: number | null;
  shipping: { chargedNetCents: number; costNetCents: number; costMissingCount: number; adjustmentsCents: number; resultNetCents: number };
  buylist: { paidCount: number; paidNetCents: number; paidWithoutPayoutCount: number };
  profitCents: number;
}

/** Un acumulador de cubo (las cifras aditivas). Las derivadas se calculan al cerrar (`finish`). */
export interface FiguresAcc {
  orders: number;
  chargedCents: number;
  netSalesCents: number;
  pieces: number;
  refundCount: number;
  refundAmountCents: number;
  refundNetCents: number;
  cardCount: number;
  cardAmountCents: number;
  speiCount: number;
  speiAmountCents: number;
  pnl: PnlComponents | null;
  buylistPaidCount: number;
  buylistPaidNetCents: number;
  buylistWithoutPayout: number;
}

export function emptyAcc(): FiguresAcc {
  return {
    orders: 0,
    chargedCents: 0,
    netSalesCents: 0,
    pieces: 0,
    refundCount: 0,
    refundAmountCents: 0,
    refundNetCents: 0,
    cardCount: 0,
    cardAmountCents: 0,
    speiCount: 0,
    speiAmountCents: 0,
    pnl: null,
    buylistPaidCount: 0,
    buylistPaidNetCents: 0,
    buylistWithoutPayout: 0,
  };
}

/** R-2: un pedido cobrado suma al cubo de su `settledAt` (cualquier estado de hoy). */
export function addOrder(acc: FiguresAcc, o: OrderLite): void {
  acc.orders += 1;
  acc.chargedCents += o.totalCents;
  acc.netSalesCents += netRevenueCents(o);
  acc.pieces += o.pieces;
}

/** R-3: un reembolso suma al cubo de SU día (⛔ nunca mueve el día del pedido). */
export function addRefund(acc: FiguresAcc, r: RefundRow): void {
  acc.refundCount += 1;
  acc.refundAmountCents += r.amountCents;
  acc.refundNetCents += r.netCents;
  if (r.channel === 'card') {
    acc.cardCount += 1;
    acc.cardAmountCents += r.amountCents;
  } else {
    acc.speiCount += 1;
    acc.speiAmountCents += r.amountCents;
  }
}

/** 623: una `SellRequest` `pagada` en su día de `paidAt`; sin `payoutNetCents` ⇒ se CUENTA aparte (⛔ no es 0 silencioso). */
export function addBuylist(acc: FiguresAcc, payoutNetCents: number | null): void {
  acc.buylistPaidCount += 1;
  if (payoutNetCents === null) acc.buylistWithoutPayout += 1;
  else acc.buylistPaidNetCents += payoutNetCents;
}

/** `round(a / b)` con la mitad hacia arriba, en enteros (a ≥ 0, b > 0). */
export function roundHalfUp(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/** Cierra un cubo: las cifras derivadas sobre SUS totales (⛔ nunca promediando filas). */
export function finish(acc: FiguresAcc): SalesFigures {
  const p = acc.pnl;
  return {
    orders: acc.orders,
    chargedCents: acc.chargedCents,
    netSalesCents: acc.netSalesCents,
    refunds: {
      count: acc.refundCount,
      amountCents: acc.refundAmountCents,
      netCents: acc.refundNetCents,
      byChannel: {
        card: { count: acc.cardCount, amountCents: acc.cardAmountCents },
        spei: { count: acc.speiCount, amountCents: acc.speiAmountCents },
      },
    },
    netSalesAfterRefundsCents: acc.netSalesCents - acc.refundNetCents,
    pieces: acc.pieces,
    // Criterio 604: con 0 pedidos, `null` (⛔ ni 0, ni NaN, ni Infinity).
    avgTicketCents: acc.orders === 0 ? null : roundHalfUp(acc.chargedCents, acc.orders),
    piecesPerOrder: acc.orders === 0 ? null : roundHalfUp(acc.pieces * 10, acc.orders) / 10,
    shipping: {
      chargedNetCents: p?.shippingRevenueCents ?? 0,
      costNetCents: p?.shippingCostCents ?? 0,
      costMissingCount: p?.shippingCostMissingCount ?? 0,
      adjustmentsCents: p?.shippingAdjustmentsCents ?? 0,
      // ⭐ AN-1.1 (§15.11.3): cobrado neto − costo neto del MISMO cubo. Los ajustes YA van dentro del costo: ⛔ no se
      // restan otra vez. Puede ser negativo; con costos sin capturar se emite igual (cota superior).
      resultNetCents: (p?.shippingRevenueCents ?? 0) - (p?.shippingCostCents ?? 0),
    },
    buylist: { paidCount: acc.buylistPaidCount, paidNetCents: acc.buylistPaidNetCents, paidWithoutPayoutCount: acc.buylistWithoutPayout },
    profitCents: p?.profitCents ?? 0,
  };
}

/** §15.4 `Delta`: `diff = actual − anterior`; `pct = round(diff / anterior × 100)` con la mitad LEJOS de cero. */
export function delta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { diff: null, pct: null };
  const diff = current - previous;
  if (previous === 0) return { diff, pct: null };
  const raw = (diff * 100) / previous;
  const pct = Math.sign(raw) * Math.round(Math.abs(raw));
  return { diff, pct: pct === 0 ? 0 : pct };
}

/**
 * ⭐ AN-1.1 (§15.11.2) — reparte `totalCents` entre renglones en proporción a su peso, por RESTO MAYOR: `⌊N·wᵢ/W⌋` y los
 * centavos sobrantes uno a uno a los mayores restos (empate ⇒ `id` ascendente); `W = 0` ⇒ pesos iguales. Σ = `totalCents`
 * EXACTO (⛔ `taxBaseCentsOf` por renglón no cuadra con `IVA_INCLUSIVE`, AN-B-21). Enteros (`totalCents ≥ 0`, pesos ≥ 0).
 */
export function allocateByWeight(totalCents: number, weights: Array<{ id: string; w: number }>): Map<string, number> {
  const out = new Map<string, number>();
  if (weights.length === 0) return out;
  const ws = weights.reduce((a, x) => a + x.w, 0) === 0 ? weights.map((x) => ({ id: x.id, w: 1 })) : weights;
  const W = ws.reduce((a, x) => a + x.w, 0);
  const parts = ws.map((x) => ({ id: x.id, q: Math.floor((totalCents * x.w) / W), r: (totalCents * x.w) % W }));
  let left = totalCents - parts.reduce((a, x) => a + x.q, 0);
  const byRest = [...parts].sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const x of byRest) {
    if (left <= 0) break;
    x.q += 1;
    left -= 1;
  }
  for (const x of parts) out.set(x.id, x.q);
  return out;
}

/**
 * ⭐ AN-1.1 (§15.7, N-AN-4) — centavos ⇒ celda de PESOS con dos decimales, en aritmética ENTERA: signo, `⌊|n|/100⌋`, punto,
 * `|n| mod 100` a dos dígitos. ⛔ `n / 100` en flotante; ⛔ separador de miles o `$`. `-5 ⇒ "-0.05"` (el signo no se pierde
 * cuando `|n| < 100`).
 */
export function centsToPesosCell(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`centsToPesosCell: ${cents} no es un entero de centavos`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
