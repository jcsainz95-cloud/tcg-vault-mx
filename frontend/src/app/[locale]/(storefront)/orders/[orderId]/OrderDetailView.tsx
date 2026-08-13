'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getOrder } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';

export function OrderDetailView({ orderId }: { orderId: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('checkout');
  const locale = useLocale() as AppLocale;
  const [requested, setRequested] = useState(false);
  const query = useQuery({ queryKey: ['order', orderId], queryFn: () => getOrder(orderId) });

  return (
    <div className="flex flex-col gap-6">
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-h1 font-bold">{t('orderNumber', { id: query.data.id })}</h1>
              <StatusBadge domain="order" value={query.data.status} />
            </div>
            <p className="text-sm text-muted">
              {t('date')}: {formatDate(query.data.createdAt, locale)}
            </p>

            <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
              <div className="flex flex-col gap-3">
                <h2 className="text-h3 font-semibold">{t('items')}</h2>
                {query.data.items.map((it) => (
                  <div
                    key={it.inventoryItemId}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                  >
                    <div className="w-12 shrink-0">
                      <CardImage src={it.card.imageSmallUrl} alt={it.card.name} />
                    </div>
                    <span className="flex-1 text-sm font-medium" lang="en">
                      {it.card.name}
                    </span>
                    <span className="tabular text-sm">{formatMoneyCents(it.unitPriceCents, locale)}</span>
                  </div>
                ))}
              </div>

              <aside className="flex h-fit flex-col gap-4 rounded-lg border border-border bg-surface p-5">
                <AmountBreakdown breakdown={query.data.breakdown} variant="purchase" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{t('cfdiStatusLabel')}</span>
                  <Badge tone="info">{query.data.cfdiStatus}</Badge>
                </div>
                {requested || query.data.invoiceRequested ? (
                  <Banner variant="success">{tc('cfdiNotice')}</Banner>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => setRequested(true)}>
                      {t('requestInvoice')}
                    </Button>
                    <p className="text-xs text-muted">{tc('cfdiNotice')}</p>
                  </>
                )}
              </aside>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
