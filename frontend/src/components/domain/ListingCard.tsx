'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ListingDTO } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { GradedCertChip } from '@/components/ui/GradedCertChip';
import { PriceTag } from '@/components/ui/PriceTag';
import { Button } from '@/components/ui/Button';

export interface ListingCardProps {
  listing: ListingDTO;
  onAdd?: (listing: ListingDTO) => void;
}

/** CardTile de storefront (DESIGN_SYSTEM §7.1 / §7.1b sellado). */
export function ListingCard({ listing, onAdd }: ListingCardProps) {
  const t = useTranslations('catalog');
  const { card } = listing;
  const isSealed = listing.productType === 'sealed';
  const isGraded = listing.productType === 'graded';

  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm transition-shadow hover:shadow-md">
      <Link
        href={`/catalog/${card.id}`}
        className="relative block rounded-md focus-visible:outline-none"
      >
        {/*
          Regla anti-empalme (§7.2b): la calidad va FUERA del arte (fila de info).
          La ÚNICA excepción sobre el arte es el chip de grado de gradeada, con scrim
          sólido, en la esquina superior-izquierda (top-2 left-2). Raw NM y sellado
          NUNCA se montan sobre el arte.
        */}
        {isGraded && (
          <div className="absolute left-2 top-2 z-10">
            <GradedCertChip
              gradingCompany={listing.gradingCompany}
              gradeValue={listing.gradeValue}
              certNumber={listing.certNumber}
              variant="scrim"
              compact
            />
          </div>
        )}
        {/* imagen de catálogo remota (v1.2, sin fotos propias); sellado usa object-contain */}
        <CardImage src={card.imageSmallUrl} alt={card.name} />
      </Link>

      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 text-sm font-semibold text-text" lang="en">
          {card.name}
        </p>
        <p className="text-xs text-muted" lang="en">
          {isSealed ? card.setName : `${card.setName} · #${card.number}`}
        </p>
      </div>

      {/* Fila de calidad (bajo la imagen, fuera del arte) — ubicación por defecto §7.2b */}
      <div className="flex flex-wrap gap-1.5">
        <ConditionBadge
          productType={listing.productType}
          rawCondition={listing.rawCondition}
          sealedSubtype={listing.sealedSubtype}
          gradingCompany={listing.gradingCompany}
          gradeValue={listing.gradeValue}
          certNumber={listing.certNumber}
        />
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
