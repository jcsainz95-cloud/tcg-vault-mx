'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getOrders } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import type { OrderSummaryDTO } from '@/types/contract';

export function OrdersView() {
  const t = useTranslations('orders');
  const locale = useLocale() as AppLocale;
  const query = useQuery({ queryKey: ['orders'], queryFn: getOrders });

  const columns: Column<OrderSummaryDTO>[] = [
    {
      key: 'id',
      header: t('orderNumber', { id: '' }).trim(),
      render: (o) => (
        <Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline tabular">
          {o.id}
        </Link>
      ),
    },
    { key: 'date', header: t('date'), render: (o) => formatDate(o.createdAt, locale) },
    { key: 'status', header: t('status'), render: (o) => <StatusBadge domain="order" value={o.status} /> },
    {
      key: 'total',
      header: t('total'),
      numeric: true,
      render: (o) => formatMoneyCents(o.totalCents, locale),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {(query.data?.data.length ?? 0) === 0 ? (
          <EmptyState title={t('noOrders')} />
        ) : (
          <DataTable columns={columns} rows={query.data!.data} rowKey={(o) => o.id} />
        )}
      </QueryState>
    </div>
  );
}
