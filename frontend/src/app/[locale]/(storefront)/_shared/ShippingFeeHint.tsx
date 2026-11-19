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
 * (§7.3), mono 11 px muted. §ENV3 (2026-11-19): ya NO lleva importe de envío (depende del CP y del contenido):
 * «Envío calculado con tu código postal · gratis desde {umbral}»; solo el umbral sale del endpoint público.
 * ⚠️ Texto de cara al cliente PENDIENTE de aprobación del dueño (DECISIONES §ENV3.10).
 * ⛔ Ningún importe escrito a mano: cargando o con error no se pinta nada (lo cobrado lo decide `session`).
 */
export function ShippingFeeHint({ kind, className }: ShippingFeeHintProps) {
  const t = useTranslations('checkout.feeHint');
  const tFixed = useTranslations('checkout.feeHintFixed');
  const locale = useLocale() as AppLocale;
  const rule = useQuery({
    queryKey: PUBLIC_SHIPPING_RULE_KEY,
    queryFn: getPublicShippingRule,
    staleTime: 60_000,
  });
  if (!rule.data) return null;
  // Umbral para CUALQUIER pedido (dueño 2026-10-25, `HECHOS.md` «Envío gratis desde MX$4,000 para CUALQUIER pedido»):
  // T1a y T1b llevan los dos el `freeFrom` del endpoint.
  const freeFrom = formatMoneyCents(rule.data.freeFromCents, locale);
  // §ENV3.17: dial apagado ⇒ la regla fija de hoy, con los importes que manda el endpoint (⛔ nunca escritos a mano).
  const text =
    rule.data.v3Enabled === false
      ? tFixed(kind === 'cards' ? 'cardsOnly' : 'sealed', {
          shipping: formatMoneyCents(kind === 'cards' ? rule.data.cardsOnlyFeeCents : rule.data.sealedFeeCents, locale),
          freeFrom,
        })
      : t(kind === 'cards' ? 'cardsOnly' : 'sealed', { freeFrom });
  return (
    <p data-testid="shipping-fee-hint" className={cn('font-mono text-[11px] leading-[1.5] text-muted', className)}>
      {text}
    </p>
  );
}

/**
 * T8 en la ficha (§CHK-MOVIL.4): la promesa de reembolso («Si tu carta llega dañada o equivocada, te reembolsamos.»),
 * mono 11 px, sin icono. B4 (BRIEF_MKT §4, 2026-10-30): la ficha ya NO repite «Todas las ventas son finales»; esa
 * frase sale una sola vez antes de pagar, en el checkout (casilla de términos del invitado / nota legal con cuenta),
 * siempre con T8 al lado. Candado de conteo: `final-sale-once.test.tsx`.
 */
export function RefundPromiseLine({ className }: { className?: string }) {
  const t = useTranslations('checkout');
  return (
    <p data-testid="refund-promise-line" className={cn('font-mono text-[11px] leading-[1.5] text-muted', className)}>
      {t('refundPromise')}
    </p>
  );
}
