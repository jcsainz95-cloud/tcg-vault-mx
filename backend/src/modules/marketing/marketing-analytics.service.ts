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
import { AsyncLocalStorage } from 'node:async_hooks';
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
import { MarketingSearchMissService, SEARCH_MISS_MIN_DAYS, SEARCH_MISS_MIN_PEOPLE } from './marketing-search-miss.service';
import { GA4_UNFILTERED_NOTE, isInternalUtm } from './internal-traffic';
import type { Av7Summary } from './index-inspection';
import { IndexInspectionService } from './index-inspection.service';
import { AV3_MAX_CARTS, AV3_MIN_VIEWS, AV5_MIN_QUOTES, alertsWithSources, evaluateAlerts, type Alert } from './marketing-alerts';
import { deltaCells, nvrCells, sumIfVisible } from './marketing-summary';
import {
  AI_ASSISTANT_SOURCES,
  D2_MIN_VIEWS,
  FUNNEL_EVENTS,
  GA4_SPECS,
  a4Rows,
  b4Rows,
  c1Rows,
  c2Rows,
  c5Rows,
  e3Rows,
  landingRows,
  nvrOf,
  regionRows,
  a4Group,
  fichaOf,
  itemViews,
} from './marketing-ga4';
import { readFrozenCardFacts } from '../orders/order-item-card';
import { parseFirstUtm } from '../../common/first-utm';
import { toMexicoCityDateKey } from '../../common/business-days';

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
  foldRegionRest,
  REGION_REST_LABEL,
  hiddenCellIds,
  hiddenKeys,
  cellId,
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
import { enforceFamily, type FamilyCell } from './marketing-populations';
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
const BUY_BUTTON_DEFERRED = 'NO MEDIDO — el evento del botón COMPRAR todavía no se envía';
const B_SESSIONS_NOTE =
  'Sesiones por primer origen no entran: exigirían dimensiones de evento propias en la consola de GA4. Pedidos y solicitudes de quien aceptó la analítica.';
const SC_UNCONNECTED = 'NO MEDIDO — Search Console sin conectar';
/** b1-b3: nota literal de §MKT.H.14 («Fila de b1-b3»). */
export const B_CELLS_NOTE = 'Pedidos y solicitudes se ocultan por separado: menos de 5 ⇒ «< 5» sin su MX$.';
/** b5/b6 (v1.109): componentes y notas. */
type CsPart = 'avisame' | 'torneo';
const CS_SOURCE_NOTE =
  'Registros confirmados (doble opt-in) por fecha de confirmación: «Avísame» (todos los tipos) y «Torneo» (todos los juegos). Una baja posterior no los resta. Un buzón con varios registros cuenta una vez para el umbral.';
const CS_UTM_NOTE = '«No válido»: algún utm_* no pasa la validación (el texto no se muestra). «Sin UTM»: llegó sin parámetros.';
/** Cabecera de b5/b6 (catálogo §MKT.G.4): id, título, fuente y la columna de la clave. */
const CS_HEADS = {
  b5: { id: 'b5', title: 'Preregistros del Card Show por día', source: 'BD', keyColumn: { key: 'dia', labelEs: 'Día de confirmación (CDMX)', kind: 'text' } },
  b6: { id: 'b6', title: 'Preregistros del Card Show por UTM', source: 'BD', keyColumn: { key: 'utm', labelEs: 'Origen (utm_source / utm_medium / utm_campaign)', kind: 'text' } },
} as const;
export const CS_NO_UTM = 'Sin UTM';
export const CS_BAD_UTM = 'No válido';
/**
 * Clave de b6 (§MKT.H.14 «Poblaciones»): solo valores que pasan `parseFirstUtm`; los cuatro `NULL` ⇒ «Sin UTM»; alguno que no
 * pasa ⇒ «No válido» (⛔ nunca el texto crudo). Las claves válidas son `[a-z0-9._-]` y no chocan con las dos etiquetas.
 */
export function csUtmKey(r: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null }): string {
  const raw = { utm_source: r.utmSource, utm_medium: r.utmMedium, utm_campaign: r.utmCampaign, utm_content: r.utmContent };
  if (Object.values(raw).every((v) => v === null)) return CS_NO_UTM;
  const ok = parseFirstUtm(raw);
  const short = { utm_source: ok.source, utm_medium: ok.medium, utm_campaign: ok.campaign, utm_content: ok.content };
  if ((Object.keys(raw) as (keyof typeof raw)[]).some((k) => raw[k] !== null && short[k] === undefined)) return CS_BAD_UTM;
  return `${ok.source ?? '—'} / ${ok.medium ?? '—'} / ${ok.campaign ?? '—'}`;
}
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
const SEARCH_LOG_OFF = 'NO MEDIDO — el registro de búsquedas sin resultado está apagado';
const SEARCH_LOG_FLAG = 'marketing_search_log';
const SEARCH_LOG_UNREADABLE = 'NO MEDIDO — no se pudo leer el registro de búsquedas sin resultado';
const R3_LABELS: Record<string, string> = {
  nuevos: 'Nuevos',
  recurrentes: 'Recurrentes',
  ses_instagram_organico: 'Sesiones Instagram orgánico',
  ses_instagram_pagado: 'Sesiones Instagram pagado',
  ses_google: 'Sesiones Google',
  ses_ia: 'Sesiones asistentes de IA',
  ses_directo_otros: 'Sesiones directo y otros',
};
/** AV2: los grupos de a4 con sesiones de las dos semanas. */
function A4_GROUPS_OF(cur: Ga4Row[], prev: Ga4Row[]): { name: string; cur: number; prev: number }[] {
  const c = a4Rows(cur);
  const p = a4Rows(prev);
  return c.map((g) => ({ name: g.key, cur: g.count, prev: p.find((x) => x.key === g.key)?.count ?? 0 }));
}
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

// ──────────────────────────────── Familias (§MKT.H.14 R2, R3b, R4; MKT-TL2) ────────────────────────────────

/** Tablas con dimensión de cada familia que el servicio calcula junto (los totales aceptados son constantes). */
type PartsTable = 'b1' | 'b2' | 'b3' | 'b5' | 'b6';
type OneTable = 'g1' | 'c7' | 'a4' | 'b4' | 'c5' | 'e3';
type FamilyGroup = 'origin' | 'states' | 'sessions' | 'cardshow';
/** Columna de conteo de cada tabla de una parte (= su componente, `FamilyCell.part`). */
const ONE_COUNT: Record<OneTable, string> = { g1: 'pedidos', c7: 'pedidos', a4: 'sesiones', b4: 'sesiones', c5: 'sesiones', e3: 'sesiones' };

/** Filas crudas de una familia en un rango. Tabla ausente ⇒ no se publica en el periodo (`unmeasured`). */
interface FamilyDims {
  parts: Partial<Record<PartsTable, ComponentRow[]>>;
  one: Partial<Record<OneTable, DimensionRow[]>>;
  unmeasured: string[];
  /** Tablas de la familia leídas de GA4 SIN el filtro de tráfico propio (llevan GA4_UNFILTERED_NOTE). */
  unfiltered?: string[];
  /**
   * Tablas cuyo estado fija otro periodo (v1.109: b5 en un MES; cada fila es idéntica a la de su semana, R4 entre periodos):
   * sin R3a local y nunca candidatas de R3b (`FamilyCell.fixed`). Lo oculto les llega por R2 (`forced`).
   */
  fixed?: string[];
}
/** `forced`: lo que cada tabla recibe como oculto forzado (R2 + familia); `hidden`: lo que acaba oculto (clave o CellId). */
interface FamilyResult {
  dims: FamilyDims;
  forced: Map<string, Set<string>>;
  hidden: Map<string, Set<string>>;
}

const small = (n: number): boolean => n > 0 && n < SMALL_CELL_THRESHOLD;

/** Estado LOCAL de cada tabla (R1, R2/forzadas, R3a): claves (una parte) o CellId (b1-b3). */
function localHidden(d: FamilyDims, forced: Map<string, Set<string>>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [t, rows] of Object.entries(d.parts)) out.set(t, hiddenCellIds(rows!, forced.get(t), { complement: !d.fixed?.includes(t) }));
  for (const [t, rows] of Object.entries(d.one)) out.set(t, hiddenKeys(rows!, forced.get(t)));
  return out;
}

