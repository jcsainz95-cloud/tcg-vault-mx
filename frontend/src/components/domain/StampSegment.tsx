'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { BuylistStampDTO, BuylistVersionDTO, CardLanguage } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * §BUYLIST-ES F4 (§5) · segmento «Normal | De liga» por carta. Con varias ligas, una ficha por liga con su nombre
 * («Prize Pack», «De torneo»…). Cada opción muestra SU monto en el idioma elegido (cifra de `versions[]`, del servidor) y
 * cambiar NO pide red; se combina con el segmento de idioma (la oferta de cada ficha sigue al idioma). ⛔ No calcula dinero.
 * Sin oferta para esa versión (`null`) la opción queda apagada y dice «Sin oferta»: nunca se ofrece la normal en su lugar.
 * Grupo de botones `aria-pressed`, objetivo táctil ≥ 44 px, foco visible, radios 0; las fichas envuelven en pantallas angostas.
 */
export function StampSegment({
  name,
  language,
  stampOptions,
  versions,
  selectedProductId,
  onChange,
  disabled = false,
  testId = 'stamp-segment',
}: {
  name: string;
  language: CardLanguage;
  stampOptions: BuylistStampDTO[];
  versions: BuylistVersionDTO[];
  /** `null`/`undefined` = normal. */
  selectedProductId: number | null | undefined;
  onChange: (productId: number | null) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations('sellerFlujo.version');
  const tl = useTranslations('buylist.lang');
  const tv = useTranslations('version');
  const locale = useLocale() as AppLocale;
  const selected = selectedProductId ?? null;
  const options: { productId: number | null; label: string }[] = [
    { productId: null, label: t('name.normal') },
    ...stampOptions.map((o) => ({
      productId: o.productId,
      // La etiqueta del servidor es la de la venta (`card-version`); sin ella, el nombre del tipo de liga.
      label: o.label || (tv.has(`chip.${o.type}`) ? tv(`chip.${o.type}`) : t('name.league')),
    })),
  ];
  return (
    <div role="group" aria-label={t('group', { name })} data-testid={testId} className="mt-2 flex w-full flex-wrap gap-y-1">
      {options.map((o, i) => {
        const cents = versions.find((v) => v.language === language && (v.stamp?.productId ?? null) === o.productId)?.offerCents ?? null;
        const isSel = selected === o.productId;
        const off = disabled || (!isSel && cents == null);
        return (
          <button
            key={o.productId ?? 'normal'}
            type="button"
            aria-pressed={isSel}
            disabled={off}
            data-stamp={o.productId ?? 'normal'}
            onClick={() => {
              if (!isSel) onChange(o.productId);
            }}
            className={cn(
              'flex min-h-[44px] min-w-[96px] flex-1 flex-col items-center justify-center border border-border-strong px-2 py-1 text-center focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              i > 0 && '-ml-px',
              isSel ? 'bg-text text-primary-fg' : 'bg-transparent text-text hover:border-text',
            )}
          >
            <span className="text-[13px] font-semibold leading-tight">{o.label}</span>
            <span className="tabular font-mono text-[11px] leading-tight">
              {cents != null ? formatMoneyCents(cents, locale) : tl('noOffer')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
