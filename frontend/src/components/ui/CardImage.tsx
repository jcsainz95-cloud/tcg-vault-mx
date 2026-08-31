'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

export interface CardImageProps {
  /**
   * `null` es un valor LEGÍTIMO, no un error: `OrderItemCardDTO.imageSmallUrl` es
   * `string | null` por contrato (v1.51-b §4) y varias rutas la sirven opcional. Se acepta
   * aquí para que las vistas no tengan que hacer `?? undefined` una por una.
   */
  src?: string | null;
  alt: string;
  className?: string;
  /**
   * PERF (opt-in, default `false` = conducta previa intacta): marca ESTA imagen como
   * candidata a LCP ⇒ `loading="eager"` + `fetchpriority="high"`, y sin fade-in
   * (el `opacity-0 → opacity-100` añade un salto perceptible justo en la métrica que
   * mide cuándo se ve la página).
   *
   * REGLA DE USO: como MUCHO una imagen por pantalla, y solo si está sobre el pliegue
   * (hoy: la teja LÍDER del carrusel de la home). En rejillas/listas NO se usa: ahí
   * `lazy` es lo correcto y varias `high` a la vez se compiten el ancho de banda entre
   * sí, que es exactamente lo contrario de lo que se busca.
   */
  priority?: boolean;
  /**
   * Se llama UNA vez cuando la imagen deja de estar en vuelo: `load` o `error` (un 404 no puede
   * dejar a nadie esperando). Sin `src` **no** se llama: no hay nada que esperar y quien la use debe
   * tratar ese caso como «ya está», no como «cargando».
   *
   * Único consumidor hoy: la teja líder del carrusel de la home, que la usa como precondición 3 de
   * §23.3 — la rotación automática **no arranca hasta que la foto está**, que es la condición que
   * garantiza que el movimiento nunca coexista con un estado de carga (R2, §23.1).
   */
  onLoaded?: () => void;
}

/**
 * `fetchpriority` va en MINÚSCULAS a propósito. react-dom 18 no conoce el atributo: con la
 * grafía camelCase (`fetchPriority`, la única que declara @types/react) avisa en consola
 * —«React does not recognize the fetchPriority prop on a DOM element»— y ensucia los tests;
 * en minúsculas lo pasa tal cual al DOM, que es lo que el navegador lee (los atributos HTML
 * son case-insensitive). El `as` solo tapa el hueco de tipos, no cambia lo que se emite.
 * Cuando el proyecto suba a React 19 esto puede volver a `fetchPriority` sin más.
 */
const HIGH_FETCH_PRIORITY = { fetchpriority: 'high' } as unknown as { fetchPriority: 'high' };

/**
 * Imagen de carta 5:7 (DESIGN_SYSTEM §5).
 * Dirección 5a: el arte se apoya en un pozo de papel más oscuro, sin borde ni
 * esquina redondeada — la carta ya trae su propio marco.
 */
export function CardImage({ src, alt, className, priority = false, onLoaded }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const settle = () => {
    setLoaded(true);
    onLoaded?.();
  };
  // Con `priority` no hay fade: la imagen se pinta en cuanto llega. Un `opacity-0` que
  // espera al `onLoad` retrasa el PINTADO (y por tanto el LCP) aunque los bytes ya estén.
  const visible = loaded || priority;
  return (
    <div className={cn('relative flex aspect-[5/7] items-center justify-center bg-surface-2 p-3', className)}>
      {/* El esqueleto pulsa SOLO mientras hay una imagen en vuelo. Sin `src` no hay nada que
          esperar: un `animate-pulse` eterno se lee como «cargando» y hace que un dato ausente
          —legítimo: `imageSmallUrl` es nullable por contrato— parezca una app colgada. Sin
          `src` queda el pozo de papel quieto, que ES el placeholder que pide el contrato. */}
      {src && !loaded && <div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />}
      {src && (
        // datos de catálogo en inglés → lang="en" para lectores (DESIGN_SYSTEM §9.2)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          lang="en"
          loading={priority ? 'eager' : 'lazy'}
          {...(priority ? HIGH_FETCH_PRIORITY : {})}
          // Decodificación fuera del hilo principal: no bloquea el pintado del resto de la
          // teja mientras el navegador descomprime el JPEG. Barato y sin efecto visual.
          decoding="async"
          onLoad={settle}
          onError={settle}
          className={cn(
            'h-full w-full object-contain transition-opacity',
            visible ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
