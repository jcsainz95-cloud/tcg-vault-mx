'use client';

import { useEffect } from 'react';

/**
 * Motor de movimiento de la landing (restyle 2026-10-18). Isla de cliente que NO pinta nada
 * (`return null`): solo arma los reveals al hacer scroll. El estado y los estilos viven en CSS
 * (`card-show.css`); aquí va la lógica de arranque.
 *
 * PROGRESSIVE ENHANCEMENT (gate ux-review + e2e «sin JS»): el contenido se sirve VISIBLE. Este
 * efecto SOLO corre en cliente y SOLO si el usuario no pidió menos movimiento; recién entonces pone
 * `data-cs-motion` en el raíz, que es lo único que activa el estado «oculto hasta revelar» del CSS.
 *
 * SIN PARPADEO (above-the-fold): antes de armar el motor, marca como ya revelados (`cs-in`) los
 * bloques que YA están en viewport. Como marcar + armar ocurre en el MISMO bloque síncrono (sin
 * repintado intermedio), los bloques visibles nunca pierden opacidad. Los de abajo del pliegue
 * arrancan ocultos (están fuera de pantalla, no se ve el salto) y se revelan al entrar.
 *
 * SIN CLS: solo anima `opacity` y `transform` (no refluye el layout).
 */
export function CardShowMotion() {
  useEffect(() => {
    const prefersReduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) return;

    const root = document.querySelector<HTMLElement>('[data-cs-root]');
    if (!root) return;

    const items = Array.from(document.querySelectorAll<HTMLElement>('.cs-reveal'));
    if (items.length === 0) return;

    // 1) Marca como revelados los que ya están (casi) en viewport, ANTES de armar el motor.
    const vh = window.innerHeight || document.documentElement.clientHeight;
    for (const el of items) {
      if (el.getBoundingClientRect().top < vh * 0.9) el.classList.add('cs-in');
    }
    // 2) Arma el motor (mismo bloque síncrono ⇒ sin repintado entre 1 y 2 ⇒ sin parpadeo).
    root.setAttribute('data-cs-motion', '');

    // 3) Revela el resto al entrar en viewport.
    if (typeof IntersectionObserver === 'undefined') {
      for (const el of items) el.classList.add('cs-in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('cs-in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.01 },
    );
    for (const el of items) {
      if (!el.classList.contains('cs-in')) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  return null;
}