/** El plan de `enforceFamily`: una celda por (tabla, clave, columna). */
function familyCells(d: FamilyDims, hidden: Map<string, Set<string>>): FamilyCell[] {
  const cells: FamilyCell[] = [];
  for (const [t, rows] of Object.entries(d.parts)) {
    const fixed = d.fixed?.includes(t) === true;
    for (const r of rows!) {
      for (const [part, p] of Object.entries(r.parts)) {
        const h = hidden.get(t)!.has(cellId(r.key, part));
        cells.push({ table: t, key: r.key, part, column: part, value: p.count, hidden: h, small: small(p.subjects), fixed });
        for (const [column, v] of Object.entries(p.money)) cells.push({ table: t, key: r.key, part, column, value: v, hidden: h, small: small(p.subjects), fixed });
      }
    }
  }
  for (const [t, rows] of Object.entries(d.one) as [OneTable, DimensionRow[]][]) {
    const part = ONE_COUNT[t];
    for (const r of rows) {
      const h = hidden.get(t)!.has(r.key);
      cells.push({ table: t, key: r.key, part, column: part, value: r.count, hidden: h, small: small(r.subjects) });
      for (const [column, v] of Object.entries(r.money)) cells.push({ table: t, key: r.key, part, column, value: v, hidden: h, small: small(r.subjects) });
    }
  }
  return cells;
}

/**
 * Punto fijo de una familia: estado local de cada tabla ⇒ `enforceFamily` (R3b, R4) ⇒ toda tabla a la que la familia oculta
 * algo más recibe TODO su oculto como forzado (así R3a no suelta la pareja que tenía) ⇒ otra vuelta, hasta que nada cambie.
 * Solo oculta ⇒ termina.
 */
export function solveFamily(d: FamilyDims, forced0: Map<string, Set<string>>): { forced: Map<string, Set<string>>; hidden: Map<string, Set<string>> } {
  const forced = new Map([...forced0].map(([t, s]) => [t, new Set(s)]));
  for (;;) {
    const hidden = localHidden(d, forced);
    const out = enforceFamily({ cells: familyCells(d, hidden), unmeasured: d.unmeasured });
    const next = new Map<string, Set<string>>();
    for (const c of out.cells) {
      if (!c.hidden) continue;
      const id = c.table in d.parts ? cellId(c.key, c.part) : c.key;
      const set = next.get(c.table) ?? new Set<string>();
      set.add(id);
      next.set(c.table, set);
    }
    let grew = false;
    for (const [t, ids] of next) {
      if (ids.size > (hidden.get(t)?.size ?? 0)) {
        forced.set(t, ids);
        grew = true;
      }
    }
    if (!grew) return { forced, hidden };
  }
}

type Fam = (g: FamilyGroup) => Promise<FamilyResult>;

