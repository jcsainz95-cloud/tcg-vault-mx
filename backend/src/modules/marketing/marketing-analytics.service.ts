/**
 * marketing-analytics.service.ts — 💰(lee, no mueve) el núcleo de agregados del Panel de Marketing
 * Fase 0 (Brief 2 §2/§3/§5; ARCHITECTURE §13.4.5/§13.5; API_CONTRACT §MKT.E). COMPONE
 * `sales-analytics` para las cifras de dinero (a1/a2) y añade los agregados propios (a3, d1, d3, d4,
 * c7) con las **celdas pequeñas** (§5.2). Las columnas que dependen de GA4/Search Console salen como
 * «NO MEDIDO — GA4 sin encender», NUNCA «0» (Brief 2 §2 convenciones).
 *
 * ⛔ Solo lectura. ⛔ Ninguna fila por pedido/solicitud (ni con id opaco). ⛔ No toca `sales-analytics`.
 */
import { Injectable } from '@nestjs/common';
import { OrderStatus, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesAnalyticsService } from '../sales-analytics/sales-analytics.service';
import { daysBetween, mxRange } from '../sales-analytics/sales-period';
import { PRODUCT_TYPE_VALUES } from '../../common/enum-values';
import { applySmallCells, SMALL_CELL_SENTINEL, type DimensionRow } from './small-cells';
import type { MarketingPeriod, MarketingScreen } from './marketing-period';
import type { AggTable, Cell, ScreenPayload } from './marketing-aggregates.types';

const GA4_OFF = 'NO MEDIDO — GA4 sin encender';
const SC_OFF = 'NO MEDIDO — Search Console sin verificar';

/** Pedidos COBRADOS (R-2 de sales-analytics): los tres estados que un pedido pagado puede tener. */
const SOLD_STATUSES: OrderStatus[] = ['settled', 'refunded', 'chargeback'];

/**
 * Cartas sueltas (no sellado): d1 cruza vista↔venta↔stock por carta, y el sellado tiene su propia
 * pantalla (d7). Derivado del enum canónico (⛔ sin lista literal, candado `enum-values-parity`).
 */
const SINGLE_CARD_PRODUCT_TYPES: readonly ProductType[] = PRODUCT_TYPE_VALUES.filter((t) => t !== 'sealed');

/** Centavos → pesos con 2 decimales exactos (cents entero ⇒ sin deriva de float para montos reales). */
const centsToPesos = (cents: number | null): number | null =>
  cents === null ? null : Math.round(cents) / 100;

const SOURCE_LEGEND: Record<string, string> = {
  BD: 'Base de datos de la tienda (pedidos, solicitudes de buylist, stock, conteos de servidor)',
  GA4: 'GA4 Data API (solo sesiones que aceptaron analítica) — Fase 2',
  SC: 'Search Console API — Fase 2',
  Srv: 'Conteo anónimo del servidor de la tienda',
};

