'use client';

import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';

/**
 * «Boleto» del hero: la ficha de datos del evento como ticket plano y filoso (§CS-UX: esquinas a 0,
 * sin sombras, reglas de 1px). Se mueve con un PARALLAX muy sutil al hacer scroll (librería `motion`,
 * bundleada; ⛔ nada de CDN por la CSP estricta del sitio).
 *
 * El contenido se pinta SSR y es legible sin JS: `motion.div` arranca en `y: 0` (visible) y solo se
 * desplaza en cliente. Con `prefers-reduced-motion: reduce` el parallax se apaga (y queda fijo).
 */
export function HeroTicket({
  facts,
  acceso,
}: {
  facts: readonly { readonly k: string; readonly v: string }[];
  acceso: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  // Desplazamiento pequeño (máx ~36px) relativo al scroll de la página; apagado si se pide menos movimiento.
  const y = useTransform(scrollY, [0, 600], reduce ? [0, 0] : [0, -36]);

  return (
    <motion.div ref={ref} style={{ y }} className="w-full">
      <div className="border border-on-ink-rule">
        {facts.map((f) => (
          <div key={f.k} className="flex items-start justify-between gap-4 border-b border-dashed border-on-ink-rule px-5 py-4">
            <span className="font-mono text-[11px] uppercase leading-none tracking-label text-on-ink-nav">{f.k}</span>
            <span className="text-right font-brand font-bold text-on-ink">{f.v}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <span className="font-mono text-[11px] uppercase leading-none tracking-label text-on-ink-nav">Acceso</span>
          <span className="text-right font-brand font-bold text-[color:var(--hunt-red-up)]">{acceso}</span>
        </div>
      </div>
    </motion.div>
  );
}
