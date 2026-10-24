'use client';

import { useEffect, useState } from 'react';
import { minWidthQuery } from '@/lib/breakpoints';

/** `lg` (DESIGN_SYSTEM §4.4, única fuente `lib/breakpoints.ts`): desde aquí el `aside` sustituye a la barra fija. */
export const CHECKOUT_DESKTOP_QUERY = minWidthQuery('lg');

function read(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(CHECKOUT_DESKTOP_QUERY).matches;
}

/**
 * CHK-MOVIL.2.4 — ¿`aside` (lg+) o barra fija (<lg)? Se decide por JS y no por CSS a propósito: el diseño exige
 * **una sola copia del desglose y del botón PAGAR en el DOM** (dos botones de pago son dos caminos a una sesión,
 * L6). Esto choca con §37.1a («el contenedor nunca se decide por JS»), cuyo motivo es el destello al hidratar y el
 * DOM duplicado: aquí no se da ninguno de los dos, porque el checkout solo se pinta en cliente (`CheckoutView` espera
 * a `useSession().ready`) y el valor inicial ya es el real. La tensión entre las dos reglas va a ux-ui (FRONTEND_NOTES). En jsdom `matchMedia` devuelve `false`
 * (vitest.setup): las pruebas de unidad ven la variante móvil salvo que lo simulen.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(CHECKOUT_DESKTOP_QUERY);
    const onChange = () => setDesktop(mql.matches);
    onChange();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  return desktop;
}
