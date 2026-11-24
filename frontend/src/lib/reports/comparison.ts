import type { AppLocale } from '@/i18n/routing';
import type { ComparisonBasis, MoneyDeltaDTO, PeriodKind } from '@/types/contract';
import { fmtDay } from '@/app/[locale]/(admin)/admin/m9/salesFormat';
import { todayMx } from './period';

/**
 * §REPORTES-CEO §2 (F2a) — QUÉ se le dice al dueño sobre la comparación. Todo viene del servidor (`previousPeriod`,
 * `comparison.basis`, `dataSince`, `clamped`); aquí solo se decide el rótulo. ⛔ Nunca se calcula el periodo anterior
 * ni una variación en el navegador, y nunca se muestra un porcentaje sin su base.
 */
export type CompareMode = ComparisonBasis;
export type ToDateUnit = 'month' | 'quarter' | 'semester' | 'year';

export interface CompareInfo {
  /** `none` ⇒ «—» y «sin periodo anterior para comparar». */
  mode: CompareMode;
  /** Periodo en curso (`period.toDate:true` del servidor) ⇒ «Mes/Trimestre/Semestre/Año a la fecha». */
  toDate: ToDateUnit | null;
  previous: { from: string; to: string } | null;
  /** La fecha de comparación se recortó al último día del mes anterior (30-mar vs 28-feb). */
  clamped: boolean;
  /** `partial` ⇒ «datos desde …». */
  dataSince: string | null;
}

const TO_DATE_UNITS: readonly PeriodKind[] = ['month', 'quarter', 'semester', 'year'];

/**
 * `previous`/`comparison` de la RESPUESTA (no del selector). Sin periodo anterior o `basis: none` ⇒ `none`.
 * Un servidor anterior (sin `basis`) con periodo anterior se trata como `complete`.
 * m-7 (contrato §2): «… a la fecha» SOLO con `period.toDate === true` Y un `kind` de calendario; `toDate` ausente ⇒ sin prefijo
 * (nunca se deduce del atajo: el último día del mes ya es periodo cerrado).
 */
export function compareInfo(
  previous: { from: string; to: string; clamped?: boolean } | null | undefined,
  comparison: { basis?: ComparisonBasis; dataSince?: string | null } | null | undefined,
  period?: { toDate?: boolean; kind?: PeriodKind | null } | null,
): CompareInfo {
  const kind = period?.kind;
  const toDate = period?.toDate === true && kind && TO_DATE_UNITS.includes(kind) ? (kind as ToDateUnit) : null;
  const noBase = !previous || comparison === null;
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

/**
 * Porcentaje ÚNICO de los reportes (§2 m-3): puntos base enteros del servidor ⇒ SIEMPRE un decimal fijo («12.0 %», «−3.5 %»;
 * es `12,0 %`). `null` ⇒ `null` («—»). `signed` pone «+»/«−» (0 sin signo). Sustituye a `fmtBps`, al `Math.round` de la meta y a Ventas.
 */
export function fmtPct(bps: number | null, locale: AppLocale, signed = true): string | null {
  if (bps === null || !Number.isFinite(bps)) return null;
  const n = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(bps) / 100);
  const zero = Math.abs(bps) < 5; // se ve «0.0 %»: sin signo
  return `${signed && !zero ? (bps > 0 ? '+' : MINUS) : ''}${n} %`;
}

/** Puntos base de `n/d` (avance contra meta: dos conteos), mitad hacia afuera de cero; `d ≤ 0` ⇒ 0. Con BigInt: sin pasar de 2^53. */
export function bpsOf(n: number, d: number): number {
  if (!(d > 0) || !Number.isFinite(n)) return 0;
  const num = BigInt(Math.abs(Math.trunc(n))) * 10_000n;
  const den = BigInt(Math.trunc(d));
  const q = (num * 2n + den) / (den * 2n);
  return n < 0 ? -Number(q) : Number(q);
}

/** Sentido de una variación del servidor (solo para flecha y texto de lectores de pantalla; sin colores de bueno/malo). */
export function moneyDirection(d: Pick<MoneyDeltaDTO, 'deltaCents'>): 'up' | 'down' | 'same' {
  return d.deltaCents > 0 ? 'up' : d.deltaCents < 0 ? 'down' : 'same';
}
