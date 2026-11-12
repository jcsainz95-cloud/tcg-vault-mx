'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SupplierQueryState as QueryState } from './SupplierQueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { SUPPLY_TTL, listSupplierOffers, withdrawSupplierOffer, type SupplierOffer } from '@/lib/api/suppliers';
import { CardLine } from './CardLine';
import { Expiry } from './Expiry';
import { ApiErrorBanner } from './ApiErrorBanner';
import { OFFER_TONE } from './supplier-labels';

export function SupplierOffersView() {
  const t = useTranslations('supplier.offers');
  const query = useQuery({ queryKey: ['supplier', 'offers'], queryFn: () => listSupplierOffers() });
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl text-text">{t('title')}</h1>
        <p className="text-sm text-muted">{t('lead', { hours: SUPPLY_TTL.offerHours })}</p>
      </header>
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} loading={<Skeleton className="h-40 w-full" />}>
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {query.data?.data.map((o) => (
              <li key={o.id} className="py-5">
                <OfferRow offer={o} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function OfferRow({ offer }: { offer: SupplierOffer }) {
  const t = useTranslations('supplier.offers');
  const to = useTranslations('supplier.offerStatus');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => withdrawSupplierOffer(offer.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier'] }),
  });
  const pending = offer.status === 'open';
  return (
    <div className="flex flex-col gap-3">
      <CardLine card={offer.card} />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <Badge tone={OFFER_TONE[offer.status]}>{to(offer.status)}</Badge>
        <span className="font-mono text-text">
          {t('line', { qty: offer.qty, condition: offer.condition, unit: formatMoneyCents(offer.unitCents, locale) })}
        </span>
        <span className="font-mono text-text">{t('total', { total: formatMoneyCents(offer.totalCents, locale) })}</span>
      </div>
      {pending && <Expiry iso={offer.expiresAt} />}
      <ApiErrorBanner error={m.error} />
      {pending && (
        <Button variant="secondary" size="sm" className="self-start" loading={m.isPending} onClick={() => m.mutate()}>
          {t('withdraw')}
        </Button>
      )}
    </div>
  );
}
