'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'motion';

/**
 * Explosión del hero — GOLPE DE ENTRADA DE UNA SOLA VEZ (restyle RONDA 3, decisión JC 2026-10-18 «que
 * se desvanezcan»). Anillos de choque + ~10 «cartas» salen disparadas con fuerza desde el centro, flash
 * breve, sacudida corta, el título «CARD SHOW CDMX» se arma con un golpe (overshoot) y confeti en
 * colores de marca. Implementado con `motion@14.3.0` (API imperativa `animate`, ⛔ no GSAP), bundleada
 * (la CSP prohíbe CDN).
 *
 * ⛔ NADA se queda en reposo encima del texto y NADA anima en bucle detrás de él (RONDA 2 B-1,
 * WCAG 2.2.2): las cartas, tras salir disparadas, se DESVANECEN (fade out) y se retiran. El estado final
 * del hero es la composición LIMPIA y legible — idéntica a la vista `prefers-reduced-motion` (título,
 * lede, CTAs, contador, ticket, sin nada encima). No hay `repeat:Infinity`.
 *
 * UNA SOLA VEZ POR SESIÓN (RONDA 3 I-2): si `sessionStorage` ya marcó la ráfaga como vista, la isla no
 * anima nada (hero limpio directo, sin flash ni cartas). Lectura/escritura envueltas en try/catch
 * (Safari privado lanza al tocar `sessionStorage`).
 *
 * PROGRESSIVE ENHANCEMENT / SIN PARPADEO / SIN CLS:
 *  - El hero se pinta y se lee SIN esta isla: el burst es un REALCE decorativo (`aria-hidden`), nunca
 *    requisito para leer el hero. Sus capas (flash, anillos, cartas) nacen con `opacity:0` en el HTML
 *    ⇒ sin JS quedan invisibles y el hero se ve armado.
 *  - `prefers-reduced-motion: reduce` ⇒ la isla NO anima nada (hero estático ya armado, sin ráfaga).
 *  - El «golpe» del título es un punch de escala que arranca DESDE EL REPOSO (`scale:[1,…,1]`) y vuelve
 *    a él: nunca se oculta el título ⇒ sin parpadeo above-the-fold. Solo se anima `transform`/`opacity`
 *    ⇒ sin CLS (las cartas van en una capa `absolute`; el `overflow-hidden` del hero las recorta al salir).
 *
 * LIMPIEZA AL DESMONTAR (RONDA 3, cierra deuda FE-CS-B): una bandera `cancelled` se comprueba antes de
 * crear CUALQUIER trabajo diferido (el bucle de confeti), de modo que un desmontaje a mitad de la ráfaga
 * no deja ninguna animación ni `requestAnimationFrame` vivos.
 */

export interface BurstChip {
  /** Etiqueta mono pequeña (rótulo). */
  k: string;
  /** Dato grande. */
  b: string;
  /** Superficie de la carta (decorativa). */
  tone?: 'ink' | 'paper' | 'red';
}

// Direcciones de salida de las cartas (normalizadas): «lejos» y «alto» relativos al viewport. Salen
// disparadas hacia los bordes y se van fuera de cuadro al desvanecerse ⇒ pasan poco tiempo sobre el texto.
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

// Marca de sesión: una vez que la ráfaga corrió, no se repite al recargar/navegar dentro de la pestaña.
const SEEN_KEY = 'cs-hero-burst-seen';

type Controls = { stop: () => void };

/** Lee la marca de sesión sin romper si `sessionStorage` lanza (Safari privado, cookies bloqueadas). */
function burstAlreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Marca la ráfaga como vista; silencioso si `sessionStorage` lanza. */
function markBurstSeen(): void {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* noop */
  }
}