/** Filas seguras de una tabla de una parte de la familia (R1-R4 ya resueltos); `null` ⇒ la tabla no se publica. */
function familyRows(f: FamilyResult, t: OneTable, privacy: CellPrivacy): SafeRow[] | null {
  const rows = f.dims.one[t];
  return rows ? applySmallCells(rows, privacy, f.forced.get(t)) : null;
}

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
    @Optional() private readonly searchMiss?: MarketingSearchMissService,
    // §GSHOP.A: AV7 (indexación). `@Optional()` por la misma razón (pruebas que construyen el servicio a mano ⇒ sin AV7).
    @Optional() private readonly indexInspection?: IndexInspectionService,
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
    const r = await this.ga4Raw(spec, p, now);
    return r.ok ? r.rows : null;
  }

  /** Lectura cruda de GA4 que anota en el ámbito vigente si salió SIN el filtro de tráfico propio (MKT-V2 §4). */
  private async ga4Raw(spec: Ga4ReportSpec, p: DayRange, now: Date): ReturnType<MarketingExternalSources['ga4Report']> {
    const r = await (this.external as MarketingExternalSources).ga4Report(spec, p.from, p.to, now);
    const m = this.unfStore.getStore();
    if (m && r.ok) m.set(spec, (m.get(spec) ?? false) || r.unfiltered === true);
    return r;
  }

  private readonly unfStore = new AsyncLocalStorage<Map<Ga4ReportSpec, boolean>>();

  /** Ejecuta `fn` en un ámbito propio y dice qué consultas de GA4 hizo sin el filtro. */
  private async tracked<T>(fn: () => Promise<T>): Promise<[T, Map<Ga4ReportSpec, boolean>]> {
    const m = new Map<Ga4ReportSpec, boolean>();
    const v = await this.unfStore.run(m, fn);
    return [v, m];
  }

  private anyUnf(m: Map<Ga4ReportSpec, boolean>): boolean {
    return [...m.values()].some(Boolean);
  }

  /** Añade la nota fija (una vez) a una tabla medida si alguna lectura salió sin filtro. */
  private noted(t: AggTable, unf: boolean): AggTable {
    if (!unf || !t.measured || t.notes?.includes(GA4_UNFILTERED_NOTE)) return t;
    return { ...t, notes: [...(t.notes ?? []), GA4_UNFILTERED_NOTE] };
  }

  /** Tabla de la familia `sessions`: lleva la nota si su lectura de GA4 salió sin filtro. */
  private async famNoted(fam: Fam, id: string, build: () => Promise<AggTable>): Promise<AggTable> {
    const t = await build();
    return this.noted(t, (await fam('sessions')).dims.unfiltered?.includes(id) === true);
  }

  /** Construye una tabla de GA4 y le pone la nota si cualquiera de sus lecturas salió sin filtro. */
  private async scoped(fn: () => Promise<AggTable>): Promise<AggTable> {
    const [t, m] = await this.tracked(fn);
    return this.noted(t, this.anyUnf(m));
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
  async screen(screen: MarketingScreen, period: MarketingPeriod, now: Date, privacy: CellPrivacy, opts: { forEmail?: boolean } = {}): Promise<ScreenPayload> {
    const payload = await this.screenRaw(screen, period, now, privacy, opts);
    return { ...payload, tables: payload.tables.map(sealHiddenRows) };
  }

  private async screenRaw(screen: MarketingScreen, period: MarketingPeriod, now: Date, privacy: CellPrivacy, opts: { forEmail?: boolean } = {}): Promise<ScreenPayload> {
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
    // Familias (§MKT.H.14): cada una se calcula UNA vez por llamada y entera, pida la pantalla que pida.
    const memo = new Map<FamilyGroup, Promise<FamilyResult>>();
    const fam: Fam = (g) => {
      if (!memo.has(g)) memo.set(g, this.family(g, period, now, privacy));
      return memo.get(g)!;
    };
    // Catálogo y ORDEN de tablas: API_CONTRACT §MKT.G.4 (candado `marketing-panel.spec.ts`, §MKT.G.9 (6)).
    switch (screen) {
      case 'r':
        return { ...base, previousPeriod: period.prev, tables: await this.screenR(period, now, privacy, fam, opts) };
      case 'a':
        return { ...base, previousPeriod: period.prev, tables: await this.screenA(period, now, privacy, fam) };
      case 'b':
        return { ...base, tables: await this.screenB(period, now, privacy, fam) };
      case 'c':
        return { ...base, tables: await this.screenC(period, now, privacy, fam) };
      case 'd':
        return { ...base, tables: await this.screenD(period, now, privacy) };
      case 'e':
        return { ...base, tables: await this.screenE(period, now, privacy, fam) };
      case 'f':
        return { ...base, tables: [await this.f1Banner(period), await this.f3Coverage(period)] };
      case 'g':
        return { ...base, tables: await this.screenG(period, privacy, fam) };
      case 'h':
        return { ...base, tables: this.screenH(annotations) };
    }
  }

  // ──────────────────────────────── Pantalla (a) Resumen ────────────────────────────────

  private async screenA(period: MarketingPeriod, now: Date, privacy: CellPrivacy, fam: Fam): Promise<AggTable[]> {
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

    return [a1, a2, a3, await this.famNoted(fam, 'a4', () => this.a4Visits(privacy, fam)), await this.scoped(() => this.a5Funnel(period, now)), await this.a6Payments(period)];
  }

  /**
   * a6 (v1.116, §MKT.G.4; ARCHITECTURE §14.9) — pagos iniciados → pagados, de BD, sin cookies ni consentimiento. Cohorte por
   * `createdAt` del pedido (`PI_START`): «De esos, pagados» son los MISMOS pedidos que ya pagaron, cuando sea
   * (`PI_START_PAID`), para que el % sea una proporción honesta. Total sin dimensión ⇒ exacto (§MKT.H.14 «Total aceptado»);
   * fuera de toda ecuación. ⛔ Sin MX$. ⛔ No se manda a GA4/Meta (el aviso solo declara compras y solicitudes, §14.10).
   */
  private async a6Payments(period: MarketingPeriod): Promise<AggTable> {
    const started = { createdAt: mxRange(period.from, period.to), stripePaymentIntentId: { not: null } };
    const [n, paid] = await Promise.all([
      this.prisma.order.count({ where: started }),
      this.prisma.order.count({ where: { ...started, settledAt: { not: null }, status: { in: SOLD_STATUSES } } }),
    ]);
    return {
      id: 'a6',
      title: 'Pagos iniciados → pagados',
      source: 'BD',
      columns: [
        { key: 'paso', labelEs: 'Paso', kind: 'text' },
        { key: 'n', labelEs: 'Nº de pedidos', kind: 'count' },
        { key: 'pct', labelEs: '% sobre el paso anterior', kind: 'pct' },
      ],
      rows: [
        { paso: 'Pagos iniciados', n, pct: null },
        { paso: 'De esos, pagados', n: paid, pct: n > 0 ? Math.round((paid / n) * 1000) / 10 : null },
      ],
      measured: true,
      notes: [
        'Pedidos creados en el periodo que llegaron a cobro (pulsaron PAGAR y se abrió el pago); «De esos, pagados»: los mismos pedidos que ya se pagaron, aunque sea después del periodo. Todos los compradores, sin cookies.',
      ],
    };
  }

  /** a4 (§MKT.H.9) — sesiones por los cinco grupos de origen. */
  private async a4Visits(privacy: CellPrivacy, fam: Fam): Promise<AggTable> {
    const title = 'Visitas y de dónde (5 grupos)';
    const safe = familyRows(await fam('sessions'), 'a4', privacy);
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
    const events = await this.ga4(GA4_SPECS.events, period, now);
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
   * Una familia de §MKT.H.14 en `period` (R2, R3b, R4). En un mes con `small_cells`, lo que cada tabla hereda de las semanas es
   * su oculto FINAL en cada semana (la familia de la semana ya resuelta), por (tabla, clave, componente). En `exact`, solo las
   * filas crudas.
   */
  private async family(g: FamilyGroup, period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<FamilyResult> {
    const dims = await this.familyDims(g, period, period, now);
    if (privacy === 'exact') return { dims, forced: new Map(), hidden: new Map() };
    // b5 en un mes: cada fila (un día) es la misma de su semana ⇒ su estado lo fija la semana (R2), no el mes (§MKT.H.14 R4).
    if (g === 'cardshow' && period.kind === 'month') dims.fixed = ['b5'];
    const forced0 = new Map<string, Set<string>>();
    if (period.kind === 'month') {
      for (const w of weeksTouchingMonth(period)) {
        const wd = await this.familyDims(g, w, period, now);
        // Una semana sin datos de la fuente deja la tabla del mes sin medir (como hasta ahora, ga4SafeRows).
        for (const t of wd.unmeasured) this.dropTable(dims, t);
        for (const [t, ids] of solveFamily(wd, new Map()).hidden) {
          const set = forced0.get(t) ?? new Set<string>();
          for (const id of ids) set.add(id);
          forced0.set(t, set);
        }
      }
    }
    const { forced, hidden } = solveFamily(dims, forced0);
    return { dims, forced, hidden };
  }

  private dropTable(d: FamilyDims, t: string): void {
    if (d.unmeasured.includes(t)) return;
    delete d.parts[t as PartsTable];
    delete d.one[t as OneTable];
    d.unmeasured.push(t);
  }

  /** Filas crudas de una familia en el rango `p`; `period` (el pedido) decide qué se mide. */
  private async familyDims(g: FamilyGroup, p: DayRange, period: MarketingPeriod, now: Date): Promise<FamilyDims> {
    const d: FamilyDims = { parts: {}, one: {}, unmeasured: [] };
    if (g === 'origin') {
      if (!(await this.originMeasured(period))) {
        d.unmeasured.push('b1', 'b2', 'b3', 'g1');
        return d;
      }
      const b = await this.bDims(p);
      d.parts = b;
      d.one.g1 = await this.g1Dims(p);
      return d;
    }
    if (g === 'cardshow') {
      d.parts = await this.csDims(p);
      return d;
    }
    if (g === 'states') {
      if (!c7Measurable(period)) d.unmeasured.push('c7');
      else d.one.c7 = await this.c7Dims(p);
      return d;
    }
    const put = (t: OneTable, rows: DimensionRow[] | null) => (rows ? (d.one[t] = rows) : d.unmeasured.push(t));
    if (!this.ga4Live()) {
      d.unmeasured.push('a4', 'b4', 'c5', 'e3');
      return d;
    }
    const read = async (spec: Ga4ReportSpec, ids: string[]): Promise<Ga4Row[] | null> => {
      const [rows, m] = await this.tracked(() => this.ga4(spec, p, now));
      if (rows && this.anyUnf(m)) d.unfiltered = [...(d.unfiltered ?? []), ...ids];
      return rows;
    };
    const sources = await read(GA4_SPECS.sources, ['a4', 'b4']);
    put('a4', sources && a4Rows(sources));
    put('b4', sources && b4Rows(sources));
    const devices = await read(GA4_SPECS.devices, ['c5']);
    put('c5', devices && c5Rows(devices));
    const ai = await read(GA4_SPECS.aiReferrals, ['e3']);
    put('e3', ai && e3Rows(ai));
    return d;
  }

  // ──────────────────────────────── Pantalla (d) Catálogo ────────────────────────────────

  private async screenD(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable[]> {
    // d1 (vistas) y d2 comparten la MISMA consulta de GA4 por `itemId` (§MKT.H.9).
    const res = this.ga4Live() && this.external ? await this.ga4Raw(GA4_SPECS.items, period, now) : null;
    const views = res?.ok ? itemViews(res.rows) : null;
    const d1 = await this.d1Cards(period, privacy, views);
    const d2 = await this.d2ViewsNoSale(period, privacy, views);
    // MKT-V2 §4: si GA4 rechazó el filtro de tráfico propio por incompatibilidad y se leyó sin él, la tabla lo dice.
    if (res?.ok && res.unfiltered) for (const t of [d1, d2]) if (t.measured) t.notes = [...(t.notes ?? []), GA4_UNFILTERED_NOTE];
    return [d1, d2, await this.d3SoldOut(period, privacy), await this.d4QuoteCounts(period), await this.d4bRequested(period, privacy)];
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

    // MKT-V2 §6.7: filas = unión de las 10 cartas con más vistas (GA4) y las vendidas. Las que solo se vieron: vendidas = 0 exacto.
    const viewedOnly = await this.d1ViewedOnly(views, byCard, privacy);
    const otrosAt = safe.findIndex((r) => r.otros);
    const extraSafe: SafeRow[] = viewedOnly.map((v) => ({ key: v.key, count: 0, money: { mxn: 0 } }));
    const merged = otrosAt < 0 ? [...safe, ...extraSafe] : [...safe.slice(0, otrosAt), ...extraSafe, ...safe.slice(otrosAt)];
    const viewedBy = new Map(viewedOnly.map((v) => [v.key, v]));

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
      rows: merged.map((r) => ({
        carta: r.key,
        // GA4 (§MKT.H.9): vistas por el `itemId` canónico (§MKT.H.4, `c_<cardId>`); sin GA4 ⇒ el motivo; fila oculta ⇒ 'oculta'.
        vistas: viewedBy.has(r.key) ? viewedBy.get(r.key)!.views : !views ? this.ga4Reason() : typeof r.count !== 'number' || r.otros ? SMALL_CELL_HIDDEN : (views.get(itemIdOfKey.get(r.key) ?? '')?.views ?? 0),
        unidadesVendidas: r.count as Cell,
        mxn: (r.money.mxn ?? null) as Cell,
        // La fila agrupada «Otros» no mapea a una carta ⇒ su stock se oculta (C-P1: ⛔ null en fila oculta).
        aLaVentaHoy: r.otros ? SMALL_CELL_HIDDEN : (viewedBy.get(r.key)?.stock ?? stockByKey.get(r.key) ?? 0),
      })),
      measured: true,
      notes: [
        '«Fichas vistas» sale de GA4 (solo quien aceptó la analítica).',
        cellsNote(privacy, `Unidades vendidas menos de ${SMALL_CELL_THRESHOLD} ⇒ «< 5» sin MX$ (§5.2).`),
      ],
    };
  }

  /** d1: las cartas entre las 10 más vistas que NO se vendieron en el periodo (nombre desde `Card`, stock de hoy). Vistas < 5 ⇒ «< 5» en `small_cells`. */
  private async d1ViewedOnly(
    views: Map<string, { views: number; carts: number }> | null,
    sold: SoldByCard,
    privacy: CellPrivacy,
  ): Promise<{ key: string; views: Cell; stock: number }[]> {
    if (!views) return [];
    const ranked = [...views.entries()]
      .map(([id, v]) => ({ p: parseMeasurementItemId(id), v: v.views, id }))
      .filter((x) => x.p?.table === 'card')
      .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
      .slice(0, 10)
      .filter((x) => !sold.has(x.p!.id));
    if (ranked.length === 0) return [];
    const ids = ranked.map((x) => x.p!.id);
    const [cards, onSale] = await Promise.all([
      this.prisma.card.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } }),
      this.prisma.inventoryItem.groupBy({ by: ['cardId'], where: { cardId: { in: ids }, ownerType: 'platform', status: 'listed' }, _count: { _all: true } }),
    ]);
    const cardBy = new Map(cards.map((c) => [c.id, `${c.name} · ${c.set.name} ${c.number}`]));
    const stockBy = new Map(onSale.map((r) => [r.cardId, r._count._all]));
    return ranked.map((x) => ({
      key: cardBy.get(x.p!.id) ?? x.id,
      views: privacy === 'small_cells' && x.v > 0 && x.v < SMALL_CELL_THRESHOLD ? SMALL_CELL_SENTINEL : x.v,
      stock: stockBy.get(x.p!.id) ?? 0,
    }));
  }

  /** d2 (§MKT.H.9) — productos con ≥ 20 vistas en GA4 y 0 ventas en BD en el periodo, con % carrito/vista. */
  private async d2ViewsNoSale(period: MarketingPeriod, privacy: CellPrivacy, views: Map<string, { views: number; carts: number }> | null): Promise<AggTable> {
    const title = 'Vistas sin venta';
    if (!views) return this.notMeasured('d2', title, 'mixed', this.ga4Reason());
    const sold = await this.soldIdsOf(period);
    const candidates = [...views.entries()].filter(([id, v]) => v.views >= D2_MIN_VIEWS && !sold.has(id));
    const nameOf = await this.itemNames(candidates.map(([id]) => id));
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

  /** `itemId` canónico (§MKT.H.4) ⇒ nombre legible. El prefijo dice la tabla; lo no canónico no tiene nombre (el llamador usa el id). */
  private async itemNames(ids: string[]): Promise<Map<string, string>> {
    const parsed = ids.map((id) => [id, parseMeasurementItemId(id)] as const);
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
    return nameOf;
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

  private async screenC(period: MarketingPeriod, now: Date, privacy: CellPrivacy, fam: Fam): Promise<AggTable[]> {
    return [
      await this.scoped(() => this.c1Pages(period, now, privacy)),
      // Diferidas (§MKT.H.9): su motivo literal, en cualquier modo.
      await this.scoped(() => this.c2PageTypes(period, now, privacy)),
      await this.scoped(() => this.landingTable('c3', 'Dónde abandonan', GA4_SPECS.landing, period, now, privacy)),
      await this.scoped(() => this.c4BuyButton(period, now)),
      await this.famNoted(fam, 'c5', () => this.c5Devices(privacy, fam)),
      await this.c6SearchMiss(period),
      await this.c7ByState(period, privacy, fam),
      await this.scoped(() => this.landingTable('c8', 'Página de aterrizaje de Instagram', GA4_SPECS.landingInstagram, period, now, privacy)),
      await this.c9Regions(period, now, privacy),
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
  private async c5Devices(privacy: CellPrivacy, fam: Fam): Promise<AggTable> {
    const title = 'Dispositivo y navegador de Instagram';
    const safe = familyRows(await fam('sessions'), 'c5', privacy);
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
  private async c7ByState(period: MarketingPeriod, privacy: CellPrivacy, fam: Fam): Promise<AggTable> {
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
    const safe = familyRows(await fam('states'), 'c7', privacy) ?? [];
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
    // «Con origen» = la base de b1 (E2): sin tráfico propio (MKT-V2 §4).
    const originRows = await this.prisma.order.findMany({ where: { ...where, firstUtmSource: { not: null } }, select: { firstUtmSource: true, firstUtmMedium: true } });
    const withOrigin = originRows.filter((o) => !isInternalUtm(o.firstUtmSource, o.firstUtmMedium)).length;
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
  private async screenB(period: MarketingPeriod, now: Date, privacy: CellPrivacy, fam: Fam): Promise<AggTable[]> {
    const t1 = 'Origen por utm_*';
    const t2 = 'Instagram por puerta (bio, story, promoción, mensaje directo)';
    const t3 = 'Por pieza (utm_content)';
    const measured = await this.originMeasured(period);
    const b = measured
      ? [
          this.bTable('b1', t1, 'origen', 'Origen (utm_source / utm_medium)', privacy, await fam('origin')),
          this.bTable('b2', t2, 'puerta', 'Puerta', privacy, await fam('origin')),
          this.bTable('b3', t3, 'pieza', 'Pieza (utm_content)', privacy, await fam('origin')),
        ]
      : [this.notMeasured('b1', t1, 'BD', ORIGIN_OFF), this.notMeasured('b2', t2, 'BD', ORIGIN_OFF), this.notMeasured('b3', t3, 'BD', ORIGIN_OFF)];
    const cs = await fam('cardshow');
    return [
      ...b,
      await this.famNoted(fam, 'b4', () => this.b4Channels(privacy, fam)),
      this.csTable('b5', privacy, cs),
      this.csTable('b6', privacy, cs),
    ];
  }

  /**
   * b5/b6 (v1.109, MKT-MEDIR-CS; §MKT.H.14): dos componentes por fila, `avisame` (`CS_LEAD`) y `torneo` (`CS_SIGNUP`), sin MX$.
   * Valor publicado = filas; umbral = buzones distintos (R1). b5: una fila por día del periodo en orden de fecha (R0 sin valores;
   * en un mes, su estado lo fija la semana). b6: orden R0 como b1-b3, sin «Otros».
   */
  private csTable(id: 'b5' | 'b6', privacy: CellPrivacy, f: FamilyResult): AggTable {
    const head = CS_HEADS[id];
    const col = head.keyColumn.key;
    const opts = { complement: !f.dims.fixed?.includes(id), keepOrder: id === 'b5' };
    const safe = applySmallCellsByComponent(f.dims.parts[id] ?? [], privacy, f.forced.get(id), opts);
    // `exact` (MKT.G.2): b5 sigue en orden de fecha; b6 en orden real (avisame desc, torneo desc, clave).
    const rows =
      privacy === 'exact' && id === 'b6'
        ? [...safe].sort((a, b) => num(b, 'avisame') - num(a, 'avisame') || num(b, 'torneo') - num(a, 'torneo') || (a.key < b.key ? -1 : 1))
        : safe;
    return {
      id: head.id,
      title: head.title,
      source: head.source,
      columns: [
        { ...head.keyColumn },
        { key: 'avisame', labelEs: 'Avísame (registros confirmados)', kind: 'count' },
        { key: 'torneo', labelEs: 'Torneo (preinscripciones confirmadas)', kind: 'count' },
      ],
      rows: rows.map((r) => ({ [col]: r.key, avisame: r.parts.avisame.count as Cell, torneo: r.parts.torneo.count as Cell })),
      measured: true,
      notes: [
        CS_SOURCE_NOTE,
        ...(id === 'b6' ? [CS_UTM_NOTE] : []),
        cellsNote(privacy, `Avísame y torneo se ocultan por separado: menos de ${SMALL_CELL_THRESHOLD} buzones distintos ⇒ «< 5».`),
      ],
    };
  }

  /**
   * b5 y b6 en un rango (una sola lectura): `CardShowLead` (todo `type`) y `CardShowPlayerSignup` (todo `game`) con `confirmedAt`
   * en el rango y `status ≠ pending`. ⛔ Solo las columnas del conteo (sin correo, nombre, teléfono ni juego): b5/b6 no se parten
   * por juego, tipo ni día de torneo (X3, §MKT.H.14).
   */
  private async csDims(p: DayRange): Promise<Record<'b5' | 'b6', ComponentRow[]>> {
    const range = mxRange(p.from, p.to);
    const select = { confirmedAt: true, mailboxHmac: true, utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true } as const;
    const [leads, signups] = await Promise.all([
      this.prisma.cardShowLead.findMany({ where: { confirmedAt: range, status: { not: 'pending' } }, select }),
      this.prisma.cardShowPlayerSignup.findMany({ where: { confirmedAt: range, status: { not: 'pending' } }, select }),
    ]);
    type Acc = { rows: number; boxes: Set<string> };
    const fresh = (): Record<CsPart, Acc> => ({ avisame: { rows: 0, boxes: new Set() }, torneo: { rows: 0, boxes: new Set() } });
    const days = new Map<string, Record<CsPart, Acc>>();
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) days.set(d, fresh());
    const utms = new Map<string, Record<CsPart, Acc>>();
    const bump = (m: Map<string, Record<CsPart, Acc>>, k: string, part: CsPart, box: string) => {
      const e = m.get(k) ?? fresh();
      e[part].rows += 1;
      e[part].boxes.add(box);
      m.set(k, e);
    };
    for (const [part, xs] of [['avisame', leads], ['torneo', signups]] as const) {
      for (const x of xs) {
        if (!x.confirmedAt) continue;
        if (isInternalUtm(x.utmSource, x.utmMedium)) continue; // MKT-V2 §4 (b5 y b6 cuadran entre sí: E8/E9)
        const day = toMexicoCityDateKey(x.confirmedAt);
        if (days.has(day)) bump(days, day, part, x.mailboxHmac);
        bump(utms, csUtmKey(x), part, x.mailboxHmac);
      }
    }
    const rowsOf = (m: Map<string, Record<CsPart, Acc>>): ComponentRow[] =>
      [...m.entries()].map(([key, e]) => ({
        key,
        parts: {
          avisame: { count: e.avisame.rows, subjects: e.avisame.boxes.size, money: {} },
          torneo: { count: e.torneo.rows, subjects: e.torneo.boxes.size, money: {} },
        },
      }));
    return { b5: rowsOf(days), b6: rowsOf(utms).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) };
  }

  /**
   * b1-b3: una tabla con dimensión `keyOf(first_utm_*)` y DOS componentes por fila (§MKT.H.14): `pedidos`→`mxnPedidos`
   * (`PAID_ORIGIN`, sujeto = pedido) y `solicitudes`→`mxnOfertado` (`REQ_ORIGIN`, sujeto = solicitud). Cada componente con su
   * propio umbral (R1): ⛔ nunca la suma de los dos (SEC-MKT-1). Sin fila «Otros»: una fila parcial conserva su clave.
   */
  private bTable(id: PartsTable, title: string, col: string, label: string, privacy: CellPrivacy, f: FamilyResult): AggTable {
    const safe = applySmallCellsByComponent(f.dims.parts[id] ?? [], privacy, f.forced.get(id));
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

  /**
   * b1-b3 en un rango: dimensión `keyOf(first_utm_*)` y DOS componentes por fila (§MKT.H.14): `pedidos`→`mxnPedidos`
   * (`PAID_ORIGIN`, sujeto = pedido) y `solicitudes`→`mxnOfertado` (`REQ_ORIGIN`, sujeto = solicitud). Cada componente con su
   * propio umbral (R1): ⛔ nunca la suma de los dos (SEC-MKT-1). Una sola lectura para las tres tablas.
   */
  private async bDims(p: DayRange): Promise<Record<'b1' | 'b2' | 'b3', ComponentRow[]>> {
    const range = mxRange(p.from, p.to);
    const [allOrders, allRequests] = await Promise.all([
      this.prisma.order.findMany({
        where: { settledAt: range, status: { in: SOLD_STATUSES }, firstUtmSource: { not: null } },
        select: { firstUtmSource: true, firstUtmMedium: true, firstUtmContent: true, totalCents: true },
      }),
      this.prisma.sellRequest.findMany({
        where: { createdAt: range, firstUtmSource: { not: null } },
        select: { firstUtmSource: true, firstUtmMedium: true, firstUtmContent: true, quotedTotalCents: true },
      }),
    ]);
    // MKT-V2 §4: el tráfico propio (diag-*, qa-*…) no cuenta, ANTES de calcular totales de familia.
    const orders = allOrders.filter((o) => !isInternalUtm(o.firstUtmSource, o.firstUtmMedium));
    const requests = allRequests.filter((r) => !isInternalUtm(r.firstUtmSource, r.firstUtmMedium));
    const rowsOf = (keyOf: BKey): ComponentRow[] => {
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
      for (const r of requests) bump(keyOf(r.firstUtmSource, r.firstUtmMedium, r.firstUtmContent), 's', r.quotedTotalCents);
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
    return { b1: rowsOf(bKeyOrigin), b2: rowsOf(bKeyDoor), b3: rowsOf(bKeyPiece) };
  }

  /** b4 (§MKT.H.9) — Google orgánico, Directo, Referencias por dominio, Asistentes de IA (misma consulta que a4). */
  private async b4Channels(privacy: CellPrivacy, fam: Fam): Promise<AggTable> {
    const title = 'Google orgánico, directo, referencias e IA';
    const safe = familyRows(await fam('sessions'), 'b4', privacy);
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
  private async screenE(period: MarketingPeriod, now: Date, privacy: CellPrivacy, fam: Fam): Promise<AggTable[]> {
    return [await this.e1SearchConsole(period, now, privacy), await this.e2Pages(period, now, privacy), await this.famNoted(fam, 'e3', () => this.e3Ai(privacy, fam))];
  }

  /** e3 (§MKT.H.9) — sesiones desde asistentes de IA (lista fija en código) por página de aterrizaje. */
  private async e3Ai(privacy: CellPrivacy, fam: Fam): Promise<AggTable> {
    const title = 'Referencias de asistentes de IA';
    const safe = familyRows(await fam('sessions'), 'e3', privacy);
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
  private async screenG(period: MarketingPeriod, privacy: CellPrivacy, fam: Fam): Promise<AggTable[]> {
    if (!(await this.originMeasured(period))) {
      return [this.notMeasured('g1', 'Compras atribuidas a promociones (utm_medium=paid)', 'BD', ORIGIN_OFF)];
    }
    // g1 con su familia (b1-b3): R4 la ata a b2[Promoción] (E4), también en `aggregates` y `export/todo`.
    const [row] = familyRows(await fam('origin'), 'g1', privacy) ?? [];
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
    // Base de b1-b3 (`PAID_ORIGIN`, §MKT.H.14): sin `firstUtmSource` no entra, para que g1 ≡ b2[Promoción] sea identidad exacta.
    // MKT-V2 §4: igual que b1-b3, sin tráfico propio (por eso `findMany` y no `aggregate`: el patrón no se expresa en SQL).
    const rows = await this.prisma.order.findMany({
      where: { settledAt: mxRange(p.from, p.to), status: { in: SOLD_STATUSES }, firstUtmSource: { not: null }, firstUtmMedium: 'paid' },
      select: { firstUtmSource: true, firstUtmMedium: true, totalCents: true },
    });
    const own = rows.filter((o) => !isInternalUtm(o.firstUtmSource, o.firstUtmMedium));
    const cents = own.reduce((n, o) => n + o.totalCents, 0);
    return [{ key: G1_KEY, count: own.length, subjects: own.length, money: { mxn: centsToPesos(cents) } }];
  }

  // ──────────────────────────────── Pantalla (r) Resumen (MKT_PANEL_V2 §1-§2) ────────────────────────────────

  /**
   * r1 cifras con delta, r2 avisos y, SOLO con `privacy='exact'` (vista del dueño) y semana, r3 día por día. ⛔ `r3` no existe en
   * `small_cells` (exports, tokens, weekly-excel, correo): la regla de `marketing-period.ts` (sin detalle por día) sigue en pie
   * para todo lo demás.
   */
  private async screenR(period: MarketingPeriod, now: Date, privacy: CellPrivacy, fam: Fam, opts: { forEmail?: boolean } = {}): Promise<AggTable[]> {
    const exact = privacy === 'exact';
    const prevP: MarketingPeriod = { ...period, from: period.prev.from, to: period.prev.to, label: `${period.label}~prev` };
    const live = this.ga4Live();
    const reason = this.ga4Reason();
    const report = await this.sales.report({ preset: 'custom', from: period.from, to: period.to, groupBy: 'day' }, now);
    let r1Unf = false;
    const pair = async (spec: Ga4ReportSpec): Promise<[Ga4Row[] | null, Ga4Row[] | null]> => {
      if (!live) return [null, null];
      const [out, m] = await this.tracked(async () => [await this.ga4(spec, period, now), await this.ga4(spec, prevP, now)] as [Ga4Row[] | null, Ga4Row[] | null]);
      if (this.anyUnf(m)) r1Unf = true;
      return out;
    };
    const [totC, totP] = await pair(GA4_SPECS.funnelSessions);
    const [nvrC, nvrP] = await pair(GA4_SPECS.nvr);
    const [evC, evP] = await pair(GA4_SPECS.events);
    const [srcC, srcP] = await pair(GA4_SPECS.sources);

    const ev = (rows: Ga4Row[] | null, name: string): number | string => (rows ? (rows.find((r) => r.dimensions[0] === name)?.metrics[0] ?? 0) : reason);
    const users = (rows: Ga4Row[] | null): number | string => (rows ? (rows[0]?.metrics[1] ?? 0) : reason);

    // Sesiones de Instagram (a4): solo se suman celdas VISIBLES de la familia (la suma no despeja una celda oculta de a4).
    const igOf = async (p: MarketingPeriod, isCur: boolean): Promise<Cell> => {
      if (!live) return reason;
      try {
        const f = isCur ? await fam('sessions') : await this.family('sessions', p, now, privacy);
        const rows = familyRows(f, 'a4', privacy);
        if (!rows) return reason;
        return sumIfVisible(rows.filter((r) => r.key === 'Instagram orgánico' || r.key === 'Instagram pagado').map((r) => r.count as Cell));
      } catch {
        return reason;
      }
    };
    const [igC, igP] = [await igOf(period, true), await igOf(prevP, false)];

    // Google (Search Console, totales sin dimensión): ~2-3 días de retraso.
    const ext = this.external;
    const scOn = ext?.searchConsoleConfigured() === true;
    const sc = async (p: DayRange) => (scOn && ext ? await ext.searchConsoleTotals(p.from, p.to, now) : ({ ok: false } as const));
    const [scC, scP] = [await sc(period), await sc(prevP)];
    const scv = (r: Awaited<ReturnType<typeof sc>>, k: 'clicks' | 'impressions'): Cell => (r.ok ? (r.rows[0]?.[k] ?? 0) : SC_UNCONNECTED);

    const [accC, accP] = [await this.acceptPct(period), await this.acceptPct(prevP)];

    const t = report.totals;
    const pr = report.previousTotals;
    const nv = nvrC ? nvrCells(nvrOf(nvrC), exact) : [reason, reason];
    const nvP = nvrP ? nvrCells(nvrOf(nvrP), exact) : [reason, reason];
    const line = (cifra: string, cur: Cell, prev: Cell, basis?: [number, number]): Record<string, Cell> => ({ cifra, actual: cur, anterior: prev, ...deltaCells(cur, prev, basis) });
    const ordersBasis: [number, number] = [t.orders, pr.orders];
    const r1Rows = [
      line('Visitantes reales (que aceptaron cookies)', users(totC), users(totP)),
      line('· Nuevos', nv[0], nvP[0]),
      line('· Recurrentes', nv[1], nvP[1]),
      line('Sesiones desde Instagram', igC, igP),
      line('Fichas vistas', ev(evC, 'view_item'), ev(evP, 'view_item')),
      line('Agregados al carrito', ev(evC, 'add_to_cart'), ev(evP, 'add_to_cart')),
      line('Inicios de pago', ev(evC, 'begin_checkout'), ev(evP, 'begin_checkout')),
      line('Pedidos pagados', t.orders, pr.orders),
      line('· Ventas (MX$, IVA incluido)', centsToPesos(t.chargedCents), centsToPesos(pr.chargedCents), ordersBasis),
      line('Google: clics', scv(scC, 'clicks'), scv(scP, 'clicks')),
      line('· Google: impresiones', scv(scC, 'impressions'), scv(scP, 'impressions')),
      line('Aceptación de cookies (%)', accC, accP),
    ];
    const r1: AggTable = {
      id: 'r1',
      title: 'Cifras de la semana',
      source: 'mixed',
      columns: [
        { key: 'cifra', labelEs: 'Cifra', kind: 'text' },
        { key: 'actual', labelEs: 'Esta semana', kind: 'number' },
        { key: 'anterior', labelEs: 'Semana anterior', kind: 'number' },
        { key: 'delta_abs', labelEs: 'Cambio', kind: 'number' },
        { key: 'delta_pct', labelEs: 'Cambio (%)', kind: 'pct' },
      ],
      rows: r1Rows,
      measured: true,
      notes: [
        'Las cifras de visitantes, fichas, carritos y pagos son de GA4 y solo cuentan a quien aceptó cookies (ver «Aceptación de cookies»); pedidos y ventas vienen de la base y cuentan a todos.',
        'Sin cambio (≈): esta semana y la anterior tienen menos de 5. «Cambio (%)» vacío con cambio absoluto = antes era 0 (nuevo).',
        'Google tiene 2–3 días de retraso: el fin de semana puede estar incompleto.',
        'Nuevos y recurrentes: si una sale «< 5», la otra se oculta (el total de visitantes es exacto).',
        ...(exact ? [EXACT_CELLS_NOTE] : []),
      ],
    };

    // r2 — avisos.
    const [alerts, r2m] = await this.tracked(() => this.r2Alerts(period, prevP, now, exact, { live, reason, scOn, checkout: evC ? Number(ev(evC, 'begin_checkout')) : null, srcC, srcP, paid: t.orders }, opts.forEmail === true));
    // Los avisos que se apoyan en lecturas sin filtro (AV3 aquí; AV2/AV1 con las fuentes de r1) llevan la nota igual.
    const r2Unf = this.anyUnf(r2m) || r1Unf;
    const r2: AggTable = {
      id: 'r2',
      title: 'Qué hacer esta semana',
      source: 'mixed',
      columns: [
        { key: 'regla', labelEs: 'Regla', kind: 'text' },
        { key: 'gravedad', labelEs: 'Gravedad', kind: 'text' },
        { key: 'titulo', labelEs: 'Aviso', kind: 'text' },
        { key: 'evidencia', labelEs: 'Evidencia', kind: 'text' },
        { key: 'accion', labelEs: 'Qué hacer', kind: 'text' },
      ],
      rows: alerts.map((a) => ({ regla: a.regla, gravedad: a.gravedad, titulo: a.titulo, evidencia: a.evidencia, accion: a.accion })),
      measured: true,
      notes: ['Avisos por reglas fijas con umbral; sin IA. Cada uno cita sus números.'],
    };

    const out = [this.noted(r1, r1Unf), this.noted(r2, r2Unf)];
    if (exact && period.kind === 'week') out.push(await this.scoped(() => this.r3Daily(period, now)));
    return out;
  }

  /** % de respuestas «aceptar» del banner en el periodo (f1). `string` = motivo; `null` = sin respuestas. */
  private async acceptPct(p: MarketingPeriod): Promise<Cell> {
    if (!(await this.bannerMeasured(p))) return BANNER_OFF;
    const grouped = await this.prisma.marketingBannerConsentCounter.groupBy({ by: ['response'], where: { weekStart: this.bannerWeeks(p) }, _sum: { count: true } });
    const all = grouped.reduce((n, g) => n + (g._sum.count ?? 0), 0);
    const acc = grouped.filter((g) => g.response === 'accept').reduce((n, g) => n + (g._sum.count ?? 0), 0);
    return all === 0 ? null : Math.round((acc / all) * 1000) / 10;
  }

  private async r2Alerts(
    period: MarketingPeriod,
    prevP: MarketingPeriod,
    now: Date,
    exact: boolean,
    c: { live: boolean; reason: string; scOn: boolean; checkout: number | null; srcC: Ga4Row[] | null; srcP: Ga4Row[] | null; paid: number },
    forEmail = false,
  ): Promise<Alert[]> {
    const missing: string[] = [];
    if (!c.live) missing.push(c.reason.replace('NO MEDIDO — ', ''));
    if (!c.scOn) missing.push('Search Console sin conectar');
    // AV2
    const groups = c.srcC && c.srcP ? A4_GROUPS_OF(c.srcC, c.srcP) : null;
    // AV3 (GA4 `items` + vendidas en BD)
    let items: { name: string; views: number; carts: number; sold: boolean }[] | null = null;
    const itemRows = await this.ga4(GA4_SPECS.items, period, now);
    if (itemRows) {
      const views = itemViews(itemRows);
      const sold = await this.soldIdsOf(period);
      const cand = [...views.entries()].filter(([id, v]) => v.views >= AV3_MIN_VIEWS && v.carts <= AV3_MAX_CARTS && !sold.has(id)).sort((a, b) => b[1].views - a[1].views || a[0].localeCompare(b[0])).slice(0, 10);
      const names = await this.itemNames(cand.map(([id]) => id));
      items = cand.map(([id, v]) => ({ name: names.get(id) ?? id, views: v.views, carts: v.carts, sold: false }));
    }
    // AV4 (páginas de Google; nunca consultas)
    let scPages: { label: string; impressions: number; clicks: number; position: number }[] | null = null;
    if (c.scOn && this.external) {
      const r = await this.external.searchConsolePages(period.from, period.to, now);
      if (r.ok) scPages = await this.scPageLabels(r.rows);
      else missing.push('Search Console sin conectar');
    }
    // AV5 (buylist sin stock)
    const buylist = await this.buylistWithoutStock(period);
    // AV6 (búsquedas sin resultado)
    const misses = await this.searchMisses(period);
    // AV7 (indexación de Google; §GSHOP.A). Solo con Search Console conectado (si no, ya consta «sin conectar»).
    let indexIssues: Av7Summary | null = null;
    if (c.scOn && this.indexInspection) {
      try {
        const v = await this.indexInspection.av7Input(now, { forEmail });
        if (v.missing) missing.push(v.missing);
        else indexIssues = v.summary;
      } catch {
        missing.push('la indexación: lectura fallida');
      }
    }
    const alerts = evaluateAlerts({ checkoutStarts: c.checkout, paidOrders: c.paid, groups, items, scPages, buylist, searchMisses: misses, indexIssues, exact });
    return alertsWithSources(alerts, missing);
  }

  /** AV5: cartas con ≥ 5 cotizaciones del cotizador en la semana y 0 unidades `listed` de plataforma. */
  private async buylistWithoutStock(p: DayRange): Promise<{ name: string; quotes: number; listed: number }[]> {
    const grouped = await this.prisma.buylistQuoteDailyCount.groupBy({
      by: ['cardId'],
      where: { day: { gte: new Date(`${p.from}T00:00:00.000Z`), lte: new Date(`${p.to}T00:00:00.000Z`) } },
      _sum: { count: true },
    });
    const hot = grouped.filter((g) => (g._sum.count ?? 0) >= AV5_MIN_QUOTES);
    if (hot.length === 0) return [];
    const ids = hot.map((g) => g.cardId);
    const [listed, cards] = await Promise.all([
      this.prisma.inventoryItem.groupBy({ by: ['cardId'], where: { cardId: { in: ids }, ownerType: 'platform', status: 'listed' }, _count: { _all: true } }),
      this.prisma.card.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, number: true, set: { select: { name: true } } } }),
    ]);
    const listedBy = new Map(listed.map((l) => [l.cardId, l._count._all]));
    const cardBy = new Map(cards.map((c) => [c.id, `${c.name} · ${c.set.name} ${c.number}`]));
    return hot.map((g) => ({ name: cardBy.get(g.cardId) ?? g.cardId, quotes: g._sum.count ?? 0, listed: listedBy.get(g.cardId) ?? 0 }));
  }

  /** URL de página de Google ⇒ etiqueta (ficha por nombre desde BD) agregada por etiqueta. Clics e impresiones suman; posición ponderada. */
  private async scPageLabels(rows: { page: string; clicks: number; impressions: number; position: number }[]): Promise<{ label: string; impressions: number; clicks: number; position: number }[]> {
    const pathOf = (u: string): string => {
      try {
        return new URL(u).pathname;
      } catch {
        return u.split(/[?#]/)[0];
      }
    };
    const labels = await this.fichaLabels(rows.map((r) => pathOf(r.page)));
    const acc = new Map<string, { clicks: number; impressions: number; posW: number }>();
    for (const r of rows) {
      const path = pathOf(r.page);
      const key = labels.get(path) ?? path;
      const e = acc.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
      e.clicks += r.clicks;
      e.impressions += r.impressions;
      e.posW += r.position * r.impressions;
      acc.set(key, e);
    }
    return [...acc.entries()].map(([label, e]) => ({ label, clicks: e.clicks, impressions: e.impressions, position: e.impressions > 0 ? e.posW / e.impressions : 0 }));
  }

  /** r3 (solo `exact`, 7 filas CDMX): nuevos/recurrentes y sesiones por origen, por día. NO MEDIDO si GA4 no reporta en CDMX. */
  private async r3Daily(period: MarketingPeriod, now: Date): Promise<AggTable> {
    const title = 'Día por día';
    const ext = this.external;
    if (!this.ga4Live() || !ext) return this.notMeasured('r3', title, 'GA4', this.ga4Reason());
    const [nvr, src] = [await this.ga4Raw(GA4_SPECS.dailyNvr, period, now), await this.ga4Raw(GA4_SPECS.dailySrc, period, now)];
    if (!nvr.ok || !src.ok) return this.notMeasured('r3', title, 'GA4', GA4_UNCONNECTED);
    if (nvr.timeZone !== 'America/Mexico_City' || src.timeZone !== 'America/Mexico_City') {
      return this.notMeasured('r3', title, 'GA4', 'NO MEDIDO — la zona horaria de GA4 no es CDMX');
    }
    const ymd = (d: string): string => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d);
    const days: Ymd[] = [];
    for (let d = period.from; d <= period.to; d = addDays(d, 1)) days.push(d);
    const blank = (): Record<string, number> => ({ nuevos: 0, recurrentes: 0, ses_instagram_organico: 0, ses_instagram_pagado: 0, ses_google: 0, ses_ia: 0, ses_directo_otros: 0 });
    const byDay = new Map(days.map((d) => [d, blank()]));
    for (const r of nvr.rows) {
      const e = byDay.get(ymd(r.dimensions[0]));
      if (!e) continue;
      if (r.dimensions[1] === 'new') e.nuevos += r.metrics[0] ?? 0;
      else if (r.dimensions[1] === 'returning') e.recurrentes += r.metrics[0] ?? 0;
    }
    const col: Record<string, string> = {
      'Instagram orgánico': 'ses_instagram_organico',
      'Instagram pagado': 'ses_instagram_pagado',
      'Google orgánico': 'ses_google',
      'Asistentes de IA': 'ses_ia',
      'Directo/otros': 'ses_directo_otros',
    };
    for (const r of src.rows) {
      const e = byDay.get(ymd(r.dimensions[0]));
      if (e) e[col[a4Group(r.dimensions[1], r.dimensions[2], r.dimensions[3])]] += r.metrics[0] ?? 0;
    }
    const keys = Object.keys(blank());
    return {
      id: 'r3',
      title,
      source: 'GA4',
      columns: [{ key: 'dia', labelEs: 'Día (CDMX)', kind: 'text' }, ...keys.map((k) => ({ key: k, labelEs: R3_LABELS[k], kind: 'count' as const }))],
      rows: days.map((d) => ({ dia: d, ...(byDay.get(d) as Record<string, number>) })),
      measured: true,
      notes: ['Solo visible para ti.', 'Solo quien aceptó cookies. Cifras exactas de la vista del dueño; nunca sale en exports, tokens ni correo.'],
    };
  }

  // ──────────────────────────────── Tablas nuevas de c, e (MKT-V2 §5-§6) ────────────────────────────────

  /** c2 (§6.1) — tiempo medio por TIPO de página. */
  private async c2PageTypes(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Dónde pasan más tiempo';
    const safe = await this.ga4SafeRows(GA4_SPECS.pages, period, now, privacy, (rows) => c2Rows(rows));
    if (!safe) return this.notMeasured('c2', title, 'GA4', this.ga4Reason());
    return {
      id: 'c2',
      title,
      source: 'GA4',
      columns: [
        { key: 'tipo', labelEs: 'Tipo de página', tech: 'pagePath', kind: 'text' },
        { key: 'vistas', labelEs: 'Vistas', tech: 'screenPageViews', kind: 'count' },
        { key: 'usuarios', labelEs: 'Usuarios', tech: 'totalUsers', kind: 'count' },
        { key: 'tiempoMedio', labelEs: 'Tiempo medio por vista (s)', tech: 'userEngagementDuration / screenPageViews', kind: 'number' },
      ],
      rows: safe.map((r) => ({ tipo: r.key, vistas: r.money.vistas ?? null, usuarios: r.count as Cell, tiempoMedio: r.money.tiempoMedio ?? null })),
      measured: true,
      notes: ['Solo quien aceptó la analítica.', c1UsersNote(privacy), cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} usuarios ⇒ «< 5» sin el resto de cifras.`)],
    };
  }

  /** c3 / c8 (§6.2) — por tipo de página de aterrizaje: sesiones y abandono = 1 − sesiones con interacción / sesiones. */
  private async landingTable(id: 'c3' | 'c8', title: string, spec: Ga4ReportSpec, period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const safe = await this.ga4SafeRows(spec, period, now, privacy, (rows) => landingRows(rows));
    if (!safe) return this.notMeasured(id, title, 'GA4', this.ga4Reason());
    return {
      id,
      title,
      source: 'GA4',
      columns: [
        { key: 'tipo', labelEs: 'Tipo de página de aterrizaje', tech: 'landingPage', kind: 'text' },
        { key: 'sesiones', labelEs: 'Sesiones', tech: 'sessions', kind: 'count' },
        { key: 'abandono', labelEs: '% que se va sin interactuar', tech: '1 − engagedSessions / sessions', kind: 'pct' },
      ],
      rows: safe.map((r) => ({ tipo: r.key, sesiones: r.count as Cell, abandono: r.money.abandono ?? null })),
      measured: true,
      notes: [id === 'c8' ? 'Solo sesiones que llegaron desde Instagram.' : 'Todas las fuentes.', 'Solo quien aceptó la analítica.', cellsNote(privacy, `Menos de ${SMALL_CELL_THRESHOLD} sesiones ⇒ «< 5» sin el resto de cifras.`)],
    };
  }

  /** c4 (§6.3) — % de fichas vistas donde el botón COMPRAR se vio. Totales sin dimensión ⇒ exactos (como a5). */
  private async c4BuyButton(period: MarketingPeriod, now: Date): Promise<AggTable> {
    const title = '% de fichas donde el botón COMPRAR se ve';
    const events = await this.ga4(GA4_SPECS.events, period, now);
    if (!events) return this.notMeasured('c4', title, 'GA4', this.ga4Reason());
    const by = new Map(events.map((r) => [r.dimensions[0], r.metrics[0] ?? 0]));
    if (!by.has('buy_button_visible')) return this.notMeasured('c4', title, 'GA4', BUY_BUTTON_DEFERRED);
    const views = by.get('view_item') ?? 0;
    const seen = by.get('buy_button_visible') as number;
    return {
      id: 'c4',
      title,
      source: 'GA4',
      columns: [
        { key: 'concepto', labelEs: 'Concepto', kind: 'text' },
        { key: 'n', labelEs: 'Nº', tech: 'eventCount', kind: 'count' },
        { key: 'pct', labelEs: '% de las fichas vistas', kind: 'pct' },
      ],
      rows: [
        { concepto: 'Fichas vistas (view_item)', n: views, pct: null },
        { concepto: 'Con el botón COMPRAR visible (buy_button_visible)', n: seen, pct: views > 0 ? Math.round((seen / views) * 1000) / 10 : null },
      ],
      measured: true,
      notes: ['Totales sin dimensión: cifras exactas de quien aceptó la analítica.'],
    };
  }

  /** c6 (§6.4, §7) — búsquedas sin resultado (registro propio, sin identificador): término con ≥ 5 en ≥ 2 días. */
  private async c6SearchMiss(period: MarketingPeriod): Promise<AggTable> {
    const title = 'Búsquedas sin resultado';
    if (!(await this.flagOn(SEARCH_LOG_FLAG))) return this.notMeasured('c6', title, 'Srv', SEARCH_LOG_OFF);
    const terms = await this.searchMisses(period);
    if (!terms) return this.notMeasured('c6', title, 'Srv', SEARCH_LOG_UNREADABLE);
    return {
      id: 'c6',
      title,
      source: 'Srv',
      columns: [
        { key: 'termino', labelEs: 'Lo que buscaron', kind: 'text' },
        { key: 'busquedas', labelEs: 'Personas que lo buscaron', kind: 'count' },
        { key: 'dias', labelEs: 'Días con 2 personas o más', kind: 'count' },
      ],
      rows: [...terms].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term)).map((x) => ({ termino: x.term, busquedas: x.count, dias: x.days })),
      measured: true,
      notes: [`Solo términos que buscaron al menos ${SEARCH_MISS_MIN_PEOPLE} personas distintas, en ${SEARCH_MISS_MIN_DAYS} días o más con 2 personas cada uno. Cuenta personas, no búsquedas; no se guarda usuario, IP ni cookie (un código del día se borra al cerrar). Solo salen palabras del catálogo.`],
    };
  }

  /** Términos de c6 (PERSONAS) que pasan el umbral y el vocabulario en el periodo; `null` ⇒ no se pudo leer. Flag apagado ⇒ `[]`. */
  private async searchMisses(p: DayRange): Promise<{ term: string; count: number; days: number }[] | null> {
    try {
      if (!(await this.flagOn(SEARCH_LOG_FLAG))) return [];
      if (!this.searchMiss) return [];
      const rows = await this.searchMiss.readQualifying(p.from, p.to);
      return rows ? rows.map((x) => ({ term: x.term, count: x.people, days: x.days })) : null;
    } catch {
      return null;
    }
  }

  /** Interruptor de `ConfigSetting` (`"on"`/`"off"`): ausente ⇒ encendido. */
  private async flagOn(key: string): Promise<boolean> {
    try {
      const row = await this.prisma.configSetting.findUnique({ where: { key }, select: { valueJson: true } });
      return row?.valueJson !== 'off';
    } catch {
      return true;
    }
  }

  /** c9 (§5) — usuarios por estado (sin ciudad). */
  private async c9Regions(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const [t, m] = await this.tracked(() => this.c9Build(period, now, privacy));
    if (!t.measured) return t;
    // El pliegue complementario mezcla `region` con `funnelSessions`: deben haber salido con el MISMO estado de filtro.
    const u = (spec: Ga4ReportSpec): boolean | undefined => m.get(spec);
    if (privacy !== 'exact' && u(GA4_SPECS.region) !== u(GA4_SPECS.funnelSessions)) {
      return this.notMeasured('c9', t.title, 'GA4', 'NO MEDIDO — las consultas de GA4 no salieron con el mismo filtro de tráfico propio');
    }
    return this.noted(t, this.anyUnf(m));
  }

  private async c9Build(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Estados de quienes visitan';
    const safe = await this.ga4SafeRows(GA4_SPECS.region, period, now, privacy, (rows) => regionRows(rows));
    if (!safe) return this.notMeasured('c9', title, 'GA4', this.ga4Reason());
    let shown: { estado: string; usuarios: Cell }[];
    if (privacy === 'exact') {
      shown = safe.map((r) => ({ estado: r.key, usuarios: r.count as Cell }));
    } else {
      // Supresión complementaria contra r1 (Visitantes = `totalUsers` de la misma semana): el resto nunca sale < 5.
      const totals = await this.ga4(GA4_SPECS.funnelSessions, period, now);
      if (!totals) return this.notMeasured('c9', title, 'GA4', this.ga4Reason());
      const visible = safe.filter((r) => typeof r.count === 'number' && !r.otros && r.key !== 'Sin dato').map((r) => ({ key: r.key, count: r.count as number }));
      const { rows, rest } = foldRegionRest(visible, totals[0]?.metrics[1] ?? 0);
      shown = [...rows.map((r) => ({ estado: r.key, usuarios: r.count as Cell })), ...(rest === null ? [] : [{ estado: REGION_REST_LABEL, usuarios: rest as Cell }])];
    }
    return {
      id: 'c9',
      title,
      source: 'GA4',
      columns: [
        { key: 'estado', labelEs: 'Estado', tech: 'region', kind: 'text' },
        { key: 'usuarios', labelEs: 'Usuarios', tech: 'totalUsers', kind: 'count' },
      ],
      rows: shown,
      measured: true,
      notes: ['Solo quien aceptó la analítica; sin ciudad (con tan pocas personas identificaría).', cellsNote(privacy, `Estados con menos de ${SMALL_CELL_THRESHOLD} usuarios van en «${REGION_REST_LABEL}», que nunca baja de ${SMALL_CELL_THRESHOLD}.`)],
    };
  }

  /** e2 (§5) — páginas en Google (Search Console): clics, impresiones, CTR y posición por página. */
  private async e2Pages(period: MarketingPeriod, now: Date, privacy: CellPrivacy): Promise<AggTable> {
    const title = 'Páginas en Google';
    const ext = this.external;
    if (!ext?.searchConsoleConfigured()) return this.notMeasured('e2', title, 'SC', SC_UNCONNECTED);
    const dimsOf = async (p: DayRange): Promise<DimensionRow[]> => {
      const r = await ext.searchConsolePages(p.from, p.to, now);
      if (!r.ok) throw new Error('search console unavailable');
      const labelled = await this.scPageLabels(r.rows);
      return labelled.map((x) => ({
        key: x.label,
        count: x.clicks,
        subjects: x.clicks,
        money: { impresiones: x.impressions, ctr: x.impressions > 0 ? x.clicks / x.impressions : 0, posicion: x.position },
      }));
    };
    let safe: SafeRow[];
    try {
      safe = await this.safeRows(period, privacy, dimsOf);
    } catch {
      return this.notMeasured('e2', title, 'SC', SC_UNCONNECTED);
    }
    const round = (v: number | null | undefined | typeof SMALL_CELL_HIDDEN, f: number): Cell => (typeof v === 'number' ? Math.round(v * f) / f : (v ?? null));
    return {
      id: 'e2',
      title,
      source: 'SC',
      columns: [
        { key: 'pagina', labelEs: 'Página', tech: 'page', kind: 'text' },
        { key: 'clics', labelEs: 'Clics', tech: 'clicks', kind: 'count' },
        { key: 'impresiones', labelEs: 'Impresiones', tech: 'impressions', kind: 'count' },
        { key: 'ctr', labelEs: 'CTR (%)', tech: 'ctr', kind: 'pct' },
        { key: 'posicion', labelEs: 'Posición media', tech: 'position', kind: 'number' },
      ],
      rows: safe.map((r) => ({
        pagina: r.key,
        clics: r.count as Cell,
        impresiones: r.money.impresiones ?? null,
        ctr: typeof r.money.ctr === 'number' ? round(r.money.ctr * 100, 10) : (r.money.ctr ?? null),
        posicion: round(r.money.posicion, 10),
      })),
      measured: true,
      notes: ['Search Console, por página (nunca la consulta). No recoge nada del visitante.', cellsNote(privacy, `Páginas con menos de ${SMALL_CELL_THRESHOLD} clics ⇒ «< 5» sin el resto de cifras.`)],
    };
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
