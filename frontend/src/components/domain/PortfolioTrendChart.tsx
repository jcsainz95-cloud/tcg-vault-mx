'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { getPortfolioHistory } from '@/lib/api';
import type { PortfolioRange } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const RANGES: PortfolioRange[] = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];

type TrendColors = { up: string; down: string; flat: string; muted: string };
const LIGHT: TrendColors = { up: '#4E7A49', down: '#B44B3A', flat: '#6E695E', muted: '#6E695E' };

/** Lee los tokens de color resueltos tras montar en cliente. */
function useTrendColors(): TrendColors {
  const [colors, setColors] = useState<TrendColors>(LIGHT);
  useEffect(() => {
    const s = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
    setColors({
      up: read('--color-success', LIGHT.up),
      down: read('--color-danger', LIGHT.down),
      flat: read('--color-text-muted', LIGHT.flat),
      muted: read('--color-text-muted', LIGHT.muted),
    });
  }, []);
  return colors;
}

export interface PortfolioTrendChartProps {
  /** valor actual del portafolio (de holdings) para el encabezado del estado vacío */
  currentValueFallbackCents?: number;
  /** notas bajo el delta (hint de valuación, cartas con precio pendiente) */
  footnote?: React.ReactNode;
  /** rótulo del bloque; por defecto el propio de la tendencia */
  label?: string;
}

/**
 * Tendencia del portafolio estilo acciones (DESIGN_SYSTEM §7.17).
 *
 * 6c — Dirección 5a: el bloque deja de ser una tarjeta con ejes, retícula y
 * relleno degradado. Queda la cifra grande, el delta en verde, una polilínea
 * desnuda y la fila de rangos como texto mono con la regla bermellón en el activo.
 * Los datos exactos siguen disponibles en la tabla accesible.
 */
export function PortfolioTrendChart({ currentValueFallbackCents, footnote, label }: PortfolioTrendChartProps) {
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
    <section>
      <span className="eyebrow">{label ?? t('title')}</span>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-[220px] flex-1">
          <div className="tabular text-[32px] font-medium leading-none tracking-[-0.02em] text-text lg:text-[44px]">
            {formatMoneyCents(currentValueCents, locale)}
          </div>
          <Delta data={data} color={trendColor} />
          {footnote}
        </div>

        {/* Polilínea desnuda: el movimiento, sin ejes ni retícula. */}
        <Sparkline points={points} color={trendColor} summary={summary} dashed={hasEstimated} />
      </div>

      {/* Resumen textual accesible (alternativa al svg) */}
      <p className="sr-only" aria-live="polite">
        {summary}
      </p>

      {/* Rótulo de la serie: `label` nombra la cifra, esto nombra la tendencia. */}
      <p className="mt-7 font-mono text-[11px] text-muted">{t('title')}</p>
      <RangeToggle range={range} onChange={setRange} />

      <ChartBody
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => query.refetch()}
        pointsLength={points.length}
        data={points}
        hasEstimated={hasEstimated}
        locale={locale}
      />
    </section>
  );
}

function Sparkline({
  points,
  color,
  summary,
  dashed,
}: {
  points: { valueMxnCents: number }[];
  color: string;
  summary: string;
  dashed: boolean;
}) {
  if (points.length < 2) return null;
  const chartData = points.map((p) => ({ v: p.valueMxnCents }));
  return (
    <div role="img" aria-label={summary} className="h-[90px] w-full shrink-0 sm:w-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
          <Line
            type="linear"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={dashed ? '5 5' : undefined}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
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
  if (!data) return <span className="mt-2.5 block font-mono text-[11px] text-muted">—</span>;
  const { absMxnCents, pct, direction } = data.change;
  if (direction === 'flat') {
    return <span className="mt-2.5 block font-mono text-[11px] text-muted">{t('noChange')}</span>;
  }
  const up = direction === 'up';
  const sign = up ? '+' : '−';
  return (
    <span className="tabular mt-2.5 flex items-center gap-1.5 font-mono text-[11px]" style={{ color }}>
      {/* La flecha acompaña al color: el sentido no se cifra solo en la tinta. */}
      <span aria-hidden>{up ? '▲' : '▼'}</span>
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
      className="mt-3 flex gap-5 overflow-x-auto font-mono text-[11px]"
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
              'min-h-[44px] whitespace-nowrap transition-colors sm:min-h-[28px]',
              active ? 'border-b border-accent pb-1.5 text-text' : 'text-muted hover:text-text',
            )}
          >
            {t(r)}
          </button>
        );
      })}
    </div>
  );
}

