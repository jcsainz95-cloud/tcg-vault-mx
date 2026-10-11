'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { SealedPriceOrigin } from '@/types/contract';

/**
 * Rótulo de SOLO LECTURA del precio de una pieza sellada **ligada a su producto** (`DESIGN_SYSTEM §70.3 (a)`, tabla de
 * rótulos). `{price}` = `resolvedDisplayPriceCents` de la pieza: con IVA, lo que se cobra por **esa** pieza.
 * ⛔ Nunca `resolvedSalePriceCents` (es `L`, antes de IVA).
 *
 * Devuelve `null` si el servidor no trae `sealedPriceOrigin` o `resolvedDisplayPriceCents` (anterior a §M11-SP): quien
 * lo monta cae al rótulo de hoy.
 */
export function SealedPiecePriceLabel({
  id,
  origin,
  resolvedDisplayPriceCents,
}: {
  id: string;
  origin: SealedPriceOrigin | undefined;
  resolvedDisplayPriceCents: number | null | undefined;
}) {
  const t = useTranslations('admin.sealedProductPrice');
  const locale = useLocale() as AppLocale;
  if (origin === undefined || resolvedDisplayPriceCents === undefined) return null;
  const testId = `sealed-piece-price-${id}`;
  if (origin === 'pending' || resolvedDisplayPriceCents === null) {
    return (
      <span className="text-xs text-accent" data-testid={testId}>
        {t('piece.pending')}
      </span>
    );
  }
  const price = formatMoneyCents(resolvedDisplayPriceCents, locale);
  if (origin === 'piece') {
    return (
      <span className="tabular font-mono text-xs text-text" data-testid={testId} title={t('piece.legacyHelp')}>
        {t('piece.legacy', { price })}
        <span className="sr-only"> — {t('piece.legacyHelp')}</span>
      </span>
    );
  }
  return (
    <span className="tabular font-mono text-xs text-text" data-testid={testId}>
      {origin === 'product' ? t('piece.product', { price }) : t('piece.automatic', { price })}
    </span>
  );
}
