/**
 * sales-period.ts — 💰 el PERIODO de la analítica de ventas (API_CONTRACT §15.2, R-1 de §15.3; ARCHITECTURE §4.64.4). Puro.
 *
 * - Todo día es día civil de **México** (`America/Mexico_City`). Un periodo `from…to` es el semiabierto
 *   `[mxDayStart(from), mxDayStart(nextYmd(to)))` de `spend-alerts/mx-day.ts`. ⛔ Nunca `range()` de `admin.service.ts`
 *   (D-AN-2: medianoche UTC y `lte`).
 * - Los presets se resuelven AQUÍ, con el reloj del servidor (⛔ el navegador fuera de México cortaría otro día).
 * - Los cubos (`day | week | month`) se RECORTAN al periodo: la semana es lunes a domingo y el mes es el calendario, pero
 *   el primero y el último cubo empiezan/terminan en `from`/`to` (criterio 605: el total no cambia al agrupar).
 */
import { BusinessException } from '../../common/business.exception';
import { parseEnumFilter } from '../../common/enum-filter';
import { toMexicoCityDateKey } from '../../common/business-days';
import { isYmd, mxDayStart, nextYmd, prevYmd } from '../spend-alerts/mx-day';

/** §15.2 — dominios de clase L (§0-Q), literales junto al call-site. */
export const SALES_PRESET_VALUES = ['today', 'yesterday', 'last7', 'last30', 'this_month', 'last_month', 'custom'] as const;
export const SALES_GROUP_BY_VALUES = ['day', 'week', 'month'] as const;
export const SALES_TOP_SORT_VALUES = ['net', 'pieces'] as const;
/** §REPORTES-CEO F2a (API_CONTRACT_REPORTES §2) — cómo se elige el periodo anterior. Vacío = `span` = comportamiento de siempre. */
export const PERIOD_KIND_VALUES = ['day', 'rolling', 'month', 'quarter', 'semester', 'year', 'span'] as const;
export type PeriodKind = (typeof PERIOD_KIND_VALUES)[number];
export type SalesPreset = (typeof SALES_PRESET_VALUES)[number];
export type SalesGroupBy = (typeof SALES_GROUP_BY_VALUES)[number];
export type SalesTopSort = (typeof SALES_TOP_SORT_VALUES)[number];

/** Tramo máximo (§15.2): 366 días. */
export const SALES_MAX_DAYS = 366;

export type Ymd = string;

export interface SalesBucket {
  from: Ymd;
  to: Ymd;
}

export interface SalesPeriod {
  preset: SalesPreset;
  from: Ymd;
  to: Ymd;
  days: number;
  prev: { from: Ymd; to: Ymd };
  /** F2a: `kind` EFECTIVO (cae a `span` si el periodo no calza con su unidad de calendario) y si el tramo anterior se recortó. */
  kind: PeriodKind;
  prevClamped: boolean;
  groupBy: SalesGroupBy;
  topSort: SalesTopSort;
  buckets: SalesBucket[];
}

export interface SalesQuery {
  preset?: unknown;
  from?: unknown;
  to?: unknown;
  groupBy?: unknown;
  topSort?: unknown;
  kind?: unknown;
}

const ymdParts = (ymd: Ymd) => ymd.split('-').map(Number) as [number, number, number];
const utcOf = (ymd: Ymd) => {
  const [y, m, d] = ymdParts(ymd);
  return Date.UTC(y, m - 1, d);
};
const ymdOfUtc = (t: number): Ymd => new Date(t).toISOString().slice(0, 10);

/** Días entre `a` y `b` (b − a), en días civiles. */
export function daysBetween(a: Ymd, b: Ymd): number {
  return Math.round((utcOf(b) - utcOf(a)) / 86400000);
}

/** `ymd` + `n` días (n puede ser negativo). */
export function addDays(ymd: Ymd, n: number): Ymd {
  return ymdOfUtc(utcOf(ymd) + n * 86400000);
}

/** Día de la semana ISO del día civil (1 = lunes … 7 = domingo). */
export function isoWeekday(ymd: Ymd): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const wd = new Date(utcOf(ymd)).getUTCDay(); // 0 = domingo
  return (wd === 0 ? 7 : wd) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** Hora (0–23) de México del instante. */
export function mxHour(instant: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hourCycle: 'h23', hour: '2-digit' }).format(instant);
  return Number(h) % 24;
}

/** Hoy en México. */
export function todayMx(now: Date): Ymd {
  return toMexicoCityDateKey(now);
}

/** El semiabierto `[00:00 MX de from, 00:00 MX del día siguiente a to)` (R-1). */
export function mxRange(from: Ymd, to: Ymd): { gte: Date; lt: Date } {
  return { gte: mxDayStart(from), lt: mxDayStart(nextYmd(to)) };
}

