'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ListingDTO } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { PriceTag } from '@/components/ui/PriceTag';
import { Button } from '@/components/ui/Button';

export interface ListingCardProps {
  listing: ListingDTO;
  onAdd?: (listing: ListingDTO) => void;
}

/**
 * Pieza del catálogo (DESIGN_SYSTEM §7.1 / §7.1b sellado).
 *
 * Dirección 5a: la tarjeta pierde la caja. Queda arte sobre su pozo de papel,
 * el nombre en mincho, la ficha técnica en un renglón mono y el precio como la
 * cifra más pesada del bloque. Nada se monta sobre el arte (§7.2b): la calidad
 * vive en el renglón de ListingSpec, bajo la imagen.
 */
export function ListingCard({ listing, onAdd }: ListingCardProps) {
  const t = useTranslations('catalog');
  const { card } = listing;
  const isSealed = listing.productType === 'sealed';

  return (
    <div className="flex flex-col">
      <Link href={`/catalog/${card.id}`} className="block">
        {/* imagen de catálogo remota (v1.2, sin fotos propias); sellado usa object-contain */}
        <CardImage src={card.imageSmallUrl} alt={card.name} />
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
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!listing.sellable}
          onClick={() => onAdd?.(listing)}
        >
          {listing.sellable ? t('addToCart') : t('notForSale')}
        </Button>
      </div>
    </div>
  );
}
