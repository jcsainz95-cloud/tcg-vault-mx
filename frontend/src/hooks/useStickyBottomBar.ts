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

const heights = new Map<symbol, number>();

function publish(): void {
  if (typeof document === 'undefined') return;
  const max = Math.max(0, ...heights.values());
  const root = document.documentElement;
  if (max > 0) root.style.setProperty(STICKY_BOTTOM_VAR, `${Math.ceil(max)}px`);
  else root.style.removeProperty(STICKY_BOTTOM_VAR);
}

/** Solo pruebas: estado del registro. */
export function stickyBottomHeightsForTest(): number[] {
  return [...heights.values()];
}

export function useStickyBottomBar<T extends HTMLElement>(): (node: T | null) => void {
  const key = useRef<symbol>(Symbol('sticky-bottom-bar'));
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const id = key.current;
    if (!node) {
      heights.delete(id);
      publish();
      return;
    }
    const measure = () => {
      heights.set(id, node.offsetHeight);
      publish();
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    }
  }, []);

  useEffect(() => {
    const id = key.current;
    return () => {
      observer.current?.disconnect();
      heights.delete(id);
      publish();
    };
  }, []);

  return ref;
}
