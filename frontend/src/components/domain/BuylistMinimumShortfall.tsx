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
 *
 * **⚠ v2.3.8 (§23.3f-bis) — el CONSEJO cambia cuando hay líneas sin precio; la CIFRA no.**
 * Con el carrito lleno de `precio_pendiente` el consejo era *«Agrega otra carta»* mientras el
 * vendedor miraba **un carrito lleno**: aritméticamente impecable y, como instrucción, **una
 * cinta de correr** — puede agregar mil cartas más del mismo set y **seguir en cero**. Ahora se
 * pide **una carta que ya tenga precio**; el «ya» dice que las otras también lo tendrán y evita
 * partir el carrito en cartas buenas y cartas malas.
 *
 * ⛔ **Prohibido fundir el faltante con la explicación** («te faltan $500 **porque** tus cartas
 * no tienen precio»): mezclar dos hechos en una cifra hace que **la cifra deje de ser
 * verificable**. Son dos trabajos y dos frases — el **por qué** vive arriba, en
 * `pendingLine.note` (§23.3h), y **no se repite aquí**.
 */
export function BuylistMinimumShortfall({
  shortfallCents,
  minimumCents,
  hasPendingLines = false,
  id,
  className,
}: {
  shortfallCents: number;
  minimumCents: number;
  /** ¿Hay al menos una línea en `precio_pendiente`? Solo cambia el CONSEJO, nunca el monto. */
  hasPendingLines?: boolean;
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
      {t(hasPendingLines ? 'quote.minimum.addPricedCard' : 'quote.minimum.addAnother')}
    </p>
  );
}
