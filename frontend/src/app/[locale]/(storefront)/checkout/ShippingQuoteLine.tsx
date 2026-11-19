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
export function ShippingQuoteLine({
  state,
  className,
  chargedCents,
}: {
  state: ShippingQuoteState;
  className?: string;
  /**
   * §ENV3 (umbral DESPUÉS del descuento, arquitecto 968dc182): `shipping-quote` no conoce el código. Si un descuento de
   * mercancía deja el subtotal bajo el umbral, el desglose del servidor trae el envío que SÍ se cobra: manda sobre la
   * cotización (nunca «Gratis» si se va a cobrar). Cifra del servidor, ⛔ sin cálculo propio.
   */
  chargedCents?: number;
}) {
  const t = useTranslations('checkout.shippingQuote');
  const locale = useLocale() as AppLocale;
  const rule = useQuery({ queryKey: PUBLIC_SHIPPING_RULE_KEY, queryFn: getPublicShippingRule, staleTime: 60_000, retryOnMount: false });
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
  const shown = q && chargedCents !== undefined ? chargedCents : q?.shippingFeeCents;

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
        <span>{t('line')}</span>
        <span className="font-mono" data-testid="shipping-quote-amount">
          {shown === 0 ? t('free') : formatMoneyCents(shown ?? 0, locale)}
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
