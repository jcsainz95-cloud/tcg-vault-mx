'use client';

import { useLocale, useTranslations } from 'next-intl';
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
  locale,
}: {
  label: string;
  amount: number;
  hint?: string;
  locale: AppLocale;
}) {
  return (
    <div className="flex items-center justify-between py-3 text-sm text-text">
      {hint ? (
        // Sin icono de ayuda: la explicación cuelga del propio concepto, marcada
        // con subrayado punteado (el diseño no admite iconos decorativos).
        <span
          title={hint}
          aria-label={`${label}. ${hint}`}
          className="cursor-help underline decoration-dotted underline-offset-4"
        >
          {label}
        </span>
      ) : (
        <span>{label}</span>
      )}
      <span className="tabular">{formatMoneyCents(amount, locale)}</span>
    </div>
  );
}

/**
 * AmountBreakdown (DESIGN_SYSTEM §7.12): subtotal + IVA desglosado + fee de
 * procesamiento + total, en el orden del contrato. El total nunca sin su desglose.
 *
 * Dirección 5a: los renglones se separan con aire, no con reglas, y solo el total
 * lleva regla encima; la cifra final es la pieza tipográfica más grande del bloque.
 */
export function AmountBreakdown({ breakdown, variant = 'purchase' }: AmountBreakdownProps) {
  const t = useTranslations('checkout');
  const locale = useLocale() as AppLocale;

  return (
    <div data-testid="amount-breakdown">
      <Line
        label={variant === 'shipment' ? t('shipping') : t('subtotal')}
        amount={breakdown.subtotalCents}
        hint={variant === 'shipment' ? undefined : t('subtotalHint')}
        locale={locale}
      />
      {/*
       * v1.21-guest-checkout (ADITIVO): un pedido `direct_ship` (invitado) cobra las cartas
       * y el envío en el MISMO PaymentIntent, así que el desglose trae `shippingFeeCents`
       * como LÍNEA APARTE (contrato §4-G / BreakdownDTO). En compras a bóveda y en retiros
       * el campo no viene y este renglón no se pinta: el desglose queda idéntico a v1.20.
       */}
      {breakdown.shippingFeeCents != null && (
        <Line label={t('shipping')} amount={breakdown.shippingFeeCents} locale={locale} />
      )}
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
      <div className="mt-2 flex items-baseline justify-between border-t border-border-strong pt-5">
        <span className="text-[15px] font-medium text-text">{t('total')}</span>
        <span className="tabular text-[28px] font-medium leading-none text-text">
          {formatMoneyCents(breakdown.totalCents, locale)}
        </span>
      </div>
    </div>
  );
}
