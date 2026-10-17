'use client';

import { useEffect, useState } from 'react';

/**
 * CTA fija inferior «Regístrate» — SOLO móvil (<sm). Se mantiene OCULTA mientras el hero está en
 * viewport para no tapar el botón «Regístrate gratis» del propio hero (MENOR-3, tester-e2e
 * 2026-10-17); se desliza hacia arriba en cuanto el usuario deja atrás el hero por completo.
 *
 * Progressive enhancement: antes de hidratar (y si no hay JS o no se encuentra el hero) permanece
 * fuera de pantalla, de modo que NUNCA solapa el hero en la primera pintura. El botón del hero y los
 * formularios de la sección «Registro» siguen disponibles sin JS.
 */
export function StickyRegisterCta({
  href,
  label,
  anchorClassName,
}: {
  href: string;
  label: string;
  anchorClassName: string;
}) {
  // `null` = aún sin medir (SSR / pre-hidratación): off-screen. `true` = hero ya fuera de viewport.
  const [pastHero, setPastHero] = useState<boolean | null>(null);

  useEffect(() => {
    const hero = document.getElementById('hero');
    if (!hero || typeof IntersectionObserver === 'undefined') {
      setPastHero(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setPastHero(!entry.isIntersecting), { threshold: 0 });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  const shown = pastHero === true;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 border-t border-border-strong bg-bg p-3 transition-transform duration-200 sm:hidden ${
        shown ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      }`}
      aria-hidden={!shown}
    >
      <a href={href} className={anchorClassName} tabIndex={shown ? undefined : -1}>
        {label}
      </a>
    </div>
  );
}
