'use client';

import { useCallback, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { getAccessory } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useCart } from '@/lib/cart';
import { useSession } from '@/lib/session';
import { formatMoneyCents } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { QuantityStepper } from '@/components/domain/accessories/QuantityStepper';
import { SignedInAccessoryNotice } from '@/components/domain/accessories/SignedInNotice';
import { CartAddedToast } from '../../catalog/CartAddedToast';

/**
 * Ficha de accesorio (`API_CONTRACT §AC.3`, `DESIGN_SYSTEM §AC-UX.3/.4`). El selector va de 1 a
 * `maxQty − lo que ya hay en el carrito` (AC-UX-3): `maxQty` es el único rastro del disponible y ⛔ no se pinta
 * como número propio. El precio es `priceCents` del servidor. `404 ACCESSORY_NOT_FOUND` ⇒ «ya no está a la venta».
 */
export function AccessoryDetailView({ id }: { id: string }) {
  const t = useTranslations('accessories');
  const locale = useLocale() as AppLocale;
  const query = useQuery({ queryKey: ['accessory', id], queryFn: () => getAccessory(id), retry: false });
  const cart = useCart();
  const { isAuthenticated } = useSession();
  const [qty, setQty] = useState(1);
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);
  const reasonId = useId();

  if (query.isLoading) {
    return (
      <div className="gutter grid gap-10 py-12 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-6 w-1/3" />
        </div>
      </div>
    );
  }
  if (query.isError) {
    const err = asApiError(query.error);
    if (err?.status === 404) {
      return (
        <div className="gutter flex flex-col items-center gap-5 py-24 text-center">
          <h1 className="font-serif text-[30px] leading-tight text-text">{t('notFoundTitle')}</h1>
          <Link href="/accesorios" className="text-sm text-accent underline underline-offset-4 hover:text-text">
            {t('notFoundCta')}
          </Link>
        </div>
      );
    }
    return (
      <div className="gutter py-12">
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {t('loadError')}
        </Banner>
      </div>
    );
  }
  const item = query.data!;
  const inCart = cart.accessories.find((a) => a.id === item.id)?.qty ?? 0;
  const room = Math.max(0, item.maxQty - inCart);
  const value = Math.min(Math.max(1, qty), Math.max(1, room));
  const soldOut = item.soldOut || item.maxQty <= 0;
  const category = t(`category.${item.category}`);
  const eyebrow = item.energyType ? t('categoryWithType', { category, type: t(`energyType.${item.energyType}`) }) : category;

  return (
    <div className="gutter py-10">
      <Link href="/accesorios" className="font-mono text-xs tracking-[0.06em] text-muted hover:text-text">
        ← {t('back')}
      </Link>
      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <AccessoryPhoto src={item.photo.url} alt={item.name} fallbackText={item.name} eager className="w-full" />
        <div className="flex flex-col gap-5">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{item.name}</h1>
          <div>
            <p className="tabular text-[30px] font-medium leading-none text-text">{formatMoneyCents(item.priceCents, locale)}</p>
            <p className="mt-1.5 text-xs text-muted">{t('vatIncluded')}</p>
          </div>
          {item.description && <p className="whitespace-pre-line text-base leading-relaxed text-text">{item.description}</p>}

          {soldOut ? (
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-label text-muted">{t('soldOut')}</span>
              <p className="text-sm text-muted">{t('soldOutBody')}</p>
            </div>
          ) : isAuthenticated ? (
            <SignedInAccessoryNotice />
          ) : (
            <div className="flex flex-col gap-4">
              {room > 0 && (
                <QuantityStepper
                  label={t('quantity')}
                  value={value}
                  min={1}
                  max={room}
                  onChange={setQty}
                  hint={t('maxHint', { n: room })}
                />
              )}
              <Button
                variant="primary"
                className="w-full sm:w-auto sm:self-start"
                disabled={room === 0}
                aria-describedby={room === 0 ? reasonId : undefined}
                onClick={() => {
                  cart.addAccessory(item.id, value);
                  setQty(1);
                  setAddedSignal(Date.now());
                }}
              >
                {t('addToCart')}
              </Button>
              {room === 0 && (
                <p className="text-sm text-muted">
                  <span id={reasonId}>{t('allInCart')}</span>{' '}
                  <Link href="/checkout" className="text-accent underline underline-offset-4 hover:text-text">
                    {t('goToCart')}
                  </Link>
                </p>
              )}
            </div>
          )}
          <p className="text-sm text-muted">{t('shipsHome')}</p>
        </div>
      </div>
      <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
    </div>
  );
}
