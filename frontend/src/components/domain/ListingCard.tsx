'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ListingDTO } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { PriceTag } from '@/components/ui/PriceTag';
import { Button } from '@/components/ui/Button';

export interface ListingCardProps {
  listing: ListingDTO;
  onAdd?: (listing: ListingDTO) => void;
  /**
   * N-17 (SOLO tienda/compra): estado DERIVADO del carrito (useCart, por inventoryItemId). El
   * padre lo calcula con `cart.ids.includes(listing.inventoryItemId)` — NO se duplica el store
   * aquí. `true` pinta un feedback SUTIL de "ya agregado" (palomita + estado del botón) con el
   * único acento bermellón del sistema. El carrito es pieza ÚNICA: la cantidad por listing es 0/1,
   * así que no hay contador que mostrar. Fuera de la tienda (bóveda/checkout) se omite (default false).
   */
  inCart?: boolean;
}

/**
 * Pieza del catálogo (DESIGN_SYSTEM §7.1 / §7.1b sellado).
 *
 * Dirección 5a: la tarjeta pierde la caja. Queda arte sobre su pozo de papel,
 * el nombre en mincho, la ficha técnica en un renglón mono y el precio como la
 * cifra más pesada del bloque. Nada se monta sobre el arte (§7.2b): la calidad
 * vive en el renglón de ListingSpec, bajo la imagen.
 */
export function ListingCard({ listing, onAdd, inCart = false }: ListingCardProps) {
  const t = useTranslations('catalog');
  const { card } = listing;
  const isSealed = listing.productType === 'sealed';
  // N-17: el feedback "en carrito" solo aplica a piezas comprables (sellable); una pieza no
  // vendible nunca está en el carrito de compra.
  const showInCart = inCart && listing.sellable;

  return (
    <div className="flex flex-col">
      <Link href={`/catalog/${card.id}`} className="relative block">
        {/* imagen de catálogo remota (v1.2, sin fotos propias); sellado usa object-contain */}
        <CardImage src={card.imageSmallUrl} alt={card.name} />
        {/* Palomita SUTIL de "ya agregado" con scrim de tinta (§7.2b): el acento bermellón la
            marca sin invadir el arte. El texto/botón de abajo es el portador real del estado. */}
        {showInCart && (
          <span
            className="absolute right-1.5 top-1.5 flex items-center gap-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-on-ink)]"
            aria-hidden
          >
            <Check size={12} className="text-accent" />
          </span>
        )}
      </Link>

      <p className="mt-3.5 font-serif text-base font-medium leading-tight text-text" lang="en">
        <Link href={`/catalog/${card.id}`}>{card.name}</Link>
      </p>
      <p className="mt-1.5 font-mono text-[11px] leading-snug text-muted" lang="en">
        {isSealed ? card.setName : `${card.setName} · #${card.number}`}
      </p>

      <ListingSpec
        productType={listing.productType}
        rawCondition={listing.rawCondition}
        sealedSubtype={listing.sealedSubtype}
        finish={listing.finish}
        gradingCompany={listing.gradingCompany}
        gradeValue={listing.gradeValue}
        certNumber={listing.certNumber}
        compact
        className="mt-2.5"
      />

      <div className="mt-3">
        <PriceTag
          reference={listing.referenceValue}
          salePriceCents={listing.salePriceCents}
          mode="sale"
        />
      </div>

      {/* mt-auto alinea el botón abajo cuando las fichas de la fila tienen alturas distintas */}
      <div className="mt-auto pt-3.5">
        {showInCart ? (
          // Ya en el carrito: estado SUTIL (§7.4 el texto es el portador; la palomita es
          // decorativa). Vuelve a agregar es idempotente (pieza única) — el padre decide el onAdd.
          <Button
            variant="secondary"
            size="sm"
            className="w-full text-accent"
            onClick={() => onAdd?.(listing)}
            aria-label={t('inCart')}
          >
            <Check size={14} aria-hidden />
            {t('inCart')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={!listing.sellable}
            onClick={() => onAdd?.(listing)}
          >
            {listing.sellable ? t('addToCart') : t('notForSale')}
          </Button>
        )}
      </div>
    </div>
  );
}
