'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'motion';

/**
 * Explosión del hero AL CARGAR (restyle 2026-10-18, mock aprobado por JC
 * `scratchpad/cardshow-hero-explosion.html`): anillos de choque desde el centro, ~10 «cartas» que
 * salen disparadas girando, flash breve, sacudida corta, el título «CARD SHOW CDMX» se arma con un
 * golpe (overshoot) y confeti en colores de marca. Implementado con `motion@14.3.0` (API imperativa
 * `animate`, ⛔ no GSAP), bundleada (la CSP prohíbe CDN).
 *
 * PROGRESSIVE ENHANCEMENT / SIN PARPADEO / SIN CLS:
 *  - El hero se pinta y se lee SIN esta isla: el burst es un REALCE decorativo (`aria-hidden`), nunca
 *    requisito para leer el hero. Sus capas (flash, anillos, cartas) nacen con `opacity:0` en el HTML
 *    ⇒ sin JS quedan invisibles y el hero se ve armado.
 *  - `prefers-reduced-motion: reduce` ⇒ la isla NO anima nada (hero estático ya armado, sin ráfaga,
 *    sin flash, sin shake).
 *  - El «golpe» del título es un punch de escala que arranca DESDE EL REPOSO (`scale:[1,…,1]`): nunca
 *    se oculta el título ⇒ sin parpadeo above-the-fold. Solo se anima `transform`/`opacity` ⇒ sin CLS
 *    (las cartas van en una capa `absolute`; el `overflow-hidden` del hero las recorta al salir).
 */

export interface BurstChip {
  /** Etiqueta mono pequeña (rótulo). */
  k: string;
  /** Dato grande. */
  b: string;
  /** Superficie de la carta (decorativa). */
  tone?: 'ink' | 'paper' | 'red';
}

// Geometría/tiempos de referencia del mock del hero: «lejos» y «alto» relativos al viewport.
const TARGETS = [
  { x: -0.55, y: -0.7, r: -34 },
  { x: 0.62, y: -0.5, r: 28 },
  { x: 0.5, y: 0.6, r: -22 },
  { x: -0.6, y: 0.55, r: 30 },
  { x: 0.72, y: 0.08, r: -16 },
  { x: -0.74, y: -0.1, r: 18 },
  { x: 0.28, y: -0.82, r: 40 },
  { x: -0.3, y: 0.85, r: -40 },
  { x: 0.86, y: -0.4, r: 12 },
  { x: -0.88, y: 0.2, r: -12 },
] as const;

const CONFETTI_COLORS = ['#e0353b', '#b31217', '#f4f1ea', '#1a1a18'] as const;

type Controls = { stop: () => void; finished?: Promise<unknown> };

