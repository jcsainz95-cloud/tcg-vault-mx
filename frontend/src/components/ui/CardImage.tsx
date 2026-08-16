'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

export interface CardImageProps {
  src?: string;
  alt: string;
  className?: string;
}

/**
 * Imagen de carta 5:7 (DESIGN_SYSTEM §5).
 * Dirección 5a: el arte se apoya en un pozo de papel más oscuro, sin borde ni
 * esquina redondeada — la carta ya trae su propio marco.
 */
export function CardImage({ src, alt, className }: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cn('relative flex aspect-[5/7] items-center justify-center bg-surface-2 p-3', className)}>
      {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />}
      {src && (
        // datos de catálogo en inglés → lang="en" para lectores (DESIGN_SYSTEM §9.2)
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          lang="en"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={cn(
            'h-full w-full object-contain transition-opacity',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