interface ChartBodyProps {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  pointsLength: number;
  data: { date: string; valueMxnCents: number; costBasisMxnCents?: number; estimated?: boolean }[];
  hasEstimated: boolean;
  locale: AppLocale;
}

/**
 * Estados de la serie y acceso al dato exacto. Con la gráfica reducida a una
 * polilínea, la tabla deja de ser un extra de accesibilidad y pasa a ser la vía
 * principal para leer cifras concretas.
 */
function ChartBody({ loading, error, onRetry, pointsLength, data, hasEstimated, locale }: ChartBodyProps) {
  const t = useTranslations('portfolio.trend');
  const tCommon = useTranslations('common');
  const [showTable, setShowTable] = useState(false);

  if (loading) return <Skeleton className="mt-6 h-[90px] w-full max-w-[280px]" />;

  if (error) {
    return (
      <div className="rule-note mt-6 py-1">
        <p className="text-sm font-medium text-accent">{t('errorTitle')}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {tCommon('retry')}
        </Button>
      </div>
    );
  }

  // Vacío: sin snapshots todavía ("recopilando datos") — no es un error, no pintar cero.
  if (pointsLength === 0) {
    return (
      <div className="mt-6 border-t border-border pt-5">
        <p className="font-serif text-lg text-text">{t('collectingTitle')}</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{t('collectingBody')}</p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted">
        {pointsLength <= 1 && <span>{t('fewPoints')}</span>}
        {hasEstimated && <span>{t('estimated')}</span>}
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="ml-auto text-accent hover:text-text"
        >
          {t('viewTable')}
        </button>
      </div>

      {showTable && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="eyebrow py-2 font-medium">{t('tableDate')}</th>
              <th className="eyebrow py-2 text-right font-medium">{t('tableValue')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.date} className="border-t border-border">
                <td className="py-2">{formatDate(p.date, locale)}</td>
                <td className="tabular py-2 text-right">{formatMoneyCents(p.valueMxnCents, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Vistazo del portafolio para la home (5a): cifra, delta y polilínea, sin fila de
 * rangos ni tabla. Vive aquí para no duplicar la lectura de tokens de color ni el
 * criterio del delta, que es donde está el riesgo de que las dos vistas se
 * desalineen.
 */
export function PortfolioGlance({ fallbackCents }: { fallbackCents?: number }) {
  const locale = useLocale() as AppLocale;
  const colors = useTrendColors();
  const query = useQuery({
    queryKey: ['portfolio-history', '1m'],
    queryFn: () => getPortfolioHistory('1m'),
  });
  const data = query.data;
  const points = data?.points ?? [];
  const trendColor = colors[data?.change.direction ?? 'flat'];
  const currentValueCents =
    points.length > 0 ? points[points.length - 1].valueMxnCents : fallbackCents ?? 0;

  return (
    <div className="flex items-end justify-between gap-6">
      <div className="min-w-0">
        <div className="tabular text-[32px] font-medium leading-none tracking-[-0.02em] text-text lg:text-[41px]">
          {formatMoneyCents(currentValueCents, locale)}
        </div>
        <Delta data={data} color={trendColor} />
      </div>
      <div className="hidden sm:block">
        <Sparkline points={points} color={trendColor} summary="" dashed={false} />
      </div>
    </div>
  );
}
