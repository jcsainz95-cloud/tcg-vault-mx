'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPnlCalendar } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { fmtCompact, fmtPct } from '@/lib/reports/comparison';
import { QueryState } from '@/components/ui/QueryState';
import { CALENDAR_UNITS, PNL_LINES, type CalendarBucketDTO, type CalendarUnit, type PnlCalendarDTO, type PnlColumnDTO, type PnlLineKey } from '@/types/reports-pnl';
import { fmtDay, fmtMonth, money } from '../m9/salesFormat';
import { CellDelta } from './CellDelta';
import { ROWS, deltaOf, type RowDef } from './pnlLinesFormat';

/** Renglones del total en cada columna (los demás se ven en «Resultado por línea de negocio») y los de cada línea al abrirla. */
const TOTAL_ROWS = ['netSales', 'cogs', 'grossProfit', 'margin', 'paymentFee', 'shippingResult', 'contribution'] as const;
const LINE_ROWS = ['netSales', 'grossProfit', 'contribution'] as const;
const COUNT: Record<CalendarUnit, number> = { month: 6, quarter: 4, semester: 3, year: 3 };

/** Etiqueta de la columna: «oct 2026», «T3 2026», «S1 2026», «2026»; con inicio fiscal ≠ enero, el rango de meses (sin inventar «T»). */
export function bucketLabel(b: Pick<CalendarBucketDTO, 'from' | 'to' | 'kind'>, fiscalStart: number, locale: AppLocale, t: (k: string, v?: Record<string, string | number>) => string): string {
  const [y, m] = b.from.split('-').map(Number);
  if (b.kind === 'month') return fmtMonth(b.from, locale);
  if (fiscalStart !== 1) return `${fmtMonth(b.from, locale)} – ${fmtMonth(b.to, locale)}`;
  if (b.kind === 'quarter') return t('quarterLabel', { n: Math.floor((m - 1) / 3) + 1, year: y });
  if (b.kind === 'semester') return t('semesterLabel', { n: Math.floor((m - 1) / 6) + 1, year: y });
  return t('yearLabel', { year: y });
}

/**
 * §REPORTES-CEO F2b (§3b) — Finanzas › «Consolidados»: mes → trimestre → semestre → año. Columnas = últimos periodos COMPLETOS
 * y, al final, el que va en curso («… a la fecha», con los días transcurridos); cada una con su variación contra el MISMO
 * tramo del periodo anterior. Todo viene de `GET /admin/reports/finance/pnl/series?groupBy=…`: ⛔ el navegador no suma meses
 * ni calcula nada. Tabla ancha: primera columna fija y desplazamiento horizontal (en celular arranca mostrando el periodo en
 * curso, el último). No depende del periodo del selector de arriba.
 */
