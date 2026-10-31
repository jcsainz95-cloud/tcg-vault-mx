'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { getSealedGroupDetail } from '@/lib/api';
import type { SealedGroupDetailResponse, SealedGroupDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { IvaLabel } from '@/components/ui/IvaLabel';
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
import { StockBadge, stockVariantFromCount } from '../../_shared/StockBadge';
import { useStickyBottomBar } from '@/hooks/useStickyBottomBar';
import { centsToValue, track } from '@/lib/measurement/track';
import { measurementItemOf } from '@/lib/measurement/item';
import { RefundPromiseLine, ShippingFeeHint } from '../../_shared/ShippingFeeHint';

/** §MKT.H.4 (v1.106): identidad canónica del sellado — `s_<sealedProductId>` o `sc_<cardId ancla>`, nunca la pieza. */
function sealedItemOf(g: Pick<SealedGroupDTO, 'productName' | 'sealedProductId'> & { card: { id: string } }) {
  return measurementItemOf({ cardId: g.card.id, name: g.productName, productType: 'sealed', sealedProductId: g.sealedProductId });
}

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
              // §MKT.H.4 `add_to_cart` (con el modo `off`, no hace nada). Precio por pieza = «desde».
              const g = query.data!.group;
              const price = centsToValue(g.fromPriceCents);
              const id = sealedItemOf(g);
              track('add_to_cart', {
                items: id ? ids.map(() => ({ ...id, price })) : [],
                value: centsToValue(g.fromPriceCents * ids.length),
                currency: 'MXN',
              });
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
  // §A2: la barra de compra fija usa copy compartido del storefront para no colisionar con los
  // botones del cuerpo («Agregar {n} al carrito» / «Ir al carrito»).
  const tcat = useTranslations('catalog');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { group, listings, trendEnabled, restockEnabled } = detail;
  const cart = useCart();
  // MKT2-UX.5: la barra fija publica su alto (`--sticky-bottom-h`) para que el banner de cookies no la tape.
  const buyBarRef = useStickyBottomBar<HTMLDivElement>();
  // §MKT.H.4 `view_item`: una vez por grupo de sellado. Con el modo `off`, `track` no hace nada.
  const cardId = group.card.id;
  const productName = group.productName;
  // Un backend anterior a v1.106 no manda la clave ⇒ `sc_<ancla>`, nunca la pieza.
  const sealedProductId = group.sealedProductId ?? null;
  useEffect(() => {
    const price = centsToValue(group.fromPriceCents);
    const id = sealedItemOf({ card: { id: cardId }, productName, sealedProductId });
    track('view_item', {
      items: id ? [{ ...id, price }] : [],
      value: price,
      currency: 'MXN',
      market_value_shown: false,
    });
  }, [cardId, sealedProductId, productName, group.fromPriceCents]);

  const available = group.availableCount;
  const [qty, setQty] = useState(1);
  const clampedQty = Math.max(1, Math.min(qty, available));

  // Carrito por-pieza: agregar N = las N piezas MÁS BARATAS del grupo (listings ya vienen así).
  const idsToAdd = listings.slice(0, clampedQty).map((l) => l.inventoryItemId);
  const inCartCount = idsToAdd.filter((id) => cart.ids.includes(id)).length;
  const allInCart = inCartCount === idsToAdd.length && idsToAdd.length > 0;

  // §A1 (MKT-26a, D2=A, dueño 2026-10-16 · HECHOS:65): la ficha pública de sellado ya NO pinta la
  // celda «Valor de mercado». Este predicado se CONSERVA porque sigue gobernando la «Tendencia de
  // valor» (gateada por `trendEnabled`, §MIV.3): no publicar el mercado cuando el mercado no fijó el
  // precio (override ⇒ "override" ⇒ no; subtype_spread|global_spread ⇒ "market" ⇒ sí). La cifra con
  // IVA (`referenceDisplayCents`, §MIV.2) ya no se renderiza en la celda; solo decide si hay mercado.
  const marketDisplayCents =
    group.priceBasis === 'market' &&
    Number.isInteger(group.referenceDisplayCents) &&
    (group.referenceDisplayCents ?? 0) > 0
      ? group.referenceDisplayCents
      : undefined;
  const showMarketValue = marketDisplayCents !== undefined;

  return (
    // §A2 (MKT-26b): hueco inferior en móvil para que la barra de compra fija no tape el contenido.
    <div className="pb-24 lg:pb-0">
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

          {/* §A1 (MKT-26a): la ficha pública de sellado ya NO pinta «Valor de mercado». Queda una
              sola celda, «Desde», a fila completa. El predicado del mercado (`showMarketValue`)
              sigue vivo arriba, pero solo para gobernar la «Tendencia de valor» (§MIV.3), no esta
              retícula. */}
          <div className="mt-9 grid border-t border-border sm:grid-cols-2">
            <div className="border-b border-border py-6 sm:col-span-2">
              <div className="eyebrow">{t('fromPrice')}</div>
              <div className="mt-2.5 tabular text-3xl font-medium leading-none text-text">
                {formatMoneyCents(group.fromPriceCents, locale)}
              </div>
              {/* ⛔ §M10-IVA.3 — el rótulo lo dice el DATO (`ivaIncluded`), no la pantalla. */}
              <IvaLabel
                ivaIncluded={group.ivaIncluded}
                ivaRatePct={group.ivaRatePct}
                className="mt-2 block text-[11px] leading-none"
              />
            </div>
          </div>

          {/* T1b + T8 (§CHK-MOVIL.4): bajo el precio, fuera de su celda; importes del endpoint público. */}
          <ShippingFeeHint kind="sealed" className="mt-3" />
          <RefundPromiseLine className="mt-1" />

          {/* Disponibilidad real del endpoint («N en stock»/«Último»/«Agotado») + cantidad por-pieza. */}
          <div className="mt-7">
            <StockBadge
              variant={stockVariantFromCount(available)}
              count={available}
              className="text-[11px] sm:text-[11px]"
            />
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
              <SealedRestockForm inventoryItemId={group.representativeItemId} />
            </div>
          )}
        </div>
      </div>

      {/* Feature-flag: tendencia de valor del sellado (estilo acciones). Oculta si el flag está OFF
          o si el endpoint responde 404 (FEATURE_DISABLED / no mapeado).

          §21.8a + §N.7 — **también obedece `priceBasis`**. El objeto de la regla no es UNA CELDA: es
          **no publicar el valor de mercado cuando el mercado no fijó el precio**. Este bloque pinta
          la cifra a 32–40px y la rotula literalmente «valor de mercado de referencia», así que
          dejarlo incondicional hacía exactamente lo que la regla prohíbe, solo que 200px más abajo
          — y §21.8c es explícito en que el hueco no se rellena «ni con una explicación de por qué
          no está el mercado». Con `override` (o `pending`) desaparece; con precio derivado por
          SPREAD **sí hay mercado** y se muestra, que es la asimetría legítima. */}
      {trendEnabled && showMarketValue && (
        <div className="gutter border-t border-border py-10">
          {/* §MIV.3: la tasa del rótulo sale del grupo (la respuesta de la serie no la trae). */}
          <SealedValueTrend inventoryItemId={group.representativeItemId} ivaRatePct={group.ivaRatePct} />
        </div>
      )}

      {/* §A2 (MKT-26b): en móvil el precio «desde» con «IVA incluido» y el CTA de compra viven en
          una barra fija al pie, visibles sin scroll en la primera pantalla (la imagen llena el
          alto). Solo con ≥ 1 unidad a la venta (`available > 0`). En ≥ lg se oculta: ahí el precio y
          el CTA ya entran arriba, a la derecha del arte. z-40 como el FAB móvil del storefront. */}
      {available > 0 && (
        <div
          ref={buyBarRef}
          data-testid="mobile-buy-bar"
          aria-label={tcat('addToCart')}
          className="gutter fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 border-t border-border bg-bg py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
        >
          <div className="min-w-0">
            <div className="tabular text-xl font-medium leading-none text-text">
              {formatMoneyCents(group.fromPriceCents, locale)}
            </div>
            <IvaLabel
              ivaIncluded={group.ivaIncluded}
              ivaRatePct={group.ivaRatePct}
              className="mt-1.5 block leading-none"
            />
          </div>
          {allInCart ? (
            <Button variant="secondary" onClick={() => router.push('/checkout')}>
              {tcat('viewCart')}
            </Button>
          ) : (
            <Button variant="accent" onClick={() => onAdd(idsToAdd)}>
              {tcat('addToCart')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
