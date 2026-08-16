'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getDashboard } from '@/lib/api';
import { useRole } from '@/lib/role';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * 6i — Las tarjetas de métricas se vuelven una retícula de celdas con regla: más
 * datos por pantalla y ninguna caja redondeada. La regla la pone la retícula
 * (`divide-*`), no la celda, para que no se dupliquen los filetes. Fuera los
 * iconos: cada métrica ya se identifica por su etiqueta.
 */
export function AdminDashboard() {
  const t = useTranslations('admin.dashboard');
  const tm = useTranslations('admin');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });

  // -mx-* rompe el margen del shell: las reglas de la retícula llegan a los bordes.
  const grid =
    'grid -mx-5 lg:-mx-10 border-y border-border divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4 [&>*:nth-child(n+5)]:sm:border-t';

  return (
    <div>
      <div className="pb-6">
        <h1 className="font-serif text-[26px] leading-[1.1] text-text lg:text-[36px]">
          {tm('modules.dashboard')}
        </h1>
      </div>
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={
          <div className={grid}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-6 py-7 sm:px-10">
                <Skeleton className="h-16" />
              </div>
            ))}
          </div>
        }
      >
        {query.data && (
          <div className={grid}>
            <StatCard
              label={t('profit')}
              value={formatMoneyCents(query.data.profitPeriodCents ?? 0, locale)}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('sales')}
              value={query.data.salesPeriod.count}
              sub={formatMoneyCents(query.data.salesPeriod.amountCents, locale)}
            />
            <StatCard
              label={t('workQueue')}
              value={
                query.data.workQueue.shipments +
                query.data.workQueue.buylist +
                query.data.workQueue.disputes
              }
              sub={
                <>
                  {t('shipments')} {query.data.workQueue.shipments} · Buylist{' '}
                  {query.data.workQueue.buylist} · {t('disputes')} {query.data.workQueue.disputes} ·{' '}
                  {t('pendingPrices')} {query.data.workQueue.pendingPrices}
                </>
              }
            />
            <StatCard
              label={t('inventoryValue')}
              value={formatMoneyCents(query.data.inventoryValueCents ?? 0, locale)}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('custodyValue')}
              value={formatMoneyCents(query.data.custodyValueCents ?? 0, locale)}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('buylist')}
              value={query.data.buylistPeriod.count}
              sub={formatMoneyCents(query.data.buylistPeriod.amountCents, locale)}
            />
            <StatCard
              label={t('dataHealth')}
              // La única cifra en bermellón del tablero: lo que exige intervención.
              className="[&_span.tabular]:text-accent"
              value={query.data.dataHealth.pendingPriceCount}
              sub={
                <>
                  {t('pendingPrices')}
                  <br />
                  {t('lastSync')} {formatDate(query.data.dataHealth.lastPriceSyncAt, locale)} ·{' '}
                  {t('lastFx')} {formatDate(query.data.dataHealth.lastFxAt, locale)}
                </>
              }
            />
            <StatCard
              label={t('launch')}
              value={query.data.launchProgress.salesSettled}
              sub={
                <>
                  {t('goalPending')}
                  <br />
                  {t('users')} {query.data.launchProgress.users} · {t('buylistPaid')}{' '}
                  {query.data.launchProgress.buylistPaid} · {t('withdrawals')}{' '}
                  {query.data.launchProgress.withdrawalsNoDispute}
                </>
              }
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}
