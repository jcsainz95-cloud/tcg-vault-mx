'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  DollarSign,
  ShoppingBag,
  ListTodo,
  Boxes,
  Lock,
  Repeat2,
  Activity,
  Rocket,
} from 'lucide-react';
import { getDashboard } from '@/lib/api';
import { useRole } from '@/lib/role';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

export function AdminDashboard() {
  const t = useTranslations('admin.dashboard');
  const tm = useTranslations('admin');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tm('modules.dashboard')}</h1>
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        }
      >
        {query.data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t('profit')}
              value={formatMoneyCents(query.data.profitPeriodCents ?? 0, locale)}
              icon={<DollarSign size={18} />}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('sales')}
              value={query.data.salesPeriod.count}
              sub={formatMoneyCents(query.data.salesPeriod.amountCents, locale)}
              icon={<ShoppingBag size={18} />}
            />
            <StatCard
              label={t('workQueue')}
              value={
                query.data.workQueue.shipments +
                query.data.workQueue.buylist +
                query.data.workQueue.disputes
              }
              sub={
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{t('shipments')}: {query.data.workQueue.shipments}</span>
                  <span>Buylist: {query.data.workQueue.buylist}</span>
                  <span>{t('disputes')}: {query.data.workQueue.disputes}</span>
                  <span>{t('pendingPrices')}: {query.data.workQueue.pendingPrices}</span>
                </div>
              }
              icon={<ListTodo size={18} />}
            />
            <StatCard
              label={t('inventoryValue')}
              value={formatMoneyCents(query.data.inventoryValueCents ?? 0, locale)}
              icon={<Boxes size={18} />}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('custodyValue')}
              value={formatMoneyCents(query.data.custodyValueCents ?? 0, locale)}
              icon={<Lock size={18} />}
              masked={!isSuperAdmin}
              maskedLabel={tm('masked')}
            />
            <StatCard
              label={t('buylist')}
              value={query.data.buylistPeriod.count}
              sub={formatMoneyCents(query.data.buylistPeriod.amountCents, locale)}
              icon={<Repeat2 size={18} />}
            />
            <StatCard
              label={t('dataHealth')}
              value={query.data.dataHealth.pendingPriceCount}
              sub={
                <div className="flex flex-col">
                  <span>{t('pendingPrices')}</span>
                  <span>
                    {t('lastSync')}: {formatDate(query.data.dataHealth.lastPriceSyncAt, locale)}
                  </span>
                  <span>
                    {t('lastFx')}: {formatDate(query.data.dataHealth.lastFxAt, locale)}
                  </span>
                </div>
              }
              icon={<Activity size={18} />}
            />
            <StatCard
              label={t('launch')}
              value={query.data.launchProgress.salesSettled}
              sub={
                <div className="flex flex-col">
                  <span>{t('goalPending')}</span>
                  <span>
                    {t('users')}: {query.data.launchProgress.users} · {t('buylistPaid')}:{' '}
                    {query.data.launchProgress.buylistPaid}
                  </span>
                  <span>
                    {t('withdrawals')}: {query.data.launchProgress.withdrawalsNoDispute}
                  </span>
                </div>
              }
              icon={<Rocket size={18} />}
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}
