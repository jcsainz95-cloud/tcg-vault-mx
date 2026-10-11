'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import type { SealedProductPriceSaved } from './SealedProductPriceEditor';

/** Ancla de la cola «Listas para publicar» en M11 (`M11View`). */
export const QUEUE_ANCHOR_HREF = '/admin/m11#listas-para-publicar';
/** Ancla de la hoja «Precios del sellado» en M11 (`M11View`). */
export const SHEET_ANCHOR_HREF = '/admin/m11#precios-sellado';

/**
 * El aviso tras guardar el precio del producto (`DESIGN_SYSTEM §70.2 (d)`, «Después de `200`»; F-SP-8 / UX-SP-19).
 * Una línea por dato, **leídas de `autoPublish`** (⛔ nunca deducidas comparando `pieces`):
 * - siempre «{name}: {price} con IVA para sus {n} piezas.»;
 * - `published > 0`, `missingLocation > 0`, `notPublished > 0` ⇒ su línea (las dos últimas con enlace a la cola);
 * - `autoPublish = null` ⇒ «El precio se guardó, pero no se pudo intentar publicar…» + enlace, variante `warning`
 *   (⛔ no es un error: el precio SÍ se guardó).
 *
 * Se pinta como nota al margen **que no se autodescarta** y se cierra a mano (un enlace que desaparece a los pocos
 * segundos no se puede usar con teclado). Desviación consciente del «toast» de §70.2 (d): el `Toast` del proyecto no
 * admite enlaces ni variante de aviso; ver `FRONTEND_NOTES §SP-F`.
 */
export function SealedPriceSavedNotice({ saved }: { saved: SealedProductPriceSaved }) {
  const t = useTranslations('admin.sealedProductPrice');
  const locale = useLocale() as AppLocale;
  const ap = saved.autoPublish;
  const price = saved.displayPriceCents != null ? formatMoneyCents(saved.displayPriceCents, locale) : '—';
  const needsQueueLink = ap === null || ap.missingLocation > 0 || ap.notPublished > 0;
  return (
    <Banner variant={ap === null ? 'warning' : 'success'} role="status" dismissible>
      <span className="flex flex-col gap-0.5" data-testid="sealed-price-saved-notice">
        <span>{t('done.saved', { name: saved.name, price, n: saved.pieces })}</span>
        {ap === null ? (
          <span>{t('done.autoPublishFailed')}</span>
        ) : (
          <>
            {ap.published > 0 && <span>{t('done.published', { k: ap.published })}</span>}
            {ap.missingLocation > 0 && <span>{t('done.missingLocation', { m: ap.missingLocation })}</span>}
            {ap.notPublished > 0 && <span>{t('done.notPublished', { x: ap.notPublished })}</span>}
          </>
        )}
        {needsQueueLink && (
          <Link href={QUEUE_ANCHOR_HREF} className="w-fit text-text underline underline-offset-4 hover:text-accent">
            {t('done.seeQueue')}
          </Link>
        )}
      </span>
    </Banner>
  );
}
