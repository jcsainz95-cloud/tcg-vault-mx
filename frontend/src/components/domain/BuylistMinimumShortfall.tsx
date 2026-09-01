'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * El FALTANTE del mínimo de compra (DESIGN_SYSTEM §23.3f · PROJECT criterio 132(a)).
 *
 * **Por qué se queda cuando el envío se fue:** es un monto sobre **sus** cartas, no sobre
 * nuestro servicio. Sin él, un «no» seco manda al vendedor a otro lado; un «te faltan $120» lo
 * manda a agregar otra carta.
 *
 * **Los dos orígenes del número, y ninguno se inventa:**
 * - *preventivo* — `minimumRequestCents` de `GET /buylist/quote-policy` menos el total del
 *   carrito (la ÚNICA resta autorizada en cliente). Evita el viaje al servidor.
 * - *autoritativo* — `details.shortfallCents` / `details.minimumCents` del
 *   `422 BUYLIST_MINIMUM_NOT_MET`. **Manda sobre el preventivo**: si difieren (caché de 5
 *   minutos, o el dial movido entre medias), la pantalla se repinta con el del error.
 *
 * ⛔ **Nunca se expresa en términos de envío** («te faltan $120 para cubrir el envío»): eso
 * reintroduciría la cifra retirada y además mentiría sobre qué es el mínimo — el mínimo **no es**
 * el envío. Va en tinta, no en muted (§23.11 regla 1: el muted no porta cifras de §23).
 */
export function BuylistMinimumShortfall({
  shortfallCents,
  minimumCents,
  id,
  className,
}: {
  shortfallCents: number;
  minimumCents: number;
  id?: string;
  className?: string;
}) {
  const t = useTranslations('buylist');
  const locale = useLocale() as AppLocale;
  return (
    <p
      id={id}
      data-testid="buylist-minimum-shortfall"
      className={cn('text-sm leading-[1.7] text-text', className)}
    >
      <span className="font-medium uppercase">
        {t('quote.minimum.shortfall', { amount: formatMoneyCents(shortfallCents, locale) })}
      </span>{' '}
      {t('quote.minimum.minimumIs', { amount: formatMoneyCents(minimumCents, locale) })}{' '}
      {t('quote.minimum.addAnother')}
    </p>
  );
}
