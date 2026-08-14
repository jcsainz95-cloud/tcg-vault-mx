'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getPortfolioHistory } from '@/lib/api';
import type { PortfolioRange } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const RANGES: PortfolioRange[] = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];

type TrendColors = { up: string; down: string; flat: string; text: string; border: string; muted: string };
const LIGHT: TrendColors = {
  up: '#047857',
  down: '#DC2626',
  flat: '#475569',
  text: '#0F172A',
  border: '#E2E8F0',
  muted: '#475569',
};

/** Lee los tokens de color resueltos (soporta modo oscuro) tras montar en cliente. */
function useTrendColors(): TrendColors {
  const [colors, setColors] = useState<TrendColors>(LIGHT);
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    setColors({
      up: read('--color-success', LIGHT.up),
      down: read('--color-danger', LIGHT.down),
      flat: read('--color-text-muted', LIGHT.flat),
      text: read('--color-text', LIGHT.text),
      border: read('--color-border', LIGHT.border),
      muted: read('--color-text-muted', LIGHT.muted),
    });
  }, []);
  return colors;
}

export interface PortfolioTrendChartProps {
  /** valor actual del portafolio (de holdings) para el encabezado del estado vacío */
  currentValueFallbackCents?: number;
}

/** Gráfica de tendencia del portafolio estilo acciones (DESIGN_SYSTEM §7.17). */
export function PortfolioTrendChart({ currentValueFallbackCents }: PortfolioTrendChartProps) {
  const t = useTranslations('portfolio.trend');
  const locale = useLocale() as AppLocale;
  const colors = useTrendColors();
  const [range, setRange] = useState<PortfolioRange>('1m');

  const query = useQuery({
    queryKey: ['portfolio-history', range],
    queryFn: () => getPortfolioHistory(range),
  });

  const data = query.data;
  const points = useMemo(() => data?.points ?? [], [data]);
  const direction = data?.change.direction ?? 'flat';
  const trendColor = colors[direction];
  const hasEstimated = points.some((p) => p.estimated);

  const currentValueCents =
    points.length > 0 ? points[points.length - 1].valueMxnCents : currentValueFallbackCents ?? 0;

  const summary = useMemo(() => {
    if (!data || points.length === 0) return t('summaryNoData');
    const first = points[0];
    const last = points[points.length - 1];
    const dirWord = t(direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'flat');
    const sign = data.change.absMxnCents > 0 ? '+' : data.change.absMxnCents < 0 ? '−' : '';
    const abs = `${sign}${formatMoneyCents(Math.abs(data.change.absMxnCents), locale)}`;
    const pct = data.change.pct != null ? ` (${sign}${Math.abs(data.change.pct).toFixed(2)} %)` : '';
    return t('summary', {
      start: formatMoneyCents(first.valueMxnCents, locale),
      startDate: formatDate(first.date, locale),
      end: formatMoneyCents(last.valueMxnCents, locale),
      endDate: formatDate(last.date, locale),
      dir: dirWord,
      abs,
      pct,
    });
  }, [data, points, direction, locale, t]);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 shadow-sm">
      {/* Encabezado: valor + delta (signo + flecha + color) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">{t('title')}</span>
          <span className="tabular text-h1 font-bold text-text">
            {formatMoneyCents(currentValueCents, locale)}
          </span>
          <Delta data={data} color={trendColor} />
        </div>
        <RangeToggle range={range} onChange={setRange} />
      </div>

      {/* Resumen textual accesible (alternativa al svg) */}
      <p className="sr-only" aria-live="polite">
        {summary}
      </p>

      <ChartBody
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => query.refetch()}
        pointsLength={points.length}
        data={points}
        colors={colors}
        trendColor={trendColor}
        hasEstimated={hasEstimated}
        summary={summary}
        locale={locale}
      />
    </section>
  );
}

function Delta({
  data,
  color,
}: {
  data?: { change: { absMxnCents: number; pct: number | null; direction: 'up' | 'down' | 'flat' } };
  color: string;
}) {
  const t = useTranslations('portfolio.trend');
  const locale = useLocale() as AppLocale;
  if (!data) return <span className="text-sm text-muted">—</span>;
  const { absMxnCents, pct, direction } = data.change;
  if (direction === 'flat') {
    return <span className="text-sm font-medium text-muted">{t('noChange')}</span>;
  }
  const up = direction === 'up';
  const sign = up ? '+' : '−';
  const Arrow = up ? TrendingUp : TrendingDown;
  return (
    <span className="flex items-center gap-1 text-sm font-medium tabular" style={{ color }}>
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <Arrow size={16} aria-hidden />
      <span>
        {sign}
        {formatMoneyCents(Math.abs(absMxnCents), locale)}
      </span>
      {pct != null && (
        <span>
          ({sign}
          {Math.abs(pct).toFixed(2)} %)
        </span>
      )}
    </span>
  );
}

