'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiErrorBanner } from '@/components/supplier/ApiErrorBanner';
import { CardLine } from '@/components/supplier/CardLine';
import { Expiry } from '@/components/supplier/Expiry';
import { OFFER_TONE } from '@/components/supplier/supplier-labels';
import { useRole } from '@/lib/role';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { listSupplyOffers, respondSupplyOffer, type OfferStatus, type SupplyOfferAdmin } from '@/lib/api/suppliers';

const STATUSES: OfferStatus[] = ['open', 'accepted', 'rejected', 'withdrawn', 'expired'];

/** Ofertas recibidas: aceptar o rechazar (super_admin). El servidor aplica el tope duro del 100 % (422). */
export function OffersTab() {
  const t = useTranslations('admin.suppliers.offers');
  const to = useTranslations('supplier.offerStatus');
  const { isSuperAdmin } = useRole();
  const [status, setStatus] = useState<OfferStatus | ''>('open');
  const query = useQuery({ queryKey: ['admin', 'supply-offers', status], queryFn: () => listSupplyOffers({ status: status || undefined }) });
  return (
    <div className="flex flex-col gap-5">
      <Select label={t('status')} value={status} onChange={(e) => setStatus(e.target.value as OfferStatus | '')} options={[{ value: '', label: t('allStatuses') }, ...STATUSES.map((s) => ({ value: s, label: to(s) }))]} />
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} loading={<Skeleton className="h-32 w-full" />}>
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {query.data?.data.map((o) => (
              <li key={o.id} className="py-5">
                <OfferRow o={o} canAct={isSuperAdmin} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function OfferRow({ o, canAct }: { o: SupplyOfferAdmin; canAct: boolean }) {
  const t = useTranslations('admin.suppliers.offers');
  const to = useTranslations('supplier.offerStatus');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (action: 'accept' | 'reject') => respondSupplyOffer(o.id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
  return (
    <div className="flex flex-col gap-3">
      <CardLine card={o.card} />
      <p className="text-sm text-text">{o.supplier.businessName}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Badge tone={OFFER_TONE[o.status]}>{to(o.status)}</Badge>
        {o.isBest && <Badge tone="accent">{t('best')}</Badge>}
        <span className="font-mono text-sm text-text">{t('line', { qty: o.qty, condition: o.condition, unit: formatMoneyCents(o.unitCents, locale) })}</span>
        <span className="font-mono text-sm text-text">{t('total', { total: formatMoneyCents(o.totalCents, locale) })}</span>
        {o.pctOfMarketBps != null && <span className="font-mono text-sm text-muted">{t('pctOfMarket', { pct: o.pctOfMarketBps / 100 })}</span>}
      </div>
      {o.aboveCap && <Banner variant="danger">{t('aboveCapWarn')}</Banner>}
      {o.status === 'open' && <Expiry iso={o.expiresAt} />}
      <ApiErrorBanner error={m.error} />
      {canAct && o.status === 'open' && (
        <div className="flex flex-wrap gap-3">
          <Button size="sm" loading={m.isPending} disabled={o.aboveCap} onClick={() => m.mutate('accept')}>{t('accept')}</Button>
          <Button size="sm" variant="secondary" loading={m.isPending} onClick={() => m.mutate('reject')}>{t('reject')}</Button>
        </div>
      )}
    </div>
  );
}
