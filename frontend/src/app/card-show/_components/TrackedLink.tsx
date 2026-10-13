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
}: {
  destino: string;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => trackClick({ destino })}
    >
      {children}
    </a>
  );
}
