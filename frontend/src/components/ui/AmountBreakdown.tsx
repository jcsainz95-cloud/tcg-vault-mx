'use client';

import { useLocale, useTranslations } from 'next-intl';
import { HelpCircle } from 'lucide-react';
import type { BreakdownDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';

export interface AmountBreakdownProps {
  breakdown: BreakdownDTO;
  /** en retiros, subtotalCents = tarifa de envío (contrato §5) */
  variant?: 'purchase' | 'shipment';
}

function Line({
  label,
  amount,
  hint,
  bold,
  locale,
}: {
  label: string;
  amount: number;
  hint?: string;
  bold?: boolean;
  locale: AppLocale;
}) {
  return (
    <div
      className={
        bold
          ? 'flex items-center justify-between border-t border-border pt-3 text-lg font-bold text-text'
          : 'flex items-center justify-between text-sm text-text'
      }
    >
      <span className="flex items-center gap-1">
        {label}
        {hint && (
          <span title={hint} className="text-muted" aria-label={hint}>
            <HelpCircle size={14} />
          </span>
        )}
      </span>
      <span className="tabular">{formatMoneyCents(amount, locale)}</span>
    </div>
  );
}

/**
 * AmountBreakdown (DESIGN_SYSTEM §7.12): subtotal + fee de procesamiento
 * (gross-up, sin IVA) + IVA desglosado + total. El total nunca sin su desglose.
 */
export function AmountBreakdown({ breakdown, variant = 'purchase' }: AmountBreakdownProps) {
  const t = useTranslations('checkout');
  const locale = useLocale() as AppLocale;

  return (
    <div className="flex flex-col gap-3" data-testid="amount-breakdown">
      <Line
        label={variant === 'shipment' ? t('shipping') : t('subtotal')}
        amount={breakdown.subtotalCents}
        hint={variant === 'shipment' ? undefined : t('subtotalHint')}
        locale={locale}
      />
      <Line
        label={t('iva', { rate: breakdown.ivaRatePct })}
        amount={breakdown.ivaCents}
        hint={t('ivaHint')}
        locale={locale}
      />
      <Line
        label={t('processingFee')}
        amount={breakdown.processingFeeCents}
        hint={t('processingFeeHint')}
        locale={locale}
      />
      <Line label={t('total')} amount={breakdown.totalCents} bold locale={locale} />
    </div>
  );
}
