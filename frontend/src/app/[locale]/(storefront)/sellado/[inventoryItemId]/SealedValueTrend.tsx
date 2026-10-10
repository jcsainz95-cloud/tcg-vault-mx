'use client';

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { getSealedValueHistory } from '@/lib/api';
import type { SealedValueHistoryResponse, SetValueRange } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Skeleton } from '@/components/ui/Skeleton';
import { IvaLabel } from '@/components/ui/IvaLabel';
import { cn } from '@/lib/cn';

const RANGES: SetValueRange[] = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];
const DELTA_COLOR: Record<'up' | 'down' | 'flat', string> = {
  up: 'var(--color-success)',
  down: 'var(--color-danger)',
  flat: 'var(--color-text-muted)',
};

/**
 * §MIV.3 — ¿la respuesta trae el mercado CON IVA completo? (`displayValueMxnCents` entero en cada punto y
 * `change.displayAbsMxnCents` entero). Un servidor sin §MIV no los manda: entonces el componente se
 * oculta. ⛔ Nunca se cae al neto.
 */
function hasDisplayFields(data: SealedValueHistoryResponse): boolean {
  return (
    Number.isInteger(data.change?.displayAbsMxnCents) &&
    data.points.every((p) => Number.isInteger(p.displayValueMxnCents))
  );
}

/**
 * Tendencia de valor de mercado del producto SELLADO (contrato §2-S · GET
 * /catalog/sealed/:inventoryItemId/value-history, FEATURE-FLAGGED `sealed_value_trend`).
 *
 * Cableado "apagado limpio": si el endpoint responde `404 FEATURE_DISABLED` (dial off) o
 * `404 NOT_FOUND` (producto no mapeado → sin serie), el componente se OCULTA por completo en vez de
 * mostrar un error o una curva fabricada.
 */
export function SealedValueTrend({
  inventoryItemId,
  ivaRatePct,
}: {
  inventoryItemId: string;
  /**
   * §MIV.3 / DESIGN_SYSTEM §MIV.3 — la TASA para el rótulo «IVA {rate} % incluido» (la serie no la trae;
   * la pasa la ficha desde `group.ivaRatePct`). Solo es un rótulo: ⛔ ninguna cuenta con ella.
   */
  ivaRatePct: number;
}) {
  const t = useTranslations('sealed.trend');
  const locale = useLocale() as AppLocale;
  const [range, setRange] = useState<SetValueRange>('1m');
  const ids = useId();
  const figureId = `${ids}-figure`;
  const ivaId = `${ids}-iva`;

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
  // §MIV.3: servidor sin los campos `display*` ⇒ oculto, igual que ante un 404.
  if (data && !hasDisplayFields(data)) return null;
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
  // ⭐ §MIV.3: la cifra grande, el cambio en pesos y la curva usan SOLO los `display*` (mercado con
  // IVA, del servidor); el porcentaje y la dirección, tal cual (se calculan sobre el neto y coinciden).
  const currentCents = points[points.length - 1].displayValueMxnCents;
  const changeCents = data.change.displayAbsMxnCents;
  const sign = changeCents > 0 ? '+' : changeCents < 0 ? '−' : '';

  return (
    <section>
      <span className="eyebrow">{t('title')}</span>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div className="min-w-[220px] flex-1">
          {/* §MIV.5: cifra + rótulo de IVA forman UNA unidad para el lector de pantalla (criterio 863). */}
          <div role="group" aria-labelledby={`${figureId} ${ivaId}`}>
            <div
              id={figureId}
              className="tabular text-[32px] font-medium leading-none tracking-[-0.02em] text-text lg:text-[40px]"
            >
              {formatMoneyCents(currentCents, locale)}
            </div>
            <IvaLabel
              id={ivaId}
              ivaIncluded
              ivaRatePct={ivaRatePct}
              className="mt-2 block text-[11px] leading-none whitespace-nowrap"
            />
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
                {formatMoneyCents(Math.abs(changeCents), locale)}
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
                data={points.map((p) => ({ v: p.displayValueMxnCents }))}
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
