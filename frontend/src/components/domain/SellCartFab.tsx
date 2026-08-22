'use client';

import { forwardRef } from 'react';
import { useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';

export interface SellCartFabProps {
  /** Piezas en el carrito (suma de cantidades). Con 0 el badge se OMITE (el FAB permanece). */
  count: number;
  /** ¿Está abierto el drawer? (aria-expanded). */
  open: boolean;
  onClick: () => void;
}

/**
 * FAB del carrito de venta (DESIGN_SYSTEM §18.4a, P-16). Disparador flotante fijo
 * (56×56px, radio 0, SIN sombra, tinta/papel) del `SellCartDrawer`. Reglas de la spec:
 * - El badge contador (accent, mono `tabular-nums`, cap visual `99+`) es `aria-hidden`:
 *   la cifra viaja en el `aria-label` dinámico («Carrito de venta, N carta(s)» / «…, vacío»).
 * - SIN animación al agregar (§17.3: un pulso animado se confunde con carga); el anuncio a
 *   lectores de pantalla lo hace el `role="status"` existente de la página (addedLine).
 * - Con carrito vacío el FAB permanece: da acceso al panel de requisitos de venta.
 * - z-40: por debajo del drawer (z-50) y por encima de la barra sticky de filtros (z-10).
 */
export const SellCartFab = forwardRef<HTMLButtonElement, SellCartFabProps>(function SellCartFab(
  { count, open, onClick },
  ref,
) {
  const t = useTranslations('buylist');
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={count > 0 ? t('cartFab.ariaWithCount', { count }) : t('cartFab.ariaEmpty')}
      data-testid="sell-cart-fab"
      className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center border border-border-strong bg-ink text-on-ink focus-visible:shadow-focus focus-visible:outline-none"
      style={{ bottom: 'calc(20px + env(safe-area-inset-bottom))' }}
    >
      <ShoppingCart size={20} aria-hidden />
      {count > 0 && (
        <span
          aria-hidden
          data-testid="sell-cart-fab-badge"
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center bg-accent px-1 font-mono text-[11px] leading-none text-accent-fg tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
});
