'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * DESIGN_SYSTEM MKT2-UX.5 — contrato de layout `--sticky-bottom-h`.
 *
 * Cada barra fija inferior (COMPRAR de la ficha de carta y de sellado, `SellCartBar`) publica su alto
 * real —con el relleno del área segura— en `document.documentElement` y lo limpia al desmontarse. Si
 * hay varias a la vez, el valor es la MAYOR (no la suma). Una barra oculta por CSS (`lg:hidden`)
 * mide 0. Hoy la consume solo el banner de cookies (`bottom: var(--sticky-bottom-h, 0px)`).
 *
 * ⛔ Nunca se hardcodea la altura de una barra en quien la consume; ⛔ nunca se baja su `z-index`.
 * Uso: `const ref = useStickyBottomBar<HTMLDivElement>();` y `<div ref={ref} …>`.
 */

export const STICKY_BOTTOM_VAR = '--sticky-bottom-h';

/** Registro por variable CSS: cada elemento que publica en ella, con su alto medido. */
const registries = new Map<string, Map<symbol, number>>();

function registry(cssVar: string): Map<symbol, number> {
  let r = registries.get(cssVar);
  if (!r) registries.set(cssVar, (r = new Map()));
  return r;
}

function publish(cssVar: string): void {
  if (typeof document === 'undefined') return;
  const max = Math.max(0, ...registry(cssVar).values());
  const root = document.documentElement;
  if (max > 0) root.style.setProperty(cssVar, `${Math.ceil(max)}px`);
  else root.style.removeProperty(cssVar);
}

/** Solo pruebas: estado del registro de `--sticky-bottom-h`. */
export function stickyBottomHeightsForTest(): number[] {
  return [...registry(STICKY_BOTTOM_VAR).values()];
}

/**
 * Publica el alto real del elemento en `cssVar` (en `<html>`), lo sigue con `ResizeObserver` y lo
 * limpia al desmontarse. Varios a la vez ⇒ la MAYOR. Lo usan las barras fijas (`--sticky-bottom-h`)
 * y el banner de cookies (`--consent-banner-h`, TL D8 2026-10-19: antes repetía este patrón a mano).
 */
export function usePublishedHeight<T extends HTMLElement>(cssVar: string): (node: T | null) => void {
  const key = useRef<symbol>(Symbol(cssVar));
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      const id = key.current;
      if (!node) {
        registry(cssVar).delete(id);
        publish(cssVar);
        return;
      }
      const measure = () => {
        registry(cssVar).set(id, node.offsetHeight);
        publish(cssVar);
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        observer.current = new ResizeObserver(measure);
        observer.current.observe(node);
      }
    },
    [cssVar],
  );

  useEffect(() => {
    const id = key.current;
    return () => {
      observer.current?.disconnect();
      registry(cssVar).delete(id);
      publish(cssVar);
    };
  }, [cssVar]);

  return ref;
}

export function useStickyBottomBar<T extends HTMLElement>(): (node: T | null) => void {
  return usePublishedHeight<T>(STICKY_BOTTOM_VAR);
}
