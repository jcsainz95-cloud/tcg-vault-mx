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
import { measurementItemOf, parseMeasurementItemId } from '../measurement/measurement-item';
import { UNIDENTIFIED_SEALED_NAME } from '../../common/piece-display-identity';
import { MarketingExternalSources, type Ga4ReportSpec, type Ga4Row } from './marketing-external-sources';
import {
  AI_ASSISTANT_SOURCES,
  D2_MIN_VIEWS,
  FUNNEL_EVENTS,
  GA4_SPECS,
  a4Rows,
  b4Rows,
  c1Rows,
  c5Rows,
  e3Rows,
  fichaOf,
  itemViews,
} from './marketing-ga4';
import { readFrozenCardFacts } from '../orders/order-item-card';

/** b1-b3 (§MKT.H.9): clave de fila desde `first_utm_*`; `null` ⇒ el pedido/solicitud no entra en esa tabla. */
type BKey = (source: string | null, medium: string | null, content: string | null) => string | null;
const DOOR_LABEL: Record<string, string> = { bio: 'Bio', story: 'Story', paid: 'Promoción', dm: 'Mensaje directo' };
const bKeyOrigin: BKey = (s, m) => (s ? `${s} / ${m ?? '—'}` : null);
const bKeyDoor: BKey = (_s, m) => (m && DOOR_LABEL[m] ? DOOR_LABEL[m] : null);
// `dm` en una sola fila: un mensaje directo no tiene pieza que publicar.
const bKeyPiece: BKey = (_s, m, c) => (m === 'dm' ? 'Mensaje directo (dm)' : (c ?? null));
import { PRODUCT_TYPE_VALUES } from '../../common/enum-values';
import {
  applySmallCells,
  applySmallCellsByComponent,
  hiddenCellIds,
  hiddenKeys,
  type CellId,
  type ComponentRow,
  type SafeComponentRow,
  SMALL_CELL_HIDDEN,
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
const ORIGIN_OFF = 'NO MEDIDO — el origen de los pedidos aún no se registra (requiere el aviso de cookies con consentimiento)';
const BANNER_OFF = 'NO MEDIDO — el aviso de cookies todavía no está publicado';
/* v1.102⟨mkt-fase2⟩ (API_CONTRACT §MKT.H.9): con la medición encendida, el motivo de las tablas externas dice qué falta. */
const GA4_UNCONNECTED = 'NO MEDIDO — GA4 sin conectar';
/* v1.105⟨mkt-fase2-cierre⟩ (§MKT.H.9): tablas diferidas, con su motivo literal. */
const PAGE_TYPE_DEFERRED = 'NO MEDIDO — la clasificación por tipo de página no está definida todavía';
const ABANDON_DEFERRED = 'NO MEDIDO — la consulta de abandono no está definida todavía';
const BUY_BUTTON_DEFERRED = 'NO MEDIDO — el evento del botón COMPRAR todavía no se envía';
const B_SESSIONS_NOTE =
  'Sesiones por primer origen no entran: exigirían dimensiones de evento propias en la consola de GA4. Pedidos y solicitudes de quien aceptó la analítica.';
const SC_UNCONNECTED = 'NO MEDIDO — Search Console sin conectar';
/** b1-b3: nota literal de §MKT.H.14 («Fila de b1-b3»). */
export const B_CELLS_NOTE = 'Pedidos y solicitudes se ocultan por separado: menos de 5 ⇒ «< 5» sin su MX$.';
/** Conteo real de un componente (solo en `exact`, donde todo es número). */
const num = (r: SafeComponentRow, c: string): number => (typeof r.parts[c].count === 'number' ? (r.parts[c].count as number) : 0);
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
 * Línea de cobertura de TODA pantalla — los dos textos LITERALES de API_CONTRACT v1.105 §MKT.H.9, según `MEASUREMENT_MODE`.
 * La pinta la pantalla arriba; el export la lleva en «Info». `COVERAGE_NOTE` es el de `off` (lo lee también el mock del
 * frontend, `frontend/src/lib/mock/marketing.parity.test.ts`).
 */
export const COVERAGE_NOTE = 'Cobertura: GA4 sin encender; el origen de los pedidos aún no se registra.';
export const COVERAGE_NOTE_ON = 'Cobertura: GA4 y el origen de los pedidos solo cuentan a quien aceptó la analítica; la proporción está en f3.';

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

type SoldByCard = Map<string, { cardId: string; key: string; units: number; orders: Set<string>; mxnCents: number }>;

/** d1: filas crudas por carta. Publica unidades vendidas y MX$; el umbral lo deciden los PEDIDOS distintos (§MKT.H.14 R1). */
const d1Dims = (byCard: SoldByCard): DimensionRow[] =>
  [...byCard.values()].map((e) => ({ key: e.key, count: e.units, subjects: e.orders.size, money: { mxn: centsToPesos(e.mxnCents) } }));

/**
 * C-P1 (API_CONTRACT v1.106 §MKT.G.5): `null` es SIEMPRE «sin dato». En una fila cuyo conteo salió oculto (`'< 5'` u `'oculta'`),
 * toda celda no `text` que quedara `null` pasa a `'oculta'`. Una sola pasada sobre toda tabla de toda pantalla (y, por tanto, de
 * export y `aggregates`, que salen de `screen()`): ninguna tabla nueva puede olvidarse de la regla.
 */
export function sealHiddenRows(t: AggTable): AggTable {
  if (!t.measured) return t;
  const nonText = t.columns.filter((c) => c.kind !== 'text').map((c) => c.key);
  return {
    ...t,
    rows: t.rows.map((r) => {
      if (!Object.values(r).some((v) => v === SMALL_CELL_SENTINEL || v === SMALL_CELL_HIDDEN)) return r;
      const out = { ...r };
      for (const k of nonText) if (out[k] === null || out[k] === undefined) out[k] = SMALL_CELL_HIDDEN;
      return out;
    }),
  };
}

/** Nota de régimen en exact (vista del dueño): las notas «N<umbral ⇒ «< 5»» solo son verdad en `small_cells`. */
export const EXACT_CELLS_NOTE = 'Vista del dueño: cifras exactas. Fuera de esta pantalla (exports, analista) las celdas pequeñas se ocultan.';
/** La nota de celdas pequeñas de una tabla, o la de cifras exactas si el régimen es el del dueño (techlead D3). */
const cellsNote = (privacy: CellPrivacy, smallCellsText: string): string =>
  privacy === 'small_cells' ? smallCellsText : EXACT_CELLS_NOTE;

/**
 * TL-MKT2b-d — qué es «Usuarios» en c1, en palabras del dueño. `c1Rows` (marketing-ga4.ts) junta `/es/…` y `/en/…` en una
 * fila y GA4 no da los únicos de la unión: con número, la cifra es la SUMA por idioma (cota alta: quien vio las dos versiones
 * cuenta dos veces); si ningún idioma llega al umbral, la cifra es la del idioma con más usuarios (cota baja: la unión puede
 * llegar al umbral). En `small_cells` esa cota baja sale «< 5»; en `exact`, como número.
 */
export const c1UsersNote = (privacy: CellPrivacy): string =>
  `Usuarios se suma por idioma: quien vio la versión en español y la en inglés cuenta dos veces, así que puede ser más alto que el real. ` +
  (privacy === 'small_cells'
    ? `Sale «< 5» si ningún idioma llega a ${SMALL_CELL_THRESHOLD}, aunque entre los dos sí lleguen.`
    : `Si ningún idioma llega a ${SMALL_CELL_THRESHOLD}, sale el del idioma con más usuarios, y el real puede ser más alto.`);

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

  /** Motivo de una tabla GA4 sin datos: apagado ⇒ «sin encender»; encendido sin credenciales o con fallo ⇒ «sin conectar». */
  private ga4Reason(): string {
    return this.measurement?.mode !== 'on' ? GA4_OFF : GA4_UNCONNECTED;
  }

  /** ¿Se puede consultar GA4? Solo con `on` y credenciales (§MKT.H.9). */
  private ga4Live(): boolean {
    return this.measurement?.mode === 'on' && this.external?.ga4Configured() === true;
  }

  /** Lee un `runReport`; `null` ⇒ la tabla sale «sin conectar» (una consulta que falla no tumba la pantalla). */
  private async ga4(spec: Ga4ReportSpec, p: DayRange, now: Date): Promise<Ga4Row[] | null> {
    if (!this.ga4Live() || !this.external) return null;
    const r = await this.external.ga4Report(spec, p.from, p.to, now);
    return r.ok ? r.rows : null;
  }

  /**
   * GA4 con dimensión ⇒ celdas pequeñas y coherencia mes↔semanas como cualquier otra (`safeRows`). `null` ⇒ sin datos.
   */
  private async ga4SafeRows(
    spec: Ga4ReportSpec,
    period: MarketingPeriod,
    now: Date,
    privacy: CellPrivacy,
    compute: (rows: Ga4Row[]) => DimensionRow[] | Promise<DimensionRow[]>,
  ): Promise<SafeRow[] | null> {
    if (!this.ga4Live()) return null;
    try {
      return await this.safeRows(period, privacy, async (p) => {
        const rows = await this.ga4(spec, p, now);
        if (!rows) throw new Error('ga4 unavailable');
        return compute(rows);
      });
    } catch {
      return null;
    }
  }

  /**
   * f3/g1 y las columnas BD de b1-b3 (§MKT.H.9): con `on`, **o** con `off` si el periodo ya tiene algún pedido pagado con
   * `measurementConsentAnalytics IS NOT NULL` (la medición estuvo encendida y se apagó). Si no, Fase 0.
   */
  private async originMeasured(p: DayRange): Promise<boolean> {
    if (this.measurement?.mode === 'on') return true;
    const n = await this.prisma.order.count({
      where: { settledAt: mxRange(p.from, p.to), status: { in: SOLD_STATUSES }, measurementConsentAnalytics: { not: null } },
    });
    return n > 0;
  }

  /** f1 (§MKT.H.9): con `on`, **o** con `off` si el contador tiene alguna fila de las semanas del periodo. */
  private async bannerMeasured(period: MarketingPeriod): Promise<boolean> {
    if (this.measurement?.mode === 'on') return true;
    const n = await this.prisma.marketingBannerConsentCounter.count({ where: { weekStart: this.bannerWeeks(period) } });
    return n > 0;
  }

  private bannerWeeks(period: MarketingPeriod): { gte: Date; lte: Date } {
    return { gte: new Date(`${mondayOf(period.from)}T00:00:00.000Z`), lte: new Date(`${period.to}T00:00:00.000Z`) };
  }

  /**
   * Punto de entrada ÚNICO: arma el payload de UNA pantalla para un periodo cerrado. Lo usan `aggregates`, `panel`
   * y los exports (paridad por construcción, §MKT.G.2). `privacy` es el régimen de celdas, **obligatorio y sin
   * valor por defecto** (API_CONTRACT v1.103 §MKT.G.2 / ARCHITECTURE §13.7 D-MKT-PANEL-2): una salida nueva no
   * puede nacer exacta por olvido. Es un parámetro del MISMO cálculo, no un segundo camino.
   */
  async screen(screen: MarketingScreen, period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<ScreenPayload> {
    const payload = await this.screenRaw(screen, period, now, privacy);
    return { ...payload, tables: payload.tables.map(sealHiddenRows) };
  }

  private async screenRaw(screen: MarketingScreen, period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<ScreenPayload> {
    // Anotaciones del periodo: EMBEBIDAS en toda pantalla (pintan a/b/c y la hoja «Info»), h1/§13.4.6.
    const annotations = await this.annotations.forPeriod(period.from, period.to);
    const base = {
      screen,
      period: { kind: period.kind, from: period.from, to: period.to, label: period.label, timezone: 'America/Mexico_City' as const },
      sourceLegend: SOURCE_LEGEND,
      annotations,
      notes: [this.measurement?.mode === 'on' ? COVERAGE_NOTE_ON : COVERAGE_NOTE],
      privacy,
    };
    // Catálogo y ORDEN de tablas: API_CONTRACT §MKT.G.4 (candado `marketing-panel.spec.ts`, §MKT.G.9 (6)).
    switch (screen) {
      case 'a':
        return { ...base, previousPeriod: period.prev, tables: await this.screenA(period, now, privacy) };
      case 'b':
        return { ...base, tables: await this.screenB(period, now, privacy) };
      case 'c':
        return { ...base, tables: await this.screenC(period, now, privacy) };
      case 'd':
        return { ...base, tables: await this.screenD(period, now, privacy) };
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

    return [a1, a2, a3, await this.a4Visits(period, now, privacy), await this.a5Funnel(period, now)];
  }

  /** a4 (§MKT.H.9) — sesiones por los cinco grupos de origen. */
  private async a4Visits(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Visitas y de dónde (5 grupos)';
    const safe = await this.ga4SafeRows(GA4_SPECS.sources, period, now, privacy, a4Rows);
    if (!safe) return this.notMeasured('a4', title, 'GA4', this.ga4Reason());
    return {
      id: 'a4',
      title,
      source: 'GA4',
      columns: [
        { key: 'grupo', labelEs: 'Origen', kind: 'text' },
        { key: 'sesiones', labelEs: 'Sesiones', tech: 'sessions', kind: 'count' },
      ],
      rows: safe.map((r) => ({ grupo: r.key, sesiones: r.count as Cell })),
      measured: true,
      notes: ['Solo sesiones de quien aceptó la analítica.', cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} sesiones ⇒ «< 5».`)],
    };
  }

  /**
   * a5 (§MKT.H.9) — embudo: sesiones y los cinco eventos en orden, con % sobre el paso anterior, y «Compras (BD)» para
   * cuadrar. Totales sin dimensión ⇒ exactos. Un paso sin evento ⇒ celda `null` con nota.
   */
  private async a5Funnel(period: MarketingPeriod, now: Date): Promise<AggTable> {
    const title = 'Embudo sesiones → compra';
    const events = await this.ga4(GA4_SPECS.funnelEvents, period, now);
    const sessions = events ? await this.ga4(GA4_SPECS.funnelSessions, period, now) : null;
    if (!events || !sessions) return this.notMeasured('a5', title, 'GA4', this.ga4Reason());
    const byEvent = new Map(events.map((r) => [r.dimensions[0], r.metrics[0] ?? 0]));
    const missing = FUNNEL_EVENTS.filter((e) => !byEvent.has(e));
    const rows: Record<string, Cell>[] = [{ paso: 'Sesiones', n: sessions[0]?.metrics[0] ?? 0, pct: null }];
    let prev: number | null = sessions[0]?.metrics[0] ?? 0;
    for (const e of FUNNEL_EVENTS) {
      const n = byEvent.has(e) ? (byEvent.get(e) as number) : null;
      rows.push({ paso: e, n, pct: n !== null && prev !== null && prev > 0 ? Math.round((n / prev) * 1000) / 10 : null });
      prev = n;
    }
    const purchasesDb = await this.prisma.order.count({ where: { settledAt: mxRange(period.from, period.to), status: { in: SOLD_STATUSES } } });
    rows.push({ paso: 'Compras (BD)', n: purchasesDb, pct: null });
    return {
      id: 'a5',
      title,
      source: 'GA4',
      columns: [
        { key: 'paso', labelEs: 'Paso', tech: 'eventName', kind: 'text' },
        { key: 'n', labelEs: 'Nº', tech: 'eventCount', kind: 'count' },
        { key: 'pct', labelEs: '% sobre el paso anterior', kind: 'pct' },
      ],
      rows,
      measured: true,
      notes: [
        'Pasos de GA4 (solo quien aceptó la analítica); «Compras (BD)» son todos los pedidos pagados del periodo, para cuadrar.',
        ...(missing.length ? [`Sin eventos en el periodo para: ${missing.join(', ')} (celda vacía).`] : []),
      ],
    };
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
    return [{ key: A3_PAID_KEY, count: paid._count._all, subjects: paid._count._all, money: { pagadoMxn: centsToPesos(paid._sum.payoutNetCents ?? 0) } }];
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

  /**
   * `safeRows` para tablas de VARIOS componentes (b1-b3, §MKT.H.14): umbral por componente y coherencia mes↔semanas por
   * (clave, componente) (§MKT.G.10).
   */
  private async safeComponentRows(
    period: MarketingPeriod,
    privacy: CellPrivacy,
    dimsOf: (p: DayRange) => Promise<ComponentRow[]>,
  ): Promise<SafeComponentRow[]> {
    const dims = await dimsOf(period);
    if (privacy === 'exact') return applySmallCellsByComponent(dims, privacy);
    const forced = new Set<CellId>();
    if (period.kind === 'month') {
      for (const w of weeksTouchingMonth(period)) for (const id of hiddenCellIds(await dimsOf(w))) forced.add(id);
    }
    return applySmallCellsByComponent(dims, privacy, forced);
  }

  // ──────────────────────────────── Pantalla (d) Catálogo ────────────────────────────────

  private async screenD(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
    // d1 (vistas) y d2 comparten la MISMA consulta de GA4 por `itemId` (§MKT.H.9).
    const items = await this.ga4(GA4_SPECS.items, period, now);
    const views = items ? itemViews(items) : null;
    return [
      await this.d1Cards(period, privacy, views),
      await this.d2ViewsNoSale(period, privacy, views),
      await this.d3SoldOut(period, privacy),
      await this.d4QuoteCounts(period),
      await this.d4bRequested(period, privacy),
    ];
  }

  /** d1 — por carta: unidades vendidas / MX$ (celdas pequeñas) / unidades a la venta hoy. Vistas=GA4. */
  private async d1Cards(period: MarketingPeriod, privacy: CellPrivacy, views: Map<string, { views: number; carts: number }> | null): Promise<AggTable> {
    const byCard = await this.d1Sold(period);
    // `itemId` canónico de GA4 por fila (§MKT.H.4): la MISMA función que el drenador.
    const itemIdOfKey = new Map([...byCard.values()].map((e) => [e.key, measurementItemOf({ cardId: e.cardId, productType: 'raw' })?.item_id ?? '']));

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
        // GA4 (§MKT.H.9): vistas por el `itemId` canónico (§MKT.H.4, `c_<cardId>`); sin GA4 ⇒ el motivo; fila oculta ⇒ 'oculta'.
        vistas: !views ? this.ga4Reason() : typeof r.count !== 'number' || r.otros ? SMALL_CELL_HIDDEN : (views.get(itemIdOfKey.get(r.key) ?? '')?.views ?? 0),
        unidadesVendidas: r.count as Cell,
        mxn: (r.money.mxn ?? null) as Cell,
        // La fila agrupada «Otros» no mapea a una carta ⇒ su stock se oculta (C-P1: ⛔ null en fila oculta).
        aLaVentaHoy: r.otros ? SMALL_CELL_HIDDEN : (stockByKey.get(r.key) ?? 0),
      })),
      measured: true,
      notes: [
        '«Fichas vistas» sale de GA4 (solo quien aceptó la analítica).',
        cellsNote(privacy, `Unidades vendidas menos de ${SMALL_CELL_THRESHOLD} ⇒ «< 5» sin MX$ (§5.2).`),
      ],
    };
  }

  /** d2 (§MKT.H.9) — productos con ≥ 20 vistas en GA4 y 0 ventas en BD en el periodo, con % carrito/vista. */
  private async d2ViewsNoSale(period: MarketingPeriod, privacy: CellPrivacy, views: Map<string, { views: number; carts: number }> | null): Promise<AggTable> {
    const title = 'Vistas sin venta';
    if (!views) return this.notMeasured('d2', title, 'mixed', this.ga4Reason());
    const sold = await this.soldIdsOf(period);
    const candidates = [...views.entries()].filter(([id, v]) => v.views >= D2_MIN_VIEWS && !sold.has(id));
    // `itemId` canónico (§MKT.H.4): el prefijo dice la tabla. Lo no canónico se queda con su id crudo como etiqueta.
    const parsed = candidates.map(([id]) => [id, parseMeasurementItemId(id)] as const);
    const idsOf = (table: 'card' | 'sealedProduct' | 'sealedAnchor') => parsed.filter(([, p]) => p?.table === table).map(([, p]) => p!.id);
    const [cardIds, sealedIds, anchorIds] = [idsOf('card'), idsOf('sealedProduct'), idsOf('sealedAnchor')];
    const [cards, sealed, anchors] = await Promise.all([
      cardIds.length ? this.prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } }) : [],
      sealedIds.length ? this.prisma.sealedProduct.findMany({ where: { id: { in: sealedIds } }, select: { id: true, name: true } }) : [],
      // Sellado sin ligar: el nombre congelado de una pieza de ese ancla (⛔ nunca el `card.name` del ancla, §4.34a).
      anchorIds.length
        ? this.prisma.inventoryItem.findMany({
            where: { cardId: { in: anchorIds }, productType: 'sealed', sealedProductId: null, sealedProductName: { not: null } },
            select: { cardId: true, sealedProductName: true },
            distinct: ['cardId'],
          })
        : [],
    ]);
    const cardName = new Map(cards.map((c) => [c.id, `${c.name} · ${c.set.name} ${c.number}`]));
    const sealedName = new Map(sealed.map((x) => [x.id, x.name]));
    const anchorName = new Map(anchors.map((a) => [a.cardId, a.sealedProductName ?? '']));
    const nameOf = new Map<string, string>();
    for (const [id, p] of parsed) {
      const n =
        p?.table === 'card' ? cardName.get(p.id) : p?.table === 'sealedProduct' ? sealedName.get(p.id) : p?.table === 'sealedAnchor' ? anchorName.get(p.id) || `${UNIDENTIFIED_SEALED_NAME} (${p.id})` : undefined;
      if (n) nameOf.set(id, n);
    }
    const dims: DimensionRow[] = candidates
      .map(([id, v]) => ({ key: nameOf.get(id) ?? id, count: v.views, subjects: v.views, money: { carritoPct: v.views > 0 ? Math.round((v.carts / v.views) * 1000) / 10 : null } }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const safe = applySmallCells(dims, privacy);
    return {
      id: 'd2',
      title,
      source: 'mixed',
      columns: [
        { key: 'producto', labelEs: 'Producto', kind: 'text' },
        { key: 'vistas', labelEs: 'Fichas vistas', tech: 'itemsViewed (GA4)', kind: 'count' },
        { key: 'carritoPct', labelEs: '% carrito / vista', tech: 'itemsAddedToCart / itemsViewed', kind: 'pct' },
      ],
      rows: safe.map((r) => ({ producto: r.key, vistas: r.count as Cell, carritoPct: r.money.carritoPct ?? null })),
      measured: true,
      notes: [`Productos con al menos ${D2_MIN_VIEWS} vistas (GA4) y ninguna venta en el periodo (BD).`],
    };
  }

  /** `itemId` canónicos vendidos en el periodo (§MKT.H.4, `measurementItemOf` del snapshot congelado) — para d2. */
  private async soldIdsOf(p: DayRange): Promise<Set<string>> {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { settledAt: mxRange(p.from, p.to), status: { in: SOLD_STATUSES } } },
      select: { cardSnapshot: true },
    });
    const out = new Set<string>();
    for (const it of items) {
      const id = measurementItemOf(readFrozenCardFacts(it.cardSnapshot));
      if (id) out.add(id.item_id);
    }
    return out;
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
        orderId: true,
        unitPriceCents: true,
        inventoryItem: { select: { cardId: true, card: { select: { name: true, number: true, set: { select: { name: true } } } } } },
      },
    });

    // Agregar por carta (sumando acabados): unidades vendidas y MX$ (display, IVA incluido).
    const byCard: SoldByCard = new Map();
    for (const it of items) {
      const inv = it.inventoryItem;
      const key = `${inv.card.name} · ${inv.card.set.name} ${inv.card.number}`;
      const e = byCard.get(inv.cardId) ?? { cardId: inv.cardId, key, units: 0, orders: new Set<string>(), mxnCents: 0 };
      e.units += 1;
      e.orders.add(it.orderId);
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

  /**
   * d3 (dimensión «carta agotada»): altas de lista de deseos en el rango, solo cartas con 0 a la venta HOY. Publica las
   * altas; el umbral lo deciden los USUARIOS distintos (§MKT.H.14 R1: hasta 4 acabados por usuario y carta).
   */
  private async d3Dims(p: DayRange): Promise<DimensionRow[]> {
    // Una fila por (carta, usuario) ⇒ nº de filas de una carta = usuarios distintos; `_count` = altas de ese usuario.
    const pairs = await this.prisma.wishlistItem.groupBy({
      by: ['cardId', 'userId'],
      where: { createdAt: mxRange(p.from, p.to) },
      _count: { _all: true },
    });
    const byCard = new Map<string, { altas: number; users: number }>();
    for (const w of pairs) {
      const e = byCard.get(w.cardId) ?? { altas: 0, users: 0 };
      e.altas += w._count._all;
      e.users += 1;
      byCard.set(w.cardId, e);
    }
    const wish = [...byCard.entries()].map(([cardId, e]) => ({ cardId, ...e }));
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
      return { key: c ? `${c.name} · ${c.set.name} ${c.number}` : w.cardId, count: w.altas, subjects: w.users, money: {} };
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
      .map((e) => ({ key: e.key, count: e.requests.size, subjects: e.requests.size, money: {} }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }

  // ──────────────────────────────── Pantalla (c) Comportamiento ────────────────────────────────

  private async screenC(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
    return [
      await this.c1Pages(period, now, privacy),
      // Diferidas (§MKT.H.9): su motivo literal, en cualquier modo.
      this.notMeasured('c2', 'Dónde pasan más tiempo', 'GA4', PAGE_TYPE_DEFERRED),
      this.notMeasured('c3', 'Dónde abandonan', 'GA4', ABANDON_DEFERRED),
      this.notMeasured('c4', '% de fichas donde el botón COMPRAR se ve', 'GA4', BUY_BUTTON_DEFERRED),
      await this.c5Devices(period, now, privacy),
      this.notMeasured('c6', 'Búsquedas sin resultado', 'Srv', SEARCH_LOG_OFF),
      await this.c7ByState(period, privacy),
      this.notMeasured('c8', 'Página de aterrizaje de Instagram', 'GA4', PAGE_TYPE_DEFERRED),
    ];
  }

  /** c1 (§MKT.H.9) — 50 primeras páginas por vistas; ficha ⇒ nombre y set desde BD; celdas pequeñas sobre usuarios. */
  private async c1Pages(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Páginas y fichas más vistas';
    const safe = await this.ga4SafeRows(GA4_SPECS.pages, period, now, privacy, async (rows) => {
      const labels = await this.fichaLabels(rows.map((r) => r.dimensions[0]));
      return c1Rows(rows, (path) => labels.get(path) ?? path);
    });
    if (!safe) return this.notMeasured('c1', title, 'GA4', this.ga4Reason());
    return {
      id: 'c1',
      title,
      source: 'GA4',
      columns: [
        { key: 'pagina', labelEs: 'Página o ficha', tech: 'pagePath', kind: 'text' },
        { key: 'vistas', labelEs: 'Vistas', tech: 'screenPageViews', kind: 'count' },
        { key: 'usuarios', labelEs: 'Usuarios', tech: 'totalUsers', kind: 'count' },
        { key: 'tiempoMedio', labelEs: 'Tiempo medio por vista (s)', tech: 'userEngagementDuration / screenPageViews', kind: 'number' },
      ],
      rows: safe.map((r) => ({ pagina: r.key, vistas: r.money.vistas ?? null, usuarios: r.count as Cell, tiempoMedio: r.money.tiempoMedio ?? null })),
      measured: true,
      notes: ['Solo quien aceptó la analítica.', c1UsersNote(privacy), cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} usuarios ⇒ «< 5» sin el resto de cifras.`)],
    };
  }

  /** Ruta de ficha ⇒ «nombre · set número» (carta) o nombre del producto (sellado), desde BD. */
  private async fichaLabels(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const fichas = paths.map((p) => [p, fichaOf(p)] as const).filter((x): x is readonly [string, { kind: 'card' | 'sealed'; id: string }] => x[1] !== null);
    const cardIds = fichas.filter(([, f]) => f.kind === 'card').map(([, f]) => f.id);
    const itemIds = fichas.filter(([, f]) => f.kind === 'sealed').map(([, f]) => f.id);
    const [cards, items] = await Promise.all([
      cardIds.length ? this.prisma.card.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } }) : [],
      itemIds.length
        ? this.prisma.inventoryItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, sealedProduct: { select: { name: true } } } })
        : [],
    ]);
    const cardBy = new Map(cards.map((c) => [c.id, `${c.name} · ${c.set.name} ${c.number}`]));
    const itemBy = new Map(items.map((i) => [i.id, i.sealedProduct?.name ?? null]));
    for (const [p, f] of fichas) {
      const label = f.kind === 'card' ? cardBy.get(f.id) : itemBy.get(f.id);
      if (label) out.set(p, label);
    }
    return out;
  }

  /** c5 (§MKT.H.9) — sesiones por dispositivo y navegador, tal cual (que GA4 distinga el de Instagram: NO VERIFICADO). */
  private async c5Devices(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Dispositivo y navegador de Instagram';
    const safe = await this.ga4SafeRows(GA4_SPECS.devices, period, now, privacy, c5Rows);
    if (!safe) return this.notMeasured('c5', title, 'GA4', this.ga4Reason());
    return {
      id: 'c5',
      title,
      source: 'GA4',
      columns: [
        { key: 'dispositivo', labelEs: 'Dispositivo · navegador', tech: 'deviceCategory · browser', kind: 'text' },
        { key: 'sesiones', labelEs: 'Sesiones', tech: 'sessions', kind: 'count' },
      ],
      rows: safe.map((r) => ({ dispositivo: r.key, sesiones: r.count as Cell })),
      measured: true,
      notes: ['Que GA4 separe el navegador interno de Instagram no está verificado.', cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} sesiones ⇒ «< 5».`)],
    };
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
      else rows.push({ key: state, count: n, subjects: n, money: {} });
    }
    if (otros > 0) rows.push({ key: C7_OTHER_STATES, count: otros, subjects: otros, money: {} });
    if (pickup > 0) rows.push({ key: C7_PICKUP, count: pickup, subjects: pickup, money: {} });
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
    if (!(await this.bannerMeasured(period))) return this.notMeasured('f1', 'Tasa de aceptación del banner', 'Srv', BANNER_OFF);
    const grouped = await this.prisma.marketingBannerConsentCounter.groupBy({
      by: ['response', 'device'],
      where: { weekStart: this.bannerWeeks(period) },
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
    if (!(await this.originMeasured(period))) return this.notMeasured('f3', 'Cobertura: % de pedidos con origen', 'BD', ORIGIN_OFF);
    const where = { settledAt: mxRange(period.from, period.to), status: { in: SOLD_STATUSES } };
    const paid = await this.prisma.order.count({ where });
    const withOrigin = await this.prisma.order.count({ where: { ...where, firstUtmSource: { not: null } } });
    const consented = await this.prisma.order.count({ where: { ...where, measurementConsentAnalytics: true } });
    const refused = await this.prisma.order.count({ where: { ...where, measurementConsentAnalytics: false } });
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
        { concepto: 'Aceptaron la analítica', pedidos: consented, pct: pct(consented) },
        { concepto: 'La rechazaron', pedidos: refused, pct: pct(refused) },
        { concepto: 'Sin elección registrada (no respondió al aviso, o pedido anterior a la medición)', pedidos: before, pct: pct(before) },
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

  /**
   * (b) Origen (§MKT.H.9). b1-b3: SOLO columnas de BD (pedidos pagados y MX$, solicitudes y MX$ ofertado por `first_utm_*`;
   * `dm` en una sola fila); se miden cuando `originMeasured`. b4: GA4.
   */
  private async screenB(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
    const t1 = 'Origen por utm_*';
    const t2 = 'Instagram por puerta (bio, story, promoción, mensaje directo)';
    const t3 = 'Por pieza (utm_content)';
    const measured = await this.originMeasured(period);
    const b = measured
      ? [
          await this.bTable('b1', t1, 'origen', 'Origen (utm_source / utm_medium)', period, privacy, bKeyOrigin),
          await this.bTable('b2', t2, 'puerta', 'Puerta', period, privacy, bKeyDoor),
          await this.bTable('b3', t3, 'pieza', 'Pieza (utm_content)', period, privacy, bKeyPiece),
        ]
      : [this.notMeasured('b1', t1, 'BD', ORIGIN_OFF), this.notMeasured('b2', t2, 'BD', ORIGIN_OFF), this.notMeasured('b3', t3, 'BD', ORIGIN_OFF)];
    return [...b, await this.b4Channels(period, now, privacy)];
  }

  /**
   * b1-b3: una tabla con dimensión `keyOf(first_utm_*)` y DOS componentes por fila (§MKT.H.14): `pedidos`→`mxnPedidos`
   * (`PAID_ORIGIN`, sujeto = pedido) y `solicitudes`→`mxnOfertado` (`REQ_ORIGIN`, sujeto = solicitud). Cada componente con su
   * propio umbral (R1): ⛔ nunca la suma de los dos (SEC-MKT-1). Sin fila «Otros»: una fila parcial conserva su clave.
   */
  private async bTable(
    id: string,
    title: string,
    col: string,
    label: string,
    period: MarketingPeriod,
    privacy: CellPrivacy,
    keyOf: BKey,
  ): Promise<AggTable> {
    const dimsOf = async (p: DayRange): Promise<ComponentRow[]> => {
      const range = mxRange(p.from, p.to);
      const [orders, requests] = await Promise.all([
        this.prisma.order.findMany({
          where: { settledAt: range, status: { in: SOLD_STATUSES }, firstUtmSource: { not: null } },
          select: { firstUtmSource: true, firstUtmMedium: true, firstUtmContent: true, totalCents: true },
        }),
        this.prisma.sellRequest.findMany({
          where: { createdAt: range, firstUtmSource: { not: null } },
          select: { firstUtmSource: true, firstUtmMedium: true, firstUtmContent: true, quotedTotalCents: true },
        }),
      ]);
      const acc = new Map<string, { o: number; oc: number; s: number; sc: number }>();
      const bump = (k: string | null, f: 'o' | 's', cents: number) => {
        if (k === null) return;
        const e = acc.get(k) ?? { o: 0, oc: 0, s: 0, sc: 0 };
        if (f === 'o') (e.o += 1), (e.oc += cents);
        else (e.s += 1), (e.sc += cents);
        acc.set(k, e);
      };
      // Una fila de `findMany` = un pedido / una solicitud ⇒ el conteo ES el nº de sujetos distintos.
      for (const o of orders) bump(keyOf(o.firstUtmSource, o.firstUtmMedium, o.firstUtmContent), 'o', o.totalCents);
      for (const s of requests) bump(keyOf(s.firstUtmSource, s.firstUtmMedium, s.firstUtmContent), 's', s.quotedTotalCents);
      return [...acc.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, e]) => ({
          key,
          parts: {
            pedidos: { count: e.o, subjects: e.o, money: { mxnPedidos: centsToPesos(e.oc) } },
            solicitudes: { count: e.s, subjects: e.s, money: { mxnOfertado: centsToPesos(e.sc) } },
          },
        }));
    };
    const safe = await this.safeComponentRows(period, privacy, dimsOf);
    // `exact` sale en orden real (MKT.G.2): pedidos desc, solicitudes desc, clave. En `small_cells` el orden es el de R0.
    const rows = privacy === 'exact' ? [...safe].sort((a, b) => num(b, 'pedidos') - num(a, 'pedidos') || num(b, 'solicitudes') - num(a, 'solicitudes') || (a.key < b.key ? -1 : 1)) : safe;
    return {
      id,
      title,
      source: 'BD',
      columns: [
        { key: col, labelEs: label, kind: 'text' },
        { key: 'pedidos', labelEs: 'Pedidos pagados', kind: 'count' },
        { key: 'mxnPedidos', labelEs: 'MX$ pedidos (IVA incluido)', kind: 'money' },
        { key: 'solicitudes', labelEs: 'Solicitudes de venta', kind: 'count' },
        { key: 'mxnOfertado', labelEs: 'MX$ ofertado (IVA incluido)', kind: 'money' },
      ],
      rows: rows.map((r) => ({
        [col]: r.key,
        pedidos: r.parts.pedidos.count as Cell,
        mxnPedidos: (r.parts.pedidos.money.mxnPedidos ?? null) as Cell,
        solicitudes: r.parts.solicitudes.count as Cell,
        mxnOfertado: (r.parts.solicitudes.money.mxnOfertado ?? null) as Cell,
      })),
      measured: true,
      notes: [B_SESSIONS_NOTE, cellsNote(privacy, B_CELLS_NOTE)],
    };
  }

  /** b4 (§MKT.H.9) — Google orgánico, Directo, Referencias por dominio, Asistentes de IA (misma consulta que a4). */
  private async b4Channels(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Google orgánico, directo, referencias e IA';
    const safe = await this.ga4SafeRows(GA4_SPECS.sources, period, now, privacy, b4Rows);
    if (!safe) return this.notMeasured('b4', title, 'GA4', this.ga4Reason());
    return {
      id: 'b4',
      title,
      source: 'GA4',
      columns: [
        { key: 'canal', labelEs: 'Canal', tech: 'sessionDefaultChannelGroup / sessionSource', kind: 'text' },
        { key: 'sesiones', labelEs: 'Sesiones', tech: 'sessions', kind: 'count' },
      ],
      rows: safe.map((r) => ({ canal: r.key, sesiones: r.count as Cell })),
      measured: true,
      notes: ['Solo quien aceptó la analítica.', cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} sesiones ⇒ «< 5».`)],
    };
  }

  /** (e) Buscadores e IA — e1 de Search Console (no depende del aviso), e3 de GA4. */
  private async screenE(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
    return [await this.e1SearchConsole(period, now, privacy), await this.e3Ai(period, now, privacy)];
  }

  /** e3 (§MKT.H.9) — sesiones desde asistentes de IA (lista fija en código) por página de aterrizaje. */
  private async e3Ai(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Referencias de asistentes de IA';
    const safe = await this.ga4SafeRows(GA4_SPECS.aiReferrals, period, now, privacy, e3Rows);
    if (!safe) return this.notMeasured('e3', title, 'GA4', this.ga4Reason());
    return {
      id: 'e3',
      title,
      source: 'GA4',
      columns: [
        { key: 'fuente', labelEs: 'Asistente · página de aterrizaje', tech: 'sessionSource · landingPage', kind: 'text' },
        { key: 'sesiones', labelEs: 'Sesiones', tech: 'sessions', kind: 'count' },
      ],
      rows: safe.map((r) => ({ fuente: r.key, sesiones: r.count as Cell })),
      measured: true,
      notes: [`Asistentes: ${AI_ASSISTANT_SOURCES.join(', ')}.`, cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} sesiones ⇒ «< 5».`)],
    };
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
      return r.rows.map((q) => ({ key: q.query, count: q.clicks, subjects: q.clicks, money: { impresiones: q.impressions, ctr: q.ctr, posicion: q.position } }));
    };
    let safe: SafeRow[];
    try {
      safe = await this.safeRows(period, privacy, dimsOf);
    } catch {
      return this.notMeasured('e1', 'Consultas de Google', 'SC', SC_UNCONNECTED);
    }
    // Fila oculta ⇒ `'oculta'` pasa tal cual (C-P1); sin dato ⇒ null.
    const round = (v: number | null | undefined | typeof SMALL_CELL_HIDDEN, f: number): Cell => (typeof v === 'number' ? Math.round(v * f) / f : (v ?? null));
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
        ctr: typeof r.money.ctr === 'number' ? round(r.money.ctr * 100, 10) : (r.money.ctr ?? null),
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
    if (!(await this.originMeasured(period))) {
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
      // Base de b1-b3 (`PAID_ORIGIN`, §MKT.H.14): sin `firstUtmSource` no entra, para que g1 ≡ b2[Promoción] sea identidad exacta.
      where: { settledAt: mxRange(p.from, p.to), status: { in: SOLD_STATUSES }, firstUtmSource: { not: null }, firstUtmMedium: 'paid' },
      _count: { _all: true },
      _sum: { totalCents: true },
    });
    return [{ key: G1_KEY, count: agg._count._all, subjects: agg._count._all, money: { mxn: centsToPesos(agg._sum.totalCents ?? 0) } }];
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
