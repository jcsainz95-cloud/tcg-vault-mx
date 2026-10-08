'use client';

import { useQueries } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getAccessory } from '@/lib/api';
import type { CartAccessory } from '@/lib/cart';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { SignedInAccessoryNotice } from '@/components/domain/accessories/SignedInNotice';

/**
 * Accesorios del carrito LOCAL con sesión abierta (`DESIGN_SYSTEM §AC-UX.4`, AC-F7): «NO VAN EN ESTE PAGO». No se
 * borran, no suman al total y ⛔ el checkout con cuenta nunca los manda. El nombre y la foto salen de la ficha
 * pública (`GET /accessories/:id`); ⛔ sin precio (no se cobran aquí). Cada renglón con «Quitar».
 */
export function SignedInAccessoriesBlock({ accessories, onRemove }: { accessories: CartAccessory[]; onRemove: (id: string) => void }) {
  const t = useTranslations('checkout.accessories');
  const tc = useTranslations('checkout');
  const details = useQueries({
    queries: accessories.map((a) => ({ queryKey: ['accessory', a.id], queryFn: () => getAccessory(a.id), retry: false, staleTime: 60_000 })),
  });
  if (accessories.length === 0) return null;
  return (
    <section data-testid="accessories-not-in-payment" className="mt-6 border-t border-border-strong bg-surface-2 p-5">
      <p className="eyebrow">{t('notInThisPayment')}</p>
      <SignedInAccessoryNotice className="mt-3 border-t-0 pt-0" />
      <ul className="mt-3">
        {accessories.map((a, i) => {
          const name = details[i]?.data?.name ?? '…';
          return (
            <li key={a.id} className="flex items-center gap-4 border-t border-border py-3">
              <AccessoryPhoto src={details[i]?.data?.photo.thumbUrl} alt="" fallbackText={name} className="h-16 w-16 shrink-0" />
              <span className="min-w-0 flex-1 text-[15px] text-text">{name}</span>
              <span className="tabular font-mono text-sm text-muted">{t('qty', { qty: a.qty })}</span>
              <button
                type="button"
                aria-label={t('removeAria', { name })}
                onClick={() => onRemove(a.id)}
                className="font-mono text-[11px] text-muted hover:text-accent"
              >
                {tc('removeItem')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
