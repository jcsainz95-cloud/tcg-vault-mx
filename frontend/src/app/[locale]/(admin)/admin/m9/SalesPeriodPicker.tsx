'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesGroupBy, SalesReportDTO } from '@/types/contract';
import { SALES_MAX_DAYS, addDays, todayMx, type ReportPeriod, type ReportPreset } from '@/lib/reports/period';
import { ComparisonNote } from '@/components/domain/ComparisonNote';
import { PeriodSelector } from '@/components/domain/PeriodSelector';
import { Segmented } from './SalesBarChart';
import { capitalize, fmtDay, fmtRange } from './salesFormat';

/**
 * Periodo y agrupación de Ventas (`§AN-UX.2`): el periodo es el selector ÚNICO de Reportes (§REPORTES-CEO §2); aquí solo se
 * añade «Ver por» día/semana/mes. Los atajos los resuelve el SERVIDOR cuando los conoce (AN-5); el rango a mano se valida
 * como fecha real antes de mandar.
 */
export function SalesPeriodPicker({
  period,
  groupBy,
  onPeriod,
  onGroupBy,
}: {
  period: ReportPeriod;
  groupBy: SalesGroupBy;
  onPeriod: (p: ReportPeriod) => void;
  onGroupBy: (g: SalesGroupBy) => void;
}) {
  const t = useTranslations('admin.m9.sales');
  return (
    <section aria-labelledby="sales-period-h" className="flex flex-col gap-3">
      <h2 id="sales-period-h" className="text-h2 font-semibold">
        {t('period.title')}
      </h2>
      <PeriodSelector value={period} onChange={onPeriod} maxDays={SALES_MAX_DAYS} />
      <Segmented
        label={t('groupBy.label')}
        value={groupBy}
        options={[
          { value: 'day', label: t('groupBy.day') },
          { value: 'week', label: t('groupBy.week') },
          { value: 'month', label: t('groupBy.month') },
        ]}
        onChange={onGroupBy}
      />
      {groupBy === 'week' && <p className="text-xs text-muted">{t('groupBy.weekNote')}</p>}
    </section>
  );
}

/**
 * Rótulo del periodo (criterio 286) — SIEMPRE de `period`/`previousPeriod` de la RESPUESTA (AN-4 / UX-AN-5): mientras
 * carga un periodo nuevo se ve el rótulo viejo con las cifras viejas, ⛔ nunca el rótulo nuevo sobre cifras viejas.
 */
export function SalesPeriodLabel({ data, preset }: { data: SalesReportDTO; preset: ReportPreset }) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const { period, previousPeriod } = data;
  const day = (ymd: string) => fmtDay(ymd, locale, { weekday: true, year: true });
  let main: string;
  if (period.days === 1) {
    // §2: el selector manda fechas, no `preset`; «Hoy»/«Ayer» se reconocen por el día de México.
    if (period.preset === 'today' || period.from === todayMx()) main = t('label.oneDayToday', { date: day(period.from) });
    else if (period.preset === 'yesterday' || period.from === addDays(todayMx(), -1)) main = t('label.oneDayYesterday', { date: day(period.from) });
    else main = t('label.oneDay', { date: capitalize(day(period.from)) });
  } else {
    const r = fmtRange(period.from, period.to, locale);
    main = t('label.range', { from: r.from, to: r.to, days: period.days });
  }
  return (
    <div aria-live="polite" data-testid="sales-period-label" data-from={period.from} data-to={period.to}>
      <p className="text-sm font-medium text-text">{main}</p>
      {/* F2a: contra qué se compara (mismo tramo, «contra lo que hay», «sin periodo anterior»), de la RESPUESTA. */}
      <ComparisonNote
        preset={preset}
        period={period}
        previous={previousPeriod}
        comparison={data.comparison}
        kind={period.kind}
        testId="sales-compare"
      />
    </div>
  );
}
