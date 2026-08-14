'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Info, ShieldQuestion } from 'lucide-react';
import { getBuylistQuote, getSellRequests } from '@/lib/api';
import type { ProductType } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { mockCards } from '@/lib/mock/fixtures';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { SafeShippingGuide } from '@/components/domain/SafeShippingGuide';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { useBuylistSteps } from '@/lib/pipelines';

const PRODUCT_TYPES: ProductType[] = ['raw', 'graded', 'sealed'];

export function BuylistView() {
  const t = useTranslations('buylist');
  const tcat = useTranslations('buylist.categoryLabel');
  const locale = useLocale() as AppLocale;
  const buylistSteps = useBuylistSteps();

  const [cardId, setCardId] = useState(mockCards[0].id);
  const [productType, setProductType] = useState<ProductType>('raw');
  const [guideOpen, setGuideOpen] = useState(false);

  const quote = useMutation({
    // Condición de compra SIEMPRE NM (v1.1): raw se envía con rawCondition='NM', sin selector.
    mutationFn: () =>
      getBuylistQuote({ cardId, productType, rawCondition: productType === 'raw' ? 'NM' : undefined }),
  });

  const requests = useQuery({ queryKey: ['sell-requests'], queryFn: getSellRequests });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="mt-1 text-muted">{t('subtitle')}</p>
      </div>

      {/* Banner persistente PAY_AFTER_RECEIPT (PROJECT AC 33, DESIGN §7.5) */}
      <Banner variant="trust" title={t('quoterTitle')}>
        {t('payAfterReceipt')}
      </Banner>

      {/* Política NM-only prominente (PROJECT §E/H, AC 3d) */}
      <Banner variant="warning" title={t('nmOnlyTitle')}>
        {t('nmOnlyBody')}
      </Banner>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-h3 font-semibold">{t('quoterTitle')}</h2>
          <Select
            label={t('selectCard')}
            options={mockCards.map((c) => ({ value: c.id, label: `${c.name} · ${c.setName}` }))}
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
          />
          <Select
            label={t('selectType')}
            options={PRODUCT_TYPES.map((p) => ({ value: p, label: p }))}
            value={productType}
            onChange={(e) => setProductType(e.target.value as ProductType)}
          />
          {productType === 'raw' && (
            // Sin selector de condición: NM fijo (único grado que compramos).
            <p className="rounded-md bg-success-bg px-3 py-2 text-sm text-success">
              {t('conditionFixedNm')}
            </p>
          )}
          <Button onClick={() => quote.mutate()} loading={quote.isPending}>
            {quote.isPending ? t('quoting') : t('getQuote')}
          </Button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className="inline-flex items-center gap-2 self-start text-sm font-medium text-primary hover:underline"
          >
            <ShieldQuestion size={16} /> {t('shippingGuideLink')}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {quote.data && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
              <h3 className="text-h3 font-semibold">{t('quoteResult')}</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{t('category')}</span>
                <span className="font-medium">{tcat(quote.data.category)}</span>
              </div>
              {quote.data.quote.status === 'precio_pendiente' ? (
                <Banner variant="warning">{t('pricePendingNotice')}</Banner>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-muted">{t('quotedPrice')}</span>
                  <span className="tabular text-lg font-semibold text-success">
                    {formatMoneyCents(quote.data.quote.quotedPriceCents ?? 0, locale)}
                  </span>
                </div>
              )}
              {quote.data.referencePrice.status === 'priced' && (
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{t('referencePrice')}</span>
                  <span className="tabular">
                    {formatMoneyCents(quote.data.referencePrice.priceMxnCents ?? 0, locale)}
                  </span>
                </div>
              )}
              <Banner variant="info">{t('kycNotice')}</Banner>
              <Button variant="accent" disabled={quote.data.quote.status === 'precio_pendiente'}>
                {t('createRequest')}
              </Button>
            </div>
          )}
          <Banner variant="info" title="">
            <span className="flex items-center gap-2">
              <Info size={16} /> {t('payAfterReceipt')}
            </span>
          </Banner>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-h2 font-semibold">{t('myRequests')}</h2>
        <QueryState
          isLoading={requests.isLoading}
          isError={requests.isError}
          error={requests.error}
          onRetry={() => requests.refetch()}
        >
          {(requests.data?.length ?? 0) === 0 ? (
            <EmptyState title={t('noRequests')} />
          ) : (
            requests.data!.map((r) => (
              <div key={r.sellRequestId} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="tabular text-sm font-medium">{r.sellRequestId}</span>
                    <StatusBadge domain="sellRequest" value={r.status} />
                  </div>
                  <span className="tabular text-sm text-muted">
                    {formatMoneyCents(r.quotedTotalCents, locale)}
                  </span>
                </div>
                <PipelineStepper
                  steps={buylistSteps}
                  current={r.status}
                  errored={r.status === 'rechazada' || r.status === 'abandonada'}
                />
                <div className="flex flex-col gap-1.5">
                  {r.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-sm">
                      <span lang="en">{it.card.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="tabular text-muted">
                          {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                        </span>
                        <StatusBadge domain="sellItem" value={it.itemStatus} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </QueryState>
      </section>

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title={t('shippingGuideLink')}>
        <SafeShippingGuide onUnderstood={() => setGuideOpen(false)} />
      </Modal>
    </div>
  );
}
