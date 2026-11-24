import type { AppLocale } from '@/i18n/routing';
import type { ComparisonBasis, MoneyDeltaDTO, PeriodKind } from '@/types/contract';
import { fmtDay } from '@/app/[locale]/(admin)/admin/m9/salesFormat';
import { todayMx, type ReportPreset } from './period';

/**
 * §REPORTES-CEO §2 (F2a) — QUÉ se le dice al dueño sobre la comparación. Todo viene del servidor (`previousPeriod`,
 * `comparison.basis`, `dataSince`, `clamped`); aquí solo se decide el rótulo. ⛔ Nunca se calcula el periodo anterior
 * ni una variación en el navegador, y nunca se muestra un porcentaje sin su base.
 */
export type CompareMode = ComparisonBasis;
export type ToDateUnit = 'month' | 'quarter' | 'year';

export interface CompareInfo {
  /** `none` ⇒ «—» y «sin periodo anterior para comparar». */
  mode: CompareMode;
  /** Periodo en curso ⇒ «Mes a la fecha» / «Trimestre a la fecha» / «Año a la fecha». */
  toDate: ToDateUnit | null;
  previous: { from: string; to: string } | null;
  /** El periodo anterior es más corto que lo transcurrido y se usó completo. */
  clamped: boolean;
  /** `partial` ⇒ «datos desde …». */
  dataSince: string | null;
}

const TO_DATE: Partial<Record<ReportPreset, ToDateUnit>> = { month: 'month', quarter: 'quarter', year: 'year' };

/**
 * `previous`/`comparison` de la RESPUESTA (no del selector). Sin periodo anterior, o «Todo», o `basis: none` ⇒ `none`.
 * Un servidor anterior (sin `basis`) con periodo anterior se trata como `complete`.
 */
export function compareInfo(
  preset: ReportPreset,
  previous: { from: string; to: string; clamped?: boolean } | null | undefined,
  comparison: { basis?: ComparisonBasis; dataSince?: string | null } | null | undefined,
  /** `period.kind` EFECTIVO de la respuesta (m-3): si el servidor cayó a `span`, NO es «a la fecha». `undefined` ⇒ servidor anterior. */
  kind?: PeriodKind | null,
): CompareInfo {
  const wanted = TO_DATE[preset] ?? null;
  const toDate = wanted && (kind === undefined || kind === null || kind === wanted) ? wanted : null;
  const noBase = !previous || preset === 'all' || comparison === null;
  const basis: ComparisonBasis = noBase ? 'none' : (comparison?.basis ?? 'complete');
  if (basis === 'none') return { mode: 'none', toDate, previous: previous ? { from: previous.from, to: previous.to } : null, clamped: false, dataSince: null };
  return {
    mode: basis,
    toDate,
    previous: previous ? { from: previous.from, to: previous.to } : null,
    clamped: previous?.clamped === true,
    dataSince: basis === 'partial' ? (comparison?.dataSince ?? null) : null,
  };
}

/** «1–23 nov» / «Nov 1–23»; otro mes: «28 oct – 3 nov»; un día: «lun 23 nov». El año solo si no es el actual. */
export function fmtCompact(from: string, to: string, locale: AppLocale, today: string = todayMx()): string {
  const yearNow = today.slice(0, 4);
  const withYear = from.slice(0, 4) !== yearNow || to.slice(0, 4) !== yearNow;
  if (from === to) return fmtDay(from, locale, { weekday: true, year: withYear });
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (!sameMonth) return `${fmtDay(from, locale, { year: withYear && from.slice(0, 4) !== to.slice(0, 4) })} – ${fmtDay(to, locale, { year: withYear })}`;
  const d1 = String(Number(from.slice(8)));
  const d2 = String(Number(to.slice(8)));
  const tail = fmtDay(to, locale, { year: withYear }); // «23 nov» / «Nov 23» (+ año)
  if (locale === 'en') return `${fmtDay(from, locale)}–${d2}${withYear ? tail.slice(tail.lastIndexOf(',')) : ''}`;
  return `${d1}–${tail}`;
}

const MINUS = '−';

/** Variación de la columna «vs periodo anterior»: `deltaBps` (puntos base enteros del servidor) en %, `null` ⇒ `null` («—»). */
export function fmtBps(bps: number | null, locale: AppLocale, signed = true): string | null {
  if (bps === null) return null;
  const n = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(Math.abs(bps) / 100);
  return `${signed ? (bps > 0 ? '+' : bps < 0 ? MINUS : '') : ''}${n} %`;
}

/** Sentido de una variación del servidor (solo para flecha y texto de lectores de pantalla; sin colores de bueno/malo). */
export function moneyDirection(d: Pick<MoneyDeltaDTO, 'deltaCents'>): 'up' | 'down' | 'same' {
  return d.deltaCents > 0 ? 'up' : d.deltaCents < 0 ? 'down' : 'same';
}
