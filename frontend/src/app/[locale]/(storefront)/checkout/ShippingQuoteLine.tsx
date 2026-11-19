'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPublicShippingRule } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import type { ShippingQuoteState } from './use-shipping-quote';
import { PUBLIC_SHIPPING_RULE_KEY } from '../_shared/ShippingFeeHint';

/** La cotización en vivo mide p95 ≈ 6 s (DECISIONES §ENV3.4): a partir de aquí se dice que sigue trabajando. */
export const SLOW_QUOTE_MS = 4000;

/**
 * §ENV3 — la línea de envío del checkout de invitado: pide el CP, espera (con aviso), muestra el importe del servidor
 * y el umbral de gratis, o el error con «Reintentar». ⛔ Ningún importe se calcula aquí.
 */
export function ShippingQuoteLine({ state, className }: { state: ShippingQuoteState; className?: string }) {
  const t = useTranslations('checkout.shippingQuote');
  const locale = useLocale() as AppLocale;
  const rule = useQuery({ queryKey: PUBLIC_SHIPPING_RULE_KEY, queryFn: getPublicShippingRule, staleTime: 300_000 });
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state.status !== 'waiting') {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), SLOW_QUOTE_MS);
    return () => clearTimeout(id);
  }, [state.status]);
  const freeFrom = rule.data ? formatMoneyCents(rule.data.freeFromCents, locale) : null;
  const q = state.quote;

  let body: React.ReactNode;
  if (state.status === 'idle') {
    body = <p className="text-muted">{t('prompt')}</p>;
  } else if (state.status === 'waiting') {
    body = (
      <p className="text-muted" data-testid="shipping-quote-waiting">
        {slow ? t('waitingSlow') : t('waiting')}
      </p>
    );
  } else if (state.status === 'error') {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-accent">{t('error')}</p>
        <Button type="button" variant="secondary" onClick={state.retry}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (q) {
    body = (
      <p className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span>{t('line', { days: q.etaDays })}</span>
        <span className="font-mono" data-testid="shipping-quote-amount">
          {q.shippingFeeCents === 0 ? t('free') : formatMoneyCents(q.shippingFeeCents, locale)}
        </span>
      </p>
    );
  }
  return (
    <div
      data-testid="shipping-quote-line"
      aria-live="polite"
      aria-busy={state.status === 'waiting'}
      className={cn('border-b border-border pb-3 text-sm', className)}
    >
      {body}
      {freeFrom && <p className="mt-1 font-mono text-[11px] text-muted">{t('freeFrom', { freeFrom })}</p>}
    </div>
  );
}
