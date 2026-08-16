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
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';

/**
 * 6f (detalle) — Repite el desglose del pago y deja la factura como acción
 * secundaria al pie de la columna de importes. Los artículos son renglones con
 * regla, no tarjetas.
 */
export function OrderDetailView({ orderId }: { orderId: string }) {
  const t = useTranslations('orders');
  const tc = useTranslations('checkout');
  const locale = useLocale() as AppLocale;
  const [requested, setRequested] = useState(false);
  const query = useQuery({ queryKey: ['order', orderId], queryFn: () => getOrder(orderId) });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <div>
          <div className="gutter flex flex-wrap items-baseline justify-between gap-4 pb-5 pt-10 lg:pt-[46px]">
            <h1 className="font-serif text-[22px] leading-[1.15] text-text lg:text-[30px]">
              {t('orderNumber', { id: query.data.id })}
            </h1>
            <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
              <StatusBadge domain="order" value={query.data.status} />
              <span aria-hidden>·</span>
              {formatDate(query.data.createdAt, locale)}
            </span>
          </div>

          <div className="grid border-t border-border lg:grid-cols-[1fr_400px]">
            <div className="gutter border-b border-border pb-12 pt-6 lg:border-b-0 lg:border-r">
              <h2 className="eyebrow">{t('items')}</h2>
              <div className="mt-2.5">
                {query.data.items.map((it) => (
                  <div
                    key={it.inventoryItemId}
                    className="flex items-center gap-[18px] border-b border-border py-4 last:border-b-0"
                  >
                    <div className="w-11 shrink-0">
                      <CardImage src={it.card.imageSmallUrl} alt={it.card.name} className="p-1" />
                    </div>
                    <span className="flex-1 text-[15px] text-text" lang="en">
                      {it.card.name}
                    </span>
                    <span className="tabular text-[15px] text-text">
                      {formatMoneyCents(it.unitPriceCents, locale)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="gutter h-fit pb-12 pt-6 lg:px-10">
              <AmountBreakdown breakdown={query.data.breakdown} variant="purchase" />

              <div className="mt-7 flex items-center justify-between border-t border-border pt-4 text-[13px] text-muted">
                <span>{t('cfdiStatusLabel')}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-text">
                  {query.data.cfdiStatus}
                </span>
              </div>

              {requested || query.data.invoiceRequested ? (
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{tc('cfdiNotice')}</p>
              ) : (
                <>
                  <Button variant="secondary" className="mt-4 w-full" onClick={() => setRequested(true)}>
                    {t('requestInvoice')}
                  </Button>
                  <p className="mt-3.5 font-mono text-[11px] leading-relaxed text-muted">{tc('cfdiNotice')}</p>
                </>
              )}
            </aside>
          </div>
        </div>
      )}
    </QueryState>
  );
}