@Injectable()
export class MarketingAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesAnalyticsService,
  ) {}

  /** Punto de entrada: arma el payload de UNA pantalla para un periodo cerrado. */
  async screen(screen: MarketingScreen, period: MarketingPeriod, now: Date): Promise<ScreenPayload> {
    const base = {
      screen,
      period: { kind: period.kind, from: period.from, to: period.to, label: period.label, timezone: 'America/Mexico_City' as const },
      sourceLegend: SOURCE_LEGEND,
    };
    switch (screen) {
      case 'a':
        return { ...base, previousPeriod: period.prev, tables: await this.screenA(period, now) };
      case 'c':
        return { ...base, tables: await this.screenC(period) };
      case 'd':
        return { ...base, tables: await this.screenD(period) };
      case 'f':
        return { ...base, tables: this.screenFbannerPending() };
      case 'b':
      case 'e':
      case 'g':
      case 'h':
        return { ...base, tables: this.screenNotMeasured(screen) };
    }
  }

  // ──────────────────────────────── Pantalla (a) Resumen ────────────────────────────────

  private async screenA(period: MarketingPeriod, now: Date): Promise<AggTable[]> {
    // a1/a2: TOTALES SIN DIMENSIÓN ⇒ exactos (§5.2). Reusa `sales-analytics` (ARCHITECTURE §13.4.5),
    // cuyo «periodo anterior» es de IGUAL DURACIÓN inmediatamente antes (= semana/mes previo).
    const report = await this.sales.report({ preset: 'custom', from: period.from, to: period.to, groupBy: 'day' }, now);
    const t = report.totals;
    const p = report.previousTotals;

    const a1: AggTable = {
      id: 'a1',
      title: 'Ventas de la semana (nº de pedidos pagados y MX$ con IVA)',
      source: 'BD',
      columns: [
        { key: 'periodo', labelEs: 'Periodo', kind: 'text' },
        { key: 'pedidos', labelEs: 'Pedidos', tech: 'orders', kind: 'count' },
        { key: 'mxn', labelEs: 'Monto MXN (IVA incluido)', tech: 'chargedCents', kind: 'money' },
      ],
      rows: [
        { periodo: 'Periodo actual', pedidos: t.orders, mxn: centsToPesos(t.chargedCents) },
        { periodo: 'Periodo anterior', pedidos: p.orders, mxn: centsToPesos(p.chargedCents) },
      ],
      measured: true,
      notes: [
        'Total de la tienda SIN dimensión: cifra exacta, incluye a quien rechazó cookies (cuadra con caja).',
        `Comparación pedidos: ${this.fmtDelta(report.comparison.orders)}; MX$: ${this.fmtDelta(report.comparison.chargedCents, true)}.`,
      ],
    };

    const a2: AggTable = {
      id: 'a2',
      title: 'Ticket medio y piezas por pedido',
      source: 'BD',
      columns: [
        { key: 'periodo', labelEs: 'Periodo', kind: 'text' },
        { key: 'ticket', labelEs: 'Ticket medio MXN (IVA incluido)', tech: 'avgTicketCents', kind: 'money' },
        { key: 'piezasPorPedido', labelEs: 'Piezas por pedido', tech: 'piecesPerOrder', kind: 'number' },
      ],
      rows: [
        { periodo: 'Periodo actual', ticket: centsToPesos(t.avgTicketCents), piezasPorPedido: t.piecesPerOrder },
        { periodo: 'Periodo anterior', ticket: centsToPesos(p.avgTicketCents), piezasPorPedido: p.piecesPerOrder },
      ],
      measured: true,
    };

    const a3 = await this.a3Buylist(period);

    const a4: AggTable = this.notMeasured('a4', 'Visitas y de dónde (5 grupos)', 'GA4', GA4_OFF);
    const a5: AggTable = this.notMeasured('a5', 'Embudo sesiones → compra', 'GA4', GA4_OFF);

    return [a1, a2, a3, a4, a5];
  }

  /** a3 — buylist: solicitudes ENVIADAS + MX$ ofertado (exacto); aceptadas/pagadas con celdas pequeñas. */
  private async a3Buylist(period: MarketingPeriod): Promise<AggTable> {
    const range = mxRange(period.from, period.to);
    const [submitted, paid] = await Promise.all([
      // generate_lead = solicitud enviada (POST /buylist/requests) ⇒ creada en el periodo.
      this.prisma.sellRequest.aggregate({
        where: { createdAt: range },
        _count: { _all: true },
        _sum: { quotedTotalCents: true },
      }),
      // Ofertas aceptadas y MX$ PAGADO a clientes: status pagada con paidAt en el periodo.
      this.prisma.sellRequest.aggregate({
        where: { status: 'pagada', paidAt: range },
        _count: { _all: true },
        _sum: { payoutNetCents: true },
      }),
    ]);

    // Las pagadas son sensibles (una sola venta a la tienda = monto pagado a UNA persona, PM-A1):
    // pasan por celdas pequeñas aunque no tengan otra dimensión.
    const [paidRow] = applySmallCells([
      { key: 'Ofertas aceptadas y pagadas', count: paid._count._all, money: { pagadoMxn: centsToPesos(paid._sum.payoutNetCents ?? 0) } },
    ]);

    return {
      id: 'a3',
      title: 'Cotizaciones de buylist',
      source: 'BD',
      columns: [
        { key: 'concepto', labelEs: 'Concepto', kind: 'text' },
        { key: 'n', labelEs: 'Nº', kind: 'count' },
        { key: 'mxn', labelEs: 'MX$ (IVA incluido)', kind: 'money' },
      ],
      rows: [
        { concepto: 'Solicitudes enviadas (generate_lead)', n: submitted._count._all, mxn: centsToPesos(submitted._sum.quotedTotalCents ?? 0) },
        { concepto: 'Ofertas aceptadas / pagadas', n: paidRow.count as Cell, mxn: (paidRow.money.pagadoMxn ?? null) as Cell },
      ],
      measured: true,
      notes: ['«MX$ ofertado» = suma de lo cotizado al enviar; «pagado» = payout neto de las solicitudes pagadas en el periodo. N<5 en pagadas ⇒ «< 5» sin MX$ (PM-A1).'],
    };
  }

  // ──────────────────────────────── Pantalla (d) Catálogo ────────────────────────────────

  private async screenD(period: MarketingPeriod): Promise<AggTable[]> {
    return [await this.d1Cards(period), await this.d3SoldOut(period), await this.d4QuoteCounts(period)];
  }

  /** d1 — por carta: unidades vendidas / MX$ (celdas pequeñas) / unidades a la venta hoy. Vistas=GA4. */
  private async d1Cards(period: MarketingPeriod): Promise<AggTable> {
    const range = mxRange(period.from, period.to);
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: { settledAt: range, status: { in: SOLD_STATUSES } },
        inventoryItem: { productType: { in: [...SINGLE_CARD_PRODUCT_TYPES] } },
      },
      select: {
        unitPriceCents: true,
        inventoryItem: { select: { cardId: true, card: { select: { name: true, number: true, set: { select: { name: true } } } } } },
      },
    });

    // Agregar por carta (sumando acabados): unidades vendidas y MX$ (display, IVA incluido).
    const byCard = new Map<string, { cardId: string; key: string; units: number; mxnCents: number }>();
    for (const it of items) {
      const inv = it.inventoryItem;
      const key = `${inv.card.name} · ${inv.card.set.name} ${inv.card.number}`;
      const e = byCard.get(inv.cardId) ?? { cardId: inv.cardId, key, units: 0, mxnCents: 0 };
      e.units += 1;
      e.mxnCents += it.unitPriceCents;
      byCard.set(inv.cardId, e);
    }

    // Unidades a la venta HOY por carta (plataforma, status listed) — solo para las cartas vendidas.
    const cardIds = [...byCard.keys()];
    const onSale = cardIds.length
      ? await this.prisma.inventoryItem.groupBy({
          by: ['cardId'],
          where: { cardId: { in: cardIds }, ownerType: 'platform', status: 'listed' },
          _count: { _all: true },
        })
      : [];
    const onSaleBy = new Map(onSale.map((r) => [r.cardId, r._count._all]));
    // «Unidades a la venta hoy» por clave de fila (no es dato de persona ⇒ exacto).
    const stockByKey = new Map<string, number>();
    for (const e of byCard.values()) stockByKey.set(e.key, onSaleBy.get(e.cardId) ?? 0);

    const dims: DimensionRow[] = [...byCard.values()].map((e) => ({
      key: e.key,
      count: e.units,
      money: { mxn: centsToPesos(e.mxnCents) },
    }));
    const safe = applySmallCells(dims);

    return {
      id: 'd1',
      title: 'Cartas más vistas vs más vendidas',
      source: 'mixed',
      columns: [
        { key: 'carta', labelEs: 'Carta', kind: 'text' },
        { key: 'vistas', labelEs: 'Fichas vistas', tech: 'view_item (GA4)', kind: 'count' },
        { key: 'unidadesVendidas', labelEs: 'Unidades vendidas', kind: 'count' },
        { key: 'mxn', labelEs: 'MX$ vendido (IVA incluido)', kind: 'money' },
        { key: 'aLaVentaHoy', labelEs: 'Unidades a la venta hoy', kind: 'count' },
      ],
      rows: safe.map((r) => ({
        carta: r.key,
        vistas: GA4_OFF,
        unidadesVendidas: r.count as Cell,
        mxn: (r.money.mxn ?? null) as Cell,
        // La fila agrupada «Otros» no mapea a una carta ⇒ su stock es null.
        aLaVentaHoy: r.otros ? null : (stockByKey.get(r.key) ?? 0),
      })),
      measured: true,
      notes: ['«Fichas vistas» y carritos salen de GA4 (Fase 2). Unidades vendidas < 5 ⇒ «< 5» sin MX$ (§5.2).'],
    };
  }

  /** d3 — agotado con demanda: stock 0 + conteo de lista de deseos por carta (celdas pequeñas). */
  private async d3SoldOut(period: MarketingPeriod): Promise<AggTable> {
    // Altas de lista de deseos en el periodo, por carta (la demanda que SÍ está en BD).
    const range = mxRange(period.from, period.to);
    const wish = await this.prisma.wishlistItem.groupBy({
      by: ['cardId'],
      where: { createdAt: range },
      _count: { _all: true },
    });
    const cardIds = wish.map((w) => w.cardId);
    if (cardIds.length === 0) {
      return {
        id: 'd3',
        title: 'Agotado con demanda (stock 0 + lista de deseos)',
        source: 'mixed',
        columns: [
          { key: 'carta', labelEs: 'Carta', kind: 'text' },
          { key: 'aLaVentaHoy', labelEs: 'Unidades a la venta hoy', kind: 'count' },
          { key: 'listaDeseos', labelEs: 'Altas lista de deseos', kind: 'count' },
        ],
        rows: [],
        measured: true,
        notes: ['Sin altas de lista de deseos en el periodo. «Vistas de ficha agotada» salen de GA4 (Fase 2).'],
      };
    }
    const [cards, onSale] = await Promise.all([
      this.prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } }),
      this.prisma.inventoryItem.groupBy({ by: ['cardId'], where: { cardId: { in: cardIds }, ownerType: 'platform', status: 'listed' }, _count: { _all: true } }),
    ]);
    const cardBy = new Map(cards.map((c) => [c.id, c]));
    const onSaleBy = new Map(onSale.map((r) => [r.cardId, r._count._all]));

    // «Agotado con demanda» = 0 unidades a la venta hoy.
    const soldOut = wish.filter((w) => (onSaleBy.get(w.cardId) ?? 0) === 0);
    const dims: DimensionRow[] = soldOut.map((w) => {
      const c = cardBy.get(w.cardId);
      return { key: c ? `${c.name} · ${c.set.name} ${c.number}` : w.cardId, count: w._count._all, money: {} };
    });
    const safe = applySmallCells(dims);
    return {
      id: 'd3',
      title: 'Agotado con demanda (stock 0 + lista de deseos)',
      source: 'mixed',
      columns: [
        { key: 'carta', labelEs: 'Carta', kind: 'text' },
        { key: 'aLaVentaHoy', labelEs: 'Unidades a la venta hoy', kind: 'count' },
        { key: 'listaDeseos', labelEs: 'Altas lista de deseos', kind: 'count' },
      ],
      rows: safe.map((r) => ({ carta: r.key, aLaVentaHoy: r.otros ? null : 0, listaDeseos: r.count as Cell })),
      measured: true,
      notes: ['Cartas con 0 unidades a la venta hoy y altas de lista de deseos en el periodo. Conteo de deseos < 5 ⇒ «< 5» (§5.2).'],
    };
  }

  /** d4 — nº de cálculos del cotizador por carta (conteo anónimo de servidor; sin usuario ni IP). */
  private async d4QuoteCounts(period: MarketingPeriod): Promise<AggTable> {
    const grouped = await this.prisma.buylistQuoteDailyCount.groupBy({
      by: ['cardId'],
      where: { day: { gte: new Date(`${period.from}T00:00:00.000Z`), lte: new Date(`${period.to}T00:00:00.000Z`) } },
      _sum: { count: true },
    });
    const cardIds = grouped.map((g) => g.cardId);
    const cards = cardIds.length
      ? await this.prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } })
      : [];
    const cardBy = new Map(cards.map((c) => [c.id, c]));
    const rows = grouped
      .map((g) => {
        const c = cardBy.get(g.cardId);
        return { carta: c ? `${c.name} · ${c.set.name} ${c.number}` : g.cardId, calculos: g._sum.count ?? 0 };
      })
      .sort((a, b) => (b.calculos as number) - (a.calculos as number) || a.carta.localeCompare(b.carta));
    return {
      id: 'd4',
      title: 'Buylist más cotizadas (nº de cálculos del cotizador)',
      source: 'Srv',
      columns: [
        { key: 'carta', labelEs: 'Carta', kind: 'text' },
        { key: 'calculos', labelEs: 'Cálculos del cotizador', kind: 'count' },
      ],
      rows,
      measured: true,
      notes: ['Conteo ANÓNIMO de `POST /buylist/quote` (sin usuario, sin IP): no identifica a persona ⇒ no aplica supresión de celda pequeña.'],
    };
  }

  // ──────────────────────────────── Pantalla (c) Comportamiento ────────────────────────────────

  private async screenC(period: MarketingPeriod): Promise<AggTable[]> {
    return [await this.c7ByState(period)];
  }

  /** c7 (P5=B, PM-B2) — nº de pedidos por estado de envío. SIN MX$, sin cruce. Mínimo 4 semanas. */
  private async c7ByState(period: MarketingPeriod): Promise<AggTable> {
    const columns = [
      { key: 'estado', labelEs: 'Estado', kind: 'text' as const },
      { key: 'pedidos', labelEs: 'Pedidos', kind: 'count' as const },
    ];
    const days = daysBetween(period.from, period.to) + 1;
    if (days < 28) {
      return {
        id: 'c7',
        title: 'Nº de pedidos por estado de envío',
        source: 'BD',
        columns,
        rows: [],
        measured: false,
        notMeasuredReason: 'c7 requiere un periodo mínimo de 4 semanas (PM-B2); una semana cerrada no basta.',
      };
    }
    const range = mxRange(period.from, period.to);
    const orders = await this.prisma.order.findMany({
      where: { settledAt: range, status: { in: SOLD_STATUSES } },
      select: { fulfillmentMode: true, shippingAddressSnapshot: true },
    });

    let pickup = 0;
    const byState = new Map<string, number>();
    for (const o of orders) {
      if (o.fulfillmentMode === 'vault') {
        pickup += 1; // bóveda/recogida ⇒ «Recogida en persona»
        continue;
      }
      const snap = (o.shippingAddressSnapshot ?? {}) as { state?: unknown };
      const state = typeof snap.state === 'string' && snap.state.trim() !== '' ? snap.state.trim() : 'Sin estado';
      byState.set(state, (byState.get(state) ?? 0) + 1);
    }

    // Estados con N<5 ⇒ «Otros estados» (agrupación propia de c7, PM-B2), para no dejar un estado solo.
    const rows: Record<string, Cell>[] = [];
    let otros = 0;
    for (const [state, n] of [...byState.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (n < 5) otros += n;
      else rows.push({ estado: state, pedidos: n });
    }
    if (otros > 0) rows.push({ estado: 'Otros estados', pedidos: otros >= 5 ? otros : SMALL_CELL_SENTINEL });
    if (pickup > 0) rows.push({ estado: 'Recogida en persona', pedidos: pickup >= 5 ? pickup : SMALL_CELL_SENTINEL });

    return {
      id: 'c7',
      title: 'Nº de pedidos por estado de envío',
      source: 'BD',
      columns,
      rows,
      measured: true,
      notes: [
        'Derivado del estado del snapshot de dirección (direct_ship) y del modo de fulfillment. SIN MX$, sin cruce con carta/utm/puerta (PM-B2).',
        'Estados con N<5 agrupados en «Otros estados». «Recogida en persona» = pedidos de bóveda/recogida.',
      ],
    };
  }

  // ──────────────────────────────── Pantallas sin BD en Fase 0 ────────────────────────────────

  /** (f) f1/f2: el modelo existe pero el banner es Fase 2 ⇒ sin camino de escritura ⇒ NO MEDIDO. */
  private screenFbannerPending(): AggTable[] {
    return [
      this.notMeasured('f1', 'Tasa de aceptación del banner', 'Srv', 'NO MEDIDO — banner en Fase 2 (sin camino de escritura todavía)'),
      this.notMeasured('f3', 'Cobertura: % de pedidos con origen', 'BD', 'NO MEDIDO — atribución UTM se puebla en Fase 2 (hoy first_utm_* = NULL)'),
    ];
  }

  /** (b)(e)(g)(h): dependen de GA4/SC/atribución (Fase 2) o de modelo aún no creado. */
  private screenNotMeasured(screen: MarketingScreen): AggTable[] {
    switch (screen) {
      case 'b':
        return [this.notMeasured('b1', 'Origen por utm_*', 'mixed', 'NO MEDIDO — sesiones=GA4 (Fase 2); pedidos por origen requieren first_utm_* (NULL en Fase 0, se puebla en Fase 2)')];
      case 'e':
        return [this.notMeasured('e1', 'Consultas de Google', 'SC', SC_OFF)];
      case 'g':
        return [this.notMeasured('g1', 'Compras atribuidas a promociones (utm_medium=paid)', 'BD', 'NO MEDIDO — first_utm_* = NULL en Fase 0 (se puebla con consentimiento en Fase 2)')];
      case 'h':
        return [
          this.notMeasured('h1', 'Anotaciones de fecha', 'BD', 'NO MEDIDO — sin modelo de anotaciones en m82 (deuda enrutada; ver TECH_DEBT)'),
        ];
      default:
        return [];
    }
  }

  private notMeasured(id: string, title: string, source: AggTable['source'], reason: string): AggTable {
    return { id, title, source, columns: [], rows: [], measured: false, notMeasuredReason: reason };
  }

  private fmtDelta(d: { diff: number | null; pct: number | null }, money = false): string {
    const diff = d.diff === null ? 'n/d' : money ? `$${(d.diff / 100).toFixed(2)}` : String(d.diff);
    const pct = d.pct === null ? 'N chico, sin veredicto' : `${d.pct > 0 ? '+' : ''}${d.pct}%`;
    return `${diff} (${pct})`;
  }
}
