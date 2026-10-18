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
import {
  applySmallCells,
  hiddenKeys,
  SMALL_CELL_SENTINEL,
  SMALL_CELL_THRESHOLD,
  type CellPrivacy,
  type DimensionRow,
  type SafeRow,
} from './small-cells';
import { MarketingAnnotationsService, type EmbeddedAnnotation } from './marketing-annotations.service';
import { weeksTouchingMonth, type DayRange, type MarketingPeriod, type MarketingScreen } from './marketing-period';
import type { AggTable, Cell, ScreenPayload } from './marketing-aggregates.types';

/*
 * Motivos «NO MEDIDO — …» (API_CONTRACT §MKT.G.4). La pantalla los pinta TAL CUAL ⇒ ⛔ sin códigos internos
 * (PM-…, Fase N) — DESIGN_SYSTEM §MKT-UX P66-3 / petición 3(a). Candado: `test/marketing-panel.spec.ts`.
 */
const GA4_OFF = 'NO MEDIDO — GA4 sin encender';
const SC_OFF = 'NO MEDIDO — Search Console sin verificar';
const ORIGIN_OFF = 'NO MEDIDO — el origen de los pedidos aún no se registra (requiere el aviso de cookies con consentimiento)';
const GA4_AND_ORIGIN_OFF = 'NO MEDIDO — GA4 sin encender y el origen de los pedidos aún no se registra';
const BANNER_OFF = 'NO MEDIDO — el aviso de cookies todavía no está publicado';
const SEARCH_LOG_OFF =
  'NO MEDIDO — pendiente de la revisión de seguridad; el registro de búsquedas sin resultado no existe todavía';
const C7_MIN_PERIOD = 'NO MEDIDO — esta tabla necesita un periodo de al menos 4 semanas; elige un mes cerrado';
const C7_NOTE_SOURCE =
  'Derivado del estado de la dirección de envío y del modo de entrega. Sin montos y sin cruce con carta, origen ni puerta.';

/**
 * Línea de cobertura de TODA pantalla en Fase 0 — texto LITERAL de API_CONTRACT §MKT.G.4 («Cobertura arriba de
 * cada pantalla»). La pinta la pantalla arriba; el export la lleva en «Info».
 */
export const COVERAGE_NOTE = 'Cobertura: GA4 sin encender; origen de pedidos NO MEDIDO (first_utm_* vacío hasta Fase 2).';

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

/** Clave de la fila «pagadas» de a3 (también es la clave de cruce mes↔semanas). */
const A3_PAID_KEY = 'Ofertas aceptadas y pagadas';

type SoldByCard = Map<string, { cardId: string; key: string; units: number; mxnCents: number }>;

