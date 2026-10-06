/**
 * sales-analytics.service.ts — 💰 la analítica de ventas del dueño (`PROJECT §AN`, API_CONTRACT §15, ARCHITECTURE §4.64).
 * LEE dinero, ⛔ no lo mueve. Sin tabla nueva ni índice: consultas acotadas por periodo y agregación en memoria con los
 * MISMOS helpers de `common/money.ts` que M7.
 *
 *  - `report(q, now)` → `SalesReportDTO` (pestaña «Ventas» de M9).
 *  - `csv(q, now)` → el CSV de §15.7 (las mismas filas que `report`, celda a celda).
 *  - `today(now)` → `SalesTodayDTO` (tarjeta del tablero; contra el mismo día de la semana pasada COMPLETO, P-AN-2).
 *  - `dayFigures(day)` → la fila de un día: la usa el resumen de las 08:00 (624). Es el MISMO cuerpo que las filas del
 *    informe (`bucketFigures`), así que la línea del correo no puede divergir de la tabla.
 *
 * Reglas de conteo (§15.3): R-1 día de México y semiabierto; R-2 pedido cobrado = `settledAt` en el periodo, cualquier estado
 * de hoy; R-3 reembolsos = las filas de M7 (`refundRowsInPeriod`) en SU día; R-4 una pieza = un `OrderItem`.
 * Ganancia y envíos (612/622): `pnlBuckets` de `admin/pnl-core.ts` — el cuerpo de M7 partido ⇒ Σ días = `pnl()` por
 * construcción (hereda D-AN-1: «Ganancia (regla de Finanzas)»).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ivaIsIncluded, netRevenueCents, taxBaseCentsOf } from '../../common/money';
import { pnlBuckets, refundRowsInPeriod, zeroPnl, PnlComponents } from '../admin/pnl-core';
import {
  addDays,
  bucketKeyOf,
  bucketsOf,
  isoWeekday,
  mxHour,
  mxRange,
  resolvePeriod,
  SalesGroupBy,
  SalesQuery,
  SalesTopSort,
  todayMx,
  Ymd,
} from './sales-period';
import { toMexicoCityDateKey } from '../../common/business-days';
import {
  addBuylist,
  allocateByWeight,
  centsToPesosCell,
  addOrder,
  addRefund,
  delta,
  emptyAcc,
  FiguresAcc,
  finish,
  OrderLite,
  SalesFigures,
} from './sales-figures';
import type { SalesReportDTO, SalesTodayDTO, TopCard, TopSealed, TopSet, MixCell, PieceCell } from './sales-analytics.dto';

/** Lo que se lee de cada pedido R-2 (columnas enumeradas; ⛔ sin `include` de piezas para las cifras). */
const ORDER_SELECT = {
  id: true,
  settledAt: true,
  status: true,
  totalCents: true,
  subtotalCents: true,
  ivaRatePct: true,
  priceConvention: true,
  fulfillmentMode: true,
  guestEmail: true,
  userId: true,
  user: { select: { email: true } },
  _count: { select: { items: true } },
} as const;

interface OrderRow extends OrderLite {
  userId: string | null;
  userEmail: string | null;
}

/** §15.3 — llave del cliente: correo de la cuenta (normalizado), si no el del invitado, si no `user:<id>`. */
export function customerKeyOf(o: { userId: string | null; userEmail: string | null; guestEmail: string | null }): string {
  if (o.userId && o.userEmail != null) return o.userEmail.trim().toLowerCase();
  if (o.guestEmail) return o.guestEmail;
  return `user:${o.userId}`;
}

const TOP_LIMIT = 10;

/** Lo que se lee de cada renglón (nombres del catálogo; ⛔ ningún dato de cliente). */
const ITEM_SELECT = {
  id: true,
  orderId: true,
  unitPriceCents: true,
  finish: true,
  order: { select: { ivaRatePct: true, priceConvention: true } },
  inventoryItem: {
    select: {
      productType: true,
      finish: true,
      cardId: true,
      sealedProductId: true,
      sealedProductName: true,
      card: { select: { name: true, number: true, setId: true, set: { select: { name: true } } } },
      sealedProduct: { select: { name: true, setId: true, set: { select: { name: true } } } },
    },
  },
} as const;
type ItemRow = Prisma.OrderItemGetPayload<{ select: typeof ITEM_SELECT }>;

