'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { getSealedGroupDetail } from '@/lib/api';
import type { SealedGroupDetailResponse } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { useCart } from '@/lib/cart';
import { Link, useRouter } from '@/i18n/navigation';
import { CartAddedToast } from '../../catalog/CartAddedToast';
import { CardImage } from '@/components/ui/CardImage';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { SealedValueTrend } from './SealedValueTrend';
import { SealedRestockForm } from './SealedRestockForm';
import { StockBadge } from '../StockBadge';

/**
 * Ficha del producto SELLADO (contrato §2-S · GET /catalog/sealed/:inventoryItemId). Selección de
 * cantidad (carrito por-pieza: agrega las N piezas más baratas del grupo) y destino recibir/bóveda
 * vía el checkout existente (§4/§4-G). Tendencia de valor y «avísame cuando vuelva» quedan cableados
 * pero gateados por feature-flag (trendEnabled/restockEnabled).
 */
export function SealedDetailView({ inventoryItemId }: { inventoryItemId: string }) {
  const cart = useCart();
  const [addedSignal, setAddedSignal] = useState(0);
  const dismissToast = useCallback(() => setAddedSignal(0), []);

  const query = useQuery({
    queryKey: ['sealed-detail', inventoryItemId],
    queryFn: () => getSealedGroupDetail(inventoryItemId),
  });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={
        <div className="gutter grid gap-10 py-14 lg:grid-cols-2">
          <Skeleton className="aspect-[5/7] w-full max-w-sm" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      }
    >
      {query.data && (
        <>
          <Detail
            detail={query.data}
            onAdd={(ids) => {
              ids.forEach((id) => cart.add(id));
              setAddedSignal(Date.now());
            }}
          />
          <CartAddedToast signal={addedSignal} onDismiss={dismissToast} />
        </>
      )}
    </QueryState>
  );
}

