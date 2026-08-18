'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { clearUnavailableNotice, useUnavailableNotice } from './unavailable-notice';

/**
 * Aviso INFORMATIVO de poda (v1.21.3-quote-prune): «X ya no está disponible y se
 * quitó de tu carrito». Es variante `info` a propósito (regla fina neutra, tinta
 * muted, `role="status"`) — no es un error del usuario ni de la plataforma, así que
 * nada de bermellón ni `role="alert"` (DESIGN_SYSTEM: "lo informativo no compite
 * con el acento"). Se cierra con la X (limpia el store) o al salir del checkout.
 */
export function UnavailableItemsNotice({ className }: { className?: string }) {
  const t = useTranslations('checkout.unavailable');
  const items = useUnavailableNotice();
  if (items.length === 0) return null;

  const named = items.map((i) => i.cardName).filter((n): n is string => !!n);
  const single = items.length === 1 ? items[0] : null;

  return (
    <div data-testid="unavailable-notice" className={className}>
      <Banner
        variant="info"
        role="status"
        action={
          <button
            type="button"
            onClick={clearUnavailableNotice}
            aria-label={t('dismiss')}
            className="ml-1 shrink-0 p-1 text-muted hover:text-text"
          >
            <X size={16} />
          </button>
        }
      >
        {single ? (
          single.cardName ? t('one', { cardName: single.cardName }) : t('oneGeneric')
        ) : (
          <>
            {t('many', { count: items.length })}
            {named.length > 0 && (
              <span className="mt-1 block font-mono text-[11px] leading-relaxed" lang="en">
                {named.join(' · ')}
              </span>
            )}
          </>
        )}
      </Banner>
    </div>
  );
}
