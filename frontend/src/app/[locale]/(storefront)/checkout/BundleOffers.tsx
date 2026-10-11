'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { EnergyBundleDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { totalQuantity } from '@/lib/accessories';
import { markBundleOfferSeen, useBundleOfferSeen } from '@/lib/cart';
import { Button } from '@/components/ui/Button';

/**
 * La oferta del paquete en el carrito (`DESIGN_SYSTEM §AC-UX.8b`, AC-F5): «el carrito lo sugiere UNA vez». La fila
 * de un deck desaparece para siempre cuando el cliente pulsa cualquiera de los dos botones (se guarda aparte del
 * carrito, `tcg.cart.bundleOfferSeen`). Si solo la ignora, sigue apareciendo. ⛔ No es modal.
 */
export function BundleOffers({ offers, onAdd }: { offers: EnergyBundleDTO[]; onAdd: (slug: string) => void }) {
  const t = useTranslations('checkout.bundleOffer');
  const locale = useLocale() as AppLocale;
  const seen = useBundleOfferSeen();
  const visible = offers.filter((o) => !seen.includes(o.deckSlug));
  if (visible.length === 0) return null;
  return (
    <section aria-label={t('title')} className="mt-8 border-t border-border-strong bg-surface-2 p-5">
      <ul>
        {visible.map((o) => (
          <li key={o.deckSlug} className="flex flex-col gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
            <p className="text-sm leading-relaxed text-text">
              {t('line', {
                deck: o.deckName,
                n: totalQuantity(o.energies),
                price: formatMoneyCents(o.priceCents, locale),
                loose: formatMoneyCents(o.looseTotalCents, locale),
              })}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  markBundleOfferSeen(o.deckSlug);
                  onAdd(o.deckSlug);
                }}
              >
                {t('add')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => markBundleOfferSeen(o.deckSlug)}>
                {t('dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