function Detail({
  detail,
  onAdd,
}: {
  detail: SealedGroupDetailResponse;
  onAdd: (inventoryItemIds: string[]) => void;
}) {
  const t = useTranslations('sealed');
  const tSub = useTranslations('status.sealedSubtype');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { group, listings, trendEnabled, restockEnabled } = detail;
  const cart = useCart();

  const available = group.availableCount;
  const [qty, setQty] = useState(1);
  const clampedQty = Math.max(1, Math.min(qty, available));

  // Carrito por-pieza: agregar N = las N piezas MÁS BARATAS del grupo (listings ya vienen así).
  const idsToAdd = listings.slice(0, clampedQty).map((l) => l.inventoryItemId);
  const inCartCount = idsToAdd.filter((id) => cart.ids.includes(id)).length;
  const allInCart = inCartCount === idsToAdd.length && idsToAdd.length > 0;

  const captured = group.referenceValue.capturedDate
    ? formatDate(group.referenceValue.capturedDate, locale)
    : undefined;

  return (
    <div>
      <nav
        aria-label="Breadcrumb"
        className="gutter flex items-center gap-3 border-b border-border py-5 font-mono text-xs tracking-[0.06em] text-muted"
      >
        <Link href="/sellado" className="hover:text-text">
          {t('detail.backToShop')}
        </Link>
        <span aria-hidden>›</span>
        <span className="text-text" aria-current="page" lang="en">
          {group.productName}
        </span>
      </nav>

      <div className="grid lg:grid-cols-2">
        <div className="flex items-center justify-center border-b border-border bg-surface-2 px-6 py-10 lg:border-b-0 lg:border-r lg:px-11 lg:py-14">
          <CardImage
            src={group.imageUrl ?? undefined}
            alt={group.productName}
            className="w-full max-w-[420px] bg-transparent p-0"
          />
        </div>

        <div className="gutter py-10 lg:py-14">
          <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:text-[46px]" lang="en">
            {group.productName}
          </h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.1em] text-muted" lang="en">
            {group.card.setName}
          </p>

          {/* Calidad: badge «Sellado» + subtipo + condición legible (visible al comprador, §2-S). */}
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.06em]">
            <Badge tone="info" shape="soft">
              {t('badge')}
            </Badge>
            {group.sealedSubtype && <span className="text-text">{tSub(group.sealedSubtype)}</span>}
            <span className={group.sealedCondition === 'mint' ? 'text-success' : 'text-accent'}>
              {t(`condition.${group.sealedCondition}`)}
            </span>
          </div>
          {group.sealedCondition === 'minor_box_damage' && (
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('detail.minorDamageNote')}</p>
          )}

          {/* Precio: desde (mínimo del grupo) + valor de mercado informativo. */}
          <div className="mt-9 grid border-t border-border sm:grid-cols-2">
            <div className="border-b border-border py-6">
              <div className="eyebrow">{t('fromPrice')}</div>
              <div className="mt-2.5 tabular text-3xl font-medium leading-none text-text">
                {formatMoneyCents(group.fromPriceCents, locale)}
              </div>
              <div className="mt-2 font-mono text-[11px] leading-none text-muted">{t('withoutIva')}</div>
            </div>
            <div className="border-b border-border py-6 sm:border-l sm:pl-7">
              <div className="eyebrow">{t('detail.marketValue')}</div>
              <div className="mt-2.5 tabular text-3xl font-medium leading-none text-text">
                {group.referenceValue.status === 'priced' &&
                group.referenceValue.referenceMxnCents != null
                  ? formatMoneyCents(group.referenceValue.referenceMxnCents, locale)
                  : '—'}
              </div>
              {captured && (
                <div className="mt-2 font-mono text-[11px] leading-none text-muted">{captured}</div>
              )}
            </div>
          </div>

          {/* Disponibilidad real del endpoint («N en stock»/«Último»/«Agotado») + cantidad por-pieza. */}
          <div className="mt-7">
            <StockBadge count={available} className="text-[11px]" />
          </div>

          <div className="mt-4 flex items-center gap-4">
            <div className="flex items-center border border-border-strong">
              <button
                type="button"
                aria-label={t('detail.decrease')}
                disabled={clampedQty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-11 w-11 items-center justify-center text-text disabled:opacity-40"
              >
                <Minus size={16} aria-hidden />
              </button>
              <span className="tabular w-12 text-center font-mono text-base text-text" aria-live="polite">
                {clampedQty}
              </span>
              <button
                type="button"
                aria-label={t('detail.increase')}
                disabled={clampedQty >= available}
                onClick={() => setQty((q) => Math.min(available, q + 1))}
                className="flex h-11 w-11 items-center justify-center text-text disabled:opacity-40"
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>

            {allInCart ? (
              <Button variant="secondary" onClick={() => router.push('/checkout')}>
                {t('detail.goToCart')}
              </Button>
            ) : (
              <Button variant="accent" onClick={() => onAdd(idsToAdd)}>
                {t('detail.addToCart', { count: clampedQty })}
              </Button>
            )}
          </div>

          {/* Destino: recibir o dejar en bóveda — se decide en el checkout existente (§4/§4-G). */}
          <p className="rule-note mt-7 text-[13px] leading-[1.65] text-muted">{t('detail.destinationNote')}</p>

          {/* Feature-flag: «avísame cuando vuelva» (restock). Se muestra solo si el flag está ON. */}
          {restockEnabled && (
            <div className="mt-8 border-t border-border pt-6">
              <SealedRestockForm
                cardId={group.card.id}
                sealedSubtype={group.sealedSubtype ?? undefined}
                sealedCondition={group.sealedCondition}
              />
            </div>
          )}
        </div>
      </div>

      {/* Feature-flag: tendencia de valor del sellado (estilo acciones). Oculta si el flag está OFF
          o si el endpoint responde 404 (FEATURE_DISABLED / no mapeado). */}
      {trendEnabled && (
        <div className="gutter border-t border-border py-10">
          <SealedValueTrend inventoryItemId={group.representativeItemId} />
        </div>
      )}
    </div>
  );
}
