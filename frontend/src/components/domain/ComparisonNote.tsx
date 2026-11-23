'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { ComparisonBasis, PeriodKind } from '@/types/contract';
import type { ReportPreset } from '@/lib/reports/period';
import { compareInfo, fmtCompact } from '@/lib/reports/comparison';
import { fmtDay } from '@/app/[locale]/(admin)/admin/m9/salesFormat';

/**
 * §REPORTES-CEO §2 (F2a) — la línea que dice, en llano, CONTRA QUÉ se compara el periodo: «Mes a la fecha · 1–23 nov
 * comparado con 1–23 oct». Todo sale de la respuesta del servidor (`previousPeriod`, `comparison.basis`, `dataSince`,
 * `clamped`); `basis: partial` ⇒ «contra lo que hay (datos desde …)»; `none` ⇒ «—» y «sin periodo anterior para comparar».
 * `previous`/`comparison` `undefined` mientras carga ⇒ no se pinta nada (nunca un rótulo sin su respuesta).
 */
export function ComparisonNote({
  preset,
  period,
  previous,
  comparison,
  kind,
  testId = 'compare-note',
  className,
}: {
  preset: ReportPreset;
  period: { from: string; to: string };
  previous: { from: string; to: string; clamped?: boolean } | null | undefined;
  comparison: { basis?: ComparisonBasis; dataSince?: string | null } | null | undefined;
  /** `period.kind` efectivo de la respuesta (m-3). */
  kind?: PeriodKind | null;
  testId?: string;
  className?: string;
}) {
  const t = useTranslations('admin.reports.compare');
  const locale = useLocale() as AppLocale;
  const info = compareInfo(preset, previous, comparison, kind);
  const range = fmtCompact(period.from, period.to, locale);

  if (info.mode === 'none') {
    return (
      <p className={className ?? 'text-sm text-muted'} data-testid={testId} data-basis="none">
        {info.toDate && <span className="font-medium text-text">{t(`toDate.${info.toDate}`)} · </span>}
        <span aria-hidden>— </span>
        {info.previous ? t('noSales', { prev: fmtCompact(info.previous.from, info.previous.to, locale) }) : t('none')}
      </p>
    );
  }
  const prev = info.previous ? fmtCompact(info.previous.from, info.previous.to, locale) : '';
  const base = info.mode === 'partial' ? t('partial', { range, prev, since: info.dataSince ? fmtDay(info.dataSince, locale, { year: true }) : '' }) : t('complete', { range, prev });
  return (
    <p className={className ?? 'text-sm text-muted'} data-testid={testId} data-basis={info.mode}>
      {info.toDate && <span className="font-medium text-text">{t(`toDate.${info.toDate}`)} · </span>}
      {base}
      {info.clamped && (
        <span data-testid={`${testId}-clamped`} className="block text-xs">
          {t('clamped')}
        </span>
      )}
    </p>
  );
}
