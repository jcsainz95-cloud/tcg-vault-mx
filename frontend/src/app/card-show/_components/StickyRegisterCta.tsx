'use client';

import { useEffect, useState } from 'react';

/**
 * CTA fija inferior «Regístrate» — SOLO móvil (<sm). Se mantiene OCULTA:
 *  - mientras el HERO está en viewport, para no tapar su propio botón (MENOR-3, tester-e2e 2026-10-17);
 *  - mientras la sección REGISTRO está en viewport (BLOQ-4): si el usuario ya está en los formularios
 *    —o viendo el panel de éxito, que vive dentro de `#registro`— la CTA sobra y estorba (BLOQ-1).
 * Se desliza a la vista solo entre medias (contenido intermedio), cuando lleva al registro sirve.
 *
 * Progressive enhancement: antes de hidratar (y si no hay JS o no se encuentran las secciones)
 * permanece fuera de pantalla, de modo que NUNCA solapa el hero en la primera pintura. El botón del
 * hero y los formularios de la sección «Registro» siguen disponibles sin JS.
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
  // `true` = la sección de registro está (al menos en parte) en viewport ⇒ ocultar la CTA.
  const [registroVisible, setRegistroVisible] = useState(false);

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

  useEffect(() => {
    const registro = document.getElementById('registro');
    if (!registro || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setRegistroVisible(entry.isIntersecting), { threshold: 0 });
    io.observe(registro);
    return () => io.disconnect();
  }, []);

  const shown = pastHero === true && !registroVisible;

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
