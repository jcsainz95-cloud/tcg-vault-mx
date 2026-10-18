/**
 * Formato del Panel de Marketing (`DESIGN_SYSTEM §MKT-UX.5`). Sin `'use client'`: funciones puras.
 *
 * ⛔ El dinero del panel llega en PESOS con IVA (`API_CONTRACT §MKT.G.5`), no en centavos: ⛔ `formatMoneyCents`
 * dividiría otra vez entre 100 (candado UX-MKT-6). Mismo `MX$` que el resto del sistema (§9.3, P-98).
 */
import type { AppLocale } from '@/i18n/routing';

const TAG: Record<AppLocale, string> = { es: 'es-MX', en: 'en-US' };

export function formatPesos(pesos: number, locale: AppLocale): string {
  const s = new Intl.NumberFormat(TAG[locale], {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pesos);
  return s.includes('MX$') ? s : s.replace('$', 'MX$');
}

export function formatNumber(n: number, locale: AppLocale, maxFraction = 2): string {
  return new Intl.NumberFormat(TAG[locale], { maximumFractionDigits: maxFraction }).format(n);
}

/**
 * `pct` «tal cual» (MKT-3: no se recalcula). ⚠ La unidad no la fija el contrato (§MKT.G.5); se lee como PUNTOS
 * porcentuales (`12.5` ⇒ «12.5 %»), igual que el resto de porcentajes del contrato. Hueco enrutado al arquitecto.
 */
export function formatPct(points: number, locale: AppLocale): string {
  return new Intl.NumberFormat(TAG[locale], { style: 'percent', maximumFractionDigits: 1 }).format(points / 100);
}

/** `YYYY-MM-DD` ⇒ `Date` al mediodía UTC (el día del calendario de México no se mueve con la zona del navegador). */
function day(ymd: string): Date {
  return new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
}
function fmt(ymd: string, locale: AppLocale, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(TAG[locale], { ...opts, timeZone: 'UTC' }).format(day(ymd));
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Opción de semana: «Lun 5 – dom 11 oct 2026» / «Mon 5 – Sun 11 Oct 2026». */
export function weekOptionLabel(from: string, to: string, locale: AppLocale): string {
  const wd = (d: string) => fmt(d, locale, { weekday: 'short' }).replace('.', '');
  const dn = (d: string) => fmt(d, locale, { day: 'numeric' });
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const fromMonth = sameMonth ? '' : ` ${fmt(from, locale, { month: 'short' }).replace('.', '')}`;
  const tail = `${fmt(to, locale, { month: 'short' }).replace('.', '')} ${to.slice(0, 4)}`;
  return `${cap(wd(from))} ${dn(from)}${fromMonth} – ${wd(to)} ${dn(to)} ${tail}`;
}

/** Opción de mes: «Octubre 2026» / «October 2026». */
export function monthOptionLabel(month: string, locale: AppLocale): string {
  return cap(fmt(`${month}-01`, locale, { month: 'long', year: 'numeric' }));
}

/** Fecha corta del rótulo: «5 oct 2026». */
export function shortDate(ymd: string, locale: AppLocale): string {
  return fmt(ymd, locale, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
}

/** Fecha de anotación: «Mar 7 oct» / «Tue, Oct 7». */
export function annotationDate(ymd: string, locale: AppLocale): string {
  return cap(fmt(ymd, locale, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''));
}

/** Instante ISO ⇒ «5 oct 2026». */
export function instantDate(iso: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(TAG[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Mexico_City',
  })
    .format(new Date(iso))
    .replace('.', '');
}

/** Semana ISO (`2026-W42`) de un lunes `YYYY-MM-DD` — solo aritmética de calendario, sin reloj. */
export function isoWeekOf(monday: string): string {
  const d = day(monday);
  const thursday = new Date(d.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const ordinal = Math.floor((thursday.getTime() - jan1) / 86_400_000) + 1;
  return `${year}-W${String(Math.ceil(ordinal / 7)).padStart(2, '0')}`;
}