/** Inicio del cubo (recortado a `periodFrom`) al que pertenece el día `day`. */
export function bucketStartOf(day: Ymd, groupBy: SalesGroupBy, periodFrom: Ymd): Ymd {
  let start = day;
  if (groupBy === 'week') start = addDays(day, 1 - isoWeekday(day));
  else if (groupBy === 'month') start = `${day.slice(0, 7)}-01`;
  return start < periodFrom ? periodFrom : start;
}

/** Todos los cubos del periodo, en orden, recortados a `[from, to]` (también los de cero). */
export function bucketsOf(from: Ymd, to: Ymd, groupBy: SalesGroupBy): SalesBucket[] {
  const out: SalesBucket[] = [];
  let d = from;
  while (d <= to) {
    const start = bucketStartOf(d, groupBy, from);
    let end: Ymd;
    if (groupBy === 'day') end = d;
    else if (groupBy === 'week') end = addDays(start, 7 - isoWeekday(start));
    else {
      const [y, m] = ymdParts(d);
      end = ymdOfUtc(Date.UTC(y, m, 0)); // último día del mes de `d`
    }
    if (end > to) end = to;
    out.push({ from: start, to: end });
    d = nextYmd(end);
  }
  return out;
}

/** La llave de cubo de un instante (día MX ⇒ inicio de su cubo recortado). */
export function bucketKeyOf(instant: Date, groupBy: SalesGroupBy, periodFrom: Ymd): Ymd {
  return bucketStartOf(toMexicoCityDateKey(instant), groupBy, periodFrom);
}

const CALENDAR_MONTHS: Partial<Record<PeriodKind, number>> = { month: 1, quarter: 3, semester: 6, year: 12 };

/** Inicio (día 1) de la unidad de calendario de `kind` que contiene `day`. */
export function unitStart(kind: PeriodKind, day: Ymd): Ymd {
  const n = CALENDAR_MONTHS[kind]!;
  const [y, m] = ymdParts(day);
  const m0 = Math.floor((m - 1) / n) * n + 1;
  return `${String(y).padStart(4, '0')}-${String(m0).padStart(2, '0')}-01`;
}

/** Último día de la unidad que empieza en `start`. */
export function unitEnd(kind: PeriodKind, start: Ymd): Ymd {
  const n = CALENDAR_MONTHS[kind]!;
  const [y, m] = ymdParts(start);
  return ymdOfUtc(Date.UTC(y, m - 1 + n, 0));
}

/** Días del mes `m` (1..12) del año `y`. */
const monthLength = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * `ymd` desplazado `-months` meses de calendario (mismo día; si no existe en el mes destino ⇒ fin de ese mes, `clamped:true`).
 * Un día que ES el último de su mes va al último del mes destino SIN rótulo (el periodo cerrado nunca se rotula).
 */
