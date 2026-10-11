'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { cn } from '@/lib/cn';
import { BuylistPendingLineLabel } from '@/components/domain/BuylistPendingLinesNote';

export interface CartTotalFigureProps {
  /**
   * §33.11.2: el carrito se está recotizando o la recotización falló — «sin cotización fresca no
   * hay cifra». Es el MISMO predicado que apaga el CTA (`requoting || requoteFailed`).
   */
  noFreshPrice: boolean;
  totalEstimatedCents: number;
  pendingCardCount: number;
  /**
   * `hero` = la cifra de 26 px del bloque de dinero del cajón; `bar` = el escalón de 20 px de la
   * `SellCartBar` (§37.1b: «la barra informa, el cajón decide»); `summary` = los 18 px del resumen
   * del modal de solicitud. Solo cambia el TAMAÑO.
   */
  size: 'hero' | 'bar' | 'summary';
  /** Prefijo de `data-testid`: las superficies conviven en el DOM y cada una se nombra. */
  testIdScope: 'sell-cart' | 'sell-cart-bar' | 'sell-request';
}

/**
 * **§37.1b (P-61) — la cifra del total de la lista de venta, UNA sola función para las tres
 * superficies** (bloque de dinero del cajón, barra inferior de escritorio y resumen del modal de
 * solicitud).
 *
 * ⛔ Que una superficie tenga su propia lógica de total es el defecto que esta extracción cierra:
 * las copias de las tres ramas acaban divergiendo (una pinta la cifra vieja mientras otra pinta
 * «—», o una omite la rama del «—») y el vendedor ve dos totales distintos del mismo carrito. Las
 * ramas son, en este orden:
 *
 * 1. recotizando o recotización fallida ⇒ «—» en `muted` (lo desconocido no se afirma, §32.4);
 * 2. TODO pendiente (total 0 con líneas sin precio) ⇒ la versalita, nunca `MX$0.00` (§23.3h);
 * 3. si no, el importe en mono `tabular-nums`.
 *
 * El caso «carrito vacío» NO es una rama: el llamador no pinta cifra (⛔ `MX$0.00` con la lista
 * vacía — §37.1b). Candado: P61-4 (`BuylistView.test.tsx`).
 */
export function CartTotalFigure({
  noFreshPrice,
  totalEstimatedCents,
  pendingCardCount,
  size,
  testIdScope,
}: CartTotalFigureProps) {
  const locale = useLocale() as AppLocale;
  const tSellCart = useTranslations('sellCart');
  const sizeClass = size === 'hero' ? 'text-[26px]' : size === 'bar' ? 'text-[20px]' : 'text-[18px]';

  if (noFreshPrice) {
    return (
      <span
        className={cn('tabular font-mono font-medium leading-none text-muted', sizeClass)}
        data-testid={`${testIdScope}-total-requoting`}
        aria-label={tSellCart('requoting')}
      >
        —
      </span>
    );
  }
  if (totalEstimatedCents === 0 && pendingCardCount > 0) {
    return <BuylistPendingLineLabel className="text-[13px]" />;
  }
  return (
    <span
      className={cn('tabular font-mono font-medium leading-none text-text', sizeClass)}
      data-testid={`${testIdScope}-total`}
    >
      {formatMoneyCents(totalEstimatedCents, locale)}
    </span>
  );
}