export function HeroExplosion({ chips }: { chips: readonly BurstChip[] }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) return; // reduced-motion ⇒ hero estático; el overlay queda invisible.

    const layer = layerRef.current;
    if (!layer || typeof animate !== 'function') return;

    const section = layer.closest<HTMLElement>('[data-cs-hero]');
    const debris = Array.from(layer.querySelectorAll<HTMLElement>('.cs-debris'));
    const rings = Array.from(layer.querySelectorAll<HTMLElement>('.cs-ring'));
    const flash = layer.querySelector<HTMLElement>('.cs-flash');
    const canvas = layer.querySelector<HTMLCanvasElement>('.cs-confetti');
    const title = section?.querySelector<HTMLElement>('[data-cs-hero-title]') ?? null;
    const shake = section?.querySelector<HTMLElement>('[data-cs-hero-shake]') ?? null;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const far = Math.max(W * 0.5, 320);
    const tall = Math.min(H * 0.42, 380);

    const controls: Controls[] = [];
    const run = (el: Element, keyframes: Record<string, unknown>, options: Record<string, unknown>) => {
      const c = animate(el, keyframes as never, options as never) as unknown as Controls;
      controls.push(c);
      return c;
    };

    if (flash) run(flash, { opacity: [0, 0.85, 0] }, { duration: 0.46, ease: 'easeOut' });

    rings.forEach((ring, i) => {
      run(
        ring,
        { opacity: [0, i ? 0.8 : 1, 0], scale: [0.2, i ? 18 : 26] },
        { duration: i ? 0.72 : 0.62, delay: i ? 0.08 : 0, ease: 'easeOut' },
      );
    });

    debris.forEach((d, i) => {
      const t = TARGETS[i] ?? { x: 0, y: 0, r: 0 };
      const tx = t.x * far;
      const ty = t.y * tall;
      const c = run(
        d,
        { opacity: [0, 1], scale: [0.2, 1], x: [0, tx], y: [0, ty], rotate: [0, t.r] },
        { duration: 0.55, delay: i * 0.018, ease: [0.16, 1, 0.3, 1] },
      );
      // Flotación suave perpetua tras aterrizar (decorativa).
      c.finished
        ?.then(() => {
          run(
            d,
            { y: [ty, ty + (i % 2 ? 10 : -10)], rotate: [t.r, t.r + (i % 2 ? 3 : -3)] },
            { duration: 2.6, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' },
          );
        })
        .catch(() => {});
    });

    // Sacudida corta del contenido del hero (solo transform ⇒ sin CLS).
    if (shake) run(shake, { x: [0, 10, -8, 6, -4, 0] }, { duration: 0.45, ease: 'easeOut' });

    // El título se arma con un golpe (overshoot) desde el reposo ⇒ sin parpadeo ni CLS.
    if (title) run(title, { scale: [1, 1.06, 0.99, 1] }, { duration: 0.5, delay: 0.12, ease: 'easeOut' });

    // Confeti en canvas (colores de marca). Decorativo; se limpia al desmontar.
    let raf = 0;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const rect = layer.getBoundingClientRect();
      const cw = (canvas.width = Math.max(1, Math.round(rect.width)));
      const ch = (canvas.height = Math.max(1, Math.round(rect.height)));
      if (ctx) {
        const parts = Array.from({ length: 150 }, (_, i) => ({
          x: cw / 2,
          y: ch * 0.42,
          vx: (Math.random() - 0.5) * 20,
          vy: Math.random() * -18 - 4,
          g: 0.4 + Math.random() * 0.25,
          s: 5 + Math.random() * 7,
          r: Math.random() * 6,
          vr: (Math.random() - 0.5) * 0.5,
          c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          life: 0,
        }));
        const loop = () => {
          ctx.clearRect(0, 0, cw, ch);
          let alive = false;
          for (const p of parts) {
            if (p.life > 200 || p.y > ch + 40) continue;
            alive = true;
            p.vy += p.g;
            p.x += p.vx;
            p.y += p.vy;
            p.r += p.vr;
            p.life++;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.r);
            ctx.fillStyle = p.c;
            ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
            ctx.restore();
          }
          if (alive) raf = requestAnimationFrame(loop);
          else ctx.clearRect(0, 0, cw, ch);
        };
        raf = requestAnimationFrame(loop);
      }
    }

    return () => {
      for (const c of controls) {
        try {
          c.stop();
        } catch {
          /* noop */
        }
      }
      if (raf) cancelAnimationFrame(raf);
    };
  }, [chips.length]);

  return (
    <div ref={layerRef} aria-hidden className="cs-burst">
      <div className="cs-flash" style={{ opacity: 0 }} />
      <div className="cs-ring" style={{ opacity: 0 }} />
      <div className="cs-ring" style={{ opacity: 0 }} />
      {chips.map((chip, i) => (
        <div key={`${chip.k}-${i}`} className={`cs-debris cs-debris-${chip.tone ?? 'ink'}`} style={{ opacity: 0 }}>
          <span className="cs-debris-k">{chip.k}</span>
          <span className="cs-debris-b">{chip.b}</span>
        </div>
      ))}
      <canvas className="cs-confetti" />
    </div>
  );
}
