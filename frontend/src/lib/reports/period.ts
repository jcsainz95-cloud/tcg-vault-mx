/**
 * §REPORTES-CEO §2 — UNA definición del periodo para Junta, Finanzas, Ventas, Compras, Inventario y Operación.
 * Días civiles de `America/Mexico_City` (`YYYY-MM-DD`, ambos incluidos). El servidor sigue siendo la regla (periodo anterior,
 * 422 de fechas inexistentes); aquí solo se arman las fechas del selector. ÚNICA implementación de «hoy en México».
 */
import type { PeriodKind } from '@/types/contract';

export const REPORT_PRESETS = ['today', '7d', '30d', 'month', 'last-month', 'quarter', 'year', 'all', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
export const DEFAULT_PRESET: ReportPreset = 'month';

export interface ReportPeriod {
  preset: ReportPreset;
  from: string;
  to: string;
}

/** Primer día del que la UI deja pedir datos «Todo» (el servidor valida 2020..año actual+1). */
export const ALL_FROM = '2020-01-01';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Hoy en México, `YYYY-MM-DD` (la ÚNICA implementación; ⛔ nunca la fecha del navegador). */
export function todayMx(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Días entre dos `YYYY-MM-DD`, ambos incluidos. */
export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Fecha REAL (no solo forma): `2026-02-30` no existe; año dentro de 2020..año actual+1. */
export function isRealYmd(v: string | undefined, today: string = todayMx()): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  const y = Number(v.slice(0, 4));
  return y >= 2020 && y <= Number(today.slice(0, 4)) + 1;
}

/** Fechas de un atajo (`custom` no se arma aquí: las elige el usuario). */
export function periodFor(preset: Exclude<ReportPreset, 'custom'>, today: string = todayMx()): ReportPeriod {
  const [y, m] = today.split('-').map(Number);
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today };
    case '7d':
      return { preset, from: addDays(today, -6), to: today };
    case '30d':
      return { preset, from: addDays(today, -29), to: today };
    case 'month':
      return { preset, from: ymd(y, m, 1), to: today };
    case 'quarter':
      return { preset, from: ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
    case 'year':
      return { preset, from: ymd(y, 1, 1), to: today };
    case 'all':
      return { preset, from: ALL_FROM, to: today };
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { preset, from: ymd(py, pm, 1), to: addDays(ymd(y, m, 1), -1) };
    }
  }
}

/** Tope de días de las pantallas cuyo endpoint lo aplica (Ventas y lo que lee de ella): `all` va desactivado ahí. */
export const SALES_MAX_DAYS = 366;

/**
 * Lee `?preset=&from=&to=`. Basura, fecha inexistente o rango al revés ⇒ el defecto (este mes). Con `maxDays`, un periodo
 * más largo (p. ej. «Todo» que venía del menú desde Finanzas) también cae al defecto en vez de pedir lo que el servidor topa.
 */
export function parsePeriod(
  sp: Record<string, string | string[] | undefined>,
  today: string = todayMx(),
  opts: { maxDays?: number } = {},
): ReportPeriod {
  const p = parseRaw(sp, today);
  return opts.maxDays !== undefined && spanDays(p.from, p.to) > opts.maxDays ? periodFor('month', today) : p;
}

function parseRaw(sp: Record<string, string | string[] | undefined>, today: string): ReportPeriod {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const preset = one(sp.preset);
  const from = one(sp.from);
  const to = one(sp.to);
  if (preset === 'custom' && isRealYmd(from, today) && isRealYmd(to, today) && from <= to && to <= today) return { preset: 'custom', from, to };
  if (preset && (REPORT_PRESETS as readonly string[]).includes(preset) && preset !== 'custom') {
    return periodFor(preset as Exclude<ReportPreset, 'custom'>, today);
  }
  return periodFor(DEFAULT_PRESET as 'month', today);
}

/** Query-string que lleva el periodo al navegar entre Reportes y Finanzas (atajo: se re-resuelve; custom: fechas). */
export function periodSearch(p: ReportPeriod): string {
  return p.preset === 'custom' ? `?preset=custom&from=${p.from}&to=${p.to}` : `?preset=${p.preset}`;
}

/**
 * §REPORTES-CEO §2 (F2a) — forma del periodo que el selector manda como `kind`, para que el servidor compare el MISMO tramo
 * del periodo anterior. Hoy→`day`, 7/30 días→`rolling`, este mes/mes pasado→`month`, trimestre→`quarter`, año→`year`,
 * fechas a elegir→`span`; «Todo» no se compara (`undefined`). El servidor decide el tramo; aquí solo se dice qué forma tiene.
 */
export function periodKind(p: Pick<ReportPeriod, 'preset'>): PeriodKind | undefined {
  switch (p.preset) {
    case 'today':
      return 'day';
    case '7d':
    case '30d':
      return 'rolling';
    case 'month':
    case 'last-month':
      return 'month';
    case 'quarter':
      return 'quarter';
    case 'year':
      return 'year';
    case 'custom':
      return 'span';
    case 'all':
      return undefined;
  }
}

/** Rango que se manda a las rutas de finanzas: «Todo» = sin `from/to` ni `kind` (todo el histórico, sin comparación). */
export function financeRange(p: ReportPeriod): { from?: string; to?: string; kind?: PeriodKind } {
  return p.preset === 'all' ? {} : { from: p.from, to: p.to, kind: periodKind(p) };
}
