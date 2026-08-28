'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import type { GroupedListingSummaryDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { CardImage } from '@/components/ui/CardImage';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { RarityLabel } from '@/components/domain/RarityLabel';
import { StockBadge, stockVariantForSingle } from '../_shared/StockBadge';
import { PendingPriceLabel } from '../_shared/PendingPriceLabel';
import { GradingEstimateBadge } from '../_shared/grading/GradingEstimateBadge';
import { cn } from '@/lib/cn';

export interface CatalogTileProps {
  listing: GroupedListingSummaryDTO;
  /** Estado DERIVADO del carrito (useCart, por representativeInventoryItemId); el padre lo calcula. */
  inCart: boolean;
  onAdd: (listing: GroupedListingSummaryDTO) => void;
}

/**
 * Teja de la vitrina Comprar (artboard 2a, dirección 1a «Conservadora»):
 * arte 5:7 sobre pozo, nombre en mincho, renglón mono de set · número, la ficha
 * técnica de la variante (ListingSpec, §7.2b), el precio «desde» como cifra tabular
 * en sans y el distintivo de stock real del grupo («N en stock», §20.6).
 *
 * v1.38-grouped-listings (P-30): una teja = UNA publicación agrupada. v2.1.9 (D2): el DTO de la
 * REJILLA es `GroupedListingSummaryDTO` — SIN `priceBasis` ni `referenceValue`: el «Valor de
 * mercado» vive SOLO en la ficha (§N.7) y la teja nunca lo pintó, así que ya ni lo recibe.
 * no una copia física. `stockCount` es el conteo REAL del grupo (money-safe): el badge lo
 * traduce a su variante canónica (Queda 1 / N en stock / Agotado). El add-to-cart usa
 * `representativeInventoryItemId` (la pieza más barata; el carrito sigue por-pieza).
 *
 * Vive aquí (no en ListingCard) porque `frontend/src/components/` es zona
 * compartida de otros streams; la teja del makeover es propiedad de esta vista.
 */
export function CatalogTile({ listing, inCart, onAdd }: CatalogTileProps) {
  const t = useTranslations('catalog');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { card } = listing;
  // Un grupo del catálogo SIEMPRE es vendible (stockCount≥1); los agotados no llegan del backend.
  const sellable = listing.stockCount > 0;
  const showInCart = inCart && sellable;
  const href = `/catalog/${card.id}`;

  const ctaBase =
    'flex min-h-[44px] w-full items-center justify-center gap-2 px-2 text-[10px] font-medium uppercase tracking-label transition-colors';

  return (
    <div className="flex flex-col">
      <Link href={href} className="block">
        {/* imagen de catálogo remota (v1.2, sin fotos propias); sellado usa object-contain.
            P-39: el grid del catálogo es DENSO (muchas tejas por viewport) ⇒ se conserva la
            imagen CHICA (imageSmallUrl) por performance/ancho de banda. La alta resolución se
            reserva para superficies prominentes (featured del home y ficha de la carta). */}
        <CardImage src={card.imageSmallUrl} alt={card.name} />
      </Link>

      <p className="mt-3 font-serif text-sm leading-[1.3] text-text sm:text-base" lang="en">
        <Link href={href}>{card.name}</Link>
      </p>
      <p className="mt-1.5 font-mono text-[10px] leading-snug text-muted sm:text-[11px]" lang="en">
        {`${card.setName} · #${card.number}`}
      </p>

      {/* Fila de calidad bajo la imagen (§7.2b): RAW · NM · ACABADO / GRADED · PSA 9.
          El certNumber es POR SLAB (vive en units[] de la ficha), no a nivel de grupo. */}
      <ListingSpec
        productType={listing.productType}
        rawCondition={listing.rawCondition}
        finish={listing.finish}
        gradingCompany={listing.gradingCompany}
        gradeValue={listing.gradeValue}
        compact
        className="mt-2 text-muted"
      />

      {/* P-44: rareza junto al acabado (Illustration Rare, Full Art, Hyper Rare…). Discreta,
          mono muted; se omite sola en sellado o sin rareza (RarityLabel). */}
      <RarityLabel rarity={card.rarity} productType={listing.productType} className="mt-1.5" />

      {/* Precio «desde» del grupo: cifra tabular en sans; sin precio JAMÁS $0 — pendiente honesto (§7.3). */}
      {listing.salePriceCents != null ? (
        <p className="tabular mt-2.5 text-[15px] font-medium leading-none text-text sm:text-[17px]">
          {formatMoneyCents(listing.salePriceCents, locale)}
        </p>
      ) : (
        <PendingPriceLabel className="mt-2.5 block" />
      )}

      {/* Distintivo de stock REAL del grupo (§20.6): Queda 1 / N en stock (agotado no llega del backend). */}
      {sellable && (
        <StockBadge
          variant={stockVariantForSingle(listing.stockCount)}
          count={listing.stockCount}
          className="mt-2"
        />
      )}

      {/* «Gancho de grading» (§22.5): DESPUÉS del precio y del stock, ANTES del CTA — el orden de
          lectura obligatorio es precio real → estimado → CTA. Presencia ⇔ elegibilidad: sin
          `gradingHighlight` (o sin nota al pie en esta página) la teja se ve EXACTAMENTE como hoy,
          sin badge vacío ni altura reservada (R4). */}
      <GradingEstimateBadge listing={listing} />

      {/* mt-auto alinea el CTA abajo cuando las tejas de la fila difieren de altura */}
      <div className="mt-auto pt-3">
        {showInCart ? (
          // Pieza única deduplicada: el segundo clic no re-agrega, lleva al carrito.
          <button
            type="button"
            onClick={() => router.push('/checkout')}
            className={cn(ctaBase, 'border border-text text-text hover:bg-text hover:text-primary-fg')}
          >
            {/* Palomita decorativa (§7.4): el texto es el portador del estado. */}
            <Check size={14} aria-hidden className="text-accent" />
            {t('inCart')}
          </button>
        ) : (
          <button
            type="button"
            disabled={!sellable}
            onClick={() => onAdd(listing)}
            aria-label={sellable ? t('addToCart') : t('notForSale')}
            className={cn(
              ctaBase,
              'border border-text text-text hover:bg-text hover:text-primary-fg',
              'disabled:cursor-not-allowed disabled:border-border-strong disabled:text-muted disabled:hover:bg-transparent disabled:hover:text-muted',
            )}
          >
            {sellable ? (
              <>
                {/* Móvil 390px: etiqueta corta (artboard 2a móvil «Añadir»). */}
                <span className="sm:hidden">{t('addToCartShort')}</span>
                <span className="hidden sm:inline">{t('addToCart')}</span>
              </>
            ) : (
              t('notForSale')
            )}
          </button>
        )}
      </div>
    </div>
  );
}
