'use client';

import { trackClick } from '@/lib/card-show-clicks';

/**
 * Enlace que cuenta el clic de PRIMERA PARTE (§CARDSHOW.13) vía `sendBeacon` y luego deja que el
 * navegador siga al `href`. El `href` funciona SIN JS (progressive enhancement): si no hidrata, es
 * un ancla normal; la medición es la mejora.
 */
export function TrackedLink({
  destino,
  href,
  className,
  children,
  target,
  rel,
  'aria-label': ariaLabel,
}: {
  destino: string;
  href: string;
  className?: string;
  children: React.ReactNode;
  target?: string;
  rel?: string;
  'aria-label'?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      target={target}
      rel={target === '_blank' ? (rel ?? 'noopener noreferrer') : rel}
      aria-label={ariaLabel}
      onClick={() => trackClick({ destino })}
    >
      {children}
    </a>
  );
}
