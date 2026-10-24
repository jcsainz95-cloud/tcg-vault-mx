'use client';

import { useEffect, useState } from 'react';
import { isMeasuredPath } from '@/lib/measurement/routes';

/**
 * ARCHITECTURE §14.4 (D-MKT2-2) · candado C-F5 — NAVEGACIÓN DURA hacia rutas excluidas.
 *
 * Next navega sin recargar: un `gtag`/`fbq` cargado en una ruta medida seguiría vivo en `/cuenta`, en el paso
 * de la solicitud de venta (CLABE/INE) o en una página con token. Con etiquetas en el documento, toda
 * navegación a una ruta fuera de la lista blanca se hace como DOCUMENTO NUEVO, que llega sin terceros porque
 * el cargador no actúa allí. Lo usan los dos montajes de la medición: `MeasurementProvider` (árbol `[locale]`)
 * y `CardShowMeasurement` (árbol raíz de `/card-show`). Extracción sin cambio de conducta de lo que vivía en
 * `MeasurementProvider` (C-F5 1/3 y 2/3); la 3/3 (red de seguridad al llegar) la pone cada montaje.
 */

/** Quién llama a esto pasa siempre por aquí: ¿hay código de medición de terceros en ESTE documento? */
export function measurementLoadedInDocument(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { gtag?: unknown; fbq?: unknown };
  return Boolean(w.gtag || w.fbq || document.querySelector('script[data-th-measurement]'));
}

/**
 * Instala las dos guardas (clics y `window.next.router`) mientras `active`. Devuelve si el parche del router
 * quedó puesto: D4 (TL, 2026-10-19) — FALLA EN CERRADO, sin parche no se cargan etiquetas.
 */
export function useHardNavigationGuard(active: boolean): boolean {
  const [routerGuarded, setRouterGuarded] = useState(false);

  // C-F5 (1/3): clics en enlaces, ANTES que el router de Next.
  useEffect(() => {
    if (!active) return;
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (isMeasuredPath(url.pathname) || !measurementLoadedInDocument()) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [active]);

  // C-F5 (2/3): navegación por código. `useRouter()` (también el de next-intl) devuelve el MISMO objeto que
  // `window.next.router`; se envuelven `push`/`replace` para que una ruta excluida se pida como documento nuevo
  // ANTES de pintarse (sin esto la ruta excluida llegaba a renderizarse un instante con las etiquetas vivas:
  // medido con N=10, 60/60 rojos en el E2E de C-F5).
  useEffect(() => {
    if (!active) return;
    type Nav = (href: string, options?: unknown) => void;
    const router = (window as unknown as { next?: { router?: { push?: Nav; replace?: Nav } } }).next?.router;
    // Sin router que envolver, `routerGuarded` se queda en false y el cargador no corre (D4).
    if (typeof router?.push !== 'function' || typeof router.replace !== 'function') return;
    const origPush = router.push;
    const origReplace = router.replace;
    const hardTarget = (href: string): string | null => {
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin || isMeasuredPath(url.pathname)) return null;
        return measurementLoadedInDocument() ? url.href : null;
      } catch {
        return null;
      }
    };
    const restore = () => {
      try {
        router.push = origPush;
        router.replace = origReplace;
      } catch {
        /* objeto que no admite escritura: no hubo parche que quitar */
      }
    };
    try {
      router.push = (href, options) => {
        const target = hardTarget(href);
        if (target) window.location.assign(target);
        else origPush(href, options);
      };
      router.replace = (href, options) => {
        const target = hardTarget(href);
        if (target) window.location.replace(target);
        else origReplace(href, options);
      };
    } catch {
      // Objeto congelado o de solo lectura: el parche NO quedó ⇒ sin etiquetas (D4).
      restore();
      return;
    }
    // Solo cuenta como instalado si las DOS escrituras quedaron (comprobado leyendo, no supuesto).
    if (router.push === origPush || router.replace === origReplace) {
      restore();
      return;
    }
    setRouterGuarded(true);
    return () => {
      setRouterGuarded(false);
      restore();
    };
  }, [active]);

  return routerGuarded;
}