function RangeToggle({
  range,
  onChange,
}: {
  range: PortfolioRange;
  onChange: (r: PortfolioRange) => void;
}) {
  const t = useTranslations('portfolio.trend.ranges');
  const tRoot = useTranslations('portfolio.trend');
  return (
    <div
      role="group"
      aria-label={tRoot('rangesAria')}
      className="flex gap-1 overflow-x-auto rounded-full border border-border bg-surface-2 p-1"
    >
      {RANGES.map((r) => {
        const active = r === range;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(r)}
            className={cn(
              'min-h-[44px] whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors sm:min-h-[36px]',
              active ? 'bg-primary text-primary-fg' : 'text-muted hover:text-text',
            )}
          >
            {t(r)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sparkline opcional para el StatCard de "valor de portafolio" (§7.8/§7.17).
 * Reutiliza `history` (rango corto) y muestra el delta como subtítulo (signo+flecha).
 */
export function PortfolioSparkline() {
  const t = useTranslations('portfolio.trend');
  const locale = useLocale() as AppLocale;
  const colors = useTrendColors();
  const query = useQuery({
    queryKey: ['portfolio-history', '1m', 'spark'],
    queryFn: () => getPortfolioHistory('1m'),
  });
  const data = query.data;
  if (!data || data.points.length < 2) return null;
  const direction = data.change.direction;
  const color = colors[direction];
  const chartData = data.points.map((p) => ({ v: p.valueMxnCents }));
  const up = direction === 'up';
  const sign = direction === 'flat' ? '' : up ? '+' : '−';
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-24 shrink-0" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill="url(#sparkFill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <span className="tabular text-xs font-medium" style={{ color }}>
        {direction === 'flat' ? (
          t('noChange')
        ) : (
          <>
            {up ? '▲' : '▼'} {sign}
            {formatMoneyCents(Math.abs(data.change.absMxnCents), locale)}
            {data.change.pct != null && (
              <>
                {' '}
                ({sign}
                {Math.abs(data.change.pct).toFixed(2)} %)
              </>
            )}
          </>
        )}
      </span>
    </div>
  );
}

interface ChartBodyProps {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  pointsLength: number;
  data: { date: string; valueMxnCents: number; costBasisMxnCents?: number; estimated?: boolean }[];
  colors: TrendColors;
  trendColor: string;
  hasEstimated: boolean;
  summary: string;
  locale: AppLocale;
}

function ChartBody({
  loading,
  error,
  onRetry,
  pointsLength,
  data,
  colors,
  trendColor,
  hasEstimated,
  summary,
  locale,
}: ChartBodyProps) {
  const t = useTranslations('portfolio.trend');
  const tCommon = useTranslations('common');
  const [showTable, setShowTable] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[240px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-danger/40 bg-danger-bg p-4">
        <p className="text-sm font-medium text-danger">{t('errorTitle')}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {tCommon('retry')}
        </Button>
      </div>
    );
  }

  // Vacío: sin snapshots todavía ("recopilando datos") — no es un error, no pintar cero.
  if (pointsLength === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-surface-2/50 p-8 text-center">
        <TrendingUp size={28} className="text-muted" aria-hidden />
        <p className="text-h3 font-semibold text-text">{t('collectingTitle')}</p>
        <p className="max-w-sm text-sm text-muted">{t('collectingBody')}</p>
      </div>
    );
  }

  const hasCostBasis = data.some((p) => p.costBasisMxnCents != null);
  const chartData = data.map((p) => ({
    date: p.date,
    value: p.valueMxnCents,
    cost: p.costBasisMxnCents,
  }));

  const fmtAxisDate = (d: string) => formatDate(d, locale);
  const fmtAxisValue = (v: number) => {
    const pesos = v / 100;
    if (pesos >= 1000) return `MX$ ${(pesos / 1000).toFixed(1)}k`;
    return `MX$ ${pesos.toFixed(0)}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {pointsLength <= 1 && <p className="text-xs text-muted">{t('fewPoints')}</p>}

      <div role="img" aria-label={summary} className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={trendColor} stopOpacity={0.25} />
                <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={colors.border} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtAxisDate}
              minTickGap={40}
              tick={{ fill: colors.muted, fontSize: 12 }}
              stroke={colors.border}
            />
            <YAxis
              tickFormatter={fmtAxisValue}
              width={64}
              tick={{ fill: colors.muted, fontSize: 12 }}
              stroke={colors.border}
            />
            <Tooltip
              formatter={(v: number) => formatMoneyCents(v, locale)}
              labelFormatter={(d: string) => formatDate(d, locale)}
              contentStyle={{ fontSize: 12 }}
            />
            {hasCostBasis && (
              <Line
                type="monotone"
                dataKey="cost"
                stroke={colors.muted}
                strokeDasharray="4 4"
                dot={false}
                strokeWidth={1.5}
                name={t('costBasis')}
              />
            )}
            <Area
              type="monotone"
              dataKey="value"
              stroke={trendColor}
              strokeWidth={2}
              strokeDasharray={hasEstimated ? '5 5' : undefined}
              fill="url(#trendFill)"
              name={t('value')}
              dot={pointsLength <= 2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-full" style={{ background: trendColor }} aria-hidden />
          {t('value')}
        </span>
        {hasCostBasis && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: colors.muted }} aria-hidden />
            {t('costBasis')}
          </span>
        )}
        {hasEstimated && <span>{t('estimated')}</span>}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="ml-auto font-medium text-primary hover:underline"
        >
          {t('viewTable')}
        </button>
      </div>

      {showTable && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted">
              <th className="py-1">{t('tableDate')}</th>
              <th className="py-1 text-right">{t('tableValue')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.date} className="border-t border-border">
                <td className="py-1">{formatDate(p.date, locale)}</td>
                <td className="tabular py-1 text-right">{formatMoneyCents(p.valueMxnCents, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
