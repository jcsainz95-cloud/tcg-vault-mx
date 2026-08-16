'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PriceInfo } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface PriceTagProps {
  /** valor de referencia de mercado (PriceInfo del contrato) */
  reference: PriceInfo;
  /** precio de venta = referencia + markup (u override). Solo storefront. */
  salePriceCents?: number;
  /** 'sale' resalta el precio de venta; 'reference' resalta el valor de mercado */
  mode?: 'sale' | 'reference';
  /** 'lg' para la ficha de detalle; 'md' para retículas y renglones */
  size?: 'md' | 'lg';
}

/**
 * PriceTag (DESIGN_SYSTEM §7.3): distingue valor de mercado (referencia) del
 * precio de venta. Estado "precio pendiente" explícito, nunca $0.
 *
 * Dirección 5a: la cifra manda —Archivo, tabular, sin decorar— y la letra chica
 * baja a mono. El pendiente es la única excepción que conserva una caja, con
 * regla bermellón, porque debe frenar la lectura.
 */
export function PriceTag({ reference, salePriceCents, mode = 'sale', size = 'md' }: PriceTagProps) {
  const locale = useLocale() as AppLocale;
  const t = useTranslations();
  const amountClass = cn(
    'tabular font-medium leading-none text-text',
    size === 'lg' ? 'text-3xl' : 'text-lg',
  );

  if (reference.status === 'pending' && salePriceCents == null) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <span className="border border-accent px-2.5 py-1.5 font-mono text-[11px] uppercase leading-none tracking-[0.06em] text-accent">
          {t('price.pendingLabel')}
        </span>
        <span className="font-mono text-[11px] leading-relaxed text-muted">{t('price.pendingHint')}</span>
      </div>
    );
  }

  // Solo el modo `reference` fecha la referencia; en venta el diseño cierra en
  // dos renglones y la fecha vive en la ficha de detalle.
  const captured = reference.capturedDate ? formatDate(reference.capturedDate, locale) : null;

  if (mode === 'reference' || salePriceCents == null) {
    return (
      <div className="flex flex-col gap-2">
        <span className={amountClass}>
          {reference.referenceMxnCents != null
            ? formatMoneyCents(reference.referenceMxnCents, locale)
            : '—'}
        </span>
        <span className="font-mono text-[11px] leading-relaxed text-muted">
          {t('catalog.marketValue')}
          {captured ? ` · ${t('price.capturedOn', { date: captured })}` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={amountClass}>{formatMoneyCents(salePriceCents, locale)}</span>
      <span className="font-mono text-[11px] leading-relaxed text-muted">
        {t('common.withoutIva')}
        {reference.referenceMxnCents != null
          ? ` · ${t('catalog.marketValue')} ${formatMoneyCents(reference.referenceMxnCents, locale)}`
          : ''}
      </span>
    </div>
  );
}
