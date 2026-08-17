'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * Toast de confirmación al agregar una pieza al carrito (DESIGN_SYSTEM §7.5:
 * efímero, 4–6 s, esquina; solo confirmaciones no críticas). Es un bloque de
 * tinta sobre papel (scrim §7.2b), texto mono en versalitas, radio 0.
 *
 * Vive en el módulo de catálogo (no en `src/components/`) a propósito: no hay
 * infra global de toasts y las zonas compartidas pertenecen a otro stream, así
 * que el componente queda junto a sus dos consumidores (CatalogView y
 * CardDetailView). Si otro módulo lo necesita, promoverlo pasa por el stream
 * dueño de `src/components/`.
 *
 * `signal` es un timestamp (>0 = visible): cada add reinicia el timer de
 * auto-cierre aunque el toast ya esté abierto.
 */
export function CartAddedToast({ signal, onDismiss }: { signal: number; onDismiss: () => void }) {
  const t = useTranslations('catalog');

  useEffect(() => {
    if (!signal) return;
    const id = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(id);
  }, [signal, onDismiss]);

  return (
    // La región vive SIEMPRE en el DOM para que aria-live anuncie el cambio (§8.2).
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-50">
      {signal > 0 && (
        <div className="pointer-events-auto flex items-center gap-5 bg-ink px-5 py-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-on-ink">
            {t('addedToCart')}
          </span>
          {/* El carrito vive en /checkout (misma ruta que el badge del StorefrontHeader). */}
          <Link
            href="/checkout"
            className="font-mono text-[11px] uppercase tracking-[0.06em] text-on-ink underline underline-offset-4 hover:text-on-ink-muted"
          >
            {t('viewCart')}
          </Link>
        </div>
      )}
    </div>
  );
}
