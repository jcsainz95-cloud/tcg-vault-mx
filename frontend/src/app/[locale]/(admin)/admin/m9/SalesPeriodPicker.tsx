'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesGroupBy, SalesPreset, SalesReportDTO } from '@/types/contract';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Segmented } from './SalesBarChart';
import { capitalize, fmtDay, fmtRange } from './salesFormat';
import { SALES_PRESETS, todayMx, validateRange, type SalesRangeError } from './salesParams';

const PRESET_KEY: Record<SalesPreset, string> = {
  today: 'today',
  yesterday: 'yesterday',
  last7: 'last7',
  last30: 'last30',
  this_month: 'thisMonth',
  last_month: 'lastMonth',
  custom: 'custom',
};

/** `invalid` = el genérico para un `400` del servidor (AN-1.2: sin `details.reason`, se coloca por `field`). */
export type FieldError = { field: 'from' | 'to'; key: SalesRangeError['key'] | 'invalid' };

/**
 * Selector de periodo y agrupación (`§AN-UX.2`). Los presets los resuelve el SERVIDOR (AN-5); el rango a mano se valida
 * aquí antes de mandar (mismos textos que el servidor) y solo consulta al pulsar «Ver».
 */
export function SalesPeriodPicker({
  preset,
  from,
  to,
  groupBy,
  serverError,
  onPreset,
  onCustom,
  onGroupBy,
}: {
  preset: SalesPreset;
  from?: string;
  to?: string;
  groupBy: SalesGroupBy;
  serverError: FieldError | null;
  onPreset: (p: Exclude<SalesPreset, 'custom'>) => void;
  onCustom: (from: string, to: string) => void;
  onGroupBy: (g: SalesGroupBy) => void;
}) {
  const t = useTranslations('admin.m9.sales');
  const [open, setOpen] = useState(preset === 'custom');
  const [draftFrom, setDraftFrom] = useState(from ?? '');
  const [draftTo, setDraftTo] = useState(to ?? '');
  const [localError, setLocalError] = useState<FieldError | null>(null);
  const today = todayMx();
  const err = localError ?? serverError;
  const errFor = (f: 'from' | 'to') => (err && err.field === f ? t(`range.${err.key}`) : undefined);

  function apply() {
    const e = validateRange(draftFrom, draftTo, today);
    setLocalError(e);
    if (!e) onCustom(draftFrom, draftTo);
  }

  const chip = (active: boolean) =>
    cn(
      'min-h-[44px] px-4 text-[10px] uppercase tracking-label focus-visible:shadow-focus focus-visible:outline-none',
      active ? 'bg-primary text-primary-fg' : 'text-text hover:text-accent',
    );
  const customActive = open || preset === 'custom';

  return (
    <section aria-labelledby="sales-period-h" className="flex flex-col gap-3">
      <h2 id="sales-period-h" className="text-h2 font-semibold">
        {t('period.title')}
      </h2>
      <div role="group" aria-label={t('period.presetsLabel')} className="flex flex-wrap gap-1">
        {SALES_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={!customActive && preset === p}
            className={chip(!customActive && preset === p)}
            onClick={() => {
              setOpen(false);
              setLocalError(null);
              onPreset(p);
            }}
          >
            {t(`period.${PRESET_KEY[p]}`)}
          </button>
        ))}
        <button type="button" aria-pressed={customActive} className={chip(customActive)} onClick={() => setOpen(true)}>
          {t('period.custom')}
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('period.from')}
            type="date"
            className="w-44"
            max={today}
            value={draftFrom}
            error={errFor('from')}
            onChange={(e) => setDraftFrom(e.target.value)}
          />
          <Input
            label={t('period.to')}
            type="date"
            className="w-44"
            max={today}
            value={draftTo}
            error={errFor('to')}
            onChange={(e) => setDraftTo(e.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={apply}>
            {t('period.apply')}
          </Button>
        </div>
      )}
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
export function SalesPeriodLabel({ data }: { data: SalesReportDTO }) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const { period, previousPeriod } = data;
  const day = (ymd: string) => fmtDay(ymd, locale, { weekday: true, year: true });
  let main: string;
  if (period.days === 1) {
    if (period.preset === 'today') main = t('label.oneDayToday', { date: day(period.from) });
    else if (period.preset === 'yesterday') main = t('label.oneDayYesterday', { date: day(period.from) });
    else main = t('label.oneDay', { date: capitalize(day(period.from)) });
  } else {
    const r = fmtRange(period.from, period.to, locale);
    main = t('label.range', { from: r.from, to: r.to, days: period.days });
  }
  const cmp =
    previousPeriod.from === previousPeriod.to
      ? t('label.compareDay', { date: day(previousPeriod.from) })
      : t('label.compareRange', fmtRange(previousPeriod.from, previousPeriod.to, locale));
  return (
    <div aria-live="polite" data-testid="sales-period-label" data-from={period.from} data-to={period.to}>
      <p className="text-sm font-medium text-text">{main}</p>
      <p className="text-sm text-muted">{cmp}</p>
    </div>
  );
}
