'use client';

import { forwardRef } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { CartTotalFigure } from './CartTotalFigure';

export interface SellCartBarProps {
  /** Piezas en la lista (suma de cantidades). */
  cartCount: number;
  /** ¿Hay al menos una línea? Sin líneas NO hay cifra (⛔ `MX$0.00` con la lista vacía). */
  hasLines: boolean;
  totalEstimatedCents: number;
  pendingCardCount: number;
  /** `requoting || requoteFailed` — el MISMO predicado que usa el bloque de dinero del cajón. */
  noFreshPrice: boolean;
  /** Sin sesión (`sellReq.ready && !sellReq.isAuthenticated`): recordatorio corto + «Iniciar sesión». */
  showLoginHint: boolean;
  /** ¿Está abierto el cajón? (`aria-expanded`). */
  drawerOpen: boolean;
  /** `id` del diálogo del cajón (`aria-controls`). */
  dialogId: string;
  onOpen: () => void;
}

/**
 * **§37.1b (P-61) — la barra inferior de la lista de venta en escritorio (`≥ lg`).**
 *
 * En escritorio el carrito volvió a ser el `SellCartDrawer` (el catálogo recupera todo el
 * ancho); lo que el panel fijo de P-42 daba —ver siempre cuánto llevas— lo conserva esta barra.
 * Es un DISPARADOR, no un segundo carrito:
 * - izquierda: `TU LISTA` + conteo, o la frase de vacío;
 * - centro-derecha (solo con líneas): `VALOR DE TUS CARTAS` + la cifra de `CartTotalFigure`, la
 *   MISMA función que el bloque de dinero del cajón (las tres ramas no se copian aquí);
 * - sin sesión: recordatorio corto + «Iniciar sesión» (el banner completo vive en la cabecera);
 * - derecha: «Ver lista», siempre activo (vacío da acceso a los requisitos, igual que el FAB).
 *
 * ⛔ No pinta el faltante del mínimo, ni la nota de la guía, ni «Enviar solicitud»: la decisión
 * de enviar se toma en el cajón, con todo a la vista. ⛔ Sin `aria-live` en la cifra (el anuncio
 * al agregar ya lo hace el `role="status"` de `addedLine`) y sin animación (§17.3).
 *
 * `hidden lg:flex`: en `< lg` el disparador es el FAB (`lg:hidden`). Los dos se montan siempre y
 * se esconden por CSS — sin `useMediaQuery`, sin destello al hidratar (`display:none` los saca
 * del árbol de accesibilidad).
 */
export const SellCartBar = forwardRef<HTMLButtonElement, SellCartBarProps>(function SellCartBar(
  {
    cartCount,
    hasLines,
    totalEstimatedCents,
    pendingCardCount,
    noFreshPrice,
    showLoginHint,
    drawerOpen,
    dialogId,
    onOpen,
  },
  ref,
) {
  const t = useTranslations('buylist');
  return (
    <section
      aria-label={t('cartBar.region')}
      data-testid="sell-cart-bar"
      data-sell-cart-bar=""
      className="fixed inset-x-0 bottom-0 z-40 hidden h-16 border-t border-border-strong bg-bg lg:flex"
    >
      {/* Alineada con la columna del catálogo: mismo `max-w-7xl`, la columna de 40 px de la
          etiqueta vertical y el `.gutter` de la vista. */}
      <div className="mx-auto grid h-full w-full max-w-7xl grid-cols-[40px_minmax(0,1fr)]">
        <div aria-hidden />
        <div className="gutter flex min-w-0 items-center gap-6">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="eyebrow shrink-0">{t('cartTitle')}</span>
            {hasLines ? (
              <span className="eyebrow shrink-0" data-testid="sell-cart-bar-count">
                {t('cartCount', { count: cartCount })}
              </span>
            ) : (
              <span className="min-w-0 truncate text-[13px] text-muted">{t('cartBar.empty')}</span>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-6">
            {hasLines && (
              <div className="flex items-baseline gap-3" data-testid="sell-cart-bar-money">
                <span className="font-mono text-[11px] font-medium uppercase tracking-eyebrow text-text">
                  {t('quote.money.cardsValue')}
                </span>
                <CartTotalFigure
                  noFreshPrice={noFreshPrice}
                  totalEstimatedCents={totalEstimatedCents}
                  pendingCardCount={pendingCardCount}
                  size="bar"
                  testIdScope="sell-cart-bar"
                />
              </div>
            )}

            {showLoginHint && (
              <p className="flex items-baseline gap-3 font-mono text-[11px] text-text" data-testid="sell-cart-bar-login">
                <span>{t('cartBar.loginHint')}</span>
                <Link
                  href="/login?next=/buylist"
                  className="border-b border-accent pb-0.5 text-xs font-medium text-accent hover:border-text hover:text-text"
                >
                  {t('loginCta')}
                </Link>
              </p>
            )}

            <Button
              ref={ref}
              variant="primary"
              className="min-h-[44px]"
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls={dialogId}
              onClick={onOpen}
              data-testid="sell-cart-bar-open"
            >
              {t('cartBar.open')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
});
