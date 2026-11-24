'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { ComparisonBasis, MoneyDeltaDTO } from '@/types/contract';
import { fmtPct, moneyDirection } from '@/lib/reports/comparison';

/**
 * Variación de UNA celda, tal cual del servidor (`deltaBps` ⇒ un decimal fijo). `basis: none` o `deltaBps: null` ⇒ «—» (nunca
 * «0 %»); sin flechas de color de bueno/malo. Pequeña: cabe bajo el importe en una celda de tabla.
 */
export function CellDelta({ d, basis, testId }: { d?: MoneyDeltaDTO; basis?: ComparisonBasis; testId?: string }) {
  const t = useTranslations('admin.reports.compare');
  const locale = useLocale() as AppLocale;
  if (!d || !basis) return null;
  const pct = basis === 'none' ? null : fmtPct(d.deltaBps, locale);
  if (pct === null) {
    const why = basis === 'none' ? t('noBase') : t('noPrevious');
    return (
      <span className="block text-xs text-muted" data-testid={testId} title={why}>
        <span aria-hidden>—</span>
        <span className="sr-only">{why}</span>
      </span>
    );
  }
  const dir = moneyDirection(d);
  return (
    <span className="block text-xs text-muted" data-testid={testId}>
      <span aria-hidden>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '＝'} </span>
      <span className="sr-only">{t(`dir.${dir}`)} </span>
      {pct}
    </span>
  );
}