export function Consolidated() {
  const t = useTranslations('admin.m7.consolidated');
  const tl = useTranslations('admin.m7.lines');
  const tc = useTranslations('admin.reports.compare');
  const locale = useLocale() as AppLocale;
  const [unit, setUnit] = useState<CalendarUnit>('month');
  const [open, setOpen] = useState<Record<PnlLineKey, boolean>>({ sealed: false, raw: false, graded: false, accessory: false, unassigned: false });
  const q = useQuery({ queryKey: ['finance-pnl-calendar', unit], queryFn: () => getPnlCalendar({ unit, count: COUNT[unit] }) });
  const d: PnlCalendarDTO | undefined = q.data;
  const scroller = useRef<HTMLDivElement>(null);
  // En pantallas angostas, ver primero lo más reciente: el periodo en curso es la última columna.
  useEffect(() => {
    const el = scroller.current;
    if (el && d) el.scrollLeft = el.scrollWidth;
  }, [d]);

  const rowDef = (id: string) => ROWS.find((r) => r.id === id) as RowDef;
  const val = (r: RowDef, c: PnlColumnDTO, locale2: AppLocale) =>
    r.kind === 'pct' ? (c.marginBps === null ? '—' : (fmtPct(c.marginBps, locale2, false) as string)) : money(r.get(c) ?? 0, locale2);

  return (
    <section aria-labelledby="pnl-cons-h" className="flex flex-col gap-4" data-testid="pnl-consolidated">
      <div className="flex flex-col gap-1">
        <h2 id="pnl-cons-h" className="text-h2 font-semibold">
          {t('title')}
        </h2>
        <p className="max-w-2xl text-sm text-muted">{t('intro')}</p>
      </div>
      <div role="group" aria-label={t('unitLabel')} className="flex flex-wrap" data-testid="cons-units">
        {CALENDAR_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            aria-pressed={unit === u}
            onClick={() => setUnit(u)}
            className={cn(
              'min-h-[44px] -ml-px border border-border px-4 text-sm first:ml-0 focus-visible:shadow-focus focus-visible:outline-none',
              unit === u ? 'bg-text text-surface' : 'bg-surface text-text hover:bg-surface-2',
            )}
          >
            {t(`unit.${u}`)}
          </button>
        ))}
      </div>
      <QueryState isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={() => q.refetch()}>
        {d && (
          <div className="flex flex-col gap-2">
            <div ref={scroller} className="relative overflow-x-auto border border-border bg-surface" tabIndex={0} role="region" aria-label={t('tableLabel')} data-testid="cons-scroller">
              <table className="min-w-full border-collapse text-sm" data-testid="cons-table" data-unit={d.unit}>
                <caption className="sr-only">{t('tableLabel')}</caption>
                <thead>
                  <tr className="border-b border-border-strong align-bottom">
                    <th scope="col" className="sticky left-0 z-10 min-w-[9rem] bg-surface px-3 py-2 text-left font-normal">
                      <span className="sr-only">{tl('rowHeader')}</span>
                    </th>
                    {d.buckets.map((b) => {
                      const cmp = b.comparison;
                      return (
                        <th key={b.from} scope="col" data-testid={`cons-head-${b.from}`} data-todate={b.toDate ? 'true' : 'false'} className={cn('min-w-[8.5rem] px-3 py-2 text-right align-bottom font-normal', b.toDate && 'border-l border-border-strong bg-surface-2/60')}>
                          <span className="eyebrow block whitespace-nowrap text-text">{bucketLabel(b, d.fiscalYearStartMonth, locale, t)}</span>
                          {b.toDate && (
                            <span className="block text-xs font-medium text-text" data-testid="cons-todate">
                              {tc(`toDate.${b.kind}`)} · {t('daysSoFar', { days: b.days })}
                            </span>
                          )}
                          <span className="block text-xs text-muted">
                            {cmp.basis === 'none'
                              ? t('noBaseHead')
                              : t('vs', { prev: fmtCompact(cmp.previous.from, cmp.previous.to, locale) })}
                            {cmp.basis === 'partial' && cmp.dataSince ? ` · ${t('partialSince', { since: fmtDay(cmp.dataSince, locale, { year: true }) })}` : ''}
                          </span>
                          {cmp.previous.clamped && <span className="block text-xs text-muted">{t('clampedHead', { day: Number(b.to.slice(8, 10)), last: fmtDay(cmp.previous.to, locale) })}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {TOTAL_ROWS.map((id) => {
                    const r = rowDef(id);
                    return (
                      <tr key={id} data-testid={`cons-row-${id}`} className={cn('border-b border-border', r.strong && 'bg-surface-2/60')}>
                        <th scope="row" className={cn('sticky left-0 z-10 bg-surface px-3 py-2 text-left align-top font-normal', r.strong && 'bg-surface-2 font-semibold')}>
                          {tl(`rows.${id}`)}
                        </th>
                        {d.buckets.map((b) => (
                          <td key={b.from} data-testid={`cons-${id}-${b.from}`} className={cn('tabular whitespace-nowrap px-3 py-2 text-right align-top', r.strong && 'font-semibold', b.toDate && 'border-l border-border-strong')}>
                            <span>{val(r, b.total, locale)}</span>
                            {r.kind === 'money' && <CellDelta d={deltaOf(b.comparison.total, r.fig)} basis={b.comparison.basis} />}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {PNL_LINES.map((l) => (
                    <Fragment key={l}>
                      <tr className="border-b border-border bg-surface">
                        <th scope="row" colSpan={1} className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal">
                          <button
                            type="button"
                            aria-expanded={open[l]}
                            data-testid={`cons-toggle-${l}`}
                            onClick={() => setOpen((o) => ({ ...o, [l]: !o[l] }))}
                            className="min-h-[44px] text-left text-accent underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            <span aria-hidden>{open[l] ? '▾' : '▸'} </span>
                            {t('openLine', { line: tl(`line.${l}`) })}
                          </button>
                        </th>
                        {d.buckets.map((b) => (
                          <td key={b.from} className={cn(b.toDate && 'border-l border-border-strong')} />
                        ))}
                      </tr>
                      {open[l] &&
                        LINE_ROWS.map((id) => {
                          const r = rowDef(id);
                          return (
                            <tr key={`${l}-${id}`} data-testid={`cons-${l}-${id}`} className="border-b border-border">
                              <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 pl-6 text-left align-top font-normal text-muted">
                                {tl(`rows.${id}`)}
                              </th>
                              {d.buckets.map((b) => (
                                <td key={b.from} data-testid={`cons-${l}-${id}-${b.from}`} className={cn('tabular whitespace-nowrap px-3 py-1.5 text-right align-top', b.toDate && 'border-l border-border-strong')}>
                                  <span>{val(r, b.own[l], locale)}</span>
                                  <CellDelta d={deltaOf(b.comparison.byLine[l], r.fig)} basis={b.comparison.basis} />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">{t('rule')}</p>
            <p className="text-xs text-muted md:hidden">{t('scrollHint')}</p>
          </div>
        )}
      </QueryState>
    </section>
  );
}
