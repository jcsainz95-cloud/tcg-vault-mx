'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { EnergyBundleDTO, QuoteAccessoryLineDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { energyBreakdown } from '@/lib/accessories';
import { ACCESSORY_MAX_QTY } from '@/lib/cart';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { QuantityStepper } from '@/components/domain/accessories/QuantityStepper';

/**
 * Renglones de accesorio y de paquete del carrito (`DESIGN_SYSTEM §AC-UX.5`). Orden: cartas → sellado →
 * ACCESORIOS → PAQUETES DE ENERGÍAS, con `eyebrow` por grupo solo si tiene algo. ⛔ Ningún importe se calcula:
 * `lineTotalCents`, `unitPriceCents`, `priceCents` y `looseTotalCents` son de la cotización.
 */
export function AccessoryCartLines({
  lines,
  bundles,
  qtyOf,
  onQty,
  onRemove,
  onRemoveBundle,
}: {
  lines: QuoteAccessoryLineDTO[];
  bundles: EnergyBundleDTO[];
  /** La cantidad del carrito local (lo que el cliente pidió); el total del renglón lo dice el servidor. */
  qtyOf: (accessoryId: string) => number | undefined;
  onQty: (accessoryId: string, qty: number) => void;
  onRemove: (accessoryId: string) => void;
  onRemoveBundle: (slug: string) => void;
}) {
  const t = useTranslations('checkout.accessories');
  const tc = useTranslations('checkout');
  const ta = useTranslations('accessories');
  const locale = useLocale() as AppLocale;
  const money = (c: number) => formatMoneyCents(c, locale);

  return (
    <>
      {lines.length > 0 && (
        <div className="pt-6">
          <p className="eyebrow">{t('groupAccessories')}</p>
          <ul>
            {lines.map((l) => {
              const category = ta(`category.${l.category}`);
              const meta = l.energyType ? ta('categoryWithType', { category, type: ta(`energyType.${l.energyType}`) }) : category;
              return (
                <li key={l.accessoryId} data-testid={`cart-accessory-${l.accessoryId}`} className="flex items-start gap-4 border-b border-border py-5 sm:gap-5">
                  <AccessoryPhoto src={l.photo.thumbUrl} alt={l.name} fallbackText={l.name} className="w-16 shrink-0 sm:w-[92px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-serif text-[17px] leading-tight text-text sm:text-[19px]">{l.name}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-muted">{meta}</p>
                    <QuantityStepper
                      className="mt-3"
                      compact
                      announce
                      label={t('quantityAria', { name: l.name })}
                      labelHidden
                      value={qtyOf(l.accessoryId) ?? l.quantity}
                      min={1}
                      max={ACCESSORY_MAX_QTY}
                      onChange={(q) => onQty(l.accessoryId, q)}
                    />
                    <button
                      type="button"
                      aria-label={t('removeAria', { name: l.name })}
                      onClick={() => onRemove(l.accessoryId)}
                      className="mt-3 font-mono text-[11px] text-muted hover:text-accent"
                    >
                      {tc('removeItem')}
                    </button>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="tabular block text-[17px] font-medium text-text sm:text-[19px]">{money(l.lineTotalCents)}</span>
                    {l.quantity > 1 && <span className="tabular mt-1 block text-xs text-muted">{t('unitPrice', { price: money(l.unitPriceCents) })}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {bundles.length > 0 && (
        <div className="pt-6">
          <p className="eyebrow">{t('groupBundles')}</p>
          <ul>
            {bundles.map((b) => {
              // Miniatura: la foto de la energía con MÁS cantidad (§AC-UX.5), venida del servidor (v1.86.1).
              const top = [...b.energies].sort((x, y) => y.quantity - x.quantity)[0];
              const title = t('bundleTitle', { deck: b.deckName });
              return (
                <li key={b.deckSlug} data-testid={`cart-bundle-${b.deckSlug}`} className="flex items-start gap-4 border-b border-border py-5 sm:gap-5">
                  {top?.photo ? (
                    <AccessoryPhoto src={top.photo.thumbUrl} alt={title} fallbackText={t('bundlePhotoFallback')} className="w-16 shrink-0 sm:w-[92px]" />
                  ) : (
                    <div className="flex aspect-square w-16 shrink-0 items-center justify-center border border-border bg-surface-2 sm:w-[92px]">
                      <span className="eyebrow">{t('bundlePhotoFallback')}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-[17px] leading-tight text-text sm:text-[19px]">{title}</p>
                    <p className="mt-1.5 font-mono text-xs text-muted">{energyBreakdown(b.energies, ta)}</p>
                    <button
                      type="button"
                      aria-label={t('removeAria', { name: title })}
                      onClick={() => onRemoveBundle(b.deckSlug)}
                      className="mt-3.5 font-mono text-[11px] text-muted hover:text-accent"
                    >
                      {tc('removeItem')}
                    </button>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="tabular block text-[17px] font-medium text-text sm:text-[19px]">{money(b.priceCents)}</span>
                    <span className="tabular mt-1 block text-xs text-muted">{t('bundleLoose', { amount: money(b.looseTotalCents) })}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
