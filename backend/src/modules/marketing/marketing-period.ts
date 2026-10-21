/**
 * marketing-period.ts — 🔒 GRANULARIDAD FUERA DE PANTALLA del Panel (Brief 2 §5.2, PM-A1;
 * ARCHITECTURE §13.5; API_CONTRACT §MKT.E). PURO.
 *
 * El endpoint, el botón semanal y los exports aceptan SOLO una **semana cerrada** (lunes 00:00 →
 * domingo 23:59 `America/Mexico_City`) o un **mes cerrado**. ⛔ NUNCA rango libre ni detalle por día:
 * dos rangos solapados permitirían restar y despejar una celda oculta. Una semana/mes aún ABIERTOS,
 * un rango libre, o parámetros ausentes/duplicados ⇒ **400** genérico (sin detalle interno).
 *
 * Reutiliza la zona de México y los helpers de `sales-period.ts` (lunes = isoWeekday 1).
 */
import { BusinessException } from '../../common/business.exception';
import { assertEnumFilter } from '../../common/enum-filter';
import { addDays, isoWeekday, todayMx, type Ymd } from '../sales-analytics/sales-period';

export type MarketingPeriodKind = 'week' | 'month';

export interface MarketingPeriod {
  kind: MarketingPeriodKind;
  /** Primer día civil CDMX del periodo (lunes de la semana, o día 1 del mes). */
  from: Ymd;
  /** Último día civil CDMX del periodo (domingo de la semana, o último día del mes). */
  to: Ymd;
  /** Periodo anterior de igual naturaleza (semana previa / mes previo), para comparaciones. */
  prev: { from: Ymd; to: Ymd };
  /** Etiqueta legible, p. ej. `2026-W41` o `2026-10`. */
  label: string;
}

/** Entrada cruda del endpoint/botón (query). */
export interface MarketingPeriodQuery {
  week?: unknown; // `YYYY-Www`
  weekStart?: unknown; // `YYYY-MM-DD` (debe ser lunes)
  month?: unknown; // `YYYY-MM`
  // Cualquier `from`/`to`/`day`/`preset` se trata como rango libre PROHIBIDO.
  from?: unknown;
  to?: unknown;
  day?: unknown;
  preset?: unknown;
}

/** 400 genérico (sin `value`, sin detalle interno). */
function bad(message: string): never {
  throw BusinessException.badRequest('VALIDATION_ERROR', message);
}

const isYmd = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && roundTrips(s);
function roundTrips(s: string): boolean {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const asStr = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') bad('invalid period parameter');
  const t = v.trim();
  return t === '' ? undefined : t;
};

/** Lunes de la semana ISO `YYYY-Www`. Semana 1 = la que contiene el 4 de enero. */
function mondayOfIsoWeek(year: number, week: number): Ymd {
  if (week < 1 || week > 53) bad('invalid week');
  const jan4: Ymd = `${String(year).padStart(4, '0')}-01-04`;
  const mondayOfWeek1 = addDays(jan4, 1 - isoWeekday(jan4));
  const monday = addDays(mondayOfWeek1, (week - 1) * 7);
  // La semana 53 no existe en todos los años: una semana ISO pertenece al año de su JUEVES. Si el jueves cae en el
  // año siguiente, «YYYY-W53» sería en realidad la W01 del año siguiente ⇒ 400 (candado `marketing-period.spec.ts`).
  if (addDays(monday, 3).slice(0, 4) !== String(year).padStart(4, '0')) bad('invalid week');
  return monday;
}

const lastDayOfMonth = (year: number, month1to12: number): Ymd => {
  const d = new Date(Date.UTC(year, month1to12, 0)); // día 0 del mes siguiente = último del actual
  return d.toISOString().slice(0, 10);
};

/** Domingo de la semana (lunes-domingo) que contiene `day`. */
const sundayOfWeek = (day: Ymd): Ymd => addDays(day, 7 - isoWeekday(day));

/**
 * ¿Mes cerrado? (API_CONTRACT v1.103 §MKT.G.3, D-MKT-PANEL-4): el domingo de la semana de su ÚLTIMO día ya pasó
 * en CDMX. Ej.: oct-2026 acaba en sábado 31 ⇒ su última semana acaba el domingo 1-nov ⇒ cerrado desde el lunes 2-nov.
 * UNA sola regla para periods, panel, aggregates, export, export/todo y weekly-excel.
 */
function isMonthClosed(year: number, month1to12: number, today: Ymd): boolean {
  return sundayOfWeek(lastDayOfMonth(year, month1to12)) < today;
}