export function HeroExplosion({ chips }: { chips: readonly BurstChip[] }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduce) return; // reduced-motion ⇒ hero estático; el overlay queda invisible.

    // I-2: la ráfaga corre UNA sola vez por sesión. Si ya se vio ⇒ hero limpio directo (sin ráfaga).
    if (burstAlreadySeen()) return;

    const layer = layerRef.current;
    if (!layer || typeof animate !== 'function') return;

    // A partir de aquí SÍ corre la ráfaga: marcarla antes de animar evita que un reload a mitad la repita.
    markBurstSeen();

    const section = layer.closest<HTMLElement>('[data-cs-hero]');
    const debris = Array.from(layer.querySelectorAll<HTMLElement>('.cs-debris'));
    const rings = Array.from(layer.querySelectorAll<HTMLElement>('.cs-ring'));
    const flash = layer.querySelector<HTMLElement>('.cs-flash');
    const canvas = layer.querySelector<HTMLCanvasElement>('.cs-confetti');
    const title = section?.querySelector<HTMLElement>('[data-cs-hero-title]') ?? null;
    const shake = section?.querySelector<HTMLElement>('[data-cs-hero-shake]') ?? null;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const far = Math.max(W * 0.58, 340);
    const tall = Math.min(H * 0.46, 420);

    // Bandera de limpieza: cualquier trabajo diferido (confeti) la comprueba antes de programarse (FE-CS-B).
    let cancelled = false;

    const controls: Controls[] = [];
    const run = (el: Element, keyframes: Record<string, unknown>, options: Record<string, unknown>) => {
      const c = animate(el, keyframes as never, options as never) as unknown as Controls;
      controls.push(c);
      return c;
    };

    if (flash) run(flash, { opacity: [0, 0.85, 0] }, { duration: 0.46, ease: 'easeOut' });

    // Anillos: onda tenue (anillo fino que se expande y se apaga), ⛔ ya no un cuadro ×26 que lee como
    // glitch a 1280 (RONDA 3 I-2). Esquinas 0 de la marca (sin border-radius, ver `card-show.css`).
    rings.forEach((ring, i) => {
      run(
        ring,
        { opacity: [0, i ? 0.4 : 0.55, 0], scale: [0.2, i ? 3 : 2.4] },
        { duration: i ? 0.72 : 0.6, delay: i ? 0.08 : 0, ease: 'easeOut' },
      );
    });

    // Cartas: salen disparadas hacia los bordes (0→0.32), aguantan un instante (0.32→0.6) y luego se
    // DESVANECEN mientras siguen de salida + encogen (0.6→1) ⇒ terminan en opacity 0, retiradas. Sin
    // encadenar al final de la animación ni bucle ⇒ nada queda sobre el texto y nada anima en bucle (B-1).
    debris.forEach((d, i) => {
      const t = TARGETS[i] ?? { x: 0, y: 0, r: 0 };
      const tx = t.x * far;
      const ty = t.y * tall;
      run(
        d,
        {
          opacity: [0, 1, 1, 0],
          scale: [0.2, 1, 1, 0.8],
          x: [0, tx, tx * 1.08, tx * 1.2],
          y: [0, ty, ty * 1.08, ty * 1.2],
          rotate: [0, t.r, t.r, t.r * 1.2],
        },
        { duration: 1.5, delay: i * 0.02, times: [0, 0.32, 0.6, 1], ease: [0.16, 1, 0.3, 1] },
      );
    });

    // Sacudida corta del contenido del hero (solo transform ⇒ sin CLS) — vuelve al reposo.
    if (shake) run(shake, { x: [0, 10, -8, 6, -4, 0] }, { duration: 0.45, ease: 'easeOut' });

    // El título se arma con un golpe (overshoot) desde el reposo y vuelve a él ⇒ sin parpadeo ni CLS.
    if (title) run(title, { scale: [1, 1.06, 0.99, 1] }, { duration: 0.5, delay: 0.12, ease: 'easeOut' });

    // Confeti en canvas (colores de marca). Decorativo; de una sola vez (las partículas mueren por `life`).
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
          if (cancelled) return; // FE-CS-B: tras desmontar no se reprograma ni se dibuja.
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
        if (!cancelled) raf = requestAnimationFrame(loop);
      }
    }

    return () => {
      cancelled = true;
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
