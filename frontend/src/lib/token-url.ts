'use client';

import { useEffect, useLayoutEffect } from 'react';

/**
 * D-CTA-10 (API_CONTRACT §CTA.6, v1.117.1; ARCHITECTURE §16.1) — **una sola regla para las tres páginas con token en
 * la URL** (`/account-setup`, `/reset-password`, `/verify-email`). Esta es la pata (1): leer el token y QUITARLO de la
 * URL con `history.replaceState` (misma ruta, mismo idioma, sin `token`) **antes de cualquier otra petición**, incluida
 * la del propio canje. Así el token no queda en el historial ni viaja en el `Referer` de las peticiones siguientes.
 * La pata (2) es la cabecera `Referrer-Policy: no-referrer` por ruta (`next.config.mjs`, `TOKEN_PAGE_SOURCE`) y la (3),
 * que ninguna de las tres está en la lista blanca de medición (`lib/measurement/routes.ts`). Candados: CTA-F4 y CTA-F8.
 *
 * El token ya lo leyó el componente de servidor (`searchParams`) y llega por props: quitarlo de la barra no lo pierde.
 */
export const TOKEN_PAGES = ['account-setup', 'reset-password', 'verify-email'] as const;

export function stripTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

// `useLayoutEffect` corre antes que cualquier `useEffect` del árbol (incluidos los que piden datos); en el servidor
// no existe y React avisa, así que allí se usa `useEffect` (que tampoco corre en el servidor).
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Quita el token de la URL al montar, antes que cualquier efecto que pida datos (D-CTA-10 (1)). */
export function useStripTokenFromUrl(): void {
  useIsoLayoutEffect(() => {
    stripTokenFromUrl();
  }, []);
}
