'use client';

import { useEffect, useState } from 'react';

/**
 * Suscribe a un media query (P-42). SSR/primer render → `false` (evita hydration mismatch:
 * el servidor no sabe el viewport); tras montar, lee el valor real y re-renderiza. En jsdom
 * `matchMedia` está poly-rellenado con `matches:false` (vitest.setup), así que los tests
 * corren la variante MÓVIL por defecto salvo que mockeen `matchMedia`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    // addEventListener es el API moderno; addListener queda como fallback para navegadores viejos.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}
