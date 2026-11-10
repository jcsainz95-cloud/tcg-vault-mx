'use client';

import { useEffect } from 'react';
import { track } from './track';

/** Atributo que marca el botón de COMPRAR (agregar al carrito) cuya visibilidad se mide. */
export const BUY_CTA_ATTR = 'data-buy-cta';

/** Tope de vida del `MutationObserver`: pasado este tiempo ya no se re-escanea la página (ficha agotada, sin COMPRAR). */
export const BUY_CTA_SCAN_MS = 10_000;

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
    const t0 = Date.now();
    let sent = false;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        if (sent || !entries.some((e) => e.isIntersecting)) return;
        sent = true;
        io.disconnect();
        mo?.disconnect();
        track('buy_button_visible', { card_id: cardId, seconds_to_visible: Math.round((Date.now() - t0) / 1000) });
      },
      { threshold: 0.5 },
    );
    // El botón puede aparecer DESPUÉS de montar (datos que llegan, variante cargada): se re-escanea al cambiar el DOM.
    const scan = () => {
      if (sent) return;
      document.querySelectorAll(`[${BUY_CTA_ATTR}]`).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(scan);
    scan();
    mo?.observe(document.body, { childList: true, subtree: true });
    // Acotado: el IntersectionObserver sigue vivo con lo ya hallado, pero deja de vigilarse el DOM entero.
    const stop = window.setTimeout(() => mo?.disconnect(), BUY_CTA_SCAN_MS);
    return () => {
      window.clearTimeout(stop);
      io.disconnect();
      mo?.disconnect();
    };
  }, [cardId]);
}