function shiftBackMonths(ymd: Ymd, months: number): { ymd: Ymd; clamped: boolean } {
  const [y, m, d] = ymdParts(ymd);
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const tLen = monthLength(ty, tm);
  const fmt = (day: number) => `${String(ty).padStart(4, '0')}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (d === monthLength(y, m)) return { ymd: fmt(tLen), clamped: false };
  if (d > tLen) return { ymd: fmt(tLen), clamped: true };
  return { ymd: fmt(d), clamped: false };
}

/**
 * §REPORTES-CEO F2a — el periodo anterior = el MISMO TRAMO (puro). Regla única de calendario: «el mismo día, un mes/trimestre/
 * semestre/año antes» (`from`/`to` desplazados −1/−3/−6/−12 meses); `clamped` solo si la FECHA se recorta (30-mar vs 28-feb).
 * Un periodo cerrado (`to` = fin de la unidad) ⇒ la unidad anterior completa, sin rótulo. `kind` de calendario cuyo `from` no es el
 * inicio de la unidad, o cuyo `to` pasa el fin de la unidad ⇒ `span`. `day` solo admite UN día (−7 d); con más ⇒ `span`.
 */
export function previousRange(kind: PeriodKind | undefined, from: Ymd, to: Ymd): { kind: PeriodKind; from: Ymd; to: Ymd; clamped: boolean } {
  const days = daysBetween(from, to) + 1;
  const span = (k: PeriodKind) => ({ kind: k, from: addDays(from, -days), to: prevYmd(from), clamped: false });
  if (kind === undefined || kind === 'span') return span('span');
  if (kind === 'rolling') return span('rolling');
  if (kind === 'day') return from === to ? { kind, from: addDays(from, -7), to: addDays(to, -7), clamped: false } : span('span');
  if (unitStart(kind, from) !== from || to > unitEnd(kind, from)) return span('span');
  return shiftUnitBack(kind, from, to);
}

/** El mismo tramo una unidad de calendario antes (`from`/`to` −1/−3/−6/−12 meses). Lo comparten `previousRange` y los consolidados fiscales. */
export function shiftUnitBack(kind: 'month' | 'quarter' | 'semester' | 'year', from: Ymd, to: Ymd): { kind: PeriodKind; from: Ymd; to: Ymd; clamped: boolean } {
  const months = CALENDAR_MONTHS[kind]!;
  const f = shiftBackMonths(from, months);
  const t = shiftBackMonths(to, months);
  return { kind, from: f.ymd, to: t.ymd, clamped: f.clamped || t.clamped };
}

/**
 * §REPORTES-CEO F2b (m-7) — `period.toDate`: el servidor dice «a la fecha» = `kind` EFECTIVO de calendario ∧ `to` < último día de la
 * unidad que empieza en `from`. El último día de la unidad ya es periodo cerrado (⇒ `false`). `kind` ausente o no de calendario ⇒ `false`.
 */
export function isToDate(kind: PeriodKind | undefined, from: Ymd, to: Ymd): boolean {
  if (kind !== 'month' && kind !== 'quarter' && kind !== 'semester' && kind !== 'year') return false;
  return to < unitEnd(kind, from);
}

export type ComparisonBasis = 'complete' | 'partial' | 'none';

/** `basis` de la comparación según el primer día con datos (`null` = sin pedidos ⇒ `none`). Nunca un delta sin `basis`. */
export function comparisonBasis(firstDataDay: Ymd | null, prev: { from: Ymd; to: Ymd }): { basis: ComparisonBasis; dataSince: Ymd | null } {
  if (firstDataDay === null || prev.to < firstDataDay) return { basis: 'none', dataSince: null };
  if (firstDataDay <= prev.from) return { basis: 'complete', dataSince: null };
  return { basis: 'partial', dataSince: firstDataDay };
}

function badDate(field: 'from' | 'to', msg: string): never {
  throw BusinessException.badRequest('VALIDATION_ERROR', msg, { field });
}

/** Lee `from`/`to`: ausente o en blanco ⇒ ausente; mal formado o día imposible ⇒ `400 {field}` (⛔ sin `value`). */
function readYmd(raw: unknown, field: 'from' | 'to'): Ymd | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') badDate(field, `${field} must be YYYY-MM-DD`);
  if (raw.trim() === '') return undefined;
  if (!isYmd(raw)) badDate(field, `${field} must be YYYY-MM-DD`);
  return raw;
}

/**
 * §15.2 — resuelve los parámetros a un periodo, o `400 VALIDATION_ERROR` (⛔ sin `details.value`, §0-Q punto 2).
 * El orden de las validaciones es el de la tabla de errores del contrato.
 */
export function resolvePeriod(q: SalesQuery, now: Date): SalesPeriod {
  const presetIn = parseEnumFilter('preset', q.preset, SALES_PRESET_VALUES);
  const groupBy = parseEnumFilter('groupBy', q.groupBy, SALES_GROUP_BY_VALUES) ?? 'day';
  const topSort = parseEnumFilter('topSort', q.topSort, SALES_TOP_SORT_VALUES) ?? 'net';
  const fromIn = readYmd(q.from, 'from');
  const toIn = readYmd(q.to, 'to');
  const kindIn = parseEnumFilter('kind', q.kind, PERIOD_KIND_VALUES);
  const today = todayMx(now);

  let preset: SalesPreset;
  let from: Ymd;
  let to: Ymd;
  if (fromIn !== undefined || toIn !== undefined) {
    if (fromIn === undefined) badDate('from', 'from and to go together');
    if (toIn === undefined) badDate('to', 'from and to go together');
    if (presetIn !== undefined && presetIn !== 'custom') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'preset must be custom (or absent) with from/to', {
        field: 'preset',
        allowed: [...SALES_PRESET_VALUES],
      });
    }
    if (fromIn > toIn) badDate('from', 'from must be <= to');
    if (toIn > today) badDate('to', 'to must not be after today (America/Mexico_City)');
    if (daysBetween(fromIn, toIn) + 1 > SALES_MAX_DAYS) badDate('from', `period longer than ${SALES_MAX_DAYS} days`);
    preset = 'custom';
    from = fromIn;
    to = toIn;
  } else {
    preset = presetIn ?? 'last7';
    switch (preset) {
      case 'today':
        from = to = today;
        break;
      case 'yesterday':
        from = to = prevYmd(today);
        break;
      case 'last7':
        from = addDays(today, -6);
        to = today;
        break;
      case 'last30':
        from = addDays(today, -29);
        to = today;
        break;
      case 'this_month':
        from = `${today.slice(0, 7)}-01`;
        to = today;
        break;
      case 'last_month': {
        to = prevYmd(`${today.slice(0, 7)}-01`);
        from = `${to.slice(0, 7)}-01`;
        break;
      }
      default:
        // `custom` sin fechas: no hay periodo que resolver.
        badDate('from', 'custom needs from and to');
    }
  }
  const days = daysBetween(from, to) + 1;
  // Periodo anterior (criterio 606, P-AN-3): los MISMOS N días inmediatamente antes de `from`.
  // F2a: sin `kind` = `span` = exactamente lo de siempre.
  const pr = previousRange(kindIn, from, to);
  const prev = { from: pr.from, to: pr.to };
  return { preset, from, to, days, prev, kind: pr.kind, prevClamped: pr.clamped, groupBy, topSort, buckets: bucketsOf(from, to, groupBy) };
}
