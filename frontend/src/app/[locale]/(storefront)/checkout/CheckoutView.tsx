'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCheckoutQuote } from '@/lib/api';
import { useCart } from '@/lib/cart';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

/**
 * 6e — Los renglones del carrito a la izquierda y el desglose a la derecha, en el
 * orden del contrato: subtotal, IVA, costo de procesamiento, total. Los tres avisos
 * legales van como notas al margen con regla —bermellón el que compromete (ventas
 * finales), fina los informativos— en vez de tres cajas de color apiladas.
 */
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
      <div className="gutter py-14">
        <EmptyState
          title={t('empty')}
          action={
            <Link
              href="/catalog"
              className="inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
            >
              {tn('catalog')}
            </Link>
          }
        />
      </div>
    );
  }

  if (paid) {
    return (
      <div className="gutter max-w-2xl py-16">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('paidTitle')}</h1>
        <p className="rule-note mt-6 text-[15px] leading-[1.7] text-muted">{t('paidBody')}</p>
        <Link
          href="/vault"
          className="mt-8 inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
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
    <div>
      <div className="gutter pb-6 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data && (
          <div className="grid border-t border-border lg:grid-cols-[1fr_420px]">
            <div className="gutter border-b border-border pb-14 pt-4 lg:border-b-0 lg:border-r">
              {query.data.items.map((item) => (
                <div
                  key={item.inventoryItemId}
                  className="flex items-center gap-5 border-b border-border py-4"
                >
                  <div className="w-14 shrink-0">
                    <CardImage src={item.card.imageSmallUrl} alt={item.card.name} className="p-1" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-[17px] font-medium leading-tight text-text" lang="en">
                      {item.card.name}
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted" lang="en">
                      {item.card.setName} · #{item.card.number}
                    </p>
                  </div>
                  <span className="tabular text-[17px] font-medium text-text">
                    {formatMoneyCents(item.unitPriceCents, locale)}
                  </span>
                  <button
                    type="button"
                    aria-label={t('removeItem')}
                    onClick={() => cart.remove(item.inventoryItemId)}
                    className="shrink-0 pl-3 font-mono text-[11px] text-muted hover:text-accent"
                  >
                    {t('removeItem')}
                  </button>
                </div>
              ))}

              {/* Los tres avisos del contrato, como notas al margen. */}
              <p className="rule-note mt-8 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                <span className="font-medium text-text">{t('finalSaleNotice')}</span>{' '}
                <Link href="/terminos" className="text-accent hover:text-text">
                  {t('viewTerms')}
                </Link>
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('cfdiNotice')}
              </p>
              <p className="rule-note-quiet mt-5 max-w-[620px] text-[13px] leading-[1.7] text-muted">
                {t('afterPayment')}
              </p>
            </div>

            <aside className="gutter h-fit pb-14 pt-8 lg:px-10">
              <h2 className="eyebrow">{t('summary')}</h2>
              <div className="mt-5">
                <AmountBreakdown breakdown={query.data.breakdown} variant="purchase" />
              </div>
              <Button variant="accent" loading={paying} onClick={pay} className="mt-7 w-full">
                {paying
                  ? t('paying')
                  : t('pay', { amount: formatMoneyCents(query.data.breakdown.totalCents, locale) })}
              </Button>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
            </aside>
          </div>
        )}
      </QueryState>
    </div>
  );
}
