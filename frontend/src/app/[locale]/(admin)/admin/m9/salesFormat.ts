import type { AppLocale } from '@/i18n/routing';
import type { SalesGroupBy } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';

/**
 * Formato de la pestaña «Ventas» (`DESIGN_SYSTEM §AN-UX`). Solo FORMATEA lo que dice el DTO: ⛔ ninguna cifra se
 * calcula aquí (AN-1) y ⛔ ninguna fecha del periodo se resuelve en el navegador (AN-5). Los `YYYY-MM-DD` son días de
 * México: se pintan con `timeZone: 'America/Mexico_City'` a mediodía UTC (06:00 en México), así el día civil es el
 * mismo que dijo el servidor sea cual sea la zona del navegador.
 */

const TAG: Record<AppLocale, string> = { es: 'es-MX', en: 'en-US' };
const TZ = 'America/Mexico_City';
const MINUS = '−';

function at(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`);
}

function parts(ymd: string, locale: AppLocale, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(TAG[locale], { ...opts, timeZone: TZ }).formatToParts(at(ymd))) {
    if (p.type !== 'literal') out[p.type] = p.value.replace(/\.$/, '');
  }
  return out;
}

/** «lun 6 oct» / «Mon, Oct 6» (con `year`: «lun 6 oct 2026» / «Mon, Oct 6, 2026»). */
export function fmtDay(ymd: string, locale: AppLocale, o: { weekday?: boolean; year?: boolean } = {}): string {
  const p = parts(ymd, locale, {
    weekday: o.weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: o.year ? 'numeric' : undefined,
  });
  if (locale === 'en') {
    const md = `${p.month} ${p.day}`;
    const head = o.weekday ? `${p.weekday}, ${md}` : md;
    return o.year ? `${head}, ${p.year}` : head;
  }
  const dm = `${p.day} ${p.month}`;
  const head = o.weekday ? `${p.weekday} ${dm}` : dm;
  return o.year ? `${head} ${p.year}` : head;
}

/** «oct 2026» / «Oct 2026». */
export function fmtMonth(ymd: string, locale: AppLocale): string {
  const p = parts(ymd, locale, { month: 'short', year: 'numeric' });
  return `${p.month} ${p.year}`;
}

/** Nombre del día de la semana, largo («jueves» / «Thursday»). */
export function fmtWeekdayLong(ymd: string, locale: AppLocale): string {
  return parts(ymd, locale, { weekday: 'long' }).weekday;
}

/** Nombre del día de la semana ISO (1 = lunes) sin fecha: se usa una semana fija conocida (2026-01-05 fue lunes). */
export function fmtIsoWeekday(weekday: number, locale: AppLocale, style: 'short' | 'long' = 'short'): string {
  const ymd = `2026-01-${String(4 + weekday).padStart(2, '0')}`;
  return parts(ymd, locale, { weekday: style }).weekday;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Desde/hasta del rótulo: el `from` sin año si coincide con el del `to`. */
export function fmtRange(from: string, to: string, locale: AppLocale): { from: string; to: string } {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return { from: fmtDay(from, locale, { year: !sameYear }), to: fmtDay(to, locale, { year: true }) };
}

/** Etiqueta del eje X (corta). */
export function axisLabel(row: { from: string; to: string }, groupBy: SalesGroupBy, locale: AppLocale): string {
  if (groupBy === 'day') return fmtDay(row.from, locale);
  if (groupBy === 'week') return `${fmtDay(row.from, locale)}–${fmtDay(row.to, locale)}`;
  return fmtMonth(row.from, locale);
}

/** Días de un cubo, ambos incluidos — SOLO para decidir si la etiqueta dice «· 3 días» (formato, no cifra de venta). */
export function bucketDays(row: { from: string; to: string }): number {
  return Math.round((Date.parse(`${row.to}T00:00:00Z`) - Date.parse(`${row.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Signo tipográfico de una diferencia (U+2212 para el menos). */
export function signOf(n: number): string {
  return n > 0 ? '+' : n < 0 ? MINUS : '';
}

/** Dinero con signo «+MX$850.00» / «−MX$120.00». */
export function signedMoney(cents: number, locale: AppLocale): string {
  return `${signOf(cents)}${formatMoneyCents(Math.abs(cents), locale)}`;
}

/** Dinero de una cifra que puede ser negativa: «−MX$350.00» (U+2212, sin «+»). */
export function money(cents: number, locale: AppLocale): string {
  return cents < 0 ? `${MINUS}${formatMoneyCents(Math.abs(cents), locale)}` : formatMoneyCents(cents, locale);
}

/** Un decimal en el formato del idioma («2.0»). */
export function oneDecimal(n: number, locale: AppLocale): string {
  return new Intl.NumberFormat(TAG[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

/** Dinero abreviado para las marcas del eje («MX$1.2k»). */
export function shortMoney(cents: number, locale: AppLocale): string {
  const pesos = cents / 100;
  if (Math.abs(pesos) < 1000) return formatMoneyCents(Math.round(pesos) * 100, locale).replace(/\.00$/, '');
  const compact = new Intl.NumberFormat(TAG[locale], { notation: 'compact', maximumFractionDigits: 1 }).format(pesos);
  return `MX$${compact.replace(/\s/g, '').replace('mil', 'k')}`;
}
