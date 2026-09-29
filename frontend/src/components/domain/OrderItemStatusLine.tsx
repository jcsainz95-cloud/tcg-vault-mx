'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { CustomerItemRefundInfo, CustomerReplacementInfo } from '@/types/contract';

const CHIP = 'font-mono text-[11px] uppercase tracking-[0.06em]';

/**
 * **La línea de estado de una carta del cliente** (`DESIGN_SYSTEM §37.7` y `§37.8f` · contrato
 * `§M4-SHIP.10/.15.8/.16`). Un solo componente para el pedido, el retiro y «Mi bóveda»: la misma carta
 * dice lo mismo en las tres puertas.
 *
 * - `refund` (solo filas `submitted|succeeded`) ⇒ **«No salió · te devolvimos {amount}»** + el motivo en
 *   una frase corta. ⛔ Sin actor ni componentes del importe (S7).
 * - `replacement` abierto ⇒ chip **«La estamos reponiendo»** + la frase del motivo; `replaced` ⇒
 *   **«Repuesta con otra igual»**; `refunded` ⇒ **«Reembolsada · {amount}»** y, si hubo parte por
 *   transferencia, su estado (`cancelled` añade «Si no sabes por qué, contáctanos.»). ⛔ Sin CLABE, sin
 *   motivo interno, sin referencias.
 * - `originRefunded` ⇒ **«Ya no está en tu bóveda: este pedido se reembolsó.»** (§37.10d).
 *
 * Sin nada que decir no pinta nada: ausencia de dato ⇒ ausencia de línea.
 */
export function OrderItemStatusLine({
  refund,
  replacement,
  originRefunded,
  className,
}: {
  refund?: CustomerItemRefundInfo | null;
  replacement?: CustomerReplacementInfo | null;
  originRefunded?: boolean;
  className?: string;
}) {
  const t = useTranslations('orders.item');
  const locale = useLocale() as AppLocale;

  if (originRefunded) {
    return (
      <p className={cn('text-sm text-text', className)} data-testid="item-origin-refunded">
        {t('originRefunded')}
      </p>
    );
  }

  if (replacement) {
    if (replacement.status === 'open') {
      return (
        <div className={cn('flex flex-col gap-1', className)} data-testid="item-replacing">
          <span className={cn(CHIP, 'text-accent')}>{t('replacing')}</span>
          <p className="text-sm text-text">{t(`replacingBody.${replacement.reason}`)}</p>
        </div>
      );
    }
    if (replacement.status === 'replaced') {
      return (
        <p className={cn(CHIP, 'text-muted', className)} data-testid="item-replaced">
          {t('replaced')}
        </p>
      );
    }
    if (replacement.status === 'refunded' && replacement.refund) {
      const r = replacement.refund;
      return (
        <div className={cn('flex flex-col gap-1', className)} data-testid="item-case-refunded">
          <span className={cn(CHIP, 'text-muted')}>{t('caseRefunded', { amount: formatMoneyCents(r.amountCents, locale) })}</span>
          {r.byTransferCents > 0 && r.transferStatus && (
            <p className="text-sm text-text">
              {t('byTransfer', { amount: formatMoneyCents(r.byTransferCents, locale), status: t(`transferStatus.${r.transferStatus}`) })}
              {r.transferStatus === 'cancelled' && <> {t('transferCancelledHelp')}</>}
            </p>
          )}
        </div>
      );
    }
    // `voided`: el caso se anuló y la carta volvió a ser una carta normal — nada que decir.
  }

  if (refund) {
    return (
      <p className={cn('text-sm text-text', className)} data-testid="item-refund">
        {t('refund', { amount: formatMoneyCents(refund.amountCents, locale) })}
        <span className="text-muted"> · {t(`refundReason.${refund.reason}`)}</span>
      </p>
    );
  }

  return null;
}
