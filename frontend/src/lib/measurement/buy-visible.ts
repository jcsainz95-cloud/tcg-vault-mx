'use client';

import { useEffect } from 'react';
import { track } from './track';

/** Atributo que marca el botón de COMPRAR (agregar al carrito) cuya visibilidad se mide. */
export const BUY_CTA_ATTR = 'data-buy-cta';

/**
 * §MKT.H.4 `buy_button_visible` (§MKT-V2 6.3): UNA vez por vista de ficha, la primera vez que algún botón marcado con
 * `data-buy-cta` entra en pantalla (≥ 50 %), con los segundos desde que se montó la ficha. Con el modo `off` o sin
 * `IntersectionObserver`, no hace nada. Un botón en `display:none` (barra móvil en escritorio) no cuenta.
 * c4 = `buy_button_visible / view_item`.
 */
export function useBuyButtonVisible(cardId: string): void {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE !== 'on') return;
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = document.querySelectorAll(`[${BUY_CTA_ATTR}]`);
    if (targets.length === 0) return;
    const t0 = Date.now();
    let sent = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (sent || !entries.some((e) => e.isIntersecting)) return;
        sent = true;
        io.disconnect();
        track('buy_button_visible', { card_id: cardId, seconds_to_visible: Math.round((Date.now() - t0) / 1000) });
      },
      { threshold: 0.5 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cardId]);
}
