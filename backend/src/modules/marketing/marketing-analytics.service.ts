/**
 * marketing-analytics.service.ts — 💰(lee, no mueve) el núcleo de agregados del Panel de Marketing
 * Fase 0 (Brief 2 §2/§3/§5; ARCHITECTURE §13.4.5/§13.5; API_CONTRACT §MKT.E). COMPONE
 * `sales-analytics` para las cifras de dinero (a1/a2) y añade los agregados propios (a3, d1, d3, d4,
 * c7) con las **celdas pequeñas** (§5.2). Las columnas que dependen de GA4/Search Console salen como
 * «NO MEDIDO — GA4 sin encender», NUNCA «0» (Brief 2 §2 convenciones).
 *
 * ⛔ Solo lectura. ⛔ Ninguna fila por pedido/solicitud (ni con id opaco). ⛔ No toca `sales-analytics`.
 */
import { Injectable, Optional } from '@nestjs/common';
import { OrderStatus, ProductType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesAnalyticsService } from '../sales-analytics/sales-analytics.service';
import { addDays, daysBetween, isoWeekday, mxRange, type Ymd } from '../sales-analytics/sales-period';
// v1.102⟨mkt-fase2⟩ (§MKT.H.9): f1/f3/g1 con Fase 2 y la lectura de GA4 / Search Console.
import { MeasurementService } from '../measurement/measurement.service';
import { BANNER_RESPONSES } from '../measurement/banner-response.service';
import { MarketingExternalSources } from './marketing-external-sources';
import { PRODUCT_TYPE_VALUES } from '../../common/enum-values';
import {
  applySmallCells,
  hiddenKeys,
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
const ORIGIN_OFF = 'NO MEDIDO — el origen de los pedidos aún no se registra (requiere el aviso de cookies con consentimiento)';
const GA4_AND_ORIGIN_OFF = 'NO MEDIDO — GA4 sin encender y el origen de los pedidos aún no se registra';
const BANNER_OFF = 'NO MEDIDO — el aviso de cookies todavía no está publicado';
/* v1.102⟨mkt-fase2⟩ (API_CONTRACT §MKT.H.9): con la medición encendida, el motivo de las tablas externas dice qué falta. */
const GA4_UNCONNECTED = 'NO MEDIDO — GA4 sin conectar';
const GA4_NO_QUERY = 'NO MEDIDO — GA4 conectado; la consulta de esta tabla todavía no está definida';
const SC_UNCONNECTED = 'NO MEDIDO — Search Console sin conectar';
const BANNER_LABEL: Record<(typeof BANNER_RESPONSES)[number], string> = {
  accept: 'Aceptar',
  necessary_only: 'Solo lo necesario',
  custom: 'Configurar (elección mixta)',
  no_response: 'Sin respuesta',
};
/** Clave de la fila de g1 (clave de cruce mes↔semanas). */
const G1_KEY = 'Pedidos con primer origen utm_medium=paid';
/** Lunes de la semana del día dado (f1 cuenta semanas por su `weekStart`). */
const mondayOf = (day: Ymd): Ymd => addDays(day, 1 - isoWeekday(day));
const SEARCH_LOG_OFF =
  'NO MEDIDO — pendiente de la revisión de seguridad; el registro de búsquedas sin resultado no existe todavía';
const C7_MIN_PERIOD = 'NO MEDIDO — esta tabla necesita un periodo de al menos 4 semanas; elige un mes cerrado';
/** c7: mínimo de días del periodo (4 semanas, Brief 2 c7). */
const C7_MIN_DAYS = 28;
const c7Measurable = (p: DayRange): boolean => daysBetween(p.from, p.to) + 1 >= C7_MIN_DAYS;
const C7_OTHER_STATES = 'Otros estados';
const C7_PICKUP = 'Recogida en persona';
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

/** Nota de régimen en exact (vista del dueño): las notas «N<umbral ⇒ «< 5»» solo son verdad en `small_cells`. */
export const EXACT_CELLS_NOTE = 'Vista del dueño: cifras exactas. Fuera de esta pantalla (exports, analista) las celdas pequeñas se ocultan.';
/** La nota de celdas pequeñas de una tabla, o la de cifras exactas si el régimen es el del dueño (techlead D3). */
const cellsNote = (privacy: CellPrivacy, smallCellsText: string): string =>
  privacy === 'small_cells' ? smallCellsText : EXACT_CELLS_NOTE;

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
    // v1.102⟨mkt-fase2⟩ (§MKT.H.9): `@Optional()` por las pruebas que construyen el servicio a mano (⇒ modo apagado y
    // fuentes externas sin conectar).
    @Optional() private readonly measurement?: MeasurementService,
    @Optional() private readonly external?: MarketingExternalSources,
  ) {}

  /** Motivo de una tabla GA4: apagado ⇒ «sin encender»; encendido sin credenciales ⇒ «sin conectar». */
  private ga4Reason(): string {
    if (this.measurement?.mode !== 'on') return GA4_OFF;
    return this.external?.ga4Configured() ? GA4_NO_QUERY : GA4_UNCONNECTED;
  }

  /** Motivo de b1-b3 (GA4 + `first_utm_*`): con el modo apagado tampoco se registra el origen. */
  private ga4AndOriginReason(): string {
    return this.measurement?.mode === 'on' ? this.ga4Reason() : GA4_AND_ORIGIN_OFF;
  }

  /**
   * f3/g1 se miden con la medición ENCENDIDA (§MKT.H.9: «pasan a medidos cuando haya filas con consentimiento», y solo
   * el modo `on` las escribe). Con `off` siguen NO MEDIDO, como en Fase 0. Los pedidos de antes de encender (consentimiento
   * NULL) se cuentan aparte en f3 como «antes de Fase 2».
   */
  private originMeasured(): boolean {
    return this.measurement?.mode === 'on';
  }

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
        return { ...base, tables: await this.screenE(period, now, privacy) };
      case 'f':
        return { ...base, tables: [await this.f1Banner(period), await this.f3Coverage(period)] };
      case 'g':
        return { ...base, tables: await this.screenG(period, privacy) };
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

    const a4: AggTable = this.notMeasured('a4', 'Visitas y de dónde (5 grupos)', 'GA4', this.ga4Reason());
    const a5: AggTable = this.notMeasured('a5', 'Embudo sesiones → compra', 'GA4', this.ga4Reason());

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
      notes: [
        '«MX$ ofertado» = suma de lo cotizado al enviar; «pagado» = payout neto de las solicitudes pagadas en el periodo.',
        cellsNote(privacy, `Pagadas con menos de ${SMALL_CELL_THRESHOLD} ⇒ «< 5» sin MX$ (PM-A1).`),
      ],
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
      this.notMeasured('d2', 'Vistas sin venta', 'mixed', this.ga4Reason()),
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
        vistas: this.ga4Reason(),
        unidadesVendidas: r.count as Cell,
        mxn: (r.money.mxn ?? null) as Cell,
        // La fila agrupada «Otros» no mapea a una carta ⇒ su stock es null.
        aLaVentaHoy: r.otros ? null : (stockByKey.get(r.key) ?? 0),
      })),
      measured: true,
      notes: [
        '«Fichas vistas» y carritos salen de GA4 (Fase 2).',
        cellsNote(privacy, `Unidades vendidas menos de ${SMALL_CELL_THRESHOLD} ⇒ «< 5» sin MX$ (§5.2).`),
      ],
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
      notes:
        main.length === 0
          ? ['Sin altas de lista de deseos en el periodo. «Vistas de ficha agotada» salen de GA4 (Fase 2).']
          : [
              'Cartas con 0 unidades a la venta hoy y altas de lista de deseos en el periodo.',
              cellsNote(privacy, `Conteo de deseos menor que ${SMALL_CELL_THRESHOLD} ⇒ «< 5» (§5.2).`),
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
      notes: ['Cuenta solicitudes distintas por carta (no piezas); sin montos.', cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} ⇒ «< 5».`)],
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
      this.notMeasured('c1', 'Páginas y fichas más vistas', 'GA4', this.ga4Reason()),
      this.notMeasured('c2', 'Dónde pasan más tiempo', 'GA4', this.ga4Reason()),
      this.notMeasured('c3', 'Dónde abandonan', 'GA4', this.ga4Reason()),
      this.notMeasured('c4', '% de fichas donde el botón COMPRAR se ve', 'GA4', this.ga4Reason()),
      this.notMeasured('c5', 'Dispositivo y navegador de Instagram', 'GA4', this.ga4Reason()),
      this.notMeasured('c6', 'Búsquedas sin resultado', 'Srv', SEARCH_LOG_OFF),
      await this.c7ByState(period, privacy),
      this.notMeasured('c8', 'Página de aterrizaje de Instagram', 'GA4', this.ga4Reason()),
    ];
  }

  /**
   * c7 (P5=B, PM-B2) — nº de pedidos por estado de envío. SIN MX$, sin cruce. Mínimo 4 semanas.
   * Pasa por `safeRows` como toda tabla con dimensión (techlead D1, 2026-10-18): hereda umbral, régimen y supresión
   * complementaria de `small-cells.ts` — ⛔ sin camino propio de celdas pequeñas.
   */
  private async c7ByState(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable> {
    const columns = [
      { key: 'estado', labelEs: 'Estado', kind: 'text' as const },
      { key: 'pedidos', labelEs: 'Pedidos', kind: 'count' as const },
    ];
    if (!c7Measurable(period)) {
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
    const safe = await this.safeRows(period, privacy, (p) => this.c7Dims(p));
    return {
      id: 'c7',
      title: 'Nº de pedidos por estado de envío',
      source: 'BD',
      columns,
      rows: safe.map((r) => ({ estado: r.key, pedidos: r.count as Cell })),
      measured: true,
      notes: [
        C7_NOTE_SOURCE,
        `Estados con menos de ${SMALL_CELL_THRESHOLD} pedidos agrupados en «Otros estados». «Recogida en persona» = pedidos de bóveda/recogida.`,
      ],
    };
  }

  /**
   * c7 (dimensión «estado»): filas YA agrupadas — estados con N≥umbral, «Otros estados» (suma de los estados con
   * N<umbral, PM-B2: nunca un estado solo) y «Recogida en persona». La agrupación es ESTRUCTURA de c7 (vale también
   * en `exact`, API_CONTRACT §MKT.G.2 «lo que exact NO levanta»); el umbral de la fila y la complementaria los pone
   * `safeRows`. Para un rango de menos de 4 semanas devuelve `[]`: c7 semanal no se publica (NO MEDIDO), así que la
   * coherencia mes↔semanas (§MKT.G.10) no tiene semana que restar y no hereda ocultas de ahí.
   */
  private async c7Dims(p: DayRange): Promise<DimensionRow[]> {
    if (!c7Measurable(p)) return [];
    const orders = await this.prisma.order.findMany({
      where: { settledAt: mxRange(p.from, p.to), status: { in: SOLD_STATUSES } },
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
    const rows: DimensionRow[] = [];
    let otros = 0;
    const sorted = [...byState.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [state, n] of sorted) {
      if (n < SMALL_CELL_THRESHOLD) otros += n;
      else rows.push({ key: state, count: n, money: {} });
    }
    if (otros > 0) rows.push({ key: C7_OTHER_STATES, count: otros, money: {} });
    if (pickup > 0) rows.push({ key: C7_PICKUP, count: pickup, money: {} });
    return rows;
  }

  // ──────────────────────────────── Pantalla (f) Consentimiento (Fase 2) ────────────────────────────────

  /**
   * f1/f2 (API_CONTRACT §MKT.H.9). Con la medición apagada el banner no existe ⇒ NO MEDIDO. Con `on`, de
   * `MarketingBannerConsentCounter`: las cuatro respuestas (`custom` incluida) y columnas por dispositivo (f2). Contador
   * anónimo sin fila por visita ⇒ no identifica a persona ⇒ sin celdas pequeñas (como d4). Semanas cuyo lunes cae en el
   * periodo (o es el lunes de su primer día).
   */
  private async f1Banner(period: MarketingPeriod): Promise<AggTable> {
    if (this.measurement?.mode !== 'on') return this.notMeasured('f1', 'Tasa de aceptación del banner', 'Srv', BANNER_OFF);
    const grouped = await this.prisma.marketingBannerConsentCounter.groupBy({
      by: ['response', 'device'],
      where: { weekStart: { gte: new Date(`${mondayOf(period.from)}T00:00:00.000Z`), lte: new Date(`${period.to}T00:00:00.000Z`) } },
      _sum: { count: true },
    });
    const sum = (r: string, device?: string | null): number =>
      grouped
        .filter((g) => g.response === r && (device === undefined || g.device === device))
        .reduce((n, g) => n + (g._sum.count ?? 0), 0);
    const all = BANNER_RESPONSES.reduce((n, r) => n + sum(r), 0);
    const accept = sum('accept');
    return {
      id: 'f1',
      title: 'Tasa de aceptación del banner',
      source: 'Srv',
      columns: [
        { key: 'respuesta', labelEs: 'Respuesta', kind: 'text' },
        { key: 'total', labelEs: 'Total', kind: 'count' },
        { key: 'movil', labelEs: 'Móvil', tech: 'device', kind: 'count' },
        { key: 'escritorio', labelEs: 'Escritorio', tech: 'device', kind: 'count' },
        { key: 'tableta', labelEs: 'Tableta', tech: 'device', kind: 'count' },
        { key: 'sinDato', labelEs: 'Sin dato de dispositivo', tech: 'device', kind: 'count' },
      ],
      rows: BANNER_RESPONSES.map((r) => ({
        respuesta: BANNER_LABEL[r],
        total: sum(r),
        movil: sum(r, 'móvil'),
        escritorio: sum(r, 'escritorio'),
        tableta: sum(r, 'tableta'),
        sinDato: sum(r, null),
      })),
      measured: true,
      notes: [
        all === 0
          ? 'Sin respuestas al banner en el periodo.'
          : `Tasa de aceptación = Aceptar / total de respuestas = ${Math.round((accept / all) * 1000) / 10}% (${accept} de ${all}).`,
        'Conteo ANÓNIMO por semana (sin cookie, sin IP, sin fila por visita). El dispositivo se deriva del navegador en el servidor; el navegador no se guarda.',
      ],
    };
  }

  /** f3 — cobertura: pedidos pagados con origen (`firstUtmSource`), con analítica aceptada y «antes de Fase 2». Totales exactos. */
  private async f3Coverage(period: MarketingPeriod): Promise<AggTable> {
    if (!this.originMeasured()) return this.notMeasured('f3', 'Cobertura: % de pedidos con origen', 'BD', ORIGIN_OFF);
    const where = { settledAt: mxRange(period.from, period.to), status: { in: SOLD_STATUSES } };
    const paid = await this.prisma.order.count({ where });
    const withOrigin = await this.prisma.order.count({ where: { ...where, firstUtmSource: { not: null } } });
    const consented = await this.prisma.order.count({ where: { ...where, measurementConsentAnalytics: true } });
    const before = await this.prisma.order.count({ where: { ...where, measurementConsentAnalytics: null } });
    const pct = (n: number): number | null => (paid === 0 ? null : Math.round((n / paid) * 1000) / 10);
    return {
      id: 'f3',
      title: 'Cobertura: % de pedidos con origen',
      source: 'BD',
      columns: [
        { key: 'concepto', labelEs: 'Concepto', kind: 'text' },
        { key: 'pedidos', labelEs: 'Pedidos pagados', kind: 'count' },
        { key: 'pct', labelEs: '% de los pagados', kind: 'pct' },
      ],
      rows: [
        { concepto: 'Pedidos pagados del periodo', pedidos: paid, pct: paid === 0 ? null : 100 },
        { concepto: 'Con origen registrado (first_utm_source)', pedidos: withOrigin, pct: pct(withOrigin) },
        { concepto: 'Aceptaron analítica', pedidos: consented, pct: pct(consented) },
        { concepto: 'Antes de Fase 2 (sin consentimiento registrado)', pedidos: before, pct: pct(before) },
      ],
      measured: true,
      notes: ['Totales SIN dimensión: cifras exactas. El origen solo se guarda si el cliente aceptó analítica.'],
    };
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
      this.notMeasured('b1', 'Origen por utm_*', 'mixed', this.ga4AndOriginReason()),
      this.notMeasured('b2', 'Instagram por puerta (bio, story, promoción, mensaje directo)', 'mixed', this.ga4AndOriginReason()),
      this.notMeasured('b3', 'Por pieza (utm_content)', 'mixed', this.ga4AndOriginReason()),
      this.notMeasured('b4', 'Google orgánico, directo, referencias e IA', 'GA4', this.ga4Reason()),
    ];
  }

  /** (e) Buscadores e IA — e1 de Search Console (no depende del aviso), e3 de GA4. */
  private async screenE(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
    return [
      await this.e1SearchConsole(period, now, privacy),
      this.notMeasured('e3', 'Referencias de asistentes de IA', 'GA4', this.ga4Reason()),
    ];
  }

  /**
   * e1 — consultas de Google (Search Console API). Sin credenciales o con error ⇒ «NO MEDIDO — Search Console sin
   * conectar» (§MKT.H.9). Tabla con dimensión (una consulta puede ser un nombre propio) ⇒ celdas pequeñas sobre los clics
   * y coherencia mes↔semanas (§MKT.G.10) como cualquier otra. La consulta es texto de fuera: el export la sanea.
   */
  private async e1SearchConsole(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const ext = this.external;
    if (!ext?.searchConsoleConfigured()) return this.notMeasured('e1', 'Consultas de Google', 'SC', SC_UNCONNECTED);
    const dimsOf = async (p: DayRange): Promise<DimensionRow[]> => {
      const r = await ext.searchConsoleQueries(p.from, p.to, now);
      if (!r.ok) throw new Error('search console unavailable');
      return r.rows.map((q) => ({ key: q.query, count: q.clicks, money: { impresiones: q.impressions, ctr: q.ctr, posicion: q.position } }));
    };
    let safe: SafeRow[];
    try {
      safe = await this.safeRows(period, privacy, dimsOf);
    } catch {
      return this.notMeasured('e1', 'Consultas de Google', 'SC', SC_UNCONNECTED);
    }
    const round = (v: number | null | undefined, f: number): number | null => (v === null || v === undefined ? null : Math.round(v * f) / f);
    return {
      id: 'e1',
      title: 'Consultas de Google',
      source: 'SC',
      columns: [
        { key: 'consulta', labelEs: 'Consulta', tech: 'query', kind: 'text' },
        { key: 'clics', labelEs: 'Clics', tech: 'clicks', kind: 'count' },
        { key: 'impresiones', labelEs: 'Impresiones', tech: 'impressions', kind: 'count' },
        { key: 'ctr', labelEs: 'CTR (%)', tech: 'ctr', kind: 'pct' },
        { key: 'posicion', labelEs: 'Posición media', tech: 'position', kind: 'number' },
      ],
      rows: safe.map((r) => ({
        consulta: r.key,
        clics: r.count as Cell,
        impresiones: r.money.impresiones ?? null,
        ctr: r.money.ctr === null || r.money.ctr === undefined ? null : round(r.money.ctr * 100, 10),
        posicion: round(r.money.posicion, 10),
      })),
      measured: true,
      notes: [
        'Search Console (hasta 50 consultas, por clics). No recoge nada del visitante ni pone cookies.',
        cellsNote(privacy, `Consultas con menos de ${SMALL_CELL_THRESHOLD} clics ⇒ «< 5» sin el resto de cifras (§5.2).`),
      ],
    };
  }

  /** (g) g1 — compras pagadas con `first_utm_medium = paid` (Fase 2). N<5 ⇒ «< 5» sin MX$ (como a3 pagadas). */
  private async screenG(period: MarketingPeriod, privacy: CellPrivacy): Promise<AggTable[]> {
    if (!this.originMeasured()) {
      return [this.notMeasured('g1', 'Compras atribuidas a promociones (utm_medium=paid)', 'BD', ORIGIN_OFF)];
    }
    const [row] = await this.safeRows(period, privacy, (p) => this.g1Dims(p));
    return [
      {
        id: 'g1',
        title: 'Compras atribuidas a promociones (utm_medium=paid)',
        source: 'BD',
        columns: [
          { key: 'concepto', labelEs: 'Concepto', kind: 'text' },
          { key: 'pedidos', labelEs: 'Pedidos pagados', kind: 'count' },
          { key: 'mxn', labelEs: 'MX$ (IVA incluido)', kind: 'money' },
        ],
        rows: [{ concepto: G1_KEY, pedidos: row.count as Cell, mxn: (row.money.mxn ?? null) as Cell }],
        measured: true,
        notes: [
          'Primer origen guardado con el pedido (solo de quien aceptó analítica): cuenta lo que se puede atribuir, no todo lo que trajo la promoción.',
          cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} pedidos ⇒ «< 5» sin MX$.`),
        ],
      },
    ];
  }

  /** g1 (dimensión única): pedidos cobrados en el rango con primer origen `paid`, y su MX$ con IVA. */
  private async g1Dims(p: DayRange): Promise<DimensionRow[]> {
    const agg = await this.prisma.order.aggregate({
      where: { settledAt: mxRange(p.from, p.to), status: { in: SOLD_STATUSES }, firstUtmMedium: 'paid' },
      _count: { _all: true },
      _sum: { totalCents: true },
    });
    return [{ key: G1_KEY, count: agg._count._all, money: { mxn: centsToPesos(agg._sum.totalCents ?? 0) } }];
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
