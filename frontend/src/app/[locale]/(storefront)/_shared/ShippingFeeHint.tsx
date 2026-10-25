'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPublicShippingRule } from '@/lib/api';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

/** `GET /checkout/shipping-rule` es `public` con `max-age=300` (§4-G.12 punto 5): misma vida en la caché del cliente. */
export const PUBLIC_SHIPPING_RULE_KEY = ['public-shipping-rule'] as const;

export interface ShippingFeeHintProps {
  /** `cards` = carta suelta o gradeada (T1a) · `sealed` = sellado (T1b). D-ENV-2: la gradeada viaja como carta. */
  kind: 'cards' | 'sealed';
  className?: string;
}

/**
 * T1a / T1b (DESIGN_SYSTEM §CHK-MOVIL.4, fricción 1a): bajo el precio de la ficha, **fuera** del `PriceTag`
 * (§7.3), mono 11 px muted. El importe del envío sale del endpoint público (diales vivos, IVA dentro); la
 * comisión se nombra SIN importe (no se calcula fuera del carrito: gross-up no invertible, §4-G.1).
 * ⛔ Ningún importe escrito a mano: cargando o con error no se pinta nada (lo cobrado lo decide `session`).
 */
export function ShippingFeeHint({ kind, className }: ShippingFeeHintProps) {
  const t = useTranslations('checkout.feeHint');
  const locale = useLocale() as AppLocale;
  const rule = useQuery({
    queryKey: PUBLIC_SHIPPING_RULE_KEY,
    queryFn: getPublicShippingRule,
    staleTime: 300_000,
  });
  if (!rule.data) return null;
  // Umbral para CUALQUIER pedido (dueño 2026-10-25, `HECHOS.md` «Envío gratis desde MX$4,000 para CUALQUIER pedido»):
  // T1a y T1b llevan los dos el `freeFrom` del endpoint.
  const freeFrom = formatMoneyCents(rule.data.freeFromCents, locale);
  const text =
    kind === 'cards'
      ? t('cardsOnly', { shipping: formatMoneyCents(rule.data.cardsOnlyFeeCents, locale), freeFrom })
      : t('sealed', { shipping: formatMoneyCents(rule.data.sealedFeeCents, locale), freeFrom });
  return (
    <p data-testid="shipping-fee-hint" className={cn('font-mono text-[11px] leading-[1.5] text-muted', className)}>
      {text}
    </p>
  );
}

/**
 * T8 en la ficha (§CHK-MOVIL.4): «Todas las ventas son finales.» y, en la misma línea, la promesa de reembolso
 * que ya sostiene la política (`checkout.finalSaleNotice`: «…salvo carta dañada o equivocada»). Mono 11 px, sin icono.
 */
export function FinalSaleLine({ className }: { className?: string }) {
  const t = useTranslations('checkout');
  return (
    <p data-testid="final-sale-line" className={cn('font-mono text-[11px] leading-[1.5] text-muted', className)}>
      {t('finalSaleShort')} {t('refundPromise')}
    </p>
  );
}