/** Rango de días civiles CDMX (inclusive). */
export interface DayRange {
  from: Ymd;
  to: Ymd;
}

/**
 * Semanas (lunes-domingo) que tocan un mes, de la que contiene el día 1 a la que contiene el último (4 a 6).
 * Con el mes cerrado (`isMonthClosed`), todas están cerradas. Para la supresión coherente (§MKT.G.10).
 */
export function weeksTouchingMonth(month: DayRange): DayRange[] {
  const out: DayRange[] = [];
  const lastMonday = addDays(month.to, 1 - isoWeekday(month.to));
  for (let mon = addDays(month.from, 1 - isoWeekday(month.from)); mon <= lastMonday; mon = addDays(mon, 7)) {
    out.push({ from: mon, to: addDays(mon, 6) });
  }
  return out;
}

/**
 * Resuelve la query a un periodo CERRADO, o lanza 400. `now` es el reloj del servidor (zona fijada en
 * `todayMx`). Exactamente UNA forma de periodo; cualquier `from/to/day/preset` ⇒ 400 (rango libre).
 */
export function resolveMarketingPeriod(q: MarketingPeriodQuery, now: Date): MarketingPeriod {
  if (asStr(q.from) !== undefined || asStr(q.to) !== undefined || asStr(q.day) !== undefined || asStr(q.preset) !== undefined) {
    bad('only a closed week or a closed month is allowed (no free range or day)');
  }
  const week = asStr(q.week);
  const weekStart = asStr(q.weekStart);
  const month = asStr(q.month);
  const present = [week, weekStart, month].filter((x) => x !== undefined).length;
  if (present === 0) bad('period required: week, weekStart or month');
  if (present > 1) bad('provide exactly one of week, weekStart or month');

  const today = todayMx(now);

  if (month !== undefined) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) bad('month must be YYYY-MM');
    const year = Number(m[1]);
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12) bad('month must be YYYY-MM');
    const from: Ymd = `${m[1]}-${m[2]}-01`;
    const to = lastDayOfMonth(year, mon);
    // Cerrado (v1.103, §MKT.G.3/.10): cuando está cerrada la semana que contiene su último día (su domingo ya
    // pasó en CDMX). Si no, el mes saldría antes de conocer la semana que lo cruza (supresión coherente).
    if (!isMonthClosed(year, mon, today)) bad('month is not closed yet');
    const prevTo = addDays(from, -1); // último día del mes anterior
    const prevFrom: Ymd = `${prevTo.slice(0, 7)}-01`;
    return { kind: 'month', from, to, prev: { from: prevFrom, to: prevTo }, label: month };
  }

  // Semana — por `week=YYYY-Www` o por `weekStart=YYYY-MM-DD` (lunes).
  let from: Ymd;
  let label: string;
  if (week !== undefined) {
    const m = /^(\d{4})-W(\d{2})$/.exec(week);
    if (!m) bad('week must be YYYY-Www');
    from = mondayOfIsoWeek(Number(m[1]), Number(m[2]));
    label = week;
  } else {
    if (!isYmd(weekStart!)) bad('weekStart must be YYYY-MM-DD');
    if (isoWeekday(weekStart!) !== 1) bad('weekStart must be a Monday (America/Mexico_City)');
    from = weekStart!;
    label = from;
  }
  const to = addDays(from, 6); // domingo
  // Cerrada: el domingo ya pasó (hoy CDMX es posterior al domingo de esa semana).
  if (to >= today) bad('week is not closed yet');
  return { kind: 'week', from, to, prev: { from: addDays(from, -7), to: addDays(to, -7) }, label };
}

/**
 * Lunes de la ÚLTIMA semana cerrada (lunes-domingo CDMX totalmente en el pasado). Para el valor por
 * defecto del botón «Descargar Excel de la semana» (Brief 2 §4).
 */
export function lastClosedWeekStart(now: Date): Ymd {
  const today = todayMx(now);
  const thisMonday = addDays(today, 1 - isoWeekday(today));
  return addDays(thisMonday, -7); // lunes de la semana anterior (su domingo ya pasó)
}

/** Lista blanca de pantallas (Brief 2 §7.2, API_CONTRACT §MKT.E). `codigos` es Fase 3 (aún no). */
export const MARKETING_SCREENS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export type MarketingScreen = (typeof MARKETING_SCREENS)[number];

/** Dominio de `?format=` de `GET /admin/marketing/export` (API_CONTRACT §MKT.E, clase L, SELECTOR; v1.104). */
export const MARKETING_EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type MarketingExportFormat = (typeof MARKETING_EXPORT_FORMATS)[number];