/** d1: filas crudas por carta (unidades vendidas, MX$ con IVA). */
const d1Dims = (byCard: SoldByCard): DimensionRow[] =>
  [...byCard.values()].map((e) => ({ key: e.key, count: e.units, money: { mxn: centsToPesos(e.mxnCents) } }));

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
    private readonly annotations: MarketingAnnotationsService,
  ) {}

  /**
   * Punto de entrada ÚNICO: arma el payload de UNA pantalla para un periodo cerrado. Lo usan `aggregates`, `panel`
   * y los exports (paridad por construcción, §MKT.G.2). `privacy` es el régimen de celdas, **obligatorio y sin
   * valor por defecto** (API_CONTRACT v1.103 §MKT.G.2 / ARCHITECTURE §13.7 D-MKT-PANEL-2): una salida nueva no
   * puede nacer exacta por olvido. Es un parámetro del MISMO cálculo, no un segundo camino.
   */
  async screen(screen: MarketingScreen, period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<ScreenPayload> {
    // Anotaciones del periodo: EMBEBIDAS en toda pantalla (pintan a/b/c y la hoja «Info»), h1/§13.4.6.
    const annotations = await this.annotations.forPeriod(period.from, period.to);
    const base = {
      screen,
      period: { kind: period.kind, from: period.from, to: period.to, label: period.label, timezone: 'America/Mexico_City' as const },
      sourceLegend: SOURCE_LEGEND,
      annotations,
      notes: [COVERAGE_NOTE],
      privacy,
    };
    // Catálogo y ORDEN de tablas: API_CONTRACT §MKT.G.4 (candado `marketing-panel.spec.ts`, §MKT.G.9 (6)).
    switch (screen) {
      case 'a':
        return { ...base, previousPeriod: period.prev, tables: await this.screenA(period, now, privacy) };
      case 'b':
        return { ...base, tables: this.screenB() };
      case 'c':
        return { ...base, tables: await this.screenC(period, privacy) };
      case 'd':
        return { ...base, tables: await this.screenD(period, privacy) };
      case 'e':
        return { ...base, tables: this.screenE() };
      case 'f':
        return { ...base, tables: this.screenFbannerPending() };
      case 'g':
        return { ...base, tables: this.screenG() };
      case 'h':
        return { ...base, tables: this.screenH(annotations) };
    }
  }

  // ──────────────────────────────── Pantalla (a) Resumen ────────────────────────────────

  private async screenA(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
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

    const a3 = await this.a3Buylist(period, privacy);

    const a4: AggTable = this.notMeasured('a4', 'Visitas y de dónde (5 grupos)', 'GA4', GA4_OFF);
    const a5: AggTable = this.notMeasured('a5', 'Embudo sesiones → compra', 'GA4', GA4_OFF);

    return [a1, a2, a3, a4, a5];
  }

  /** a3 — buylist: solicitudes ENVIADAS + MX$ ofertado (exacto); aceptadas/pagadas con celdas pequeñas. */
  private async a3Buylist(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable> {
    const range = mxRange(period.from, period.to);
    // generate_lead = solicitud enviada (POST /buylist/requests) ⇒ creada en el periodo.
    const submitted = await this.prisma.sellRequest.aggregate({
      where: { createdAt: range },
      _count: { _all: true },
      _sum: { quotedTotalCents: true },
    });

    // Las pagadas son sensibles (una sola venta a la tienda = monto pagado a UNA persona, PM-A1):
    // pasan por celdas pequeñas aunque no tengan otra dimensión (y por la coherencia mes↔semanas).
    const [paidRow] = await this.safeRows(period, privacy, (p) => this.a3PaidDims(p));

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

  /** a3 (dimensión «pagadas»): ofertas aceptadas y MX$ PAGADO a clientes, status pagada con `paidAt` en el rango. */
  private async a3PaidDims(p: DayRange): Promise<DimensionRow[]> {
    const paid = await this.prisma.sellRequest.aggregate({
      where: { status: 'pagada', paidAt: mxRange(p.from, p.to) },
      _count: { _all: true },
      _sum: { payoutNetCents: true },
    });
    return [{ key: A3_PAID_KEY, count: paid._count._all, money: { pagadoMxn: centsToPesos(paid._sum.payoutNetCents ?? 0) } }];
  }

  // ──────────────────────────────── Régimen de celdas (una sola función) ────────────────────────────────

  /**
   * Aplica el régimen a una tabla con dimensión. `dimsOf` es LA función que calcula las filas crudas de un rango
   * de días; se llama para el periodo y, en un MES con `small_cells`, para cada semana cerrada que lo toca
   * (API_CONTRACT §MKT.G.10, D-MKT-PANEL-4): toda clave oculta en alguna semana sale «oculta» en el mes.
   * En `exact` no aplica ni la regla ni la coherencia.
   */
  private async safeRows(
    period: MarketingPeriod,
    privacy: CellPrivacy,
    dimsOf: (p: DayRange) => Promise<DimensionRow[]>,
    /** Filas del periodo ya calculadas por el llamador (evita repetir la consulta). */
    mainDims?: DimensionRow[],
  ): Promise<SafeRow[]> {
    const dims = mainDims ?? (await dimsOf(period));
    if (privacy === 'exact') return applySmallCells(dims, privacy);
    const forced = new Set<string>();
    if (period.kind === 'month') {
      for (const w of weeksTouchingMonth(period)) for (const k of hiddenKeys(await dimsOf(w))) forced.add(k);
    }
    return applySmallCells(dims, privacy, forced);
  }

  // ──────────────────────────────── Pantalla (d) Catálogo ────────────────────────────────

  private async screenD(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable[]> {
    return [
      await this.d1Cards(period, privacy),
      this.notMeasured('d2', 'Vistas sin venta', 'mixed', GA4_OFF),
      await this.d3SoldOut(period, privacy),
      await this.d4QuoteCounts(period),
      await this.d4bRequested(period, privacy),
    ];
  }

  /** d1 — por carta: unidades vendidas / MX$ (celdas pequeñas) / unidades a la venta hoy. Vistas=GA4. */
  private async d1Cards(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable> {
    const byCard = await this.d1Sold(period);

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

    const safe = await this.safeRows(period, privacy, async (p) => d1Dims(await this.d1Sold(p)), d1Dims(byCard));

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

  /** d1 (dimensión «carta»): unidades vendidas y MX$ (con IVA) por carta suelta, pedidos cobrados en el rango. */
  private async d1Sold(p: DayRange): Promise<SoldByCard> {
    const range = mxRange(p.from, p.to);
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
    const byCard: SoldByCard = new Map();
    for (const it of items) {
      const inv = it.inventoryItem;
      const key = `${inv.card.name} · ${inv.card.set.name} ${inv.card.number}`;
      const e = byCard.get(inv.cardId) ?? { cardId: inv.cardId, key, units: 0, mxnCents: 0 };
      e.units += 1;
      e.mxnCents += it.unitPriceCents;
      byCard.set(inv.cardId, e);
    }
    return byCard;
  }

  /** d3 — agotado con demanda: stock 0 HOY + altas de lista de deseos por carta en el periodo (celdas pequeñas). */
  private async d3SoldOut(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable> {
    const main = await this.d3Dims(period);
    const safe = await this.safeRows(period, privacy, (p) => this.d3Dims(p), main);
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
      notes: [
        main.length === 0
          ? 'Sin altas de lista de deseos en el periodo. «Vistas de ficha agotada» salen de GA4 (Fase 2).'
          : 'Cartas con 0 unidades a la venta hoy y altas de lista de deseos en el periodo. Conteo de deseos < 5 ⇒ «< 5» (§5.2).',
      ],
    };
  }

  /** d3 (dimensión «carta agotada»): altas de lista de deseos en el rango, solo cartas con 0 a la venta HOY. */
  private async d3Dims(p: DayRange): Promise<DimensionRow[]> {
    const wish = await this.prisma.wishlistItem.groupBy({
      by: ['cardId'],
      where: { createdAt: mxRange(p.from, p.to) },
      _count: { _all: true },
    });
    const cardIds = wish.map((w) => w.cardId);
    if (cardIds.length === 0) return [];
    const [cards, onSale] = await Promise.all([
      this.prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } }),
      this.prisma.inventoryItem.groupBy({ by: ['cardId'], where: { cardId: { in: cardIds }, ownerType: 'platform', status: 'listed' }, _count: { _all: true } }),
    ]);
    const cardBy = new Map(cards.map((c) => [c.id, c]));
    const onSaleBy = new Map(onSale.map((r) => [r.cardId, r._count._all]));

    // «Agotado con demanda» = 0 unidades a la venta hoy.
    const soldOut = wish.filter((w) => (onSaleBy.get(w.cardId) ?? 0) === 0);
    return soldOut.map((w) => {
      const c = cardBy.get(w.cardId);
      return { key: c ? `${c.name} · ${c.set.name} ${c.number}` : w.cardId, count: w._count._all, money: {} };
    });
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

  /**
   * d4b — buylist más SOLICITADAS (API_CONTRACT §MKT.G.4): por carta, nº de solicitudes ENVIADAS en el periodo que
   * la incluyen (mismo criterio de «enviada» que a3: `SellRequest.createdAt` en el periodo). Cuenta SOLICITUDES
   * distintas, no líneas: una solicitud ≈ una persona, que es lo que protege la celda pequeña.
   * ⛔ Sin MX$. N<5 ⇒ «< 5» con supresión complementaria.
   */
  private async d4bRequested(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable> {
    const safe = await this.safeRows(period, privacy, (p) => this.d4bDims(p));
    return {
      id: 'd4b',
      title: 'Buylist más solicitadas (cartas en solicitudes enviadas)',
      source: 'BD',
      columns: [
        { key: 'carta', labelEs: 'Carta', kind: 'text' },
        { key: 'solicitudes', labelEs: 'Solicitudes enviadas que la incluyen', kind: 'count' },
      ],
      rows: safe.map((r) => ({ carta: r.key, solicitudes: r.count as Cell })),
      measured: true,
      notes: [`Cuenta solicitudes distintas por carta (no piezas). Menos de ${SMALL_CELL_THRESHOLD} ⇒ «< 5»; sin montos.`],
    };
  }

  /** d4b (dimensión «carta solicitada»): solicitudes distintas creadas en el rango que incluyen la carta. */
  private async d4bDims(p: DayRange): Promise<DimensionRow[]> {
    const items = await this.prisma.sellRequestItem.findMany({
      where: { sellRequest: { createdAt: mxRange(p.from, p.to) } },
      select: {
        cardId: true,
        sellRequestId: true,
        card: { select: { name: true, number: true, set: { select: { name: true } } } },
      },
    });
    const byCard = new Map<string, { key: string; requests: Set<string> }>();
    for (const it of items) {
      const e = byCard.get(it.cardId) ?? { key: `${it.card.name} · ${it.card.set.name} ${it.card.number}`, requests: new Set<string>() };
      e.requests.add(it.sellRequestId);
      byCard.set(it.cardId, e);
    }
    return [...byCard.values()]
      .map((e) => ({ key: e.key, count: e.requests.size, money: {} }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  // ──────────────────────────────── Pantalla (c) Comportamiento ────────────────────────────────

  private async screenC(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable[]> {
    return [
      this.notMeasured('c1', 'Páginas y fichas más vistas', 'GA4', GA4_OFF),
      this.notMeasured('c2', 'Dónde pasan más tiempo', 'GA4', GA4_OFF),
      this.notMeasured('c3', 'Dónde abandonan', 'GA4', GA4_OFF),
      this.notMeasured('c4', '% de fichas donde el botón COMPRAR se ve', 'GA4', GA4_OFF),
      this.notMeasured('c5', 'Dispositivo y navegador de Instagram', 'GA4', GA4_OFF),
      this.notMeasured('c6', 'Búsquedas sin resultado', 'Srv', SEARCH_LOG_OFF),
      await this.c7ByState(period, privacy),
      this.notMeasured('c8', 'Página de aterrizaje de Instagram', 'GA4', GA4_OFF),
    ];
  }

  /** c7 (P5=B, PM-B2) — nº de pedidos por estado de envío. SIN MX$, sin cruce. Mínimo 4 semanas. */
  private async c7ByState(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable> {
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
        notMeasuredReason: C7_MIN_PERIOD,
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
    const sorted = [...byState.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (privacy === 'exact') {
      // Régimen exacto: cada estado con su número real, sin agrupar (mismo cálculo, otro régimen).
      for (const [state, n] of sorted) rows.push({ estado: state, pedidos: n });
      if (pickup > 0) rows.push({ estado: 'Recogida en persona', pedidos: pickup });
      return { id: 'c7', title: 'Nº de pedidos por estado de envío', source: 'BD', columns, rows, measured: true, notes: [C7_NOTE_SOURCE] };
    }
    let otros = 0;
    for (const [state, n] of sorted) {
      if (n < SMALL_CELL_THRESHOLD) otros += n;
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
      notes: [C7_NOTE_SOURCE, 'Estados con menos de 5 pedidos agrupados en «Otros estados». «Recogida en persona» = pedidos de bóveda/recogida.'],
    };
  }

  // ──────────────────────────────── Pantallas sin BD en Fase 0 ────────────────────────────────

  /** (f) f1/f2: el modelo existe pero el banner es Fase 2 ⇒ sin camino de escritura ⇒ NO MEDIDO. */
  private screenFbannerPending(): AggTable[] {
    return [
      this.notMeasured('f1', 'Tasa de aceptación del banner', 'Srv', BANNER_OFF),
      this.notMeasured('f3', 'Cobertura: % de pedidos con origen', 'BD', ORIGIN_OFF),
    ];
  }

  // ──────────────────────────────── Pantalla (h) Anotaciones de fecha ────────────────────────────────

  /**
   * h1 (§13.4.6) — las anotaciones del periodo como tabla (día, tipo, etiqueta, destino). Es TEXTO del
   * admin (saneado al exportar, PM-B1); ⛔ NO es un conteo ⇒ no aplica §5.2 (celdas pequeñas).
   */
  private screenH(annotations: EmbeddedAnnotation[]): AggTable[] {
    return [
      {
        id: 'h1',
        title: 'Anotaciones de fecha (promociones, despliegues, eventos)',
        source: 'BD',
        columns: [
          { key: 'date', labelEs: 'Fecha', kind: 'text' },
          { key: 'kind', labelEs: 'Tipo', kind: 'text' },
          { key: 'label', labelEs: 'Etiqueta', kind: 'text' },
          { key: 'destino', labelEs: 'Destino (solo promoción)', kind: 'text' },
        ],
        rows: annotations.map((a) => ({ date: a.date, kind: a.kind, label: a.label, destino: a.destino ?? null })),
        measured: true,
        notes: ['Texto del admin, SIN datos personales (validado en el servidor). No es un conteo ⇒ sin supresión de celda pequeña.'],
      },
    ];
  }

  /** (b) Origen — GA4 y atribución por `first_utm_*` (vacía hasta que haya consentimiento, Fase 2). */
  private screenB(): AggTable[] {
    return [
      this.notMeasured('b1', 'Origen por utm_*', 'mixed', GA4_AND_ORIGIN_OFF),
      this.notMeasured('b2', 'Instagram por puerta (bio, story, promoción, mensaje directo)', 'mixed', GA4_AND_ORIGIN_OFF),
      this.notMeasured('b3', 'Por pieza (utm_content)', 'mixed', GA4_AND_ORIGIN_OFF),
      this.notMeasured('b4', 'Google orgánico, directo, referencias e IA', 'GA4', GA4_OFF),
    ];
  }

  /** (e) Buscadores e IA — Search Console y GA4. */
  private screenE(): AggTable[] {
    return [
      this.notMeasured('e1', 'Consultas de Google', 'SC', SC_OFF),
      this.notMeasured('e3', 'Referencias de asistentes de IA', 'GA4', GA4_OFF),
    ];
  }

  /** (g) Promociones — atribución `utm_medium=paid` (vacía hasta que haya consentimiento, Fase 2). */
  private screenG(): AggTable[] {
    return [this.notMeasured('g1', 'Compras atribuidas a promociones (utm_medium=paid)', 'BD', ORIGIN_OFF)];
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
