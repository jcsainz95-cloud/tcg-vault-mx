'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSalesToday } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { SalesDeltaDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { capitalize, fmtDay, signOf, signedMoney } from './m9/salesFormat';

const LINK_CLASS = 'underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none';

/**
 * «Ventas de hoy» (`DESIGN_SYSTEM §AN-UX.11`, contrato §15.5, criterio 611). ⛔ Se monta SOLO con súper-admin: quien la
 * usa la condiciona a `isSuperAdmin` y aquí no hay máscara (AN-7 / UX-AN-10). Consulta PROPIA (`/sales/today`, no
 * `/admin/dashboard`), con su carga y su error dentro de la celda (UX-AN-12). Sin sondeo: se refresca al volver a la
 * pestaña. Cifras y diferencias tal cual del DTO (AN-1).
 */
export function SalesTodayCard() {
  const t = useTranslations('admin.dashboard.salesToday');
  const ts = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const q = useQuery({ queryKey: ['sales-today'], queryFn: getSalesToday, refetchOnWindowFocus: true, retry: false });

  if (q.isLoading) {
    return (
      <div className="px-6 py-7 sm:px-10" data-testid="sales-today-card">
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="flex flex-col px-6 py-7 sm:px-10" data-testid="sales-today-card">
        <span className="eyebrow">{t('title')}</span>
        <span className="mt-4 flex flex-col gap-1 font-mono text-xs text-muted" role="alert">
          <span>{t('error')}</span>
          <button type="button" onClick={() => q.refetch()} className={`self-start ${LINK_CLASS}`}>
            {t('retry')}
          </button>
        </span>
      </div>
    );
  }

  const d = q.data;
  const refDate = fmtDay(d.sameWeekdayLastWeek.day, locale, { weekday: true });
  const arrow = (delta: SalesDeltaDTO) => (
    <>
      <span className="sr-only">{(delta.diff ?? 0) > 0 ? ts('delta.up') : ts('delta.down')} </span>
      <span aria-hidden>{(delta.diff ?? 0) > 0 ? '▲' : '▼'} </span>
    </>
  );
  const o = d.comparison.orders;
  const c = d.comparison.chargedCents;

  let comparison: React.ReactNode;
  if (d.sameWeekdayLastWeek.orders === 0) comparison = t('noReference', { date: refDate });
  else if (o.diff === 0) comparison = t('same', { date: refDate });
  else if (o.diff === null) comparison = null;
  else
    comparison = (
      <>
        {arrow(o)}
        {signOf(o.diff)}
        {ts('delta.orders', { diff: Math.abs(o.diff) })}
        {o.pct !== null && (
          <span className="hidden sm:inline">
            {' '}
            ({signOf(o.pct)}
            {Math.abs(o.pct)} %)
          </span>
        )}
        {c.diff !== null && c.diff !== 0 && (
          <>
            {' · '}
            {arrow(c)}
            {signedMoney(c.diff, locale)}
          </>
        )}
      </>
    );

  return (
    <div data-testid="sales-today-card">
      <StatCard
        label={t('title')}
        value={<span data-testid="sales-today-orders">{t('orders', { count: d.today.orders })}</span>}
        sub={
          <span className="flex flex-col gap-0.5">
            <span>{t('charged', { amount: formatMoneyCents(d.today.chargedCents, locale) })}</span>
            <span>{t('today', { date: fmtDay(d.today.day, locale, { weekday: true }) })}</span>
            <span>
              {t('reference', {
                date: capitalize(refDate),
                orders: d.sameWeekdayLastWeek.orders,
                amount: formatMoneyCents(d.sameWeekdayLastWeek.chargedCents, locale),
              })}
            </span>
            {comparison !== null && <span data-testid="sales-today-delta">{comparison}</span>}
            <Link href="/admin/m9?tab=ventas&preset=today" className={`self-start ${LINK_CLASS}`} data-testid="sales-today-link">
              {t('link')}
            </Link>
          </span>
        }
      />
    </div>
  );
}
