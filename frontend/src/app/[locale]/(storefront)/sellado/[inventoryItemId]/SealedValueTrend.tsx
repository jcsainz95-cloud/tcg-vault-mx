'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { getSealedValueHistory } from '@/lib/api';
import type { SetValueRange } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

const RANGES: SetValueRange[] = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];
const DELTA_COLOR: Record<'up' | 'down' | 'flat', string> = {
  up: 'var(--color-success)',
  down: 'var(--color-danger)',
  flat: 'var(--color-text-muted)',
};

/**
 * Tendencia de valor de mercado del producto SELLADO (contrato §2-S · GET
 * /catalog/sealed/:inventoryItemId/value-history, FEATURE-FLAGGED `sealed_value_trend`).
 *
 * Cableado "apagado limpio": si el endpoint responde `404 FEATURE_DISABLED` (dial off) o
 * `404 NOT_FOUND` (producto no mapeado → sin serie), el componente se OCULTA por completo en vez de
 * mostrar un error o una curva fabricada.
 */
export function SealedValueTrend({ inventoryItemId }: { inventoryItemId: string }) {
  const t = useTranslations('sealed.trend');
  const locale = useLocale() as AppLocale;
  const [range, setRange] = useState<SetValueRange>('1m');

  const query = useQuery({
    queryKey: ['sealed-value-history', inventoryItemId, range],
    queryFn: () => getSealedValueHistory(inventoryItemId, range),
    retry: false,
  });

  // Flag apagado / sin serie / cualquier fallo de este endpoint secundario → ocultar limpio.
  if (query.isError) return null;

  if (query.isLoading) {
    return (
      <section>
        <span className="eyebrow">{t('title')}</span>
        <Skeleton className="mt-4 h-[90px] w-full max-w-[320px]" />
      </section>
    );
  }

  const data = query.data;
  if (!data || data.points.length === 0) {
    return (
      <section>
        <span className="eyebrow">{t('title')}</span>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">{t('collecting')}</p>
      </section>
    );
  }

  const points = data.points;
  const direction = data.change.direction;
  const color = DELTA_COLOR[direction];
  const currentCents = points[points.length - 1].valueMxnCents;
  const sign = data.change.absMxnCents > 0 ? '+' : data.change.absMxnCents < 0 ? '−' : '';

  return (
    <section>
      <span className="eyebrow">{t('title')}</span>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-[220px] flex-1">
          <div className="tabular text-[32px] font-medium leading-none tracking-[-0.02em] text-text lg:text-[40px]">
            {formatMoneyCents(currentCents, locale)}
          </div>
          {direction === 'flat' ? (
            <span className="mt-2.5 block font-mono text-[11px] text-muted">{t('noChange')}</span>
          ) : (
            <span
              className="tabular mt-2.5 flex items-center gap-1.5 font-mono text-[11px]"
              style={{ color }}
            >
              <span aria-hidden>{direction === 'up' ? '▲' : '▼'}</span>
              <span>
                {sign}
                {formatMoneyCents(Math.abs(data.change.absMxnCents), locale)}
              </span>
              {data.change.pct != null && (
                <span>
                  ({sign}
                  {Math.abs(data.change.pct).toFixed(2)} %)
                </span>
              )}
            </span>
          )}
          <p className="mt-3 font-mono text-[11px] text-muted">{t('marketRefNote')}</p>
        </div>

        {points.length >= 2 && (
          <div className="h-[90px] w-full shrink-0 sm:w-[320px]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points.map((p) => ({ v: p.valueMxnCents }))}
                margin={{ top: 4, right: 0, left: 0, bottom: 4 }}
              >
                <Line
                  type="linear"
                  dataKey="v"
                  stroke={color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div role="group" aria-label={t('rangesAria')} className="mt-5 flex gap-5 overflow-x-auto font-mono text-[11px]">
        {RANGES.map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => setRange(r)}
              className={cn(
                'min-h-[44px] whitespace-nowrap transition-colors sm:min-h-[28px]',
                active ? 'border-b border-accent pb-1.5 text-text' : 'text-muted hover:text-text',
              )}
            >
              {t(`ranges.${r}`)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
