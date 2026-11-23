'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { isRealYmd, periodFor, periodSearch, spanDays, todayMx, REPORT_PRESETS, type ReportPeriod, type ReportPreset } from '@/lib/reports/period';
import { setCurrentPeriod } from '@/lib/reports/period-store';
import { fmtRange } from '@/app/[locale]/(admin)/admin/m9/salesFormat';

const SHORTCUTS = REPORT_PRESETS.filter((p): p is Exclude<ReportPreset, 'custom'> => p !== 'custom');

/** Estado del periodo de una pantalla + su reflejo en la URL y en el menú. `initial` viene del servidor (`parsePeriod`). */
export function useReportPeriod(initial: ReportPeriod) {
  const [period, setPeriod] = useState<ReportPeriod>(initial);
  // Al abrir: menú y URL reflejan lo que la pantalla muestra (un `?preset=all` que aquí no cabe cae al defecto y la URL lo dice).
  useEffect(() => {
    setCurrentPeriod(initial);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const want = periodSearch(initial);
    if (url.search !== want) window.history.replaceState(window.history.state, '', url.pathname + want + url.hash);
  }, [initial]);
  const change = useCallback((p: ReportPeriod) => {
    setPeriod(p);
    setCurrentPeriod(p);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.search = periodSearch(p);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);
  return [period, change] as const;
}

/**
 * ÚNICO selector de periodo de Reportes y Finanzas (§REPORTES-CEO §2): atajos + «Fechas…», siempre «Hora de México» y las
 * fechas resueltas a la vista. Las fechas a mano se validan como fechas REALES antes de mandar; el servidor es la regla.
 */
export function PeriodSelector({
  value,
  onChange,
  maxDays,
}: {
  value: ReportPeriod;
  onChange: (p: ReportPeriod) => void;
  /** Tope de días del endpoint (Ventas: 366): «Todo» queda desactivado con su rótulo y el rango a mano se valida. */
  maxDays?: number;
}) {
  const t = useTranslations('admin.reports.period');
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(value.preset === 'custom');
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  // m-6: las fechas a mano siguen al periodo vigente (también al pulsar un atajo).
  useEffect(() => {
    setFrom(value.from);
    setTo(value.to);
  }, [value.from, value.to]);
  const today = todayMx();
  const invalid = !isRealYmd(from, today) || !isRealYmd(to, today) || from > to || to > today || (maxDays !== undefined && spanDays(from, to) > maxDays);
  const r = fmtRange(value.from, value.to, locale);
  const base = 'min-h-[44px] border border-border px-4 text-sm focus-visible:shadow-focus focus-visible:outline-none -ml-px first:ml-0';
  const tone = (on: boolean) => (on ? 'bg-text text-surface' : 'bg-surface text-text hover:bg-surface-2');

  return (
    <div className="flex flex-col gap-3" data-testid="period-selector">
      <div role="group" aria-label={t('label')} className="flex flex-wrap">
        {SHORTCUTS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value.preset === p}
            disabled={p === 'all' && maxDays !== undefined}
            className={cn(base, tone(value.preset === p), 'disabled:cursor-not-allowed disabled:text-muted')}
            onClick={() => {
              setOpen(false);
              onChange(periodFor(p));
            }}
          >
            {t(p)}
            {p === 'all' && maxDays !== undefined && <span className="ml-1 text-xs">({t('maxDays', { days: maxDays })})</span>}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.preset === 'custom'}
          aria-expanded={open}
          className={cn(base, tone(value.preset === 'custom'))}
          onClick={() => setOpen((o) => !o)}
        >
          {t('custom')}
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap items-end gap-3">
          <Input label={t('from')} type="date" className="w-44" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          <Input label={t('to')} type="date" className="w-44" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          <Button size="sm" disabled={invalid} onClick={() => onChange({ preset: 'custom', from, to })}>
            {t('apply')}
          </Button>
          {invalid && <p className="text-xs text-muted">{t('invalid')}</p>}
        </div>
      )}
      <p className="text-sm text-muted" data-testid="period-resolved">
        <span className="font-mono text-xs uppercase tracking-label">{t('mexicoTime')}</span> ·{' '}
        {value.preset === 'all' ? t('allResolved', { to: r.to }) : t('resolved', { from: r.from, to: r.to })}
      </p>
    </div>
  );
}
