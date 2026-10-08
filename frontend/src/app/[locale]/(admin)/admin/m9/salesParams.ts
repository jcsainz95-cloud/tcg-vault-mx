import type { SalesGroupBy, SalesPreset, SalesReportParams, SalesTopSort } from '@/types/contract';

/**
 * Estado en la URL de Reportes (`DESIGN_SYSTEM §AN-UX.1`): `tab`, `preset`, `from`, `to`, `groupBy`, `topSort` (van al
 * servidor) y los locales `chart`, `cols`, `top`. Valores fuera de dominio ⇒ se ignoran y se usa el default (⛔ no se
 * manda basura al servidor para recibir un `400`). Módulo sin `'use client'`: lo usa también `page.tsx`.
 */
// ⭐ §WSH-UX.7: `compra` = «Lista de compra» (lista de deseos sin piezas a la venta, `super_admin`).
export const M9_TABS = ['ventas', 'actividad', 'compra'] as const;
export type M9Tab = (typeof M9_TABS)[number];

export const SALES_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'this_month', 'last_month'] as const;
export const SALES_GROUP_BYS: readonly SalesGroupBy[] = ['day', 'week', 'month'];
export const SALES_TOP_SORTS: readonly SalesTopSort[] = ['net', 'pieces'];
export type SalesChartMetric = 'orders' | 'charged';
export type SalesCols = 'sales' | 'money';
export type SalesTopTab = 'cards' | 'sets' | 'sealed';
export const SALES_MAX_DAYS = 366;

export interface SalesUrlState {
  preset: SalesPreset;
  from?: string;
  to?: string;
  groupBy: SalesGroupBy;
  topSort: SalesTopSort;
  chart: SalesChartMetric;
  cols: SalesCols;
  top: SalesTopTab;
}

export const SALES_DEFAULTS: SalesUrlState = {
  preset: 'last7',
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

/** Hoy en México, `YYYY-MM-DD` (ayuda de UI; la regla es del servidor, AN-5). */
export function todayMx(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
}

function isYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Días de calendario entre dos `YYYY-MM-DD`, ambos incluidos (solo para validar el tope de 366 en el navegador). */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export type SalesRangeError = { field: 'from' | 'to'; key: 'bothRequired' | 'fromAfterTo' | 'toFuture' | 'tooLong' };

/**
 * Validación del rango a mano ANTES de mandar (`§AN-UX.2`): los cuatro casos, con el campo bajo el que se pinta.
 * Mismo criterio que el servidor (§15.2); el servidor sigue siendo la regla.
 */
export function validateRange(from: string, to: string, today: string = todayMx()): SalesRangeError | null {
  if (!from) return { field: 'from', key: 'bothRequired' };
  if (!to) return { field: 'to', key: 'bothRequired' };
  if (from > to) return { field: 'from', key: 'fromAfterTo' };
  if (to > today) return { field: 'to', key: 'toFuture' };
  if (spanDays(from, to) > SALES_MAX_DAYS) return { field: 'from', key: 'tooLong' };
  return null;
}

export function parseM9Tab(v: Raw): M9Tab {
  return pick(v, M9_TABS, 'ventas');
}

export function parseSalesUrl(sp: Record<string, Raw>, today: string = todayMx()): SalesUrlState {
  const base: SalesUrlState = {
    preset: pick<SalesPreset>(sp.preset, SALES_PRESETS, SALES_DEFAULTS.preset),
    groupBy: pick(sp.groupBy, SALES_GROUP_BYS, SALES_DEFAULTS.groupBy),
    topSort: pick(sp.topSort, SALES_TOP_SORTS, SALES_DEFAULTS.topSort),
    chart: pick<SalesChartMetric>(sp.chart, ['orders', 'charged'], SALES_DEFAULTS.chart),
    cols: pick<SalesCols>(sp.cols, ['sales', 'money'], SALES_DEFAULTS.cols),
    top: pick<SalesTopTab>(sp.top, ['cards', 'sets', 'sealed'], SALES_DEFAULTS.top),
  };
  const from = one(sp.from);
  const to = one(sp.to);
  if (from && to && isYmd(from) && isYmd(to) && !validateRange(from, to, today)) {
    return { ...base, preset: 'custom', from, to };
  }
  return base;
}

/** Lo que viaja al servidor (§15.2). */
export function toReportParams(s: SalesUrlState): SalesReportParams {
  if (s.preset === 'custom' && s.from && s.to) return { preset: 'custom', from: s.from, to: s.to, groupBy: s.groupBy, topSort: s.topSort };
  return { preset: s.preset, groupBy: s.groupBy, topSort: s.topSort };
}

/** Escribe el estado en la URL (sin navegar): recargar o compartir deja la pantalla igual. */
export function writeSalesUrl(s: SalesUrlState): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const set = (k: string, v: string | undefined, def?: string) => {
    if (v === undefined || v === def) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  };
  url.searchParams.set('tab', 'ventas');
  set('preset', s.preset === 'custom' ? undefined : s.preset, SALES_DEFAULTS.preset);
  set('from', s.preset === 'custom' ? s.from : undefined);
  set('to', s.preset === 'custom' ? s.to : undefined);
  set('groupBy', s.groupBy, SALES_DEFAULTS.groupBy);
  set('topSort', s.topSort, SALES_DEFAULTS.topSort);
  set('chart', s.chart, SALES_DEFAULTS.chart);
  set('cols', s.cols, SALES_DEFAULTS.cols);
  set('top', s.top, SALES_DEFAULTS.top);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
