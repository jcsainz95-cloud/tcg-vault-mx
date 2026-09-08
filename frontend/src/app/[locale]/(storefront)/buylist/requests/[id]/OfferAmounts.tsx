'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { SellOfferPublicDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';

export interface OfferAmountsProps {
  offer: SellOfferPublicDTO;
  /** Cuántas cartas COMPRAMOS: solo rotula el bruto («Valor de tus 2 cartas»). */
  boughtCount: number;
}

/**
 * **Los TRES montos de la oferta** (DESIGN_SYSTEM §23.5b, espejo de §23.4.2 decisiones 4 y 5).
 *
 * *«La resta se ENSEÑA, no se esconde»*: un correo que anuncie $1,480 y termine en un depósito
 * de $1,350 destruye exactamente la confianza que la oferta vinculante venía a construir.
 *
 * Decisiones de forma, todas normativas:
 * - **Los tres, siempre, en este orden.** El bruto **nunca** aparece sin el envío y el neto al
 *   lado (R1 de §23.0). No hay variante «solo el neto»: §23.5b es explícito en que el portal es
 *   **el único sitio donde el vendedor puede RELEER la resta** —el correo la estrena y el
 *   recordatorio no la repite—, así que aquí el desglose completo es **obligatorio**.
 * - **La única regla de tinta del bloque va encima del neto**, y el signo `−` del envío es
 *   texto: la resta tiene dos canales visuales, no uno.
 * - **El neto es la cifra tipográficamente dominante** (la más grande del bloque) y es la única
 *   vinculante: `netCents` es *lo que se deposita*, siempre (D31 retiró `depositField`, así que
 *   **esto no ramifica**).
 * - **La prosa repite el ENVÍO y el NETO** (`ruleParagraph`, D43): un número que se estrena no
 *   puede vivir en una sola celda —justo la que se salta quien lee en diagonal—. Va en **tinta**,
 *   no en muted: no es letra chica.
 * - ⚠️ **Ninguna cifra se calcula aquí.** No hay `gross - shipping` en este archivo: los tres
 *   llegan congelados del servidor (R4). Si alguna vez no cuadran a la vista, el bug está en el
 *   servidor y hay que verlo, no taparlo con una resta local que siempre «cuadra».
 */
export function OfferAmounts({ offer, boughtCount }: OfferAmountsProps) {
  const t = useTranslations('buylist.offer');
  const locale = useLocale() as AppLocale;
  const shipping = formatMoneyCents(offer.shippingFeeCents, locale);
  const net = formatMoneyCents(offer.netCents, locale);

  return (
    <div data-testid="offer-amounts">
      <dl className="text-sm">
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-text">{t('grossLabel', { count: boughtCount })}</dt>
          <dd className="tabular font-mono text-text">
            {formatMoneyCents(offer.grossCents, locale)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-text">{t('shippingLabel')}</dt>
          {/* El signo menos es TEXTO y se lee: es uno de los dos canales de la resta. */}
          <dd className="tabular font-mono text-text">{`− ${shipping}`}</dd>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-text pt-4">
          <dt className="text-[15px] font-medium uppercase tracking-[0.06em] text-text">
            {t('netLabel')}
          </dt>
          <dd
            data-testid="offer-net"
            className="tabular font-mono text-[22px] font-medium leading-none text-text"
          >
            {net}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-[1.7] text-text">
        {t('ruleParagraph', { shippingAmount: shipping, netAmount: net })}
      </p>
    </div>
  );
}
