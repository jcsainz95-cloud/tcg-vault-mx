'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import type { PriceInfo } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Badge } from './Badge';

export interface PriceTagProps {
  /** valor de referencia de mercado (PriceInfo del contrato) */
  reference: PriceInfo;
  /** precio de venta = referencia + markup (u override). Solo storefront. */
  salePriceCents?: number;
  /** 'sale' resalta el precio de venta; 'reference' resalta el valor de mercado */
  mode?: 'sale' | 'reference';
}

/**
 * PriceTag (DESIGN_SYSTEM §7.3): distingue valor de mercado (referencia) del
 * precio de venta. Estado "precio pendiente" explícito, nunca $0.
 */
export function PriceTag({ reference, salePriceCents, mode = 'sale' }: PriceTagProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations();

  if (reference.status === 'pending' && salePriceCents == null) {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="warning" shape="outline" icon={<Clock size={13} aria-hidden />}>
          {t('price.pendingLabel')}
        </Badge>
        <span className="text-xs text-muted">{t('price.pendingHint')}</span>
      </div>
    );
  }

  const captured = reference.capturedDate ? formatDate(reference.capturedDate, locale) : null;

  if (mode === 'reference' || salePriceCents == null) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="tabular text-lg font-semibold text-text">
          {reference.referenceMxnCents != null
            ? formatMoneyCents(reference.referenceMxnCents, locale)
            : '—'}
        </span>
        <span className="text-xs text-muted">
          {t('catalog.marketValue')}
          {captured ? ` · ${t('price.capturedOn', { date: captured })}` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="tabular text-lg font-semibold text-text">
        {formatMoneyCents(salePriceCents, locale)}
      </span>
      <span className="text-xs text-muted">
        {t('common.withoutIva')}
        {reference.referenceMxnCents != null
          ? ` · ${t('catalog.marketValue')} ${formatMoneyCents(reference.referenceMxnCents, locale)}`
          : ''}
      </span>
      {captured && (
        <span className="text-xs text-subtle">{t('price.capturedOn', { date: captured })}</span>
      )}
    </div>
  );
}