const sumPnl = (parts: Iterable<PnlComponents>): PnlComponents => {
  const t = zeroPnl();
  for (const p of parts) for (const k of Object.keys(t) as Array<keyof PnlComponents>) t[k] += p[k];
  return t;
};

const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

@Injectable()
export class SalesAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ordersIn(range: { gte: Date; lt: Date }): Promise<OrderRow[]> {
    const rows = await this.prisma.order.findMany({ where: { settledAt: range }, select: ORDER_SELECT });
    return rows.map((o) => ({
      id: o.id,
      settledAt: o.settledAt as Date,
      status: o.status,
      totalCents: o.totalCents,
      subtotalCents: o.subtotalCents,
      ivaRatePct: o.ivaRatePct,
      priceConvention: o.priceConvention,
      fulfillmentMode: o.fulfillmentMode,
      guestEmail: o.guestEmail,
      userId: o.userId,
      userEmail: o.user?.email ?? null,
      pieces: o._count.items,
    }));
  }

  /**
   * 💰 El cuerpo ÚNICO de las cifras por cubo: las filas del informe, sus totales (sumando acumuladores, ⛔ nunca promediando
   * filas) y los pedidos R-2 leídos (para lo que se calcula encima: lo más vendido, clientes, mejores días, mezcla).
   */
  private async bucketFigures(from: Ymd, to: Ymd, groupBy: SalesGroupBy) {
    const range = mxRange(from, to);
    const keyOf = (d: Date | null) => (d ? bucketKeyOf(d, groupBy, from) : from);
    const [orders, refunds, buylist, pnl] = await Promise.all([
      this.ordersIn(range),
      refundRowsInPeriod(this.prisma, range),
      this.prisma.sellRequest.findMany({ where: { status: 'pagada', paidAt: range }, select: { paidAt: true, payoutNetCents: true } }),
      pnlBuckets(this.prisma, range, keyOf),
    ]);
    const buckets = bucketsOf(from, to, groupBy);
    const accs = new Map<Ymd, FiguresAcc>(buckets.map((b) => [b.from, emptyAcc()]));
    const total = emptyAcc();
    const accOf = (d: Date | null): FiguresAcc => {
      const a = accs.get(keyOf(d));
      // Inalcanzable con el semiabierto: todo instante del rango cae en un cubo. Si no, es un defecto nuestro: se dice.
      if (!a) throw new Error(`sales-analytics: instante fuera de los cubos (${d?.toISOString()})`);
      return a;
    };
    for (const o of orders) {
      addOrder(accOf(o.settledAt), o);
      addOrder(total, o);
    }
    for (const r of refunds) {
      addRefund(accOf(r.at), r);
      addRefund(total, r);
    }
    for (const s of buylist) {
      addBuylist(accOf(s.paidAt), s.payoutNetCents ?? null);
      addBuylist(total, s.payoutNetCents ?? null);
    }
    for (const b of buckets) accs.get(b.from)!.pnl = pnl.get(b.from) ?? zeroPnl();
    total.pnl = sumPnl(pnl.values());
    return {
      rows: buckets.map((b) => ({ from: b.from, to: b.to, ...finish(accs.get(b.from)!) })),
      totals: finish(total),
      orders,
    };
  }

  /** 624 — la fila de un día (la MISMA función que las filas del informe). */
  async dayFigures(day: Ymd): Promise<SalesFigures> {
    const { rows } = await this.bucketFigures(day, day, 'day');
    const { from: _f, to: _t, ...figures } = rows[0];
    return figures;
  }

  async report(q: SalesQuery, now: Date): Promise<SalesReportDTO> {
    const period = resolvePeriod(q, now);
    const [cur, prev] = await Promise.all([
      this.bucketFigures(period.from, period.to, period.groupBy),
      this.bucketFigures(period.prev.from, period.prev.to, 'day'),
    ]);
    const t = cur.totals;
    const p = prev.totals;
    const [items, customers] = await Promise.all([this.itemsOf(cur.orders), this.customers(cur.orders, period.from)]);
    const top = this.top(cur.orders, items, period.topSort);
    const ppoDelta = delta(t.piecesPerOrder, p.piecesPerOrder);
    return {
      period: { preset: period.preset, from: period.from, to: period.to, days: period.days, timezone: 'America/Mexico_City' },
      previousPeriod: { from: period.prev.from, to: period.prev.to },
      groupBy: period.groupBy,
      totals: t,
      previousTotals: p,
      comparison: {
        orders: delta(t.orders, p.orders),
        chargedCents: delta(t.chargedCents, p.chargedCents),
        netSalesCents: delta(t.netSalesCents, p.netSalesCents),
        refundsAmountCents: delta(t.refunds.amountCents, p.refunds.amountCents),
        netSalesAfterRefundsCents: delta(t.netSalesAfterRefundsCents, p.netSalesAfterRefundsCents),
        avgTicketCents: delta(t.avgTicketCents, p.avgTicketCents),
        // Un decimal, como la cifra: `2.3 − 1.1` en coma flotante no es `1.2`.
        piecesPerOrder: { diff: round1(ppoDelta.diff), pct: ppoDelta.pct },
      },
      rows: cur.rows,
      top,
      customers,
      bestDays: this.bestDays(cur.orders),
      mix: this.mix(cur.orders, items),
    };
  }

  /**
   * §15.7 — el CSV: una fila por cubo (también las de cero) + `total`. ⭐ AN-1.1: el dinero en PESOS con dos decimales
   * (`centsToPesosCell`, aritmética entera; la misma cifra al centavo que el JSON). Columnas de fase A + fase B (⛔ las de
   * fase C no viajan). ⛔ Ningún dato de cliente, ninguna lista, ninguna mezcla.
   */
  async csv(q: SalesQuery, now: Date): Promise<{ filename: string; body: string }> {
    const r = await this.report(q, now);
    const header = [
      'from', 'to', 'orders', 'chargedMxn', 'netSalesMxn', 'refundsCount', 'refundsAmountMxn', 'refundsNetMxn',
      'netSalesAfterRefundsMxn', 'pieces', 'avgTicketMxn', 'piecesPerOrder',
      'shippingChargedNetMxn', 'shippingCostNetMxn', 'shippingResultNetMxn', 'shippingCostMissingCount', 'buylistPaidCount',
      'buylistPaidNetMxn', 'profitMxn',
    ];
    const n = (v: number | null) => (v === null ? '' : String(v));
    const m = (v: number | null) => (v === null ? '' : centsToPesosCell(v));
    const line = (from: string, to: string, f: SalesFigures) =>
      [
        from, to, n(f.orders), m(f.chargedCents), m(f.netSalesCents), n(f.refunds.count), m(f.refunds.amountCents), m(f.refunds.netCents),
        m(f.netSalesAfterRefundsCents), n(f.pieces), m(f.avgTicketCents), n(f.piecesPerOrder),
        m(f.shipping.chargedNetCents), m(f.shipping.costNetCents), m(f.shipping.resultNetCents), n(f.shipping.costMissingCount),
        n(f.buylist.paidCount), m(f.buylist.paidNetCents), m(f.profitCents),
      ].join(',');
    const lines = [header.join(','), ...r.rows.map((row) => line(row.from, row.to, row)), line('total', '', r.totals)];
    return { filename: `ventas_${r.period.from}_${r.period.to}_${r.groupBy}.csv`, body: `${lines.join('\n')}\n` };
  }

  /** §15.5 — tarjeta «Ventas de hoy»: hoy contra el mismo día de la semana pasada COMPLETO (P-AN-2). */
  async today(now: Date): Promise<SalesTodayDTO> {
    const day = todayMx(now);
    const lastWeek = addDays(day, -7);
    const [a, b] = await Promise.all([this.dayFigures(day), this.dayFigures(lastWeek)]);
    return {
      today: { day, orders: a.orders, chargedCents: a.chargedCents },
      sameWeekdayLastWeek: { day: lastWeek, orders: b.orders, chargedCents: b.chargedCents },
      comparison: { orders: delta(a.orders, b.orders), chargedCents: delta(a.chargedCents, b.chargedCents) },
    };
  }

  /** 620 — por día de la semana (siempre 7, 1 = lunes) y por hora de México (siempre 24). */
  private bestDays(orders: OrderRow[]): SalesReportDTO['bestDays'] {
    const byWeekday = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7, orders: 0, chargedCents: 0 }));
    const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, chargedCents: 0 }));
    for (const o of orders) {
      const w = byWeekday[isoWeekday(toMexicoCityDateKey(o.settledAt)) - 1];
      w.orders += 1;
      w.chargedCents += o.totalCents;
      const h = byHour[mxHour(o.settledAt)];
      h.orders += 1;
      h.chargedCents += o.totalCents;
    }
    return { byWeekday, byHour };
  }

  /**
   * 621 (la parte que no necesita migración): destino e invitado/cuenta. ⚠️ `byPaymentMethod` es fase C (`M-AN-1`: el método
   * no se guarda hoy) ⇒ ⛔ NO viaja (AN-1.1: clave de fase no construida = ausente, nunca 0).
   * ⭐ AN-1.1 (§15.11.2) `byProductType`: TODOS los pedidos R-2 (también los `refunded`: la mezcla reparte `totals`, no
   * ordena); el `netRevenueCents` de CADA pedido se reparte entre sus renglones por `unitPriceCents` (`allocateByWeight`)
   * ⇒ Σ = `totals.netSalesCents` al centavo.
   */
  private mix(orders: OrderRow[], items: ItemRow[]): SalesReportDTO['mix'] {
    const cell = (): MixCell => ({ orders: 0, chargedCents: 0 });
    const out = { byDestination: { vault: cell(), direct_ship: cell() }, byBuyer: { account: cell(), guest: cell() } };
    for (const o of orders) {
      const d = out.byDestination[o.fulfillmentMode];
      d.orders += 1;
      d.chargedCents += o.totalCents;
      const b = o.guestEmail != null ? out.byBuyer.guest : out.byBuyer.account;
      b.orders += 1;
      b.chargedCents += o.totalCents;
    }
    const piece = (): PieceCell => ({ pieces: 0, netCents: 0 });
    const byProductType = { raw: piece(), graded: piece(), sealed: piece() };
    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const it of items) {
      const list = itemsByOrder.get(it.orderId);
      if (list) list.push(it);
      else itemsByOrder.set(it.orderId, [it]);
    }
    for (const o of orders) {
      const its = itemsByOrder.get(o.id) ?? [];
      const share = allocateByWeight(netRevenueCents(o), its.map((it) => ({ id: it.id, w: it.unitPriceCents })));
      for (const it of its) {
        const c = byProductType[it.inventoryItem.productType];
        c.pieces += 1;
        c.netCents += share.get(it.id)!;
      }
    }
    return { ...out, byProductType };
  }

  /** 608 — nuevos / recurrentes por la llave del cliente; recurrente = alguna orden R-2 ANTERIOR a `from`. */
  private async customers(orders: OrderRow[], from: Ymd): Promise<SalesReportDTO['customers']> {
    const keys = new Set(orders.map(customerKeyOf));
    if (keys.size === 0) return { new: 0, returning: 0, distinct: 0 };
    const userIds = [...new Set(orders.map((o) => o.userId).filter((x): x is string => x !== null))];
    const emails = [...keys].filter((k) => !k.startsWith('user:'));
    const prior = await this.prisma.order.findMany({
      where: {
        settledAt: { lt: mxRange(from, from).gte },
        OR: [
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
          ...(emails.length ? [{ guestEmail: { in: emails } }, { user: { email: { in: emails, mode: 'insensitive' as const } } }] : []),
        ],
      },
      select: { userId: true, guestEmail: true, user: { select: { email: true } } },
    });
    const seen = new Set(prior.map((o) => customerKeyOf({ userId: o.userId, userEmail: o.user?.email ?? null, guestEmail: o.guestEmail })));
    let returning = 0;
    for (const k of keys) if (seen.has(k)) returning += 1;
    return { new: keys.size - returning, returning, distinct: keys.size };
  }

  /** Los renglones de los pedidos R-2 del periodo (para `top` y `mix.byProductType`), con lo que nombra cada pieza. */
  private async itemsOf(orders: OrderRow[]): Promise<ItemRow[]> {
    const ids = orders.map((o) => o.id);
    if (ids.length === 0) return [];
    return this.prisma.orderItem.findMany({ where: { orderId: { in: ids } }, select: ITEM_SELECT });
  }

  /** 607 — lo más vendido (renglones de pedidos R-2 salvo los `refunded` de hoy), hasta 10 por lista. */
  private top(orders: OrderRow[], all: ItemRow[], sort: SalesTopSort): SalesReportDTO['top'] {
    const refunded = new Set(orders.filter((o) => o.status === 'refunded').map((o) => o.id));
    const items = all.filter((it) => !refunded.has(it.orderId));
    const cards = new Map<string, TopCard>();
    const sets = new Map<string, TopSet>();
    const sealed = new Map<string, TopSealed>();
    for (const it of items) {
      const inv = it.inventoryItem;
      const net = ivaIsIncluded(it.order.priceConvention) ? taxBaseCentsOf(it.unitPriceCents, it.order.ivaRatePct) : it.unitPriceCents;
      const sp = inv.productType === 'sealed' ? inv.sealedProduct : null;
      const setId = sp ? sp.setId : inv.card.setId;
      const setName = sp ? sp.set.name : inv.card.set.name;
      const s = sets.get(setId) ?? { setId, setName, pieces: 0, netCents: 0 };
      s.pieces += 1;
      s.netCents += net;
      sets.set(setId, s);
      if (inv.productType === 'sealed') {
        const name = sp ? sp.name : inv.sealedProductName ?? inv.card.name;
        const key = inv.sealedProductId ?? `name:${name}`;
        const e = sealed.get(key) ?? { sealedProductId: inv.sealedProductId ?? null, name, setName, pieces: 0, netCents: 0 };
        e.pieces += 1;
        e.netCents += net;
        sealed.set(key, e);
      } else {
        const finishOf = it.finish ?? inv.finish;
        const key = `${inv.cardId}|${inv.productType}|${finishOf}`;
        const e =
          cards.get(key) ??
          { cardId: inv.cardId, name: inv.card.name, number: inv.card.number, setName: inv.card.set.name, finish: finishOf, productType: inv.productType as 'raw' | 'graded', pieces: 0, netCents: 0 };
        e.pieces += 1;
        e.netCents += net;
        cards.set(key, e);
      }
    }
    const order = <T extends { pieces: number; netCents: number }>(nameOf: (x: T) => string) => (a: T, b: T) => {
      const [p1, p2] = sort === 'net' ? [b.netCents - a.netCents, b.pieces - a.pieces] : [b.pieces - a.pieces, b.netCents - a.netCents];
      return p1 || p2 || nameOf(a).localeCompare(nameOf(b));
    };
    return {
      sort,
      cards: [...cards.values()].sort(order<TopCard>((x) => `${x.name}|${x.finish}|${x.productType}`)).slice(0, TOP_LIMIT),
      sets: [...sets.values()].sort(order<TopSet>((x) => x.setName)).slice(0, TOP_LIMIT),
      sealed: [...sealed.values()].sort(order<TopSealed>((x) => x.name)).slice(0, TOP_LIMIT),
    };
  }
}