/**
 * ⭐ Eje SELECTOR de §0-Q punto 6-bis (v1.104): elige QUÉ recurso se produce y no tiene «sin filtrar» ni default.
 * Ausente, vacío o solo espacios ⇒ `400 VALIDATION_ERROR {field, allowed}`; token del dominio ⇒ ese recurso;
 * cualquier otra cosa (incluido `' a'`: el `trim()` solo decide si está vacío) ⇒ el mismo `400`, por el helper único
 * `assertEnumFilter` (eco acotado, ⛔ sin `details.value`). ⛔ Nunca clamp a otro recurso.
 */
function parseSelector<T extends string>(field: string, raw: unknown, allowed: readonly T[]): T {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw BusinessException.badRequest('VALIDATION_ERROR', `${field} is required`, { field, allowed: [...allowed] });
  }
  return assertEnumFilter(field, raw, allowed);
}

/** `?pantalla=` (SELECTOR, §MKT.E): `a|…|h`, obligatorio ⇒ si no, `400 {field:'pantalla', allowed}`. */
export function parseScreen(raw: unknown): MarketingScreen {
  return parseSelector('pantalla', raw, MARKETING_SCREENS);
}

/** `?format=` (SELECTOR, §MKT.E): `xlsx|csv`, obligatorio ⇒ si no, `400 {field:'format', allowed}`. */
export function parseExportFormat(raw: unknown): MarketingExportFormat {
  return parseSelector('format', raw, MARKETING_EXPORT_FORMATS);
}

/** Una semana cerrada ofrecida al selector (API_CONTRACT §MKT.G.3). */
export interface MarketingWeekOption {
  weekStart: Ymd;
  from: Ymd;
  to: Ymd;
}

/** `GET /admin/marketing/periods` (API_CONTRACT §MKT.G.3). */
export interface MarketingPeriodsResponse {
  timezone: 'America/Mexico_City';
  lastClosedWeek: MarketingWeekOption;
  closedWeeks: MarketingWeekOption[];
  closedMonths: { month: string; from: Ymd; to: Ymd }[];
}

/** Nº de semanas y meses cerrados que ofrece el selector (§MKT.G.3). */
export const PERIOD_OPTIONS_WEEKS = 26;
export const PERIOD_OPTIONS_MONTHS = 12;

/**
 * Opciones del selector de periodo con el reloj del servidor en zona de México (§MKT.G.3). ⛔ Nunca ofrece una
 * semana o un mes abiertos: cada opción, enviada como `weekStart=` o `month=`, la acepta `resolveMarketingPeriod`
 * con el mismo `now` (candado `test/marketing-panel.spec.ts`). PURO.
 */
export function marketingPeriodOptions(now: Date): MarketingPeriodsResponse {
  const lastMonday = lastClosedWeekStart(now);
  const closedWeeks: MarketingWeekOption[] = [];
  for (let i = 0; i < PERIOD_OPTIONS_WEEKS; i++) {
    const from = addDays(lastMonday, -7 * i);
    closedWeeks.push({ weekStart: from, from, to: addDays(from, 6) });
  }
  // Del mes en curso hacia atrás, solo los que `isMonthClosed` acepta (el anterior puede no estarlo aún: §MKT.G.3).
  const today = todayMx(now);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const closedMonths: MarketingPeriodsResponse['closedMonths'] = [];
  while (closedMonths.length < PERIOD_OPTIONS_MONTHS) {
    if (isMonthClosed(year, month, today)) {
      const label = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
      closedMonths.push({ month: label, from: `${label}-01`, to: lastDayOfMonth(year, month) });
    }
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return { timezone: 'America/Mexico_City', lastClosedWeek: closedWeeks[0], closedWeeks, closedMonths };
}

/**
 * Periodo de la pantalla del panel (§MKT.G.2) y del botón `weekly-excel`: como `aggregates`, pero SIN periodo ⇒ la
 * última semana cerrada.
 * Los parámetros prohibidos (`from`/`to`/`day`/`preset`) se pasan SIEMPRE a la validación ⇒ 400 aunque falte la
 * semana (⛔ no se ignoran en silencio).
 */
export function resolvePanelPeriod(q: MarketingPeriodQuery, now: Date): MarketingPeriod {
  const has = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  const hasPeriod = has(q.week) || has(q.weekStart) || has(q.month);
  return resolveMarketingPeriod(hasPeriod ? q : { ...q, weekStart: lastClosedWeekStart(now) }, now);
}
