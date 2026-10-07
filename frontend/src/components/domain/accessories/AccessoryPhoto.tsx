'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { config } from '@/lib/config';
import { resolveApiAssetUrl } from '@/lib/accessories';

/**
 * Foto de accesorio (`DESIGN_SYSTEM §AC-UX.2/.3`): cuadrada, `object-contain`, regla de 1 px, pozo `surface-2`
 * mientras carga. Si no hay foto o falla: el respaldo de §5 (recuadro con el nombre), ⛔ nunca un icono roto.
 * `<img>` crudo como `CardImage`; la ruta de la API se ancla a su origen (`resolveApiAssetUrl`). CSP: `img-src … https:`
 * (`security/csp.ts:128`) ⇒ una API en `http:` (stack local) quedaría fuera en modo `enforce` (NO MEDIDO en navegador).
 */
export function AccessoryPhoto({
  src,
  alt,
  fallbackText,
  className,
  eager,
  dim,
}: {
  src: string | null | undefined;
  /** `''` cuando el nombre ya está como texto junto a la imagen (§AC-UX.14). */
  alt: string;
  /** Texto del respaldo (normalmente el nombre). */
  fallbackText: string;
  className?: string;
  eager?: boolean;
  /** Agotado: foto atenuada. */
  dim?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // El backend sirve la foto como RUTA de la API (sin origen): se ancla al origen de la API (FRONTEND_NOTES §107).
  const url = resolveApiAssetUrl(src, config.apiBaseUrl);
  const showFallback = !url || failed;
  return (
    <div className={cn('relative aspect-square overflow-hidden border border-border bg-surface-2', className)}>
      {showFallback ? (
        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-muted" aria-hidden={alt === ''}>
          {fallbackText}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url!}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailed(true)}
          className={cn('h-full w-full object-contain', dim && 'opacity-60')}
        />
      )}
    </div>
  );
}
