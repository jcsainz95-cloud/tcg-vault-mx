import type { SalesGroupBy, SalesReportParams, SalesTopSort } from '@/types/contract';
import { SALES_MAX_DAYS, parsePeriod, todayMx, type ReportPreset } from '@/lib/reports/period';
import { salesParamsFor } from '@/lib/reports/sales-params';

/**
 * Estado en la URL de Reportes › Ventas (`DESIGN_SYSTEM §AN-UX.1`): el periodo único (`preset`, `from`, `to`; §REPORTES-CEO
 * §2) más `groupBy`, `topSort` (van al servidor) y los locales `chart`, `cols`, `top`. Valores fuera de dominio ⇒ se
 * ignoran y se usa el default (⛔ no se manda basura al servidor para recibir un `400`). Módulo sin `'use client'`.
 */
export const SALES_GROUP_BYS: readonly SalesGroupBy[] = ['day', 'week', 'month'];
export const SALES_TOP_SORTS: readonly SalesTopSort[] = ['net', 'pieces'];
export type SalesChartMetric = 'orders' | 'charged';
export type SalesCols = 'sales' | 'money';
export type SalesTopTab = 'cards' | 'sets' | 'sealed';

// «Hoy en México»: UNA sola implementación (`lib/reports/period.ts`).
export { todayMx };

export interface SalesUrlState {
  preset: ReportPreset;
  from: string;
  to: string;
  groupBy: SalesGroupBy;
  topSort: SalesTopSort;
  chart: SalesChartMetric;
  cols: SalesCols;
  top: SalesTopTab;
}

export const SALES_DEFAULTS: SalesUrlState = {
  ...parsePeriod({}),
  groupBy: 'day',
  topSort: 'net',
  chart: 'orders',
  cols: 'sales',
  top: 'cards',
};

type Raw = string | string[] | undefined;
const one = (v: Raw): string | undefined => (Array.isArray(v) ? v[0] : v);
function pick<T extends string>(v: Raw, allowed: readonly T[], fallback: T): T {
  const s = one(v);
  return s !== undefined && (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

export function parseSalesUrl(sp: Record<string, Raw>, today: string = todayMx()): SalesUrlState {
  return {
    ...parsePeriod(sp, today, { maxDays: SALES_MAX_DAYS }),
    groupBy: pick(sp.groupBy, SALES_GROUP_BYS, SALES_DEFAULTS.groupBy),
    topSort: pick(sp.topSort, SALES_TOP_SORTS, SALES_DEFAULTS.topSort),
    chart: pick<SalesChartMetric>(sp.chart, ['orders', 'charged'], SALES_DEFAULTS.chart),
    cols: pick<SalesCols>(sp.cols, ['sales', 'money'], SALES_DEFAULTS.cols),
    top: pick<SalesTopTab>(sp.top, ['cards', 'sets', 'sealed'], SALES_DEFAULTS.top),
  };
}

/** Lo que viaja al servidor (§15.2): los atajos que el servidor ya resuelve en hora de México, el resto con fechas. */
export function toReportParams(s: SalesUrlState): SalesReportParams {
  return salesParamsFor(s, s.groupBy, { topSort: s.topSort });
}

/** Escribe el estado en la URL (sin navegar): recargar o compartir deja la pantalla igual. */
export function writeSalesUrl(s: SalesUrlState): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const set = (k: string, v: string | undefined, def?: string) => {
    if (v === undefined || v === def) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  };
  url.searchParams.set('preset', s.preset);
  set('from', s.preset === 'custom' ? s.from : undefined);
  set('to', s.preset === 'custom' ? s.to : undefined);
  set('groupBy', s.groupBy, SALES_DEFAULTS.groupBy);
  set('topSort', s.topSort, SALES_DEFAULTS.topSort);
  set('chart', s.chart, SALES_DEFAULTS.chart);
  set('cols', s.cols, SALES_DEFAULTS.cols);
  set('top', s.top, SALES_DEFAULTS.top);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
