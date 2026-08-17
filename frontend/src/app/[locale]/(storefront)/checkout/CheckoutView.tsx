'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { createCheckoutSession, getCheckoutQuote } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { config } from '@/lib/config';
import { useCart } from '@/lib/cart';
import type { AppLocale } from '@/i18n/routing';
import type { CheckoutSessionResponse } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';

/**
 * 6e — Los renglones del carrito a la izquierda y el desglose a la derecha, en el
 * orden del contrato: subtotal, IVA, costo de procesamiento, total. Los tres avisos
 * legales van como notas al margen con regla —bermellón el que compromete (ventas
 * finales), fina los informativos— en vez de tres cajas de color apiladas.
 *
 * WS-F · F1 — El pago pasa de un stub a Stripe REAL: `pay()` crea la sesión de checkout
 * (`POST /checkout/session`) y abre el `StripePaymentModal` con el `clientSecret`. El pago se
 * asienta por webhook (`payment_intent.succeeded`), así que tras confirmar mostramos
 * "procesando" y limpiamos el carrito. Un `403 EMAIL_NOT_VERIFIED` muestra el banner de
 * verificación (reusa el patrón existente).
 */
export function CheckoutView() {
  const t = useTranslations('checkout');
  const tn = useTranslations('nav');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const cart = useCart();
  const [paid, setPaid] = useState(false);
  const [creating, setCreating] = useState(false);
  const [session, setSession] = useState<CheckoutSessionResponse | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

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
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('processingTitle')}</h1>
        <p className="rule-note mt-6 text-[15px] leading-[1.7] text-muted">{t('processingBody')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/orders"
            className="inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
          >
            {tn('orders')}
          </Link>
          <Link
            href="/vault"
            className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
          >
            {tn('vault')}
          </Link>
        </div>
      </div>
    );
  }

  async function pay() {
    setCreating(true);
    setPayError(null);
    setEmailNotVerified(false);
    try {
      const res = await createCheckoutSession(cart.ids);
      setSession(res);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'EMAIL_NOT_VERIFIED') {
        setEmailNotVerified(true);
      } else {
        setPayError(getMessage(e));
      }
    } finally {
      setCreating(false);
    }
  }

  function onConfirmed() {
    // El pago quedó autorizado; el backend lo asienta por webhook. Limpiamos el carrito y
    // mostramos "procesando" (la titularidad pasa a settled cuando el webhook liquida).
    setSession(null);
    cart.clear();
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

              {emailNotVerified && (
                <div className="mt-6">
                  <EmailNotVerifiedNotice />
                </div>
              )}
              {payError && (
                <p role="alert" className="mt-6 font-mono text-xs text-accent">
                  {payError}
                </p>
              )}

              <Button variant="accent" loading={creating} onClick={pay} className="mt-7 w-full">
                {creating
                  ? t('preparing')
                  : t('pay', { amount: formatMoneyCents(query.data.breakdown.totalCents, locale) })}
              </Button>
              {config.useMocks && (
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted">{t('stripeMock')}</p>
              )}
            </aside>
          </div>
        )}
      </QueryState>

      <StripePaymentModal
        open={!!session}
        onClose={() => setSession(null)}
        clientSecret={session?.stripe.clientSecret ?? null}
        returnUrl={`${typeof window !== 'undefined' ? window.location.origin : ''}/${locale}/orders`}
        title={t('payTitle')}
        amountLabel={
          query.data ? formatMoneyCents(query.data.breakdown.totalCents, locale) : undefined
        }
        onConfirmed={onConfirmed}
      />
    </div>
  );
}
