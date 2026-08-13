'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ListingDTO } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { Button } from '@/components/ui/Button';

export interface ListingCardProps {
  listing: ListingDTO;
  onAdd?: (listing: ListingDTO) => void;
}

/** CardTile de storefront (DESIGN_SYSTEM §7.1). */
export function ListingCard({ listing, onAdd }: ListingCardProps) {
  const t = useTranslations('catalog');
  const { card } = listing;

  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md">
      <Link
        href={`/catalog/${card.id}`}
        className="relative block rounded-md focus-visible:outline-none"
      >
        <div className="absolute left-2 top-2 z-10">
          <ConditionBadge
            productType={listing.productType}
            rawCondition={listing.rawCondition}
            gradingCompany={listing.gradingCompany}
            gradeValue={listing.gradeValue}
          />
        </div>
        <CardImage src={listing.frontPhotoUrl ?? card.imageSmallUrl} alt={card.name} />
      </Link>

      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 text-sm font-semibold text-text" lang="en">
          {card.name}
        </p>
        <p className="text-xs text-muted" lang="en">
          {card.setName} · #{card.number}
        </p>
      </div>

      <PriceTag reference={listing.referenceValue} salePriceCents={listing.salePriceCents} mode="sale" />

      <Button
        variant="accent"
        size="sm"
        className="mt-auto w-full"
        disabled={!listing.sellable}
        onClick={() => onAdd?.(listing)}
      >
        {listing.sellable ? t('addToCart') : t('notForSale')}
      </Button>
    </div>
  );
}
