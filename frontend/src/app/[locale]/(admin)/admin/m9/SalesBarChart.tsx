'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesGroupBy, SalesRowDTO, SalesReportDTO } from '@/types/contract';
import { cn } from '@/lib/cn';
import { formatMoneyCents } from '@/lib/format';
import { axisLabel, capitalize, fmtDay, fmtRange, shortMoney } from './salesFormat';
import type { SalesChartMetric } from './salesParams';

export interface Bar {
  key: string;
  axis: string;
  tooltip: string;
  value: number;
  valueLabel: string;
  inProgress?: boolean;
}

/** Escala «bonita» desde 0 (1/2/5 × 10ᵏ): es dibujo, no cifra de venta. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/**
 * Barras de UNA serie (`§AN-UX.4`): una barra por dato, en el orden dado, ⛔ ni se agregan ni se saltan. Tinta, sin
 * radio, sin movimiento. Cero = marca de 2 px en `muted` ocupando su hueco; «en curso» = barra hueca con contorno.
 * La equivalencia accesible es la tabla: el contenedor es `role="img"` con resumen y las barras no son paradas de Tab.
 * (HTML/CSS propio, no SVG: mismo resultado visual y la marca de cero mide 2 px reales; ⛔ librería externa, AN-8.)
 */
export function BarSeries({
  bars,
  ariaLabel,
  testId,
  heightClass = 'h-[200px] md:h-[240px]',
  formatTick,
  labelEvery = 1,
}: {
  bars: Bar[];
  ariaLabel: string;
  testId: string;
  heightClass?: string;
  formatTick: (v: number) => string;
  labelEvery?: number;
}) {
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const ticks = [max, max / 2, 0];
  const showValues = bars.length <= 14;
  return (
    <div className="flex gap-2">
      <div className={cn('relative w-14 shrink-0', heightClass)} aria-hidden>
        {ticks.map((v) => (
          <span
            key={v}
            className="tabular absolute right-0 -translate-y-1/2 font-mono text-xs text-muted"
            style={{ top: `${100 - (v / max) * 100}%` }}
          >
            {formatTick(v)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('relative', heightClass)}>
          {ticks.map((v) => (
            <div key={v} aria-hidden className="absolute inset-x-0 border-t border-border" style={{ top: `${100 - (v / max) * 100}%` }} />
          ))}
          <div role="img" aria-label={ariaLabel} className="absolute inset-0 flex items-end gap-[2px]">
            {bars.map((b, i) => {
              const pct = (b.value / max) * 100;
              return (
                <div key={b.key} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={b.tooltip}>
                  {showValues && (
                    <span aria-hidden className="tabular mb-0.5 truncate text-center font-mono text-xs text-muted">
                      {b.valueLabel}
                    </span>
                  )}
                  <div
                    data-testid={testId}
                    data-index={i}
                    data-value={b.value}
                    data-zero={b.value === 0 ? 'true' : undefined}
                    data-in-progress={b.inProgress ? 'true' : undefined}
                    className={cn(
                      'w-full',
                      b.value === 0
                        ? b.inProgress
                          ? 'h-[2px] border-2 border-text'
                          : 'h-[2px] bg-muted'
                        : b.inProgress
                          ? 'border-2 border-text bg-transparent'
                          : 'bg-text',
                    )}
                    style={b.value === 0 ? undefined : { height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        <div aria-hidden className="mt-1 flex gap-[2px]">
          {bars.map((b, i) => (
            <span key={b.key} className="min-w-0 flex-1 truncate text-center font-mono text-xs text-muted">
              {i % labelEvery === 0 ? `${b.axis}${b.inProgress ? '*' : ''}` : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Gráfica principal de la pestaña: una barra por fila de `rows` (criterio 609). */
export function SalesBarChart({
  data,
  metric,
  today,
  onMetric,
  onWeek,
}: {
  data: SalesReportDTO;
  metric: SalesChartMetric;
  today: string;
  onMetric: (m: SalesChartMetric) => void;
  onWeek: () => void;
}) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const unit: SalesGroupBy = data.groupBy;
  const valueOf = (r: SalesRowDTO) => (metric === 'orders' ? r.orders : r.chargedCents);
  const fmtValue = (v: number) => (metric === 'orders' ? String(v) : formatMoneyCents(v, locale));
  const includesToday = data.period.to === today;

  const bars: Bar[] = data.rows.map((r) => ({
    key: r.from,
    axis: axisLabel(r, unit, locale),
    tooltip: `${capitalize(unit === 'day' ? fmtDay(r.from, locale, { weekday: true }) : axisLabel(r, unit, locale))} · ${t('delta.orders', { diff: r.orders })} · ${formatMoneyCents(r.chargedCents, locale)}`,
    value: valueOf(r),
    valueLabel: metric === 'orders' ? String(r.orders) : shortMoney(r.chargedCents, locale),
    inProgress: includesToday && r.to === today,
  }));

  // Resumen accesible: solo se BUSCA el máximo y se cuentan los ceros (nada nuevo se calcula, §AN-UX.4).
  let best = data.rows[0];
  for (const r of data.rows) if (valueOf(r) > valueOf(best)) best = r;
  const zero = data.rows.filter((r) => valueOf(r) === 0).length;
  const range = fmtRange(data.period.from, data.period.to, locale);
  const metricName = metric === 'orders' ? t('chart.metricOrders') : t('chart.metricCharged');
  const summary = best
    ? t('chart.summaryOrders', {
        metric: metricName,
        from: range.from,
        to: range.to,
        total: metric === 'orders' ? String(data.totals.orders) : formatMoneyCents(data.totals.chargedCents, locale),
        best: unit === 'day' ? fmtDay(best.from, locale, { weekday: true }) : axisLabel(best, unit, locale),
        bestValue: fmtValue(valueOf(best)),
        zero,
      })
    : metricName;
  const labelEvery = bars.length > 14 ? Math.ceil(bars.length / 7) : 1;

  return (
    <figure className="flex flex-col gap-3" aria-labelledby="sales-chart-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="sales-chart-h" className="text-h2 font-semibold">
          {metric === 'orders' ? t('chart.titleOrders', { unit }) : t('chart.titleCharged', { unit })}
        </h2>
        <Segmented
          label={t('chart.metricLabel')}
          value={metric}
          options={[
            { value: 'orders', label: t('chart.metricOrders') },
            { value: 'charged', label: t('chart.metricCharged') },
          ]}
          onChange={onMetric}
        />
      </div>
      {data.rows.length > 62 && (
        <p className="text-xs text-muted">
          {t('chart.tooMany')}{' '}
          {unit === 'day' && (
            <button type="button" onClick={onWeek} className="underline underline-offset-2 hover:text-text focus-visible:shadow-focus focus-visible:outline-none">
              {t('chart.switchToWeek')}
            </button>
          )}
        </p>
      )}
      <BarSeries
        bars={bars}
        ariaLabel={summary}
        testId="sales-bar"
        formatTick={(v) => (metric === 'orders' ? String(Math.round(v * 10) / 10) : shortMoney(v, locale))}
        labelEvery={labelEvery}
      />
      {bars.some((b) => b.inProgress) && <p className="text-xs text-muted">{t('chart.inProgress')}</p>}
      <figcaption className="text-xs text-muted">{t('chart.caption')}</figcaption>
    </figure>
  );
}

/** Conmutador segmentado (`role="group"` + `aria-pressed`, §7.17), ≥ 44 px. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span aria-hidden className="eyebrow mr-1">
        {label}
      </span>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-[44px] px-3 text-[11px] uppercase tracking-label focus-visible:shadow-focus focus-visible:outline-none',
              active ? 'bg-primary text-primary-fg' : 'text-text hover:text-accent',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
