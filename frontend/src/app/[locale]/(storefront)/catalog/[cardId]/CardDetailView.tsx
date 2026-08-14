'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { getCardDetail } from '@/lib/api';
import type { ListingDTO } from '@/types/contract';
import { useCart } from '@/lib/cart';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { ConditionBadge } from '@/components/ui/ConditionBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';

export function CardDetailView({ cardId }: { cardId: string }) {
  const t = useTranslations('card');
  const tcat = useTranslations('catalog');
  const cart = useCart();
  const [tab, setTab] = useState<'description' | 'condition' | 'photos'>('description');

  const query = useQuery({ queryKey: ['card', cardId], queryFn: () => getCardDetail(cardId) });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={
        <div className="grid gap-8 lg:grid-cols-2">
          <Skeleton className="aspect-[5/7] w-full max-w-sm" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      }
    >
      {query.data && (
        <Detail
          card={query.data.card}
          listings={query.data.listings}
          tab={tab}
          setTab={setTab}
          onAdd={(l) => cart.add(l.inventoryItemId)}
          t={t}
          tcat={tcat}
        />
      )}
    </QueryState>
  );
}

function Detail({
  card,
  listings,
  tab,
  setTab,
  onAdd,
  t,
  tcat,
}: {
  card: import('@/types/contract').CardDTO;
  listings: ListingDTO[];
  tab: 'description' | 'condition' | 'photos';
  setTab: (v: 'description' | 'condition' | 'photos') => void;
  onAdd: (l: ListingDTO) => void;
  t: ReturnType<typeof useTranslations>;
  tcat: ReturnType<typeof useTranslations>;
}) {
  const primary = listings[0];
  const tabs = [
    { key: 'description' as const, label: t('tabDescription') },
    { key: 'condition' as const, label: t('tabCondition') },
    { key: 'photos' as const, label: t('tabPhotos') },
  ];

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted">
        <Link href="/catalog" className="hover:text-text">
          {t('backToCatalog')}
        </Link>
        <ChevronRight size={14} aria-hidden />
        <span className="text-text" aria-current="page" lang="en">
          {card.name}
        </span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="mx-auto w-full max-w-sm">
          <CardImage src={primary?.frontPhotoUrl ?? card.imageLargeUrl} alt={card.name} />
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-h1 font-bold" lang="en">
              {card.name}
            </h1>
            <p className="text-muted" lang="en">
              {card.setName} · #{card.number} · {card.rarity}
            </p>
          </div>

          {primary && (
            <div className="flex items-center gap-3">
              <ConditionBadge
                productType={primary.productType}
                rawCondition={primary.rawCondition}
                sealedSubtype={primary.sealedSubtype}
                gradingCompany={primary.gradingCompany}
                gradeValue={primary.gradeValue}
              />
              <PriceTag reference={primary.referenceValue} salePriceCents={primary.salePriceCents} />
            </div>
          )}

          <Banner variant="info">{t('referenceExplainer')}</Banner>

          {/* Ejemplares disponibles */}
          <div className="flex flex-col gap-2">
            <h2 className="text-h3 font-semibold">{t('instances')}</h2>
            {listings.map((l) => (
              <div
                key={l.inventoryItemId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-center gap-3">
                  <ConditionBadge
                    productType={l.productType}
                    rawCondition={l.rawCondition}
                    sealedSubtype={l.sealedSubtype}
                    gradingCompany={l.gradingCompany}
                    gradeValue={l.gradeValue}
                  />
                  <PriceTag reference={l.referenceValue} salePriceCents={l.salePriceCents} />
                </div>
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!l.sellable}
                  onClick={() => onAdd(l)}
                >
                  {l.sellable ? tcat('buyNow') : tcat('notForSale')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div role="tablist" className="flex gap-1 border-b border-border">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tab === tb.key}
              onClick={() => setTab(tb.key)}
              className={
                tab === tb.key
                  ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-text'
                  : 'px-4 py-2 text-sm text-muted hover:text-text'
              }
            >
              {tb.label}
            </button>
          ))}
        </div>
        <div className="p-4 text-sm text-text">
          {tab === 'description' && (
            <p lang="en">
              {card.supertype} — {card.subtypes.join(', ')} · {card.setName}
            </p>
          )}
          {tab === 'condition' &&
            (primary?.productType === 'raw' ? (
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {t('condition')}: {tcat('condition.nm.label')}
                </p>
                <p className="text-muted">{tcat('condition.nm.desc')}</p>
              </div>
            ) : (
              <p>
                {t('condition')}: {primary?.gradeValue ?? primary?.sealedSubtype ?? '—'}
              </p>
            ))}
          {tab === 'photos' && (
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <div>
                <p className="mb-1 text-xs text-muted">{t('frontPhoto')}</p>
                <CardImage src={primary?.frontPhotoUrl ?? card.imageLargeUrl} alt={`${card.name} front`} />
              </div>
              {primary?.backPhotoUrl && (
                <div>
                  <p className="mb-1 text-xs text-muted">{t('backPhoto')}</p>
                  <CardImage src={primary.backPhotoUrl} alt={`${card.name} back`} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
