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

/**
 * 6f — La tabla pierde el fondo y se apoya solo en reglas y en la numeración
 * monoespaciada; el folio de la orden es el único elemento en bermellón, porque
 * es lo único accionable del renglón.
 */
export function OrdersView() {
  const t = useTranslations('orders');
  const locale = useLocale() as AppLocale;
  const query = useQuery({ queryKey: ['orders'], queryFn: getOrders });

  const columns: Column<OrderSummaryDTO>[] = [
    {
      key: 'id',
      header: t('orderNumber', { id: '' }).trim(),
      render: (o) => (
        <Link href={`/orders/${o.id}`} className="tabular font-mono text-accent hover:text-text">
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
    <div className="gutter pb-14">
      <h1 className="pb-6 pt-10 font-serif text-[30px] leading-[1.1] text-text lg:pt-[46px] lg:text-[40px]">
        {t('title')}
      </h1>
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
