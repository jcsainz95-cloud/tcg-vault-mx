'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { periodFor, todayMx, type ReportPeriod } from '@/lib/reports/period';

const PRESETS = ['today', '7d', 'month', 'last-month'] as const;

/**
 * Selector de periodo único de los reportes (§REPORTES-CEO R1): atajos + «Fechas…». Días de México; el servidor valida el
 * tope y el orden (400), aquí solo se evita mandar un rango vacío o al revés. Sin sombras ni radios; foco visible.
 */
export function PeriodPicker({ value, onChange }: { value: ReportPeriod; onChange: (p: ReportPeriod) => void }) {
  const t = useTranslations('admin.reports.period');
  const [open, setOpen] = useState(value.preset === 'custom');
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const today = todayMx();
  const invalid = !from || !to || from > to || to > today;
  const base =
    'min-h-[44px] border border-border px-4 text-sm focus-visible:shadow-focus focus-visible:outline-none -ml-px first:ml-0';

  return (
    <div className="flex flex-col gap-3" data-testid="period-picker">
      <div role="group" aria-label={t('label')} className="flex flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value.preset === p}
            className={cn(base, value.preset === p ? 'bg-text text-surface' : 'bg-surface text-text hover:bg-surface-2')}
            onClick={() => {
              setOpen(false);
              onChange(periodFor(p));
            }}
          >
            {t(p)}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={value.preset === 'custom'}
          aria-expanded={open}
          className={cn(base, value.preset === 'custom' ? 'bg-text text-surface' : 'bg-surface text-text hover:bg-surface-2')}
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
          {invalid && (from || to) && <p className="text-xs text-muted">{t('invalid')}</p>}
        </div>
      )}
    </div>
  );
}
