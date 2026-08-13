'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { getCheckoutQuote } from '@/lib/api';
import { useCart } from '@/lib/cart';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

export function CheckoutView() {
  const t = useTranslations('checkout');
  const tn = useTranslations('nav');
  const locale = useLocale() as AppLocale;
  const cart = useCart();
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);

  const query = useQuery({
    queryKey: ['checkout-quote', cart.ids],
    queryFn: () => getCheckoutQuote(cart.ids),
    enabled: cart.ids.length > 0,
  });

  if (cart.ids.length === 0 && !paid) {
    return (
      <EmptyState
        title={t('empty')}
        action={
          <Link
            href="/catalog"
            className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            {tn('catalog')}
          </Link>
        }
      />
    );
  }

  if (paid) {
    return (
      <div className="mx-auto max-w-lg">
        <Banner variant="success" title={t('paidTitle')}>
          {t('paidBody')}
        </Banner>
        <Link
          href="/vault"
          className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          {tn('vault')}
        </Link>
      </div>
    );
  }

  async function pay() {
    // MOCK: pendiente integración Stripe (contrato §4 /checkout/session + Elements).
    setPaying(true);
    await new Promise((r) => setTimeout(r, 900));
    cart.clear();
    setPaying(false);
    setPaid(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
            <div className="flex flex-col gap-3">
              {query.data.items.map((item) => (
                <div
                  key={item.inventoryItemId}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="w-14 shrink-0">
                    <CardImage src={item.card.imageSmallUrl} alt={item.card.name} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" lang="en">
                      {item.card.name}
                    </p>
                    <p className="text-xs text-muted" lang="en">
                      {item.card.setName} · #{item.card.number}
                    </p>
                  </div>
                  <span className="tabular text-sm font-medium">
                    {formatMoneyCents(item.unitPriceCents, locale)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => cart.remove(item.inventoryItemId)}
                    className="rounded-md p-2 text-muted hover:bg-surface-2"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <aside className="flex h-fit flex-col gap-4 rounded-lg border border-border bg-surface p-5">
              <h2 className="text-h3 font-semibold">{t('summary')}</h2>
              <AmountBreakdown breakdown={query.data.breakdown} variant="purchase" />
              <Banner variant="info">{t('cfdiNotice')}</Banner>
              <Banner variant="trust">{t('afterPayment')}</Banner>
              <Button variant="accent" loading={paying} onClick={pay} className="w-full">
                {paying
                  ? t('paying')
                  : t('pay', { amount: formatMoneyCents(query.data.breakdown.totalCents, locale) })}
              </Button>
              <p className="text-xs text-subtle">{t('stripeMock')}</p>
            </aside>
          </div>
        )}
      </QueryState>
    </div>
  );
}
